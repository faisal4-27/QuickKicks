import { randomUUID } from 'node:crypto';
import { redis } from './client.js';

/**
 * Best-effort mutual exclusion for the small number of operations where two clients can
 * legitimately race: submitting a pick, accepting a trade, activating a power-up. Postgres
 * unique indexes are the real guarantee; this just turns a constraint violation into a clean
 * "not your turn" message most of the time.
 */
export async function withLock<T>(
  key: string,
  fn: () => Promise<T>,
  opts: { ttlMs?: number; waitMs?: number } = {},
): Promise<T | null> {
  const ttlMs = opts.ttlMs ?? 3000;
  const waitMs = opts.waitMs ?? 250;
  const token = randomUUID();
  const deadline = Date.now() + waitMs;

  for (;;) {
    const acquired = await redis.set(key, token, 'PX', ttlMs, 'NX');
    if (acquired === 'OK') break;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  try {
    return await fn();
  } finally {
    // Only release the lock if we still hold it, so a slow operation whose lock expired
    // cannot delete the next holder's lock.
    await redis.eval(
      `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`,
      1,
      key,
      token,
    );
  }
}
