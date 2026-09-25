-- teams and fixtures are upserted by external_ref (the seed today, a real data provider later),
-- so the ref has to be unique for ON CONFLICT to have anything to conflict on. Without this,
-- every seed run inserted a fresh copy of each team and moved the players onto it, leaving the
-- fixture pointing at empty teams.
--
-- A database that already has duplicates will fail here; run `npm run services:reset` and
-- re-run migrate + seed.

CREATE UNIQUE INDEX teams_external_ref_key ON teams (external_ref);
CREATE UNIQUE INDEX fixtures_external_ref_key ON fixtures (external_ref);
