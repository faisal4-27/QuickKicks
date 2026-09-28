import type { Position } from '@quickkicks/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { Executor } from '../db/client.js';
import { fixtureLineups, fixtures, players, teams } from '../db/schema.js';
import type { LineupSource } from '../providers/matchData/lineup.js';
import seedData from './players.json' with { type: 'json' };

export interface SeedPlayer {
  externalRef: string;
  fullName: string;
  position: Position;
  shirtNumber: number | null;
  rating: number;
  starter: boolean;
}

export interface SeedTeam {
  externalRef: string;
  name: string;
  shortName: string;
  crestUrl: string | null;
  players: SeedPlayer[];
}

export interface SeedFixture {
  externalRef: string;
  homeTeamRef: string;
  awayTeamRef: string;
  competition: string;
  /**
   * Whether the seed announces this fixture's XIs up front. One seeded fixture is deliberately
   * left unannounced so the lobby's "waiting for lineups" state can be exercised locally with
   * `npm run lineups:announce`.
   */
  lineupsAnnounced: boolean;
}

export interface SeedCatalog {
  fixtures: SeedFixture[];
  teams: SeedTeam[];
}

export const catalog = seedData as SeedCatalog;

export function seedPlayerByRef(ref: string): SeedPlayer | undefined {
  for (const team of catalog.teams) {
    const found = team.players.find((p) => p.externalRef === ref);
    if (found) return found;
  }
  return undefined;
}

export function seedTeamForPlayerRef(ref: string): SeedTeam | undefined {
  return catalog.teams.find((t) => t.players.some((p) => p.externalRef === ref));
}

/**
 * Idempotent: safe to run repeatedly. Matches on external_ref so re-seeding updates the
 * catalog in place instead of duplicating players that rooms already reference.
 */
export async function seedCatalog(
  exec: Executor,
): Promise<{ teams: number; players: number; fixtures: number }> {
  const teamIdByRef = new Map<string, string>();
  let playerCount = 0;

  for (const team of catalog.teams) {
    const [row] = await exec
      .insert(teams)
      .values({
        externalRef: team.externalRef,
        name: team.name,
        shortName: team.shortName,
        crestUrl: team.crestUrl,
      })
      .onConflictDoUpdate({
        target: teams.externalRef,
        set: { name: team.name, shortName: team.shortName, crestUrl: team.crestUrl },
      })
      .returning({ id: teams.id });

    const teamId = row?.id;
    if (!teamId) throw new Error(`Failed to resolve team ${team.externalRef}`);
    teamIdByRef.set(team.externalRef, teamId);

    for (const player of team.players) {
      await exec
        .insert(players)
        .values({
          externalRef: player.externalRef,
          teamId,
          fullName: player.fullName,
          position: player.position,
          shirtNumber: player.shirtNumber,
          rating: player.rating,
        })
        .onConflictDoUpdate({
          target: players.externalRef,
          set: {
            teamId,
            fullName: player.fullName,
            position: player.position,
            shirtNumber: player.shirtNumber,
            rating: player.rating,
          },
        });
      playerCount += 1;
    }
  }

  for (const seedFixture of catalog.fixtures) {
    const homeTeamId = teamIdByRef.get(seedFixture.homeTeamRef);
    const awayTeamId = teamIdByRef.get(seedFixture.awayTeamRef);
    if (!homeTeamId || !awayTeamId) {
      throw new Error(`Fixture ${seedFixture.externalRef} references an unseeded team`);
    }

    const [row] = await exec
      .insert(fixtures)
      .values({
        externalRef: seedFixture.externalRef,
        homeTeamId,
        awayTeamId,
        competition: seedFixture.competition,
        status: 'scheduled',
      })
      .onConflictDoUpdate({
        target: fixtures.externalRef,
        set: { homeTeamId, awayTeamId, competition: seedFixture.competition },
      })
      .returning({ id: fixtures.id, lineupsAnnouncedAt: fixtures.lineupsAnnouncedAt });
    if (!row) throw new Error(`Failed to resolve fixture ${seedFixture.externalRef}`);

    // Never un-announce on a re-seed: a lobby may already be waiting on (or drafting from) it.
    if (seedFixture.lineupsAnnounced && !row.lineupsAnnouncedAt) {
      const entries = await seedLineupFor(exec, [homeTeamId, awayTeamId]);
      await exec.transaction((tx) => saveFixtureLineup(tx, row.id, entries));
    }
  }

  return { teams: catalog.teams.length, players: playerCount, fixtures: catalog.fixtures.length };
}

export interface LineupEntry {
  playerId: string;
  isStarter: boolean;
}

/** The seed file's `starter` flags, as a lineup for whichever two teams are playing. */
export async function seedLineupFor(exec: Executor, teamIds: string[]): Promise<LineupEntry[]> {
  const rows = await exec
    .select({ id: players.id, externalRef: players.externalRef })
    .from(players)
    .where(inArray(players.teamId, teamIds));
  return rows.map((row) => ({
    playerId: row.id,
    isStarter: row.externalRef ? (seedPlayerByRef(row.externalRef)?.starter ?? false) : false,
  }));
}

/**
 * Replaces a fixture's lineup and marks it announced. Call inside a transaction so the gate and
 * the rows it guards land together.
 */
export async function saveFixtureLineup(
  exec: Executor,
  fixtureId: string,
  entries: LineupEntry[],
): Promise<void> {
  await exec.delete(fixtureLineups).where(eq(fixtureLineups.fixtureId, fixtureId));
  if (entries.length > 0) {
    await exec.insert(fixtureLineups).values(entries.map((e) => ({ fixtureId, ...e })));
  }
  await exec
    .update(fixtures)
    .set({ lineupsAnnouncedAt: new Date() })
    .where(eq(fixtures.id, fixtureId));
}

/** Both squads for a fixture, plus its announced starters, used to build the draft pool. */
export async function fixturePlayers(exec: Executor, fixtureId: string) {
  const fixture = (
    await exec.select().from(fixtures).where(eq(fixtures.id, fixtureId)).limit(1)
  )[0];
  if (!fixture) throw new Error(`Unknown fixture ${fixtureId}`);

  const [home, away, lineup] = await Promise.all([
    exec.select().from(players).where(eq(players.teamId, fixture.homeTeamId)),
    exec.select().from(players).where(eq(players.teamId, fixture.awayTeamId)),
    exec
      .select({ playerId: fixtureLineups.playerId })
      .from(fixtureLineups)
      .where(and(eq(fixtureLineups.fixtureId, fixtureId), eq(fixtureLineups.isStarter, true))),
  ]);

  const [homeTeam, awayTeam] = await Promise.all([
    exec.select().from(teams).where(eq(teams.id, fixture.homeTeamId)).limit(1),
    exec.select().from(teams).where(eq(teams.id, fixture.awayTeamId)).limit(1),
  ]);

  return {
    fixture,
    homeTeam: homeTeam[0]!,
    awayTeam: awayTeam[0]!,
    homePlayers: home,
    awayPlayers: away,
    starterIds: new Set(lineup.map((row) => row.playerId)) as ReadonlySet<string>,
  };
}

export type FixtureCatalog = Awaited<ReturnType<typeof fixturePlayers>>;

export function lineupSource(fixtureCatalog: FixtureCatalog, matchId: string): LineupSource {
  return {
    matchId,
    homeTeam: fixtureCatalog.homeTeam,
    awayTeam: fixtureCatalog.awayTeam,
    homePlayers: fixtureCatalog.homePlayers,
    awayPlayers: fixtureCatalog.awayPlayers,
    starterIds: fixtureCatalog.starterIds,
  };
}