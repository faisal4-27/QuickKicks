import { redis } from '../redis/client.js';
import { keys } from '../redis/keys.js';
import { publishToRoom } from '../redis/pubsub.js';

/**
 * Presence is intentionally the one piece of state that is not recoverable from Postgres: who is
 * connected right now is only meaningful while the process is up. Everything else in Redis is a
 * derived cache.
 */
export async function markConnected(roomId: string, memberId: string): Promise<void> {
  await redis.sadd(keys.presence(roomId), memberId);
  await broadcastPresence(roomId);
}

export async function markDisconnected(roomId: string, memberId: string): Promise<void> {
  await redis.srem(keys.presence(roomId), memberId);
  await broadcastPresence(roomId);
}

export async function connectedMemberIds(roomId: string): Promise<string[]> {
  return redis.smembers(keys.presence(roomId));
}

export async function broadcastPresence(roomId: string): Promise<void> {
  await publishToRoom(roomId, 'presence:update', {
    connectedMemberIds: await connectedMemberIds(roomId),
  });
}

/** A process restart should not leave ghosts in the presence set. */
export async function clearPresence(roomId: string): Promise<void> {
  await redis.del(keys.presence(roomId));
}
