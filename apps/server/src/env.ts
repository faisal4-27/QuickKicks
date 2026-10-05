import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

// The repo-root .env is shared by the server, the migrate script and the sim CLI.
for (const candidate of [resolve(repoRoot, '.env'), resolve(here, '../.env')]) {
  if (existsSync(candidate)) dotenv.config({ path: candidate });
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z
    .string()
    .default('postgres://quickkicks:quickkicks@localhost:5433/quickkicks'),
  REDIS_URL: z.string().default('redis://localhost:6380'),
  SESSION_SECRET: z.string().min(16).default('quickkicks-local-development-secret'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  MATCH_MS_PER_MINUTE: z.coerce.number().int().min(50).default(2000),
  /**
   * Set true when the web app is on a different origin (e.g. Vercel) than this API (e.g. Render).
   * Forces SameSite=None; Secure so the session cookie is sent cross-site.
   */
  CROSS_ORIGIN: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  /**
   * Where the host screen's fixtures come from. `api-football` syncs real fixtures and lineups;
   * `mock` serves the seeded catalogue and simulates every match. Rooms already created keep
   * whichever backend their fixture came from.
   */
  MATCH_DATA: z.enum(['api-football', 'mock']).default('api-football'),
  API_FOOTBALL_KEY: z.string().default(''),
  API_FOOTBALL_BASE_URL: z.string().url().default('https://v3.football.api-sports.io'),
  /** League ids to offer, comma separated. Empty means the competitions in seed/competitions.json. */
  API_FOOTBALL_LEAGUES: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((id) => Number(id.trim()))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  /** Seconds between polls of a live match. One poll is one request, however many rooms watch it. */
  API_FOOTBALL_LIVE_POLL_SECONDS: z.coerce.number().int().min(10).default(90),
  /** Minutes between lineup checks for a fixture that has a lobby waiting on it. */
  API_FOOTBALL_LINEUP_POLL_MINUTES: z.coerce.number().int().min(1).default(5),
  /** Hours between fixture-list syncs. Each sync costs one request per day synced. */
  API_FOOTBALL_FIXTURE_SYNC_HOURS: z.coerce.number().min(1).default(12),
  /** Days synced per fixture-list sync, starting today (UTC). The free plan stops at tomorrow. */
  API_FOOTBALL_SYNC_DAYS: z.coerce.number().int().min(1).max(14).default(2),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;
export const repoRootDir = repoRoot;
