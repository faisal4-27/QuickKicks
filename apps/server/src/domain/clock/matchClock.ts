import type { FeedItem, MatchStatus } from '@quickkicks/shared';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { fixtures } from '../../db/schema.js';
import { env } from '../../env.js';
import { redis } from '../../redis/client.js';
import { keys } from '../../redis/keys.js';
import { publishToRoom } from '../../redis/pubsub.js';
import { emptyRoomState, readRoomState, writeRoomState } from '../../redis/roomState.js';
import { apiFixtureId } from '../../providers/apiFootball/refs.js';
import { ApiFootballProvider } from '../../providers/matchData/ApiFootballProvider.js';
import { MockMatchDataProvider } from '../../providers/matchData/MockMatchDataProvider.js';
import type { Subscription } from '../../providers/matchData/MatchDataProvider.js';
import { buildLineup, buildRefIndex, ratingsByRef } from '../../providers/matchData/lineup.js';
import { fixturePlayers, lineupSource } from '../../seed/catalog.js';
import { expireDuePowerUps, rehydratePowerUps } from '../powerups/powerUpService.js';
import { setRoomStatus } from '../room/roomService.js';
import { currentStandings, loadRoom, publishMembers } from '../room/snapshot.js';
import { buildRecap } from '../scoring/recap.js';
import { ingestEvent, type IngestContext } from '../scoring/scoringEngine.js';
import { expireDueTrades } from '../roster/tradeService.js';

interface RunningClock {
  cancel: () => void;
  subscription: Subscription;
  ctx: IngestContext;
  minute: number;
  ticking: boolean;
  stopped: boolean;
}

const clocks = new Map<string, RunningClock>();

/** Nobody needs the feed more often than this while the teams are in the dressing room. */
const HALF_TIME_POLL_MS = 3 * 60_000;
/** Longest single wait before kickoff, so a rescheduled kickoff is noticed. */
const MAX_PRE_KICKOFF_WAIT_MS = 15 * 60_000;

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
 * Starts (or resumes) the only timer in the system. A simulated fixture is stepped one
 * match-minute at a time; a real one is polled, with the minute taken from the feed. Either way
 * each tick runs the same sequence — ingest events, expire power-ups and trades, write room
 * state, publish — so the rest of the game cannot tell which kind of match it is watching.
 */
export async function startMatchClock(roomId: string): Promise<void> {
  if (clocks.has(roomId)) return;

  const room = await loadRoom(roomId);
  const catalog = await fixturePlayers(db, room.fixtureId);
  const source = lineupSource(catalog, roomId);

  const lineup = buildLineup(source);
  const refIndex = buildRefIndex(source);

  const ctx: IngestContext = {
    roomId,
    rules: room.scoringRules,
    refIndex,
    homeTeamRef: lineup.home.teamRef,
  };

  const state = (await readRoomState(roomId)) ?? emptyRoomState();
  const startMinute = state.matchMinute;
  await rehydratePowerUps(roomId, startMinute);

  // Per-tick collectors, filled by the subscription handler while the provider delivers.
  let feedBuffer: FeedItem[] = [];
  let touched = new Set<string>();
  let homeGoals = state.homeGoals;
  let awayGoals = state.awayGoals;
  let lastSequence = state.sequence;

  const handler = async (event: Parameters<typeof ingestEvent>[1]) => {
    const result = await ingestEvent(ctx, event);
    lastSequence = Math.max(lastSequence, event.sequence);
    if (result.feedItem) feedBuffer.push(result.feedItem);
    for (const memberId of result.touchedMemberIds) touched.add(memberId);
    if (result.goal === 'home') homeGoals += 1;
    if (result.goal === 'away') awayGoals += 1;
  };

  const running: RunningClock = {
    cancel: () => undefined,
    subscription: { unsubscribe: () => undefined },
    ctx,
    minute: startMinute,
    ticking: false,
    stopped: false,
  };

  /** Everything a tick does once the provider has delivered this minute's events. */
  async function settle(minute: number, status: MatchStatus): Promise<void> {
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

    if (status === 'finished') await finish();
  }

  async function finish(): Promise<void> {
    await stopMatchClock(roomId);
    await setRoomStatus(roomId, 'finished');
    // Republish standings first so the leaderboard and the recap cannot disagree on screen.
    await publishToRoom(roomId, 'score:update', { standings: await currentStandings(roomId) });
    await publishToRoom(roomId, 'match:finished', { recap: await buildRecap(roomId) });
    await publishToRoom(roomId, 'room:status', { status: 'finished' });
  }

  clocks.set(roomId, running);
  await redis.sadd(keys.liveRooms(), roomId);

  const fixtureId = apiFixtureId(catalog.fixture.externalRef);

  if (fixtureId === null) {
    // Seeding on the room id means every room gets its own match, and the same room always
    // replays the same one.
    const provider = new MockMatchDataProvider({
      matchId: roomId,
      lineup,
      ratings: ratingsByRef(source),
      seed: roomId,
    });
    running.subscription = await provider.subscribe(
      roomId,
      handler,
      startMinute > 0 ? { sinceSequence: state.sequence } : {},
    );

    const tick = async (): Promise<void> => {
      // A slow tick must not overlap the next one, or events would interleave out of order.
      if (running.ticking || running.stopped) return;
      running.ticking = true;
      try {
        running.minute += 1;
        const minute = running.minute;
        feedBuffer = [];
        touched = new Set<string>();
        await provider.advanceTo(roomId, minute);
        await settle(minute, statusFor(minute, provider.finalMinute));
      } catch (error) {
        console.error(`[clock] room ${roomId} tick failed`, error);
      } finally {
        running.ticking = false;
      }
    };

    const timer = setInterval(() => void tick(), room.msPerMatchMinute);
    running.cancel = () => clearInterval(timer);
    return;
  }

  const provider = new ApiFootballProvider({
    matchId: roomId,
    fixtureId,
    lineup,
    pollIntervalMs: env.API_FOOTBALL_LIVE_POLL_SECONDS * 1000,
  });
  running.subscription = await provider.subscribe(roomId, handler, { sinceSequence: state.sequence });

  let timer: NodeJS.Timeout | null = null;
  let lastFixtureStatus: MatchStatus = catalog.fixture.status;
  const schedule = (delayMs: number) => {
    if (running.stopped) return;
    timer = setTimeout(() => void poll(), delayMs);
  };
  running.cancel = () => {
    if (timer) clearTimeout(timer);
  };

  const poll = async (): Promise<void> => {
    if (running.ticking || running.stopped) return;
    running.ticking = true;
    let nextDelay = provider.pollIntervalMs;
    try {
      // Polling before kickoff spends quota to learn nothing. The kickoff is re-read each time
      // because the fixture sync moves it when a match is rescheduled.
      const kickoff = (
        await db.select({ kickoffAt: fixtures.kickoffAt }).from(fixtures).where(eq(fixtures.id, room.fixtureId)).limit(1)
      )[0]?.kickoffAt;
      const untilKickoff = (kickoff?.getTime() ?? 0) - Date.now();
      if (untilKickoff > 0) {
        if (running.minute === 0) {
          // The draft ends with the room live, but the match itself has not started yet.
          await writeRoomState(roomId, { matchMinute: 0, matchStatus: 'scheduled' });
          await publishToRoom(roomId, 'match:tick', { minute: 0, status: 'scheduled', homeGoals, awayGoals });
        }
        nextDelay = Math.min(untilKickoff, MAX_PRE_KICKOFF_WAIT_MS);
        return;
      }

      feedBuffer = [];
      touched = new Set<string>();
      const snapshot = await provider.poll(roomId);
      // The feed's own score is authoritative: it already accounts for own goals and VAR.
      homeGoals = snapshot.score.home;
      awayGoals = snapshot.score.away;
      running.minute = Math.max(running.minute, snapshot.minute);

      if (snapshot.status !== lastFixtureStatus) {
        lastFixtureStatus = snapshot.status;
        await db.update(fixtures).set({ status: snapshot.status }).where(eq(fixtures.id, room.fixtureId));
      }

      await settle(running.minute, snapshot.status);
      if (snapshot.status === 'half_time') nextDelay = Math.max(nextDelay, HALF_TIME_POLL_MS);
    } catch (error) {
      console.error(`[clock] room ${roomId} poll failed`, error);
    } finally {
      running.ticking = false;
      schedule(nextDelay);
    }
  };

  schedule(0);
}

export async function stopMatchClock(roomId: string): Promise<void> {
  const running = clocks.get(roomId);
  if (!running) return;
  running.stopped = true;
  running.cancel();
  await running.subscription.unsubscribe();
  clocks.delete(roomId);
  await redis.srem(keys.liveRooms(), roomId);
}

export async function stopAllClocks(): Promise<void> {
  await Promise.all([...clocks.keys()].map((roomId) => stopMatchClock(roomId)));
}
