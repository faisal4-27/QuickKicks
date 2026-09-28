-- Hosts now choose which fixture a room plays, and a draft cannot start until that fixture's
-- starting XIs are announced. Starters used to be one global flag in the seed file; a player
-- starts one match and not the next, so the lineup has to belong to the fixture.
--
-- lineups_announced_at is the gate. It is set in the same transaction that writes the rows, so
-- a fixture never looks announced with a half-written lineup.

ALTER TABLE fixtures ADD COLUMN competition text;
ALTER TABLE fixtures ADD COLUMN kickoff_at timestamptz;
ALTER TABLE fixtures ADD COLUMN lineups_announced_at timestamptz;

CREATE TABLE fixture_lineups (
  fixture_id uuid NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
  player_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  is_starter boolean NOT NULL,
  PRIMARY KEY (fixture_id, player_id)
);
