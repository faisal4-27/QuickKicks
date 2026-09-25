-- Power-ups now boost one player rather than a manager's whole roster. A manager still uses each
-- kind at most once (power_ups_room_member_kind_key), but can run two at the same time as long
-- as they are on different players.
--
-- Nullable only because rows written before this migration were manager-wide; the service always
-- sets it, and a null never matches an event, so those old rows simply stop boosting.

ALTER TABLE power_ups ADD COLUMN player_id uuid REFERENCES players(id);
