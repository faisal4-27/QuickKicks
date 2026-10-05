import { draftPositionForPick } from '@quickkicks/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { draftPicks, matchEvents, players, rooms, rosterSlots } from '../../db/schema.js';
import { redis } from '../../redis/client.js';
import { keys } from '../../redis/keys.js';
import { clearRoomState, writeRoomState } from '../../redis/roomState.js';
import { starterIds } from '../../providers/matchData/lineup.js';
import { fixturePlayers, lineupSource } from '../../seed/catalog.js';
import { startMatchClock } from '../clock/matchClock.js';
import { resumeDraftTimer } from '../draft/draftService.js';
import { rehydratePowerUps } from '../powerups/powerUpService.js';
import { ledgerTotals } from '../scoring/recap.js';
import { clearPresence } from '../../ws/presence.js';
import { loadMembers, loadRoom } from './snapshot.js';

/**
 * Rebuilds every Redis key for a room from Postgres.
 *
 * This function is what lets the rest of the code treat Redis as a pure cache. Flushing Redis, or
 * losing it entirely, costs a reconnect and nothing else: no picks, no points and no ownership
 * history live only in memory.
 */
export async function rehydrateRoom(roomId: string): Promise<void> {
  const room = await loadRoom(roomId);
  const members = await loadMembers(roomId);
  const catalog = await fixturePlayers(db, room.fixtureId);

  await clearRoomState(roomId);
  await clearPresence(roomId);

  const pool = starterIds(lineupSource(catalog, roomId));

  const owned = await db
    .select({ playerId: rosterSlots.playerId, memberId: rosterSlots.memberId })
    .from(rosterSlots)
    .where(and(eq(rosterSlots.roomId, roomId), isNull(rosterSlots.releasedAtMinute)));

  const ownedById = new Map(owned.map((row) => [row.playerId, row.memberId]));

  const available = pool.filter((id) => !ownedById.has(id));
  if (available.length > 0) await redis.sadd(keys.available(roomId), ...available);
  if (ownedById.size > 0) {
    await redis.hset(keys.owners(roomId), Object.fromEntries(ownedById));
  }

  const totals = await ledgerTotals(roomId);
  if (totals.size > 0) {
    const args: (string | number)[] = [];
    for (const [memberId, points] of totals) args.push(points, memberId);
    await redis.zadd(keys.scores(roomId), ...(args as [string | number, ...(string | number)[]]));
  }

  const progress = await matchProgress(roomId, catalog.fixture.homeTeamId);
  await writeRoomState(roomId, {
    status: room.status,
    matchMinute: progress.minute,
    matchStatus: room.status === 'finished' ? 'finished' : progress.minute > 0 ? 'live' : 'scheduled',
    homeGoals: progress.homeGoals,
    awayGoals: progress.awayGoals,
    sequence: progress.sequence,
  });

  await rehydratePowerUps(roomId, progress.minute);

  if (room.status === 'drafting') {
    const picked = await db
      .select({ count: sql<number>`count(*)` })
      .from(draftPicks)
      .where(eq(draftPicks.roomId, roomId));
    const nextPickNumber = Number(picked[0]?.count ?? 0) + 1;
    await writeRoomState(roomId, { currentPickNumber: nextPickNumber });

    // Re-derive whose turn it is from the snake order rather than trusting anything cached.
    const position = draftPositionForPick(nextPickNumber, members.length, room.draftConfig.rounds);
    const member = position === null ? undefined : members.find((m) => m.draftPosition === position);
    await writeRoomState(roomId, {
      currentMemberId: member?.id ?? null,
      pickDeadlineMs: Date.now() + room.draftConfig.pickTimerSeconds * 1000,
    });
    await resumeDraftTimer(roomId);
  }

  if (room.status === 'live') {
    await startMatchClock(roomId);
  }
}

interface MatchProgress {
  minute: number;
  sequence: number;
  homeGoals: number;
  awayGoals: number;
}

async function matchProgress(roomId: string, homeTeamId: string): Promise<MatchProgress> {
  const [aggregate] = await db
    .select({
      minute: sql<number>`coalesce(max(${matchEvents.matchMinute}), 0)`,
      sequence: sql<number>`coalesce(max(${matchEvents.sequence}), 0)`,
    })
    .from(matchEvents)
    .where(eq(matchEvents.roomId, roomId));

  const goals = await db
    .select({ teamId: players.teamId, type: matchEvents.type, count: sql<number>`count(*)` })
    .from(matchEvents)
    .innerJoin(players, eq(matchEvents.playerId, players.id))
    .where(
      and(eq(matchEvents.roomId, roomId), inArray(matchEvents.type, ['goal.scored', 'goal.own'])),
    )
    .groupBy(players.teamId, matchEvents.type);

  let homeGoals = 0;
  let awayGoals = 0;
  for (const row of goals) {
    // An own goal is charged to the scorer's team but counts for the other one.
    const forHome = (row.teamId === homeTeamId) !== (row.type === 'goal.own');
    if (forHome) homeGoals += Number(row.count);
    else awayGoals += Number(row.count);
  }

  return {
    minute: Number(aggregate?.minute ?? 0),
    sequence: Number(aggregate?.sequence ?? 0),
    homeGoals,
    awayGoals,
  };
}

/** Called once on boot: any room that was mid-draft or mid-match picks up where it left off. */
export async function rehydrateActiveRooms(): Promise<number> {
  const active = await db
    .select({ id: rooms.id })
    .from(rooms)
    .where(inArray(rooms.status, ['drafting', 'live']));

  for (const room of active) {
    try {
      await rehydrateRoom(room.id);
    } catch (error) {
      console.error(`[rehydrate] room ${room.id} failed`, error);
    }
  }
  return active.length;
}
