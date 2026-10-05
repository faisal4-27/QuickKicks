/**
 * Pulls the next few days of fixtures from API-Football right now, ignoring the server's sync
 * throttle. Costs one request per day synced.
 *
 *   npm run fixtures:sync            # API_FOOTBALL_SYNC_DAYS days, starting today (UTC)
 *   npm run fixtures:sync -- 7       # a week
 */
import { closeDb } from '../db/client.js';
import { syncFixtures } from '../domain/fixture/fixtureFeed.js';
import { apiQuota } from '../providers/apiFootball/client.js';
import { closeRedis } from '../redis/client.js';

async function main(): Promise<void> {
  const days = process.argv[2] ? Number(process.argv[2]) : undefined;
  if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 14)) {
    throw new Error('Days must be a whole number from 1 to 14.');
  }
  const result = await syncFixtures(days);
  const quota = apiQuota();
  console.log(`Synced ${result.fixtures} fixture(s) for ${result.days.join(', ')}.`);
  for (const { reason } of result.skipped) console.warn(`Skipped: ${reason}`);
  console.log(`${quota.dailyRemaining ?? '?'} of ${quota.dailyLimit ?? '?'} requests left today.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => Promise.all([closeDb(), closeRedis()]));
