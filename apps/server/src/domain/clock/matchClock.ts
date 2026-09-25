import type { FeedItem, MatchStatus } from '@quickkicks/shared';
import { db } from '../../db/client.js';
import { redis } from '../../redis/client.js';
import { keys } from '../../redis/keys.js';
import { publishToRoom } from '../../redis/pubsub.js';
import { emptyRoomState, readRoomState, writeRoomState } from '../../redis/roomState.js';
import { MockMatchDataProvider } from '../../providers/matchData/MockMatchDataProvider.js';
import type { DrivableMatchDataProvider, Subscription } from '../../providers/matchData/MatchDataProvider.js';
import { buildLineup, buildRefIndex, ratingsByRef } from '../../providers/matchData/lineup.js';
import { fixturePlayers } from '../../seed/catalog.js';
import { expireDuePowerUps, rehydratePowerUps } from '../powerups/powerUpService.js';
import { setRoomStatus } from '../room/roomService.js';
import { currentStandings, loadRoom, publishMembers } from '../room/snapshot.js';
import { buildRecap } from '../scoring/recap.js';
import { ingestEvent, type IngestContext } from '../scoring/scoringEngine.js';
import { expireDueTrades } from '../roster/tradeService.js';

interface RunningClock {
  timer: NodeJS.Timeout;
  provider: DrivableMatchDataProvider;
  subscription: Subscription;
  ctx: IngestContext;
  minute: number;
  finalMinute: number;
  ticking: boolean;
  stopped: boolean;
}

const clocks = new Map<string, RunningClock>();

export function isClockRunning(roomId: string): boolean {
  return clocks.has(roomId);
}

function statusFor(minute: number, finalMinute: number, halfTime = 45): MatchStatus {
  if (minute >= finalMinute) return 'finished';
  if (minute === halfTime) return 'half_time';
  if (minute <= 0) return 'scheduled';
  return 'live';
}

/**
 * Starts (or resumes) the only timer in the system. It steps the provider one match-minute at a
 * time, which keeps event delivery, power-up expiry and the displayed clock on a single
 * timeline. A real provider would not be steppable; the clock would poll its snapshot instead.
 */
export async function startMatchClock(roomId: string): Promise<void> {
  if (clocks.has(roomId)) return;

  const room = await loadRoom(roomId);
  const catalog = await fixturePlayers(db, room.fixtureId);
  const source = {
    matchId: roomId,
    homeTeam: catalog.homeTeam,
    awayTeam: catalog.awayTeam,
    homePlayers: catalog.homePlayers,
    awayPlayers: catalog.awayPlayers,
  };

  const lineup = buildLineup(source);
  const refIndex = buildRefIndex(source);

  // Seeding on the room id means every room gets its own match, and the same room always
  // replays the same one.
  const provider = new MockMatchDataProvider({
    matchId: roomId,
    lineup,
    ratings: ratingsByRef(source),
    seed: roomId,
  });

  const ctx: IngestContext = {
    roomId,
    rules: room.scoringRules,
    refIndex,
    homeTeamRef: lineup.home.teamRef,
  };

  const state = (await readRoomState(roomId)) ?? emptyRoomState();
  const startMinute = state.matchMinute;
  await rehydratePowerUps(roomId, startMinute);

  // Per-tick collectors, filled by the subscription handler while advanceTo runs.
  let feedBuffer: FeedItem[] = [];
  let touched = new Set<string>();
  let homeGoals = state.homeGoals;
  let awayGoals = state.awayGoals;
  let lastSequence = state.sequence;

  const subscription = await provider.subscribe(
    roomId,
    async (event) => {
      const result = await ingestEvent(ctx, event);
      lastSequence = Math.max(lastSequence, event.sequence);
      if (result.feedItem) feedBuffer.push(result.feedItem);
      for (const memberId of result.touchedMemberIds) touched.add(memberId);
      if (result.goal === 'home') homeGoals += 1;
      if (result.goal === 'away') awayGoals += 1;
    },
    startMinute > 0 ? { sinceSequence: state.sequence } : {},
  );

  const running: RunningClock = {
    timer: setInterval(() => void tick(), room.msPerMatchMinute),
    provider,
    subscription,
    ctx,
    minute: startMinute,
    finalMinute: provider.finalMinute,
    ticking: false,
    stopped: false,
  };
  clocks.set(roomId, running);
  await redis.sadd(keys.liveRooms(), roomId);

  async function tick(): Promise<void> {
    // A slow tick must not overlap the next one, or events would interleave out of order.
    if (running.ticking || running.stopped) return;
    running.ticking = true;
    try {
      running.minute += 1;
      const minute = running.minute;
      feedBuffer = [];
      touched = new Set<string>();

      await provider.advanceTo(roomId, minute);

      const status = statusFor(minute, running.finalMinute);
      await writeRoomState(roomId, {
        matchMinute: minute,
        matchStatus: status,
        homeGoals,
        awayGoals,
        sequence: lastSequence,
      });

      await publishToRoom(roomId, 'match:tick', { minute, status, homeGoals, awayGoals });

      if (feedBuffer.length > 0) {
        await publishToRoom(roomId, 'match:events', { items: feedBuffer });
      }

      for (const expired of await expireDuePowerUps(roomId, minute)) {
        await publishToRoom(roomId, 'powerup:expired', {
          memberId: expired.memberId,
          powerUpId: expired.id,
        });
      }

      for (const trade of await expireDueTrades(roomId, minute)) {
        await publishToRoom(roomId, 'trade:resolved', { trade });
      }

      // Members, not just standings: the points on each rostered player moved too.
      if (touched.size > 0) await publishMembers(roomId);

      if (minute >= running.finalMinute) await finish();
    } catch (error) {
      console.error(`[clock] room ${roomId} tick failed`, error);
    } finally {
      running.ticking = false;
    }
  }

  async function finish(): Promise<void> {
    await stopMatchClock(roomId);
    await setRoomStatus(roomId, 'finished');
    // Republish standings first so the leaderboard and the recap cannot disagree on screen.
    await publishToRoom(roomId, 'score:update', { standings: await currentStandings(roomId) });
    await publishToRoom(roomId, 'match:finished', { recap: await buildRecap(roomId) });
    await publishToRoom(roomId, 'room:status', { status: 'finished' });
  }
}

export async function stopMatchClock(roomId: string): Promise<void> {
  const running = clocks.get(roomId);
  if (!running) return;
  running.stopped = true;
  clearInterval(running.timer);
  await running.subscription.unsubscribe();
  clocks.delete(roomId);
  await redis.srem(keys.liveRooms(), roomId);
}

export async function stopAllClocks(): Promise<void> {
  await Promise.all([...clocks.keys()].map((roomId) => stopMatchClock(roomId)));
}
