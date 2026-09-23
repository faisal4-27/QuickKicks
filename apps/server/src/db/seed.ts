import { closeDb, db } from './client.js';
import { seedCatalog } from '../seed/catalog.js';

seedCatalog(db)
  .then(({ teams, players, fixtureId }) => {
    console.log(`Seeded ${teams} team(s), ${players} player(s).`);
    console.log(`Default fixture id: ${fixtureId}`);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
