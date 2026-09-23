import type { TradeView } from '@quickkicks/shared';
import { and, eq, isNull, lte } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { rosterSlots, trades } from '../../db/schema.js';
import { keys } from '../../redis/keys.js';
import { withLock } from '../../redis/locks.js';
import { emptyRoomState, readRoomState } from '../../redis/roomState.js';
import { DomainError } from '../room/roomService.js';
import { loadRoom } from '../room/snapshot.js';
import { closeSlot, markOwned, openSlot } from './rosterService.js';

function toView(row: typeof trades.$inferSelect): TradeView {
  return {
    id: row.id,
    fromMemberId: row.fromMemberId,
    toMemberId: row.toMemberId,
    offeredPlayerId: row.offeredPlayerId,
    requestedPlayerId: row.requestedPlayerId,
    status: row.status,
    createdAtMinute: row.createdAtMinute,
    expiresAtMinute: row.expiresAtMinute,
  };
}

export interface ProposeTradeInput {
  roomId: string;
  fromMemberId: string;
  toMemberId: string;
  offeredPlayerId: string;
  requestedPlayerId: string;
}

/**
 * One-for-one only, and only while the match is live. Points already earned never travel with a
 * player: the ledger paid whoever owned them at the time, which is the same carry-over rule
 * swaps follow.
 */
export async function proposeTrade(input: ProposeTradeInput): Promise<TradeView> {
  const room = await loadRoom(input.roomId);
  const state = (await readRoomState(input.roomId)) ?? emptyRoomState();
  const minute = state.matchMinute;
  const config = room.scoringRules.trades;

  if (room.status !== 'live') throw new DomainError('Trades open once the match kicks off.');
  if (input.fromMemberId === input.toMemberId) {
    throw new DomainError('You cannot trade with yourself.');
  }
  if (minute >= config.cutoffMinute) {
    throw new DomainError(`Trades close at ${config.cutoffMinute}'.`);
  }

  const [offered, requested] = await Promise.all([
    activeSlotFor(input.roomId, input.offeredPlayerId),
    activeSlotFor(input.roomId, input.requestedPlayerId),
  ]);

  if (!offered || offered.memberId !== input.fromMemberId) {
    throw new DomainError('You can only offer a player you currently hold.');
  }
  if (!requested || requested.memberId !== input.toMemberId) {
    throw new DomainError('That manager no longer holds the player you asked for.');
  }

  const existing = await db
    .select()
    .from(trades)
    .where(
      and(
        eq(trades.roomId, input.roomId),
        eq(trades.fromMemberId, input.fromMemberId),
        eq(trades.toMemberId, input.toMemberId),
        eq(trades.status, 'pending'),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    throw new DomainError('You already have an offer pending with that manager.');
  }

  const [row] = await db
    .insert(trades)
    .values({
      roomId: input.roomId,
      fromMemberId: input.fromMemberId,
      toMemberId: input.toMemberId,
      offeredPlayerId: input.offeredPlayerId,
      requestedPlayerId: input.requestedPlayerId,
      status: 'pending',
      createdAtMinute: minute,
      expiresAtMinute: minute + config.offerExpiryMinutes,
    })
    .returning();
  if (!row) throw new Error('Failed to record the trade offer');
  return toView(row);
}

async function activeSlotFor(roomId: string, playerId: string) {
  const rows = await db
    .select()
    .from(rosterSlots)
    .where(
      and(
        eq(rosterSlots.roomId, roomId),
        eq(rosterSlots.playerId, playerId),
        isNull(rosterSlots.releasedAtMinute),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export interface RespondResult {
  trade: TradeView;
  /** Present only on an accepted trade. */
  applied: {
    minute: number;
    fromMemberId: string;
    toMemberId: string;
    offeredPlayerId: string;
    requestedPlayerId: string;
  } | null;
}

export async function respondToTrade(
  roomId: string,
  memberId: string,
  tradeId: string,
  accept: boolean,
): Promise<RespondResult> {
  const state = (await readRoomState(roomId)) ?? emptyRoomState();
  const minute = state.matchMinute;

  const result = await withLock(`${keys.turnLock(roomId)}:trade:${tradeId}`, async () => {
    const row = (
      await db.select().from(trades).where(eq(trades.id, tradeId)).limit(1)
    )[0];
    if (!row || row.roomId !== roomId) throw new DomainError('That offer no longer exists.');
    if (row.toMemberId !== memberId) throw new DomainError('That offer is not yours to answer.');
    if (row.status !== 'pending') throw new DomainError('That offer has already been settled.');
    if (minute >= row.expiresAtMinute) {
      await db
        .update(trades)
        .set({ status: 'expired', resolvedAt: new Date() })
        .where(eq(trades.id, tradeId));
      throw new DomainError('That offer expired.');
    }

    if (!accept) {
      const [rejected] = await db
        .update(trades)
        .set({ status: 'rejected', resolvedAt: new Date() })
        .where(eq(trades.id, tradeId))
        .returning();
      return { trade: toView(rejected!), applied: null } satisfies RespondResult;
    }

    // Both rosters move together or not at all.
    await db.transaction(async (tx) => {
      const offeredSlot = await closeSlot(tx, {
        roomId,
        playerId: row.offeredPlayerId,
        minute,
      });
      const requestedSlot = await closeSlot(tx, {
        roomId,
        playerId: row.requestedPlayerId,
        minute,
      });
      if (!offeredSlot || !requestedSlot) {
        throw new DomainError('One of those players has already moved.');
      }
      if (
        offeredSlot.memberId !== row.fromMemberId ||
        requestedSlot.memberId !== row.toMemberId
      ) {
        throw new DomainError('One of those players has already moved.');
      }

      // Each player takes over the slot the outgoing player vacated.
      await openSlot(tx, {
        roomId,
        memberId: row.fromMemberId,
        playerId: row.requestedPlayerId,
        slotIndex: offeredSlot.slotIndex,
        minute,
        via: 'trade',
      });
      await openSlot(tx, {
        roomId,
        memberId: row.toMemberId,
        playerId: row.offeredPlayerId,
        slotIndex: requestedSlot.slotIndex,
        minute,
        via: 'trade',
      });

      await tx
        .update(trades)
        .set({ status: 'accepted', resolvedAt: new Date() })
        .where(eq(trades.id, tradeId));
    });

    await Promise.all([
      markOwned(roomId, row.requestedPlayerId, row.fromMemberId),
      markOwned(roomId, row.offeredPlayerId, row.toMemberId),
    ]);

    const [accepted] = await db.select().from(trades).where(eq(trades.id, tradeId)).limit(1);
    return {
      trade: toView(accepted!),
      applied: {
        minute,
        fromMemberId: row.fromMemberId,
        toMemberId: row.toMemberId,
        offeredPlayerId: row.offeredPlayerId,
        requestedPlayerId: row.requestedPlayerId,
      },
    } satisfies RespondResult;
  });

  if (!result) throw new DomainError('That did not go through. Try again.');
  return result;
}

export async function cancelTrade(
  roomId: string,
  memberId: string,
  tradeId: string,
): Promise<TradeView> {
  const row = (await db.select().from(trades).where(eq(trades.id, tradeId)).limit(1))[0];
  if (!row || row.roomId !== roomId) throw new DomainError('That offer no longer exists.');
  if (row.fromMemberId !== memberId) throw new DomainError('That offer is not yours to cancel.');
  if (row.status !== 'pending') throw new DomainError('That offer has already been settled.');
  const [cancelled] = await db
    .update(trades)
    .set({ status: 'cancelled', resolvedAt: new Date() })
    .where(eq(trades.id, tradeId))
    .returning();
  return toView(cancelled!);
}

/** Called by the match clock: pending offers do not linger past their match-minute deadline. */
export async function expireDueTrades(roomId: string, minute: number): Promise<TradeView[]> {
  const due = await db
    .update(trades)
    .set({ status: 'expired', resolvedAt: new Date() })
    .where(
      and(
        eq(trades.roomId, roomId),
        eq(trades.status, 'pending'),
        lte(trades.expiresAtMinute, minute),
      ),
    )
    .returning();
  return due.map(toView);
}

export async function pendingTrades(roomId: string): Promise<TradeView[]> {
  const rows = await db
    .select()
    .from(trades)
    .where(and(eq(trades.roomId, roomId), eq(trades.status, 'pending')));
  return rows.map(toView);
}
