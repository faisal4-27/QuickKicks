import {
  type FeedItem,
  type MatchEvent,
  type Player,
  type PowerUpKind,
  type ScoringRules,
  cleanSheetClaimant,
  concededMinutes,
  isScoringEvent,
  scoreEvent,
} from '@quickkicks/shared';
import { and, eq, gt, lte } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { matchEvents, players, powerUps, rosterSlots, scoreEntries } from '../../db/schema.js';
import { redis } from '../../redis/client.js';
import { keys } from '../../redis/keys.js';
import { activeKindsFor } from '../powerups/powerUpState.js';
import { isFeedWorthyAward } from '../room/snapshot.js';

export interface IngestContext {
  roomId: string;
  rules: ScoringRules;
  /** Provider player ref to our player row. */
  refIndex: Map<string, Player>;
  homeTeamRef: string;
}

export interface IngestResult {
  /** Null when the event was a redelivery and had already been recorded. */
  feedItem: FeedItem | null;
  /** Member ids whose totals moved, so the caller knows whether to republish standings. */
  touchedMemberIds: string[];
  goal: 'home' | 'away' | null;
  minute: number;
}

/**
 * Turns one provider event into ledger rows.
 *
 * Two properties matter here. First, it is idempotent: the unique index on
 * (room_id, provider_event_id) means a redelivered event is dropped, and the event row plus its
 * score rows are written in one transaction so a crash can never leave an event recorded but
 * unpaid. Second, attribution happens at event time: whoever owns the player at this minute is
 * paid, which is what makes the swap and trade carry-over policy fall out for free.
 */
export async function ingestEvent(
  ctx: IngestContext,
  event: MatchEvent,
): Promise<IngestResult> {
  const player = event.playerRef ? ctx.refIndex.get(event.playerRef) : undefined;
  const goal =
    event.type === 'goal.scored' ? (event.teamRef === ctx.homeTeamRef ? 'home' : 'away') : null;

  const ownerId = player
    ? event.type === 'clean_sheet.awarded'
      ? await cleanSheetOwner(ctx, player, event.minute)
      : await currentOwner(ctx.roomId, player.id)
    : null;
  const activeKinds: PowerUpKind[] =
    ownerId && player ? await activeKindsFor(ctx.roomId, ownerId, player.id, event.minute) : [];

  const scored =
    player && isScoringEvent(event.type)
      ? scoreEvent(event.type, player.position, activeKinds, ctx.rules)
      : { basePoints: 0, multiplier: 1, awardedPoints: 0 };

  const written = await db.transaction(async (tx) => {
    const [eventRow] = await tx
      .insert(matchEvents)
      .values({
        roomId: ctx.roomId,
        providerEventId: event.id,
        sequence: event.sequence,
        matchMinute: event.minute,
        playerId: player?.id ?? null,
        type: event.type,
        meta: event.meta ?? {},
      })
      .onConflictDoNothing()
      .returning();

    // Already recorded: this is a redelivery, so there is nothing left to do.
    if (!eventRow) return null;

    if (ownerId && player && scored.awardedPoints !== 0) {
      const powerUpId =
        scored.multiplier > 1
          ? await matchingPowerUpId(ctx.roomId, ownerId, player.id, event.minute)
          : null;
      await tx.insert(scoreEntries).values({
        roomId: ctx.roomId,
        memberId: ownerId,
        playerId: player.id,
        matchEventId: eventRow.id,
        matchMinute: event.minute,
        basePoints: scored.basePoints,
        multiplier: scored.multiplier,
        awardedPoints: scored.awardedPoints,
        powerUpId,
      });
    }

    return eventRow;
  });

  if (!written) {
    return { feedItem: null, touchedMemberIds: [], goal: null, minute: event.minute };
  }

  const touched: string[] = [];
  if (ownerId && scored.awardedPoints !== 0) {
    await redis.zincrby(keys.scores(ctx.roomId), scored.awardedPoints, ownerId);
    touched.push(ownerId);
  }

  const paid = ownerId !== null && scored.awardedPoints !== 0;
  const feedItem: FeedItem | null = isFeedWorthyAward(event.type, paid)
    ? {
        id: written.id,
        minute: event.minute,
        type: event.type,
        playerId: player?.id ?? null,
        playerName: player?.fullName ?? null,
        position: player?.position ?? null,
        awards:
          paid && ownerId
            ? [
                {
                  memberId: ownerId,
                  awardedPoints: scored.awardedPoints,
                  multiplier: scored.multiplier,
                },
              ]
            : [],
      }
    : null;

  return { feedItem, touchedMemberIds: touched, goal, minute: event.minute };
}

/**
 * Who earned this player's clean sheet, or nobody.
 *
 * The one event that cannot be settled by asking who owns the player right now: it belongs to
 * whoever held him through a long enough goalless stretch, which takes the whole ownership
 * timeline and the minutes his team conceded. Both are read from Postgres rather than carried in
 * the clock's memory, because a restart mid-match resumes the provider from its last sequence and
 * never sees the earlier goals again.
 */
async function cleanSheetOwner(
  ctx: IngestContext,
  player: Player,
  finalMinute: number,
): Promise<string | null> {
  const [slots, goals] = await Promise.all([
    db
      .select({
        memberId: rosterSlots.memberId,
        acquiredAtMinute: rosterSlots.acquiredAtMinute,
        releasedAtMinute: rosterSlots.releasedAtMinute,
      })
      .from(rosterSlots)
      .where(and(eq(rosterSlots.roomId, ctx.roomId), eq(rosterSlots.playerId, player.id))),
    db
      .select({ minute: matchEvents.matchMinute, teamId: players.teamId })
      .from(matchEvents)
      .innerJoin(players, eq(matchEvents.playerId, players.id))
      .where(and(eq(matchEvents.roomId, ctx.roomId), eq(matchEvents.type, 'goal.scored'))),
  ]);

  return cleanSheetClaimant({
    // The player's row id stands in for the provider ref here; the rule only needs a stable key.
    stints: slots.map((slot) => ({
      memberId: slot.memberId,
      playerRef: player.id,
      fromMinute: slot.acquiredAtMinute,
      toMinute: slot.releasedAtMinute,
    })),
    playerRef: player.id,
    concededMinutes: concededMinutes(
      goals.map((goal) => ({ minute: goal.minute, teamRef: goal.teamId })),
      player.teamId,
    ),
    finalMinute,
    config: ctx.rules.cleanSheet,
  });
}

/** The power-up that actually boosted this event, for the ledger audit trail. */
async function matchingPowerUpId(
  roomId: string,
  memberId: string,
  playerId: string,
  minute: number,
): Promise<string | null> {
  const rows = await db
    .select({ id: powerUps.id })
    .from(powerUps)
    .where(
      and(
        eq(powerUps.roomId, roomId),
        eq(powerUps.memberId, memberId),
        eq(powerUps.playerId, playerId),
        eq(powerUps.status, 'active'),
        lte(powerUps.activatedAtMinute, minute),
        gt(powerUps.expiresAtMinute, minute),
      ),
    );
  return rows[0]?.id ?? null;
}

export async function currentOwner(roomId: string, playerId: string): Promise<string | null> {
  const owner = await redis.hget(keys.owners(roomId), playerId);
  return owner && owner.length > 0 ? owner : null;
}

export async function setOwner(
  roomId: string,
  playerId: string,
  memberId: string,
): Promise<void> {
  await redis.hset(keys.owners(roomId), playerId, memberId);
}

export async function clearOwner(roomId: string, playerId: string): Promise<void> {
  await redis.hdel(keys.owners(roomId), playerId);
}
