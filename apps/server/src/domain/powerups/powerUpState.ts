import type { PowerUpKind } from '@quickkicks/shared';
import { redis } from '../../redis/client.js';
import { keys } from '../../redis/keys.js';

/**
 * Active power-ups live in a hash keyed `${memberId}:${playerId}:${kind}` with the expiry
 * match-minute as the value. Redis key TTL is deliberately not used: expiry is measured in
 * match-minutes, and the match clock may be running compressed, so only the clock ticker can
 * decide when a power-up is done.
 */
function field(memberId: string, playerId: string, kind: PowerUpKind): string {
  return `${memberId}:${playerId}:${kind}`;
}

export async function armPowerUp(
  roomId: string,
  memberId: string,
  playerId: string,
  kind: PowerUpKind,
  expiresAtMinute: number,
): Promise<void> {
  await redis.hset(keys.powerUps(roomId), field(memberId, playerId, kind), String(expiresAtMinute));
}

export async function disarmPowerUp(
  roomId: string,
  memberId: string,
  playerId: string,
  kind: PowerUpKind,
): Promise<void> {
  await redis.hdel(keys.powerUps(roomId), field(memberId, playerId, kind));
}

export interface ActivePowerUp {
  memberId: string;
  playerId: string;
  kind: PowerUpKind;
  expiresAtMinute: number;
}

export async function readActivePowerUps(roomId: string): Promise<ActivePowerUp[]> {
  const raw = await redis.hgetall(keys.powerUps(roomId));
  const result: ActivePowerUp[] = [];
  for (const [key, value] of Object.entries(raw)) {
    const [memberId, playerId, kind] = key.split(':');
    if (!memberId || !playerId || !kind) continue;
    const expiresAtMinute = Number(value);
    if (!Number.isFinite(expiresAtMinute)) continue;
    result.push({ memberId, playerId, kind: kind as PowerUpKind, expiresAtMinute });
  }
  return result;
}

/**
 * Kinds boosting this player for this manager at `minute`. Expiry is exclusive: a 20'-30' boost
 * is done at 30'. Keying on the manager too means a traded player does not take the boost along.
 */
export async function activeKindsFor(
  roomId: string,
  memberId: string,
  playerId: string,
  minute: number,
): Promise<PowerUpKind[]> {
  const active = await readActivePowerUps(roomId);
  return active
    .filter(
      (p) => p.memberId === memberId && p.playerId === playerId && minute < p.expiresAtMinute,
    )
    .map((p) => p.kind);
}

export async function clearPowerUps(roomId: string): Promise<void> {
  await redis.del(keys.powerUps(roomId));
}
