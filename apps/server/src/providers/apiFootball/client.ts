import { env } from '../../env.js';
import { redis } from '../../redis/client.js';
import { keys } from '../../redis/keys.js';
import type { ApiEnvelope } from './types.js';

export class ApiFootballError extends Error {
  constructor(message: string) {
    super(`API-Football: ${message}`);
    this.name = 'ApiFootballError';
  }
}

export interface ApiQuota {
  dailyLimit: number | null;
  dailyRemaining: number | null;
  perMinuteLimit: number | null;
  perMinuteRemaining: number | null;
}

const quota: ApiQuota = {
  dailyLimit: null,
  dailyRemaining: null,
  perMinuteLimit: null,
  perMinuteRemaining: null,
};

/** What the last response's headers said about the plan's limits. Null until the first request. */
export function apiQuota(): Readonly<ApiQuota> {
  return quota;
}

/** The free plan's per-minute cap, assumed until a response reports the real one. */
const DEFAULT_PER_MINUTE = 10;
const LOW_QUOTA_WARNING = 15;

let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;
const inFlight = new Map<string, Promise<unknown>>();

export interface GetOptions {
  /**
   * Serve a cached copy younger than this. Every caller sharing a request key shares the cached
   * response, which is what keeps N rooms on one fixture at one request per poll.
   */
  cacheSeconds?: number;
}

/**
 * GET against API-Football v3, returning the envelope's `response`.
 *
 * Requests are spaced to the plan's per-minute cap, because going over it repeatedly can get a key
 * blocked. A 200 is not success on its own: quota exhaustion, plan restrictions ("Free plans do not
 * have access to this season") and a bad key all arrive as a 200 with a populated `errors`, so
 * those are thrown here rather than surfacing later as an empty result.
 */
export async function apiGet<T>(
  path: string,
  params: Record<string, string | number>,
  opts: GetOptions = {},
): Promise<T> {
  if (!env.API_FOOTBALL_KEY) {
    throw new ApiFootballError('API_FOOTBALL_KEY is not set. Add it to the repo-root .env.');
  }

  const query = new URLSearchParams(
    Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]): [string, string] => [k, String(v)]),
  ).toString();
  const request = `${path}?${query}`;

  if (opts.cacheSeconds) {
    const cached = await redis.get(keys.feedCache(request));
    if (cached) return JSON.parse(cached) as T;
  }

  const pending = inFlight.get(request);
  if (pending) return pending as Promise<T>;

  const promise = enqueue(() => fetchOnce<T>(request)).then(async (response) => {
    if (opts.cacheSeconds) {
      await redis.set(keys.feedCache(request), JSON.stringify(response), 'EX', opts.cacheSeconds);
    }
    return response;
  });
  inFlight.set(request, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(request);
  }
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const spacing = 60_000 / (quota.perMinuteLimit ?? DEFAULT_PER_MINUTE);
    const wait = lastRequestAt + spacing - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    return task();
  });
  queue = run.catch(() => undefined);
  return run;
}

async function fetchOnce<T>(request: string): Promise<T> {
  const url = `${env.API_FOOTBALL_BASE_URL.replace(/\/$/, '')}${request}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'x-apisports-key': env.API_FOOTBALL_KEY },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new ApiFootballError(`${request} failed: ${(error as Error).message}`);
  }

  recordQuota(res.headers);
  if (!res.ok) throw new ApiFootballError(`${request} returned HTTP ${res.status}`);

  const body = (await res.json()) as ApiEnvelope<T>;
  const errors = Array.isArray(body.errors) ? body.errors : Object.values(body.errors ?? {});
  if (errors.length > 0) throw new ApiFootballError(`${request}: ${errors.join('; ')}`);
  return body.response;
}

function recordQuota(headers: Headers): void {
  const num = (name: string): number | null => {
    const raw = headers.get(name);
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
  };
  quota.dailyLimit = num('x-ratelimit-requests-limit') ?? quota.dailyLimit;
  quota.dailyRemaining = num('x-ratelimit-requests-remaining') ?? quota.dailyRemaining;
  quota.perMinuteLimit = num('x-ratelimit-limit') ?? quota.perMinuteLimit;
  quota.perMinuteRemaining = num('x-ratelimit-remaining') ?? quota.perMinuteRemaining;

  if (quota.dailyRemaining !== null && quota.dailyRemaining <= LOW_QUOTA_WARNING) {
    console.warn(
      `[api-football] ${quota.dailyRemaining} of ${quota.dailyLimit ?? '?'} daily requests left.`,
    );
  }
}
