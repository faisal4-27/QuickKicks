import type { PowerUp, PowerUpKind, ScoringRules } from '@quickkicks/shared';
import { and, eq, lte } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { powerUps } from '../../db/schema.js';
import { keys } from '../../redis/keys.js';
import { withLock } from '../../redis/locks.js';
import { emptyRoomState, readRoomState } from '../../redis/roomState.js';
import { DomainError } from '../room/roomService.js';
import { loadRoom } from '../room/snapshot.js';
import { activeSlotsFor } from '../roster/rosterService.js';
import { armPowerUp, disarmPowerUp, readActivePowerUps } from './powerUpState.js';

function toView(
  row: typeof powerUps.$inferSelect & { playerId: string },
  minute: number,
): PowerUp & { active: boolean } {
  return {
    id: row.id,
    roomId: row.roomId,
    memberId: row.memberId,
    playerId: row.playerId,
    kind: row.kind,
    activatedAtMinute: row.activatedAtMinute,
    expiresAtMinute: row.expiresAtMinute,
    status: row.status,
    active: row.status === 'active' && minute < row.expiresAtMinute,
  };
}

export interface ActivateResult {
  powerUp: PowerUp & { active: boolean };
  minute: number;
}

/**
 * Power-ups are armed on one of the manager's players for a window measured in match-minutes,
 * never wall-clock, so a compressed simulation and a real match feel the same to the manager.
 * Activation is never retroactive: only events from this minute onwards are boosted.
 *
 * Each kind can be used once per match. A player can carry one power-up at a time, but a
 * manager's two players can both be boosted at once.
 */
export async function activatePowerUp(
  roomId: string,
  memberId: string,
  playerId: string,
  kind: PowerUpKind,
): Promise<ActivateResult> {
  const room = await loadRoom(roomId);
  const rules: ScoringRules = room.scoringRules;
  const config = rules.powerUps;
  const state = (await readRoomState(roomId)) ?? emptyRoomState();
  const minute = state.matchMinute;

  if (room.status === 'finished') throw new DomainError('The match is over.');
  if (room.status !== 'live' && !config.allowBeforeKickoff) {
    throw new DomainError('Power-ups unlock when the match kicks off.');
  }

  const result = await withLock(`${keys.turnLock(roomId)}:powerup:${memberId}`, async () => {
    const existing = await db
      .select()
      .from(powerUps)
      .where(and(eq(powerUps.roomId, roomId), eq(powerUps.memberId, memberId)));

    if (existing.length >= config.chargesPerManager) {
      throw new DomainError(
        `You have used all ${config.chargesPerManager} of your power-ups.`,
      );
    }
    if (existing.some((p) => p.kind === kind)) {
      throw new DomainError('You have already used that power-up.');
    }

    const roster = await activeSlotsFor(db, roomId, memberId);
    if (!roster.some((slot) => slot.playerId === playerId)) {
      throw new DomainError('You can only power up one of your own players.');
    }

    if (!config.allowStackingOnPlayer) {
      const running = existing.find(
        (p) => p.playerId === playerId && p.status === 'active' && minute < p.expiresAtMinute,
      );
      if (running) {
        throw new DomainError(
          `That player already has a power-up running until ${running.expiresAtMinute}'.`,
        );
      }
    }

    const [row] = await db
      .insert(powerUps)
      .values({
        roomId,
        memberId,
        playerId,
        kind,
        activatedAtMinute: minute,
        expiresAtMinute: minute + config.durationMinutes,
        status: 'active',
      })
      .returning();
    if (!row) throw new Error('Failed to record the power-up');

    await armPowerUp(roomId, memberId, playerId, kind, row.expiresAtMinute);
    return { ...row, playerId };
  });

  if (!result) throw new DomainError('That did not go through. Try again.');
  return { powerUp: toView(result, minute), minute };
}

export interface ExpiredPowerUp {
  id: string;
  memberId: string;
  kind: PowerUpKind;
}

/**
 * Called by the match clock on every tick. This is the reason power-up expiry does not use a
 * Redis TTL: the deadline is a match-minute, and only the clock knows what minute it is.
 */
export async function expireDuePowerUps(
  roomId: string,
  minute: number,
): Promise<ExpiredPowerUp[]> {
  const due = await db
    .update(powerUps)
    .set({ status: 'expired' })
    .where(
      and(
        eq(powerUps.roomId, roomId),
        eq(powerUps.status, 'active'),
        lte(powerUps.expiresAtMinute, minute),
      ),
    )
    .returning();

  for (const row of due) {
    if (row.playerId) await disarmPowerUp(roomId, row.memberId, row.playerId, row.kind);
  }

  return due.map((row) => ({ id: row.id, memberId: row.memberId, kind: row.kind }));
}

/** Rebuilds the Redis power-up hash from Postgres. */
export async function rehydratePowerUps(roomId: string, minute: number): Promise<void> {
  const rows = await db
    .select()
    .from(powerUps)
    .where(and(eq(powerUps.roomId, roomId), eq(powerUps.status, 'active')));
  for (const row of rows) {
    if (row.playerId && minute < row.expiresAtMinute) {
      await armPowerUp(roomId, row.memberId, row.playerId, row.kind, row.expiresAtMinute);
    }
  }
}

export async function activeSummary(roomId: string) {
  return readActivePowerUps(roomId);
}
