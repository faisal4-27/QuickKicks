import Redis from 'ioredis';
import { env } from '../env.js';

/** Command connection. */
export const redis = new Redis(env.REDIS_URL, { lazyConnect: false });

/**
 * A subscriber connection has to be separate: once a connection enters subscribe mode it can
 * no longer issue normal commands.
 */
export const subscriber = new Redis(env.REDIS_URL, { lazyConnect: false });

export async function closeRedis(): Promise<void> {
  await Promise.allSettled([redis.quit(), subscriber.quit()]);
}
