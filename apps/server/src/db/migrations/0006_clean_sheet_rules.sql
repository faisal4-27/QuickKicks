-- Clean sheets became a rule about how long a manager held the player rather than who held him at
-- the whistle, which added `cleanSheet` to the scoring rules. Rooms snapshot their rules at
-- creation, so a room drafted before this change carries a rules object without the new key, and
-- scoring would have no threshold to test against. Backfill the default into those rows.
--
-- Only the missing key is added: the point values in an older snapshot are left exactly as they
-- were, because retuning the rules must never rewrite a match that has already been played.
update rooms
set scoring_rules = scoring_rules || '{"cleanSheet": {"minMinutesOwned": 60}}'::jsonb
where not scoring_rules ? 'cleanSheet';
