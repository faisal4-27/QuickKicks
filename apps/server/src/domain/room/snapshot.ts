import {
  totalPicks as calcTotalPicks,
  type DraftPickView,
  type FeedItem,
  type MatchEventType,
  type MemberView,
  type Player,
  type PowerUpView,
  type RoomSnapshot,
  type RosterEntryView,
  type StandingRow,
  type TradeView,
  roundPoints,
} from '@quickkicks/shared';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  draftPicks,
  matchEvents,
  powerUps,
  roomMembers,
  rooms,
  rosterSlots,
  scoreEntries,
  swaps,
  trades,
} from '../../db/schema.js';
import { keys } from '../../redis/keys.js';
import { publishToRoom } from '../../redis/pubsub.js';
import { redis } from '../../redis/client.js';
import { emptyRoomState, readRoomState } from '../../redis/roomState.js';
import { fixturePlayers } from '../../seed/catalog.js';
import { computeStandings } from '../scoring/standings.js';

export const FEED_EXCLUDED_TYPES: readonly MatchEventType[] = [
  // Passes are the highest-volume event by an order of magnitude. They belong in point totals,
  // not in a feed a human is trying to read.
  'pass.completed',
  'pass.missed',
  'shot.off_target',
  'sub.on',
  'sub.off',
  'period.start',
  'period.end',
];

export const FEED_LIMIT = 60;

export function isFeedWorthy(type: MatchEventType): boolean {
  return !FEED_EXCLUDED_TYPES.includes(type);
}

export class RoomNotFoundError extends Error {
  constructor(idOrCode: string) {
    super(`Room not found: ${idOrCode}`);
    this.name = 'RoomNotFoundError';
  }
}

export async function loadRoom(roomId: string) {
  const row = (await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1))[0];
  if (!row) throw new RoomNotFoundError(roomId);
  return row;
}

export async function loadMembers(roomId: string) {
  return db
    .select()
    .from(roomMembers)
    .where(eq(roomMembers.roomId, roomId))
    .orderBy(roomMembers.draftPosition);
}

/** Total points per manager, straight off the ledger. */
export async function pointsByMember(roomId: string): Promise<Map<string, number>> {
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

async function pointsByMemberPlayer(roomId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({
      memberId: scoreEntries.memberId,
      playerId: scoreEntries.playerId,
      points: sql<number>`coalesce(sum(${scoreEntries.awardedPoints}), 0)`,
    })
    .from(scoreEntries)
    .where(eq(scoreEntries.roomId, roomId))
    .groupBy(scoreEntries.memberId, scoreEntries.playerId);
  // Keyed by manager+player rather than by stint. A manager re-acquiring a player they already
  // owned would see both stints merged here; the ledger itself still has the per-minute detail.
  return new Map(rows.map((r) => [`${r.memberId}:${r.playerId}`, roundPoints(Number(r.points))]));
}

async function loadFeed(roomId: string, playersById: Map<string, Player>): Promise<FeedItem[]> {
  const events = await db
    .select()
    .from(matchEvents)
    .where(eq(matchEvents.roomId, roomId))
    .orderBy(desc(matchEvents.sequence))
    .limit(400);

  const worthy = events.filter((e) => isFeedWorthy(e.type)).slice(0, FEED_LIMIT);
  if (worthy.length === 0) return [];

  const entries = await db
    .select()
    .from(scoreEntries)
    .where(
      and(
        eq(scoreEntries.roomId, roomId),
        inArray(
          scoreEntries.matchEventId,
          worthy.map((e) => e.id),
        ),
      ),
    );

  const awardsByEvent = new Map<string, FeedItem['awards']>();
  for (const entry of entries) {
    if (!entry.matchEventId) continue;
    const list = awardsByEvent.get(entry.matchEventId) ?? [];
    list.push({
      memberId: entry.memberId,
      awardedPoints: roundPoints(entry.awardedPoints),
      multiplier: entry.multiplier,
    });
    awardsByEvent.set(entry.matchEventId, list);
  }

  return worthy.map((event) => {
    const player = event.playerId ? playersById.get(event.playerId) : undefined;
    return {
      id: event.id,
      minute: event.matchMinute,
      type: event.type,
      playerId: event.playerId,
      playerName: player?.fullName ?? null,
      position: player?.position ?? null,
      awards: awardsByEvent.get(event.id) ?? [],
    };
  });
}

export async function availablePlayerIds(roomId: string, poolIds: string[]): Promise<string[]> {
  const cached = await redis.smembers(keys.available(roomId));
  if (cached.length > 0) return cached;
  // Redis is a derived cache, so a cold key just means recomputing from the source of truth.
  const owned = await db
    .select({ playerId: rosterSlots.playerId })
    .from(rosterSlots)
    .where(and(eq(rosterSlots.roomId, roomId), isNull(rosterSlots.releasedAtMinute)));
  const ownedSet = new Set(owned.map((r) => r.playerId));
  return poolIds.filter((id) => !ownedSet.has(id));
}

export async function buildRoomSnapshot(roomId: string): Promise<RoomSnapshot> {
  const room = await loadRoom(roomId);
  const [members, catalog, state] = await Promise.all([
    loadMembers(roomId),
    fixturePlayers(db, room.fixtureId),
    readRoomState(roomId).then((s) => s ?? emptyRoomState()),
  ]);

  const allPlayers: Player[] = [...catalog.homePlayers, ...catalog.awayPlayers].map((p) => ({
    id: p.id,
    externalRef: p.externalRef,
    teamId: p.teamId,
    fullName: p.fullName,
    position: p.position,
    shirtNumber: p.shirtNumber,
    rating: p.rating,
  }));
  const playersById = new Map(allPlayers.map((p) => [p.id, p]));

  const [picks, slots, powerUpRows, swapRows, tradeRows, totals, perPlayer, feed, connected] =
    await Promise.all([
      db.select().from(draftPicks).where(eq(draftPicks.roomId, roomId)).orderBy(draftPicks.pickNumber),
      db.select().from(rosterSlots).where(eq(rosterSlots.roomId, roomId)),
      db.select().from(powerUps).where(eq(powerUps.roomId, roomId)),
      db.select().from(swaps).where(eq(swaps.roomId, roomId)),
      db.select().from(trades).where(eq(trades.roomId, roomId)).orderBy(desc(trades.createdAt)),
      pointsByMember(roomId),
      pointsByMemberPlayer(roomId),
      loadFeed(roomId, playersById),
      redis.smembers(keys.presence(roomId)),
    ]);

  const connectedSet = new Set(connected);
  const rules = room.scoringRules;

  const memberViews: MemberView[] = members.map((member) => {
    const activeSlots = slots
      .filter((s) => s.memberId === member.id && s.releasedAtMinute === null)
      .sort((a, b) => a.slotIndex - b.slotIndex);

    const roster: RosterEntryView[] = activeSlots.map((slot) => ({
      playerId: slot.playerId,
      slotIndex: slot.slotIndex,
      acquiredAtMinute: slot.acquiredAtMinute,
      acquiredVia: slot.acquiredVia,
      points: perPlayer.get(`${member.id}:${slot.playerId}`) ?? 0,
    }));

    const memberRows = powerUpRows.filter((p) => p.memberId === member.id);
    const memberPowerUps: PowerUpView[] = memberRows
      // Rows from before power-ups were per player have nobody to show them against.
      .flatMap((p) => (p.playerId ? [{ ...p, playerId: p.playerId }] : []))
      .map((p) => ({
        id: p.id,
        playerId: p.playerId,
        kind: p.kind,
        activatedAtMinute: p.activatedAtMinute,
        expiresAtMinute: p.expiresAtMinute,
        active: p.status === 'active' && state.matchMinute < p.expiresAtMinute,
      }));

    const swapsUsed = swapRows.filter((s) => s.memberId === member.id).length;

    return {
      id: member.id,
      displayName: member.displayName,
      draftPosition: member.draftPosition,
      isHost: member.isHost,
      connected: connectedSet.has(member.id),
      points: totals.get(member.id) ?? 0,
      roster,
      powerUps: memberPowerUps,
      powerUpChargesRemaining: Math.max(
        0,
        rules.powerUps.chargesPerManager - memberRows.length,
      ),
      swapsRemaining: Math.max(0, rules.swaps.maxPerManager - swapsUsed),
    };
  });

  const poolIds = allPlayers.map((p) => p.id);
  const available = await availablePlayerIds(roomId, poolIds);

  const pickViews: DraftPickView[] = picks.map((p) => ({
    pickNumber: p.pickNumber,
    round: p.round,
    memberId: p.memberId,
    playerId: p.playerId,
    wasAutopick: p.wasAutopick,
  }));

  const onTheClock =
    room.status === 'drafting' && state.currentMemberId
      ? {
          memberId: state.currentMemberId,
          pickNumber: state.currentPickNumber,
          round: Math.floor((state.currentPickNumber - 1) / Math.max(1, members.length)) + 1,
          deadlineMs: state.pickDeadlineMs ?? Date.now(),
        }
      : null;

  const tradeViews: TradeView[] = tradeRows.map((t) => ({
    id: t.id,
    fromMemberId: t.fromMemberId,
    toMemberId: t.toMemberId,
    offeredPlayerId: t.offeredPlayerId,
    requestedPlayerId: t.requestedPlayerId,
    status: t.status,
    createdAtMinute: t.createdAtMinute,
    expiresAtMinute: t.expiresAtMinute,
  }));

  const hostMemberId = members.find((m) => m.isHost)?.id ?? members[0]?.id ?? '';

  return {
    room: {
      id: room.id,
      joinCode: room.joinCode,
      status: room.status,
      hostMemberId,
      draftConfig: room.draftConfig,
      msPerMatchMinute: room.msPerMatchMinute,
      scoringRules: rules,
    },
    fixture: {
      id: catalog.fixture.id,
      homeTeam: {
        id: catalog.homeTeam.id,
        externalRef: catalog.homeTeam.externalRef,
        name: catalog.homeTeam.name,
        shortName: catalog.homeTeam.shortName,
        crestUrl: catalog.homeTeam.crestUrl,
      },
      awayTeam: {
        id: catalog.awayTeam.id,
        externalRef: catalog.awayTeam.externalRef,
        name: catalog.awayTeam.name,
        shortName: catalog.awayTeam.shortName,
        crestUrl: catalog.awayTeam.crestUrl,
      },
    },
    players: allPlayers,
    members: memberViews,
    draft: {
      rounds: room.draftConfig.rounds,
      totalPicks: calcTotalPicks(members.length, room.draftConfig.rounds),
      picks: pickViews,
      onTheClock,
      availablePlayerIds: available,
    },
    match: {
      minute: state.matchMinute,
      status: state.matchStatus,
      homeGoals: state.homeGoals,
      awayGoals: state.awayGoals,
    },
    trades: tradeViews,
    feed,
  };
}

/** Reads the leaderboard out of Redis, falling back to the ledger when the key is cold. */
export async function currentStandings(roomId: string): Promise<StandingRow[]> {
  const members = await loadMembers(roomId);
  if (members.length === 0) return [];

  const raw = await redis.zrange(keys.scores(roomId), 0, -1, 'WITHSCORES');
  const fromRedis = new Map<string, number>();
  for (let i = 0; i < raw.length; i += 2) {
    const memberId = raw[i];
    const score = Number(raw[i + 1]);
    if (memberId && Number.isFinite(score)) fromRedis.set(memberId, score);
  }

  const points = fromRedis.size > 0 ? fromRedis : await pointsByMember(roomId);

  return computeStandings(
    members.map((m) => ({
      memberId: m.id,
      displayName: m.displayName,
      draftPosition: m.draftPosition,
      points: points.get(m.id) ?? 0,
    })),
  );
}

/**
 * Roster, power-up, swap and scoring changes all move several numbers at once (a manager's total
 * and the points on each of their players), so the simplest correct thing is to republish the
 * member list plus the leaderboard rather than hand-patch each field.
 */
export async function publishMembers(roomId: string): Promise<void> {
  const snapshot = await buildRoomSnapshot(roomId);
  await publishToRoom(roomId, 'members:update', { members: snapshot.members });
  await publishToRoom(roomId, 'score:update', { standings: await currentStandings(roomId) });
}
