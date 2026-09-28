# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

QuickKicks is a real-time friend-group fantasy game: managers draft two players from a single fixture's starting XIs, then score live off that match's events. v1 ships a mock fixture list (the top five European leagues, the three UEFA club competitions, the Nations League and friendlies — 24 squads over ~20 fixtures), simulated match data, and a compressed clock (`MATCH_MS_PER_MINUTE=2000`, so 90' runs in ~3 real minutes).

## Commands

```bash
cp .env.example .env      # both the server and the migrate/seed/sim scripts read the repo-root .env
npm install
npm run setup             # docker compose up + migrate + seed
npm run dev               # server (:4000) and web (:5173) concurrently

npm test                  # vitest, pure unit tests only — no Postgres, Redis or sockets needed
npx vitest run packages/shared/src/scoring/score.test.ts   # one file
npx vitest run -t "carry-over"                             # one test by name
npm run typecheck         # tsc --noEmit across all workspaces

npm run sim                           # headless match simulation + scoring balance report
npm run sim -- --runs 200 --seed demo # the calibration view used to tune DEFAULT_SCORING_RULES
npm run sim -- --scenario apps/server/src/providers/matchData/scenarios/powerup-goal.json
npm run services:reset                # wipe Postgres/Redis volumes and restart (then re-run migrate+seed)
```

Postgres is on `:5433` and Redis on `:6380` — offset from the defaults so they don't collide with local installs.

## Layout

- `packages/shared` — types, socket event contracts, snake draft, scoring rules and the pure scoring functions. Consumed **as TypeScript source** (`exports: "./src/index.ts"`); there is no build step, so edits are picked up by `tsx watch` and Vite immediately.
- `apps/server` — Fastify + Socket.IO + Postgres (drizzle) + Redis (ioredis).
- `apps/web` — React + Vite + zustand.

Relative imports carry the `.js` extension (ESM), including in `.ts` files.

## Architecture

**Postgres is the source of truth; Redis is a derived cache.** Every key in `redis/keys.ts` can be rebuilt from Postgres by `domain/room/rehydrate.ts`, which runs per-room on boot for any room in `drafting` or `live`. Flushing Redis costs a reconnect and nothing more. The one exception is presence (`ws/presence.ts`) — who is connected right now is only meaningful while the process is up.

**Every state delta goes through Redis pub/sub, never straight to a socket.** Domain code calls `publishToRoom(roomId, event, payload)`; the gateway holds one pattern subscription (`room:*`) and fans messages out to `io.to(roomId)`. Keep it that way — it's what allows a second server process without further work. `ws/gateway.ts` is a thin layer: authenticate the cookie at handshake, call a domain service, publish. `publishMembers()` republishes the whole member list plus standings after anything that moves several numbers at once.

**The match clock is the only timer in the system.** `domain/clock/matchClock.ts` steps the provider one match-minute per interval, and on each tick ingests events, expires power-ups, expires trades, writes room state and publishes. This is why power-up and trade expiry are *not* Redis TTLs: their deadlines are match-minutes, and only the clock knows the current minute. Ticks are non-reentrant (`ticking` flag) so events never interleave out of order. The draft's autopick timers (`domain/draft/draftService.ts`) are the other in-process timers; both are cleared on shutdown and re-armed by rehydrate.

**Scoring has one definition, used three ways.** `packages/shared/src/scoring/score.ts#scoreEvent` decides what an event is worth. The server calls it in `domain/scoring/scoringEngine.ts#ingestEvent` to write ledger rows incrementally; `packages/shared/src/scoring/replay.ts#replayLedger` restates the same rules as a pure function over stints and power-up windows (this is what tests assert against, without a database); the web client calls it to explain points in the UI. If you change scoring behaviour, change it in `shared` — don't add a second rule path on the server.

**One thing on the pitch is one scoring event.** Scoring pays every event it is handed, so the event stream must not describe the same moment twice. A shot that goes in arrives as `goal.scored` alone — never `shot.on_target` followed by `goal.scored` — and `shot.on_target` is therefore the value of a shot that *didn't* score. Real feeds do emit both, so collapsing the pair belongs in the provider adapter (`providers/matchData/`), not in the rules. Stat lines are free to count it both ways: `MockMatchDataProvider.snapshotAt` adds a goal back into `shotsOnTarget`.

**Attribution happens at event-minute, which is what makes swaps and trades work.** `roster_slots` is an append-only ownership timeline: a swap or trade closes the open row (`released_at_minute`) and opens a new one. Since `ingestEvent` pays whoever owns the player at that minute, a manager keeps the points they earned and the incoming player starts from zero for them — nothing is ever recalculated.

**The clean sheet is the one event that is not a moment.** It is a claim about a stretch of the match, so it can't be settled by asking who owned the player at one minute: a manager earns it by holding the player for at least `cleanSheet.minMinutesOwned` (60, summed across stints) *and* by his team conceding nothing for the whole time they held him. Conceding before you arrived isn't your problem; conceding at 90' while you still hold him costs you the lot. That makes it ownership-dependent, which a provider cannot know, so `MockMatchDataProvider` emits `clean_sheet.awarded` at full time for **every** non-forward starter regardless of the score — it reports the whistle and scoring decides. The rule itself is `scoring/cleanSheet.ts#cleanSheetClaimant`, called by both `replayLedger` and `ingestEvent`. Because 60 twice over doesn't fit in 90 minutes, at most one manager can qualify, so a clean sheet is still at most one ledger row.

**Ingest is idempotent.** The unique index on `(room_id, provider_event_id)` drops redeliveries, and the event row plus its score rows are written in one transaction so a crash can't leave an event recorded but unpaid. `sequence` is persisted in room state so a restart resumes the provider via `subscribe(..., { sinceSequence })` instead of replaying.

**Rooms snapshot their config.** `rooms.scoring_rules` and `rooms.draft_config` are JSONB copied from `DEFAULT_SCORING_RULES` / `DEFAULT_DRAFT_CONFIG` at creation. Retuning the rules never rewrites a match already in progress — always read rules off the room row, not the constant.

**Provider seam.** `providers/matchData/MatchDataProvider.ts` defines the interface; `DrivableMatchDataProvider` (steppable `advanceTo`) is deliberately separate because reality can't be stepped — a real provider would have the clock poll `getSnapshot()` instead. `MockMatchDataProvider` generates the entire timeline up front from a seeded mulberry32 RNG (seed = room id), so a room always replays the same match and a failing test is reproducible. `ApiFootballProvider` is an unimplemented placeholder documenting what a polling, revising source would change.

**Web client mirrors, never computes.** `state/roomStore.ts` holds one `RoomSnapshot` and folds server deltas into it; the server is the only authority on game state. Where a delta moves too much at once (draft complete, swap, accepted trade) `hooks/useSocket.ts` refetches the snapshot instead of patching. Vite proxies `/api` and `/socket.io` to `:4000` so the session cookie stays same-origin and the websocket handshake authenticates without CORS/SameSite juggling.

**Auth is one signed cookie.** A nickname creates a `users` row; the signed cookie carries the user id. It's checked once at the Socket.IO handshake, and the socket then caches `roomId`/`memberId` in `socket.data`.

**Concurrency.** `redis/locks.ts#withLock` is best-effort mutual exclusion around picks, trades, swaps and power-up activation. The real guarantees are Postgres unique indexes (`draft_picks_room_pick_key`, `draft_picks_room_player_key`, `power_ups_room_member_kind_key`); the lock just turns a constraint violation into a readable "it is not your turn" most of the time.

## Conventions

- Throw `DomainError` for anything a manager should read. It maps to a 400 over HTTP and to an ack + `action:error` toast over the socket; anything else is logged and reported generically.
- Migrations are hand-rolled SQL in `apps/server/src/db/migrations/NNNN_name.sql`, applied once each inside a transaction and tracked in `_migrations`. The SQL is the source of truth; `db/schema.ts` is the typed drizzle view of it, so a schema change means editing both.
- Tests live next to what they test and must stay pure — `vitest.config.ts` only includes `packages/**` and `apps/server/**` `*.test.ts`, and nothing there may touch Postgres, Redis or sockets. To pin minute-exact behaviour ("the power-up was live at 24'", "the 82' goal paid the new owner"), write a scenario JSON under `providers/matchData/scenarios/` rather than fighting random simulation data.
- The draft pool is the 22 starters only, because a drafted sub who never comes on would score nothing all match. Starters belong to the fixture (`fixture_lineups`), not the player: `fixtures.lineups_announced_at` gates `startDraft`, and `startDraft` rebuilds the pool from the lineup at that moment. `domain/fixture/fixtureService.ts#announceLineups` is the seam a real lineup feed calls; locally, `npm run lineups:announce -- <fixture ref>` drives it (the seed announces only `mock:fixture:che-liv`, leaving every other fixture pending for exactly this).
- **The fixture catalogue is shaped after API-Football**, the paid feed this replaces the mock with, so the adapter is a field rename rather than a reshape. A `competitions` row carries the provider's own vocabulary — a stable id, a `league`/`cup` type, and a country whose name is `"World"` for continental and international competitions — plus a `priority` that decides display order. The host screen at `/host` browses day → country → competition; the day/country grouping is pure and lives in `packages/shared/src/fixtures/browse.ts#groupFixturesByDay`, bucketed in the *viewer's* timezone because a 20:00 UTC kickoff is not the same day everywhere. No feed publishes when lineups drop, so `LINEUP_RELEASE_LEAD_MINUTES` estimates it at an hour before kickoff and the UI hedges ("XIs ~18:00") until the real announcement arrives.
- Seed data is split by league under `seed/squads/*.json`, with `seed/players.json` holding Chelsea and Liverpool first — `lineupFromSeed` takes the first two teams for the database-free sim and tests, and `scenarios/*.json` name their players by ref, so that ordering is load-bearing. Fixtures carry a `dayOffset` rather than a date and are anchored to the day `npm run seed` runs, so the host screen always opens on a populated today. Every squad is exactly 16 players starting 1 GK / 4 DEF / 3 MID / 3 FWD; `seed/catalog.test.ts` enforces it, because the simulator charges a conceded goal to the keeper plus every starting defender.
