import type { Position } from '@quickkicks/shared';
import { eq } from 'drizzle-orm';
import type { Executor } from '../db/client.js';
import { fixtures, players, teams } from '../db/schema.js';
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

export interface SeedCatalog {
  fixture: { externalRef: string; homeTeamRef: string; awayTeamRef: string };
  teams: SeedTeam[];
}

export const catalog = seedData as SeedCatalog;

/** Lookup of which seeded refs start the match, which is what defines the draft pool. */
export const STARTER_REFS: ReadonlySet<string> = new Set(
  catalog.teams.flatMap((t) => t.players.filter((p) => p.starter).map((p) => p.externalRef)),
);

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
): Promise<{ teams: number; players: number; fixtureId: string }> {
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

  const homeTeamId = teamIdByRef.get(catalog.fixture.homeTeamRef);
  const awayTeamId = teamIdByRef.get(catalog.fixture.awayTeamRef);
  if (!homeTeamId || !awayTeamId) throw new Error('Fixture references an unseeded team');

  const existingFixture = (
    await exec
      .select({ id: fixtures.id })
      .from(fixtures)
      .where(eq(fixtures.externalRef, catalog.fixture.externalRef))
      .limit(1)
  )[0];

  const fixtureId =
    existingFixture?.id ??
    (
      await exec
        .insert(fixtures)
        .values({
          externalRef: catalog.fixture.externalRef,
          homeTeamId,
          awayTeamId,
          status: 'scheduled',
        })
        .returning({ id: fixtures.id })
    )[0]?.id;

  if (!fixtureId) throw new Error('Failed to create the default fixture');

  return { teams: catalog.teams.length, players: playerCount, fixtureId };
}

/** The fixture rooms are created against until real fixtures exist. */
export async function defaultFixtureId(exec: Executor): Promise<string> {
  const row = (
    await exec
      .select({ id: fixtures.id })
      .from(fixtures)
      .where(eq(fixtures.externalRef, catalog.fixture.externalRef))
      .limit(1)
  )[0];
  if (row) return row.id;
  const { fixtureId } = await seedCatalog(exec);
  return fixtureId;
}

/** Both squads for a fixture, used to build the draft pool. */
export async function fixturePlayers(exec: Executor, fixtureId: string) {
  const fixture = (
    await exec.select().from(fixtures).where(eq(fixtures.id, fixtureId)).limit(1)
  )[0];
  if (!fixture) throw new Error(`Unknown fixture ${fixtureId}`);

  const [home, away] = await Promise.all([
    exec.select().from(players).where(eq(players.teamId, fixture.homeTeamId)),
    exec.select().from(players).where(eq(players.teamId, fixture.awayTeamId)),
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
  };
}