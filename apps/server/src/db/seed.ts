import { closeDb, db } from './client.js';
import { seedCatalog } from '../seed/catalog.js';

seedCatalog(db)
  .then(({ teams, players, fixtures }) => {
    console.log(`Seeded ${teams} team(s), ${players} player(s), ${fixtures} fixture(s).`);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
