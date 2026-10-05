/**
 * Announces a fixture's starting XIs by hand. For an API-Football fixture it fetches the real
 * lineups (one request, and nothing happens if they are not out yet); for a seeded fixture it uses
 * the seed's starters. Any lobby waiting on the fixture is told over pub/sub, so a running server
 * picks it up live and the host's "Start the draft" button unlocks.
 *
 *   npm run lineups:announce                              # lists fixtures and their lineup status
 *   npm run lineups:announce -- apifootball:fixture:1234  # fetches that one from API-Football
 *   npm run lineups:announce -- mock:fixture:liv-che      # announces a seeded one
 */
import { eq } from 'drizzle-orm';
import { closeDb, db } from '../db/client.js';
import { fixtures } from '../db/schema.js';
import { fetchAndAnnounceLineups } from '../domain/fixture/fixtureFeed.js';
import { announceLineups, listOpenFixtures } from '../domain/fixture/fixtureService.js';
import { isApiFixtureRef } from '../providers/apiFootball/refs.js';
import { closeRedis } from '../redis/client.js';
import { seedLineupFor } from '../seed/catalog.js';

async function main(): Promise<void> {
  const ref = process.argv[2];

  if (!ref) {
    const open = await listOpenFixtures();
    for (const view of open) {
      const row = (await db.select().from(fixtures).where(eq(fixtures.id, view.id)).limit(1))[0];
      const label = `${view.homeTeam.name} vs ${view.awayTeam.name}`;
      const lineups = view.lineupsAnnounced ? 'announced' : 'pending';
      console.log(`${(row?.externalRef ?? view.id).padEnd(30)} ${label.padEnd(40)} XIs ${lineups}`);
    }
    console.log('\nPass a fixture ref to announce its starting XIs.');
    return;
  }

  const row = (await db.select().from(fixtures).where(eq(fixtures.externalRef, ref)).limit(1))[0];
  if (!row) throw new Error(`No fixture with external ref ${ref}`);

  if (isApiFixtureRef(ref)) {
    const announced = await fetchAndAnnounceLineups(row.id);
    console.log(announced ? 'Announced the lineups from API-Football.' : 'API-Football has not published both XIs yet.');
    return;
  }

  const entries = await seedLineupFor(db, [row.homeTeamId, row.awayTeamId]);
  const view = await announceLineups(row.id, entries);
  const starters = entries.filter((e) => e.isStarter).length;
  console.log(`Announced ${starters} starters for ${view.homeTeam.name} vs ${view.awayTeam.name}.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => Promise.all([closeDb(), closeRedis()]));
