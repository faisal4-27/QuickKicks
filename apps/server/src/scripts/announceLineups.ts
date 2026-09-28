/**
 * Announces a seeded fixture's starting XIs, standing in for the lineup feed a real provider
 * will drive. Any lobby waiting on the fixture is told over pub/sub, so a running server picks
 * it up live and the host's "Start the draft" button unlocks.
 *
 *   npm run lineups:announce                          # lists fixtures and their lineup status
 *   npm run lineups:announce -- mock:fixture:liv-che  # announces that one
 */
import { eq } from 'drizzle-orm';
import { closeDb, db } from '../db/client.js';
import { fixtures } from '../db/schema.js';
import { announceLineups, listOpenFixtures } from '../domain/fixture/fixtureService.js';
import { closeRedis } from '../redis/client.js';
import { seedLineupFor } from '../seed/catalog.js';

async function main(): Promise<void> {
  const ref = process.argv[2];

  if (!ref) {
    const all = await db.select().from(fixtures);
    const open = new Map((await listOpenFixtures()).map((f) => [f.id, f]));
    for (const row of all) {
      const view = open.get(row.id);
      const label = view ? `${view.homeTeam.name} vs ${view.awayTeam.name}` : row.status;
      const lineups = row.lineupsAnnouncedAt ? 'announced' : 'pending';
      console.log(`${(row.externalRef ?? row.id).padEnd(28)} ${label.padEnd(28)} XIs ${lineups}`);
    }
    console.log('\nPass a fixture ref to announce its starting XIs.');
    return;
  }

  const row = (await db.select().from(fixtures).where(eq(fixtures.externalRef, ref)).limit(1))[0];
  if (!row) throw new Error(`No fixture with external ref ${ref}`);

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
