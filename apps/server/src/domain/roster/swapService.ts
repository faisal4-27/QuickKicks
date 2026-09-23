import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { swaps } from '../../db/schema.js';
import { keys } from '../../redis/keys.js';
import { withLock } from '../../redis/locks.js';
import { emptyRoomState, readRoomState } from '../../redis/roomState.js';
import { DomainError } from '../room/roomService.js';
import { loadRoom } from '../room/snapshot.js';
import {
  activeSlotsFor,
  closeSlot,
  isAvailable,
  markAvailable,
  markOwned,
  openSlot,
} from './rosterService.js';

export interface SwapResult {
  memberId: string;
  outPlayerId: string;
  inPlayerId: string;
  minute: number;
}

/**
 * Drops one of a manager's players for anyone nobody owns.
 *
 * Carry-over policy: the manager keeps every point the outgoing player earned while they held
 * them, and the incoming player starts from zero for them. Nothing is recalculated, because the
 * ledger already attributed each event to whoever owned the player at that minute. The flip side
 * is that end-of-match awards go to whoever holds the player at the final whistle, so a clean
 * sheet does not follow a defender who was swapped away at 70'.
 */
export async function executeSwap(
  roomId: string,
  memberId: string,
  outPlayerId: string,
  inPlayerId: string,
): Promise<SwapResult> {
  const room = await loadRoom(roomId);
  const config = room.scoringRules.swaps;
  const state = (await readRoomState(roomId)) ?? emptyRoomState();
  const minute = state.matchMinute;

  if (room.status !== 'live') throw new DomainError('Swaps open once the match kicks off.');
  if (outPlayerId === inPlayerId) throw new DomainError('Pick a different player.');
  if (minute >= config.cutoffMinute) {
    throw new DomainError(`Swaps close at ${config.cutoffMinute}'.`);
  }

  const result = await withLock(`${keys.turnLock(roomId)}:swap:${memberId}`, async () => {
    const used = await db
      .select({ count: sql<number>`count(*)` })
      .from(swaps)
      .where(and(eq(swaps.roomId, roomId), eq(swaps.memberId, memberId)));
    if (Number(used[0]?.count ?? 0) >= config.maxPerManager) {
      throw new DomainError(
        config.maxPerManager === 1
          ? 'You have already used your swap.'
          : `You have used all ${config.maxPerManager} of your swaps.`,
      );
    }

    const held = await activeSlotsFor(db, roomId, memberId);
    const outgoing = held.find((slot) => slot.playerId === outPlayerId);
    if (!outgoing) throw new DomainError('You do not hold that player.');

    if (!(await isAvailable(roomId, inPlayerId))) {
      throw new DomainError('Another manager already holds that player.');
    }

    await db.transaction(async (tx) => {
      const closed = await closeSlot(tx, { roomId, playerId: outPlayerId, minute });
      if (!closed || closed.memberId !== memberId) {
        throw new DomainError('That player has already moved.');
      }
      await openSlot(tx, {
        roomId,
        memberId,
        playerId: inPlayerId,
        slotIndex: outgoing.slotIndex,
        minute,
        via: 'swap',
      });
      await tx.insert(swaps).values({
        roomId,
        memberId,
        outPlayerId,
        inPlayerId,
        matchMinute: minute,
      });
    });

    await Promise.all([markAvailable(roomId, outPlayerId), markOwned(roomId, inPlayerId, memberId)]);

    return { memberId, outPlayerId, inPlayerId, minute } satisfies SwapResult;
  });

  if (!result) throw new DomainError('That did not go through. Try again.');
  return result;
}
