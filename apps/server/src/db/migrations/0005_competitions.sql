-- Hosts now browse fixtures the way a livescore app lays them out: by day, then by country, then
-- by competition. `fixtures.competition` was free text, which cannot express "England > Premier
-- League", cannot sort the Champions League above a domestic league, and cannot tell a club
-- competition apart from an international one.
--
-- The shape follows API-Football's /leagues payload, because that is the feed this replaces the
-- mock with: a competition has a stable id, a type of League or Cup, and a nested country whose
-- name is "World" for continental and international competitions. Keeping their vocabulary means
-- the adapter is a field rename rather than a reshape.

CREATE TABLE competitions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_ref text,
  name         text NOT NULL,
  type         text NOT NULL DEFAULT 'league' CHECK (type IN ('league', 'cup')),
  -- "World" for continental and international competitions, matching the provider.
  country_name text NOT NULL,
  country_code text,
  flag_url     text,
  logo_url     text,
  -- Display order within a day. Lower sorts first, so the competitions people care about lead.
  priority     integer NOT NULL DEFAULT 100,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX competitions_external_ref_key ON competitions (external_ref);

ALTER TABLE teams ADD COLUMN country_name text;
-- National sides share the teams table with clubs; only the flag distinguishes them.
ALTER TABLE teams ADD COLUMN national boolean NOT NULL DEFAULT false;

ALTER TABLE fixtures ADD COLUMN competition_id uuid REFERENCES competitions(id);
ALTER TABLE fixtures ADD COLUMN round text;

-- Carry existing fixtures across rather than orphaning them. Every fixture the seed has ever
-- written set a competition, so nothing should be left null by the time the constraint lands
-- below; if something is, this migration fails inside its transaction and nothing is applied.
INSERT INTO competitions (external_ref, name, type, country_name, country_code, priority)
SELECT DISTINCT 'legacy:' || competition, competition, 'league', 'England', 'GB', 1
FROM fixtures
WHERE competition IS NOT NULL;

UPDATE fixtures f
SET competition_id = c.id
FROM competitions c
WHERE c.external_ref = 'legacy:' || f.competition;

ALTER TABLE fixtures DROP COLUMN competition;
ALTER TABLE fixtures ALTER COLUMN competition_id SET NOT NULL;

-- A fixture now always has a kickoff, because the browser groups by the day it falls on. Rows
-- seeded before this had none; anchoring them to now keeps them visible on today's tab.
UPDATE fixtures SET kickoff_at = now() WHERE kickoff_at IS NULL;
ALTER TABLE fixtures ALTER COLUMN kickoff_at SET NOT NULL;

CREATE INDEX fixtures_kickoff_idx ON fixtures (kickoff_at);
CREATE INDEX fixtures_competition_idx ON fixtures (competition_id);
