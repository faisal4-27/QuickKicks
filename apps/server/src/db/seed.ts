import { closeDb, db } from './client.js';
import { syncFixtures } from '../domain/fixture/fixtureFeed.js';
import { env } from '../env.js';
import { apiQuota } from '../providers/apiFootball/client.js';
import { closeRedis } from '../redis/client.js';
import { seedCatalog } from '../seed/catalog.js';

/** With real data the "seed" is the first fixture sync; the mock catalogue is for `MATCH_DATA=mock`. */
async function main(): Promise<void> {
  if (env.MATCH_DATA === 'api-football') {
    const result = await syncFixtures();
    const quota = apiQuota();
    console.log(
      `Synced ${result.fixtures} fixture(s) from API-Football for ${result.days.join(', ')}. ` +
        `${quota.dailyRemaining ?? '?'} of ${quota.dailyLimit ?? '?'} requests left today.`,
    );
    for (const { reason } of result.skipped) console.warn(`Skipped: ${reason}`);
    return;
  }

  const { competitions, teams, players, fixtures } = await seedCatalog(db);
  console.log(
    `Seeded ${competitions} competition(s), ${teams} team(s), ${players} player(s), ` +
      `${fixtures} fixture(s).`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => Promise.all([closeDb(), closeRedis()]));
