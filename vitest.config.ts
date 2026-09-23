import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every test here is pure: no Postgres, no Redis, no websockets. That is deliberate, and it
    // is what keeping the scoring and draft logic in packages/shared buys us.
    include: ['packages/**/*.test.ts', 'apps/server/**/*.test.ts'],
    environment: 'node',
  },
});
