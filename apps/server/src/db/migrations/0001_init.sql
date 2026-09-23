-- QuickKicks initial schema.
-- Mirrors src/db/schema.ts. Applied by `npm run migrate`.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE teams (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_ref text,
  name         text NOT NULL,
  short_name   text NOT NULL,
  crest_url    text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE players (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_ref  text,
  team_id       uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  full_name     text NOT NULL,
  position      text NOT NULL CHECK (position IN ('GK', 'DEF', 'MID', 'FWD')),
  shirt_number  integer,
  rating        integer NOT NULL DEFAULT 70,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX players_team_idx ON players (team_id);
CREATE UNIQUE INDEX players_external_ref_key ON players (external_ref);

CREATE TABLE fixtures (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_ref text,
  home_team_id uuid NOT NULL REFERENCES teams(id),
  away_team_id uuid NOT NULL REFERENCES teams(id),
  status       text NOT NULL DEFAULT 'scheduled'
                 CHECK (status IN ('scheduled', 'live', 'half_time', 'finished')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rooms (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  join_code           text NOT NULL,
  host_user_id        uuid NOT NULL REFERENCES users(id),
  fixture_id          uuid NOT NULL REFERENCES fixtures(id),
  status              text NOT NULL DEFAULT 'lobby'
                        CHECK (status IN ('lobby', 'drafting', 'live', 'finished')),
  draft_config        jsonb NOT NULL,
  scoring_rules       jsonb NOT NULL,
  ms_per_match_minute integer NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  draft_started_at    timestamptz,
  match_started_at    timestamptz,
  finished_at         timestamptz
);
CREATE UNIQUE INDEX rooms_join_code_key ON rooms (join_code);

CREATE TABLE room_members (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id        uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id),
  display_name   text NOT NULL,
  draft_position integer NOT NULL,
  is_host        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX room_members_room_user_key ON room_members (room_id, user_id);
CREATE UNIQUE INDEX room_members_room_position_key ON room_members (room_id, draft_position);

CREATE TABLE draft_picks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id      uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  round        integer NOT NULL,
  pick_number  integer NOT NULL,
  member_id    uuid NOT NULL REFERENCES room_members(id) ON DELETE CASCADE,
  player_id    uuid NOT NULL REFERENCES players(id),
  was_autopick boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- These two constraints are the race protection: one manager per pick slot, and a player
-- can only ever be drafted once in a room.
CREATE UNIQUE INDEX draft_picks_room_pick_key ON draft_picks (room_id, pick_number);
CREATE UNIQUE INDEX draft_picks_room_player_key ON draft_picks (room_id, player_id);

CREATE TABLE roster_slots (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id            uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  member_id          uuid NOT NULL REFERENCES room_members(id) ON DELETE CASCADE,
  player_id          uuid NOT NULL REFERENCES players(id),
  slot_index         integer NOT NULL,
  acquired_at_minute integer NOT NULL DEFAULT 0,
  released_at_minute integer,
  acquired_via       text NOT NULL CHECK (acquired_via IN ('draft', 'swap', 'trade')),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX roster_slots_room_idx ON roster_slots (room_id);
CREATE INDEX roster_slots_member_idx ON roster_slots (member_id);
-- A player can be held by at most one manager at a time, but the closed history rows are
-- free to repeat the same player.
CREATE UNIQUE INDEX roster_slots_active_player_key
  ON roster_slots (room_id, player_id)
  WHERE released_at_minute IS NULL;
CREATE UNIQUE INDEX roster_slots_active_slot_key
  ON roster_slots (room_id, member_id, slot_index)
  WHERE released_at_minute IS NULL;

CREATE TABLE match_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id           uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  provider_event_id text NOT NULL,
  sequence          integer NOT NULL,
  match_minute      integer NOT NULL,
  player_id         uuid REFERENCES players(id),
  type              text NOT NULL,
  meta              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
-- Idempotency: a redelivered provider event cannot be scored a second time.
CREATE UNIQUE INDEX match_events_room_provider_key ON match_events (room_id, provider_event_id);
CREATE INDEX match_events_room_sequence_idx ON match_events (room_id, sequence);

CREATE TABLE score_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id        uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  member_id      uuid NOT NULL REFERENCES room_members(id) ON DELETE CASCADE,
  player_id      uuid NOT NULL REFERENCES players(id),
  match_event_id uuid REFERENCES match_events(id) ON DELETE CASCADE,
  match_minute   integer NOT NULL,
  base_points    double precision NOT NULL,
  multiplier     double precision NOT NULL DEFAULT 1,
  awarded_points double precision NOT NULL,
  power_up_id    uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX score_entries_room_member_idx ON score_entries (room_id, member_id);
CREATE INDEX score_entries_event_idx ON score_entries (match_event_id);

CREATE TABLE power_ups (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id             uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  member_id           uuid NOT NULL REFERENCES room_members(id) ON DELETE CASCADE,
  kind                text NOT NULL
                        CHECK (kind IN ('double_passes', 'double_goals', 'double_all')),
  activated_at_minute integer NOT NULL,
  expires_at_minute   integer NOT NULL,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired')),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX power_ups_room_member_idx ON power_ups (room_id, member_id);
CREATE UNIQUE INDEX power_ups_room_member_kind_key ON power_ups (room_id, member_id, kind);

CREATE TABLE swaps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  member_id     uuid NOT NULL REFERENCES room_members(id) ON DELETE CASCADE,
  out_player_id uuid NOT NULL REFERENCES players(id),
  in_player_id  uuid NOT NULL REFERENCES players(id),
  match_minute  integer NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX swaps_room_member_idx ON swaps (room_id, member_id);

CREATE TABLE trades (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id             uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  from_member_id      uuid NOT NULL REFERENCES room_members(id) ON DELETE CASCADE,
  to_member_id        uuid NOT NULL REFERENCES room_members(id) ON DELETE CASCADE,
  offered_player_id   uuid NOT NULL REFERENCES players(id),
  requested_player_id uuid NOT NULL REFERENCES players(id),
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled', 'expired')),
  created_at_minute   integer NOT NULL,
  expires_at_minute   integer NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  resolved_at         timestamptz
);
CREATE INDEX trades_room_idx ON trades (room_id);
-- At most one live offer per (proposer, target) pair, so the modal never has to disambiguate.
CREATE UNIQUE INDEX trades_pending_pair_key
  ON trades (room_id, from_member_id, to_member_id)
  WHERE status = 'pending';
