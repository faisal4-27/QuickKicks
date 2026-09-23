import type { ServerToClientEvents } from '@quickkicks/shared';
import { redis, subscriber } from './client.js';
import { keys } from './keys.js';

type EventName = keyof ServerToClientEvents;
type PayloadOf<E extends EventName> = Parameters<ServerToClientEvents[E]>[0];

interface Envelope {
  event: EventName;
  payload: unknown;
}

/**
 * Every room delta goes through Redis rather than straight to sockets. With one server
 * process that is a small indirection; it is also the thing that lets a second process serve
 * the same room without any further work.
 */
export async function publishToRoom<E extends EventName>(
  roomId: string,
  event: E,
  payload: PayloadOf<E>,
): Promise<void> {
  const envelope: Envelope = { event, payload };
  await redis.publish(keys.channel(roomId), JSON.stringify(envelope));
}

export type RoomMessageHandler = (
  roomId: string,
  event: EventName,
  payload: unknown,
) => void | Promise<void>;

/** Pattern-subscribes once for all rooms and routes by the room id embedded in the channel. */
export async function subscribeToAllRooms(handler: RoomMessageHandler): Promise<void> {
  await subscriber.psubscribe('room:*');
  subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
    const roomId = channel.slice('room:'.length);
    if (!roomId) return;
    let envelope: Envelope;
    try {
      envelope = JSON.parse(message) as Envelope;
    } catch {
      return;
    }
    void handler(roomId, envelope.event, envelope.payload);
  });
}
