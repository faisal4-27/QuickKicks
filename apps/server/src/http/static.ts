import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { env, repoRootDir } from '../env.js';

/**
 * Serves the Vite build from the same origin as the API. The web client fetches `/api` and
 * opens Socket.IO with no base URL, so production has to share a host with the server — the
 * Vite proxy only exists in `npm run dev`.
 *
 * Missing `apps/web/dist` is fine in local API-only runs; production should build the web app
 * before starting.
 */
export async function registerWeb(app: FastifyInstance): Promise<void> {
  const dist = join(repoRootDir, 'apps/web/dist');
  if (!existsSync(dist)) {
    if (env.NODE_ENV === 'production') {
      console.warn(
        `Web build not found at ${dist}. Run: npm run build --workspace @quickkicks/web`,
      );
    }
    return;
  }

  await app.register(fastifyStatic, { root: dist });

  app.setNotFoundHandler((request, reply) => {
    // Keep API / socket misses as JSON 404s; everything else is an SPA deep link.
    if (request.url.startsWith('/api') || request.url.startsWith('/socket.io')) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply.sendFile('index.html');
  });

  console.log(`Serving web app from ${dist}`);
}
