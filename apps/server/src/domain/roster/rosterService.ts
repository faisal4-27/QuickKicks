import type { AcquisitionSource } from '@quickkicks/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Executor } from '../../db/client.js';
import { rosterSlots } from '../../db/schema.js';
import { redis } from '../../redis/client.js';
import { keys } from '../../redis/keys.js';
import { clearOwner, setOwner } from '../scoring/scoringEngine.js';

export interface OpenSlotInput {
  roomId: string;
  memberId: string;
  playerId: string;
  slotIndex: number;
  minute: number;
  via: AcquisitionSource;
}

/**
 * Opens an ownership stint. The append-only timeline is what lets the ledger pay whoever held a
 * player at the minute an event happened, so a swap never rewrites history.
 */
export async function openSlot(exec: Executor, input: OpenSlotInput): Promise<void> {
  await exec.insert(rosterSlots).values({
    roomId: input.roomId,
    memberId: input.memberId,
    playerId: input.playerId,
    slotIndex: input.slotIndex,
    acquiredAtMinute: input.minute,
    acquiredVia: input.via,
  });
}

export interface CloseSlotInput {
  roomId: string;
  playerId: string;
  minute: number;
}

/** Closes the open stint for a player and returns it, or null if nobody held them. */
export async function closeSlot(exec: Executor, input: CloseSlotInput) {
  const [closed] = await exec
    .update(rosterSlots)
    .set({ releasedAtMinute: input.minute })
    .where(
      and(
        eq(rosterSlots.roomId, input.roomId),
        eq(rosterSlots.playerId, input.playerId),
        isNull(rosterSlots.releasedAtMinute),
      ),
    )
    .returning();
  return closed ?? null;
}

export async function activeSlotsFor(exec: Executor, roomId: string, memberId: string) {
  return exec
    .select()
    .from(rosterSlots)
    .where(
      and(
        eq(rosterSlots.roomId, roomId),
        eq(rosterSlots.memberId, memberId),
        isNull(rosterSlots.releasedAtMinute),
      ),
    )
    .orderBy(rosterSlots.slotIndex);
}

export async function activeSlots(exec: Executor, roomId: string) {
  return exec
    .select()
    .from(rosterSlots)
    .where(and(eq(rosterSlots.roomId, roomId), isNull(rosterSlots.releasedAtMinute)));
}

/** Mirrors an acquisition into Redis: owned by someone, no longer in the free pool. */
export async function markOwned(
  roomId: string,
  playerId: string,
  memberId: string,
): Promise<void> {
  await Promise.all([
    setOwner(roomId, playerId, memberId),
    redis.srem(keys.available(roomId), playerId),
  ]);
}

/** Mirrors a release into Redis: back in the free pool, owned by nobody. */
export async function markAvailable(roomId: string, playerId: string): Promise<void> {
  await Promise.all([
    clearOwner(roomId, playerId),
    redis.sadd(keys.available(roomId), playerId),
  ]);
}

export async function isAvailable(roomId: string, playerId: string): Promise<boolean> {
  return (await redis.sismember(keys.available(roomId), playerId)) === 1;
}
