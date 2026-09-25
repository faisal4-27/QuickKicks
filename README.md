# QuickKicks

A real-time friend-group fantasy game: draft two Premier League players, then live or die by their combined stats during a single match.

v1 is Chelsea vs Liverpool, mock match data, and a compressed clock so a full 90' finishes in about three real minutes.

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

`setup` starts Postgres (`:5433`) and Redis (`:6380`), runs the migration, and seeds both squads.

- Web: http://localhost:5173
- API: http://localhost:4000

## How a game runs

1. Host picks a name and creates a room. Friends join with the six-character code.
2. Host starts a two-round snake draft of the two starting XIs.
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
