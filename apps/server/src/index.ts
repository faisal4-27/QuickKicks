import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import { closeDb } from './db/client.js';
import { clearAllPickTimers } from './domain/draft/draftService.js';
import { stopAllClocks } from './domain/clock/matchClock.js';
import { startFixtureFeed, stopFixtureFeed } from './domain/fixture/fixtureFeed.js';
import { rehydrateActiveRooms } from './domain/room/rehydrate.js';
import { env } from './env.js';
import { registerRoutes } from './http/routes.js';
import { registerWeb } from './http/static.js';
import { closeRedis } from './redis/client.js';
import { createGateway } from './ws/gateway.js';

async function main(): Promise<void> {
  if (env.MATCH_DATA === 'api-football' && !env.API_FOOTBALL_KEY) {
    throw new Error(
      'MATCH_DATA=api-football needs API_FOOTBALL_KEY in the repo-root .env (or set MATCH_DATA=mock).',
    );
  }

  const app = Fastify({ logger: { level: env.NODE_ENV === 'development' ? 'warn' : 'info' } });

  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await registerRoutes(app);
  await registerWeb(app);

  const io = await createGateway(app);

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  console.log(`QuickKicks server listening on http://localhost:${env.PORT}`);

  // Any room that was mid-draft or mid-match when we stopped rebuilds its Redis state from
  // Postgres and picks up where it left off.
  const resumed = await rehydrateActiveRooms();
  if (resumed > 0) console.log(`Resumed ${resumed} active room(s).`);

  if (env.MATCH_DATA === 'api-football') startFixtureFeed();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received, shutting down.`);
    stopFixtureFeed();
    clearAllPickTimers();
    await stopAllClocks();
    await io.close();
    await app.close();
    await closeRedis();
    await closeDb();
    process.exit(0);
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => void shutdown(signal));
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
