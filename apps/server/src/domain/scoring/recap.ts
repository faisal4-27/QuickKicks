import {
  type MatchEventType,
  type MatchRecap,
  type RecapPlayerLine,
  type RecapRow,
  roundPoints,
} from '@quickkicks/shared';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { matchEvents, players, roomMembers, rosterSlots, scoreEntries } from '../../db/schema.js';
import { emptyRoomState, readRoomState } from '../../redis/roomState.js';
import { computeStandings } from './standings.js';

/**
 * The end-of-match story: where each manager's points actually came from. Built entirely from
 * the ledger, so it agrees with the live leaderboard by construction.
 */
export async function buildRecap(roomId: string): Promise<MatchRecap> {
  const [members, state, entries, slots, playerRows] = await Promise.all([
    db.select().from(roomMembers).where(eq(roomMembers.roomId, roomId)),
    readRoomState(roomId).then((s) => s ?? emptyRoomState()),
    db
      .select({
        memberId: scoreEntries.memberId,
        playerId: scoreEntries.playerId,
        awardedPoints: scoreEntries.awardedPoints,
        basePoints: scoreEntries.basePoints,
        multiplier: scoreEntries.multiplier,
        type: matchEvents.type,
      })
      .from(scoreEntries)
      .leftJoin(matchEvents, eq(scoreEntries.matchEventId, matchEvents.id))
      .where(eq(scoreEntries.roomId, roomId)),
    db.select().from(rosterSlots).where(eq(rosterSlots.roomId, roomId)),
    db.select({ id: players.id, fullName: players.fullName }).from(players),
  ]);

  const nameById = new Map(playerRows.map((p) => [p.id, p.fullName]));

  const totals = new Map<string, number>();
  const byMemberPlayer = new Map<string, number>();
  const breakdowns = new Map<string, Map<MatchEventType, { count: number; points: number }>>();
  const powerUpBonus = new Map<string, number>();

  for (const entry of entries) {
    const awarded = roundPoints(entry.awardedPoints);
    totals.set(entry.memberId, roundPoints((totals.get(entry.memberId) ?? 0) + awarded));

    const playerKey = `${entry.memberId}:${entry.playerId}`;
    byMemberPlayer.set(playerKey, roundPoints((byMemberPlayer.get(playerKey) ?? 0) + awarded));

    const type = (entry.type ?? 'period.end') as MatchEventType;
    const memberBreakdown = breakdowns.get(entry.memberId) ?? new Map();
    const line = memberBreakdown.get(type) ?? { count: 0, points: 0 };
    line.count += 1;
    line.points = roundPoints(line.points + awarded);
    memberBreakdown.set(type, line);
    breakdowns.set(entry.memberId, memberBreakdown);

    if (entry.multiplier !== 1) {
      const bonus = roundPoints(awarded - entry.basePoints);
      powerUpBonus.set(
        entry.memberId,
        roundPoints((powerUpBonus.get(entry.memberId) ?? 0) + bonus),
      );
    }
  }

  const standings = computeStandings(
    members.map((m) => ({
      memberId: m.id,
      displayName: m.displayName,
      draftPosition: m.draftPosition,
      points: totals.get(m.id) ?? 0,
    })),
  );

  const rows: RecapRow[] = standings.map((standing) => {
    const memberSlots = slots
      .filter((s) => s.memberId === standing.memberId)
      .sort((a, b) => a.acquiredAtMinute - b.acquiredAtMinute || a.slotIndex - b.slotIndex);

    const playerLines: RecapPlayerLine[] = memberSlots.map((slot) => ({
      playerId: slot.playerId,
      playerName: nameById.get(slot.playerId) ?? 'Unknown player',
      points: byMemberPlayer.get(`${standing.memberId}:${slot.playerId}`) ?? 0,
      fromMinute: slot.acquiredAtMinute,
      toMinute: slot.releasedAtMinute,
      acquiredVia: slot.acquiredVia,
    }));

    const breakdown = [...(breakdowns.get(standing.memberId) ?? new Map()).entries()]
      .map(([type, line]) => ({ type, count: line.count, points: line.points }))
      .sort((a, b) => Math.abs(b.points) - Math.abs(a.points));

    return {
      memberId: standing.memberId,
      displayName: standing.displayName,
      rank: standing.rank,
      points: standing.points,
      tied: standing.tied,
      players: playerLines,
      breakdown,
      powerUpPoints: powerUpBonus.get(standing.memberId) ?? 0,
    };
  });

  return {
    roomId,
    finalMinute: state.matchMinute,
    homeGoals: state.homeGoals,
    awayGoals: state.awayGoals,
    rows,
  };
}

/** Point totals straight from the ledger, used to rebuild the Redis leaderboard. */
export async function ledgerTotals(roomId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({
      memberId: scoreEntries.memberId,
      points: sql<number>`coalesce(sum(${scoreEntries.awardedPoints}), 0)`,
    })
    .from(scoreEntries)
    .where(eq(scoreEntries.roomId, roomId))
    .groupBy(scoreEntries.memberId);
  return new Map(rows.map((r) => [r.memberId, roundPoints(Number(r.points))]));
}
