import type { PowerUpKind } from '@quickkicks/shared';
import { redis } from '../../redis/client.js';
import { keys } from '../../redis/keys.js';

/**
 * Active power-ups live in a hash keyed `${memberId}:${kind}` with the expiry match-minute as
 * the value. Redis key TTL is deliberately not used: expiry is measured in match-minutes, and
 * the match clock may be running compressed, so only the clock ticker can decide when a
 * power-up is done.
 */
function field(memberId: string, kind: PowerUpKind): string {
  return `${memberId}:${kind}`;
}

export async function armPowerUp(
  roomId: string,
  memberId: string,
  kind: PowerUpKind,
  expiresAtMinute: number,
): Promise<void> {
  await redis.hset(keys.powerUps(roomId), field(memberId, kind), String(expiresAtMinute));
}

export async function disarmPowerUp(
  roomId: string,
  memberId: string,
  kind: PowerUpKind,
): Promise<void> {
  await redis.hdel(keys.powerUps(roomId), field(memberId, kind));
}

export interface ActivePowerUp {
  memberId: string;
  kind: PowerUpKind;
  expiresAtMinute: number;
}

export async function readActivePowerUps(roomId: string): Promise<ActivePowerUp[]> {
  const raw = await redis.hgetall(keys.powerUps(roomId));
  const result: ActivePowerUp[] = [];
  for (const [key, value] of Object.entries(raw)) {
    const separator = key.indexOf(':');
    if (separator < 0) continue;
    const memberId = key.slice(0, separator);
    const kind = key.slice(separator + 1) as PowerUpKind;
    const expiresAtMinute = Number(value);
    if (!Number.isFinite(expiresAtMinute)) continue;
    result.push({ memberId, kind, expiresAtMinute });
  }
  return result;
}

/** Kinds boosting this manager at `minute`. Expiry is exclusive: a 20'-30' boost is done at 30'. */
export async function activeKindsFor(
  roomId: string,
  memberId: string,
  minute: number,
): Promise<PowerUpKind[]> {
  const active = await readActivePowerUps(roomId);
  return active
    .filter((p) => p.memberId === memberId && minute < p.expiresAtMinute)
    .map((p) => p.kind);
}

export async function clearPowerUps(roomId: string): Promise<void> {
  await redis.del(keys.powerUps(roomId));
}
