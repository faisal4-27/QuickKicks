# QuickKicks

A real-time friend-group fantasy game: draft two starters from one fixture, then live or die by their combined stats during that match.

v1 ships a mock fixture list — the top five European leagues, the three UEFA club competitions and a couple of internationals, spread over the next few days — with simulated match data and a compressed clock, so a full 90' finishes in about three real minutes.

## Stack

- `packages/shared` — types, snake draft, scoring rules
- `apps/server` — Fastify, Socket.IO, Postgres, Redis
- `apps/web` — React + Vite

## Setup

You need Node 20+, npm, and Docker.

```bash
cp .env.example .env
npm install
npm run setup
npm run dev
```

`setup` starts Postgres (`:5433`) and Redis (`:6380`), runs the migrations, and seeds the competitions, squads and fixtures. Seeding anchors kickoffs to the day it runs, so re-run `npm run seed` if the fixture list has gone stale.

- Web: http://localhost:5173
- API: http://localhost:4000

## How a game runs

1. Host picks a name, then browses the fixture list by day, country and competition and hosts whichever match they like. Friends join with the six-character code.
2. Once that match's starting XIs are announced, the host starts a two-round snake draft of them. Until then the lobby waits and unlocks by itself. Only `mock:fixture:che-liv` is announced by the seed; `npm run lineups:announce -- <fixture ref>` releases any other one locally.
3. The last pick kicks off the simulated match. Points update live.
4. During the match: three power-ups (each used once, on one of your players, and never two on the same player at once), one swap before 60', 1-for-1 trades until 75'.
5. Full time produces a recap.

Points already earned stay with you on a swap or trade. The incoming player starts from zero for you.

## Useful commands

```bash
npm test
npm run typecheck
npm run sim
npm run sim -- --runs 20 --seed demo
npm run sim -- --scenario apps/server/src/providers/matchData/scenarios/powerup-goal.json
```
