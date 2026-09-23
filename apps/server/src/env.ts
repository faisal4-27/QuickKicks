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
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;
export const repoRootDir = repoRoot;
