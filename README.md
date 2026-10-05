# QuickKicks

A real-time friend-group fantasy game: draft two starters from one fixture, then live or die by their combined stats during that match.

Fixtures, lineups and live match data come from [API-Football](https://www.api-football.com/). The original mock catalogue — simulated matches on a compressed clock, a full 90' in about three real minutes — is still there behind `MATCH_DATA=mock` for development and demos.

## Stack

- `packages/shared` — types, snake draft, scoring rules
- `apps/server` — Fastify, Socket.IO, Postgres, Redis
- `apps/web` — React + Vite

## Setup

You need Node 20+, npm, Docker, and an API-Football key (the free plan works, within its limits below).

```bash
cp .env.example .env   # then set API_FOOTBALL_KEY
npm install
npm run setup
npm run dev
```

`setup` starts Postgres (`:5433`) and Redis (`:6380`), runs the migrations, and pulls the next few days of fixtures from API-Football. The running server re-syncs the fixture list every 12 hours; `npm run fixtures:sync` does it on demand.

- Web: http://localhost:5173
- API: http://localhost:4000

### Request budget

The free plan allows 100 requests a day and 10 a minute, and only serves fixtures from yesterday to tomorrow, so the host screen shows today and tomorrow. What the app spends:

- Fixture sync: one request per day synced (`API_FOOTBALL_SYNC_DAYS`, default 2), every `API_FOOTBALL_FIXTURE_SYNC_HOURS`. Days the plan refuses are skipped and logged.
- Lineups: one request every 5 minutes per fixture **that has a lobby waiting**, from about 90 minutes before kickoff until the XIs are out.
- A live match: one request per `API_FOOTBALL_LIVE_POLL_SECONDS` (default 90), however many rooms are watching it. About 75 for a whole match.

Responses are cached in Redis, so restarting the dev server does not spend requests again. The server logs a warning when fewer than 15 requests are left for the day.

### Without an API key

Set `MATCH_DATA=mock` and run `npm run seed` to load the mock catalogue. Only `mock:fixture:che-liv` has its lineups announced; `npm run lineups:announce -- <fixture ref>` releases any other one.

## How a game runs

1. Host picks a name, then browses the fixture list by day, country and competition and hosts whichever match they like. Friends join with the six-character code.
2. Once that match's starting XIs are published (usually about an hour before kickoff), the host starts a two-round snake draft of them. Until then the lobby waits and unlocks by itself.
3. The last pick starts following the match. Before kickoff the scoreboard shows the kickoff time; from kickoff, points update with each poll of the live feed.
4. During the match: three power-ups (each used once, on one of your players, and never two on the same player at once), one swap before 60', 1-for-1 trades until 75'.
5. Full time produces a recap.

Points already earned stay with you on a swap or trade. The incoming player starts from zero for you.

## Useful commands

```bash
npm test
npm run typecheck
npm run fixtures:sync            # pull fixtures from API-Football now
npm run lineups:announce         # list fixtures; pass a ref to fetch/announce its XIs
npm run sim
npm run sim -- --runs 20 --seed demo
npm run sim -- --scenario apps/server/src/providers/matchData/scenarios/powerup-goal.json
```
