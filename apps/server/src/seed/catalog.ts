import type { CompetitionType, Position } from '@quickkicks/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { Executor } from '../db/client.js';
import { competitions, fixtureLineups, fixtures, players, teams } from '../db/schema.js';
import type { LineupSource } from '../providers/matchData/lineup.js';
import competitionData from './competitions.json' with { type: 'json' };
import fixtureData from './fixtures.json' with { type: 'json' };
import coreSquads from './players.json' with { type: 'json' };
import englandSquads from './squads/england.json' with { type: 'json' };
import franceSquads from './squads/france.json' with { type: 'json' };
import germanySquads from './squads/germany.json' with { type: 'json' };
import italySquads from './squads/italy.json' with { type: 'json' };
import nationsSquads from './squads/nations.json' with { type: 'json' };
import spainSquads from './squads/spain.json' with { type: 'json' };

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
  countryName: string;
  national: boolean;
  crestUrl: string | null;
  players: SeedPlayer[];
}

export interface SeedCompetition {
  externalRef: string;
  name: string;
  type: CompetitionType;
  countryName: string;
  countryCode: string | null;
  flagUrl: string | null;
  logoUrl: string | null;
  priority: number;
}

export interface SeedFixture {
  externalRef: string;
  competitionRef: string;
  homeTeamRef: string;
  awayTeamRef: string;
  round: string | null;
  /**
   * Days from the day the seed runs, so the host screen always has matches on today's tab and a
   * few days either side of it. Absolute dates would go stale the moment the repo sat for a week.
   */
  dayOffset: number;
  /** `HH:MM` in the seeding machine's timezone, which is also the timezone the host browses in. */
  kickoffTime: string;
  /**
   * Whether the seed announces this fixture's XIs up front. Only one fixture is announced, so a
   * host can draft immediately while every other fixture exercises the "waiting for lineups"
   * state that `npm run lineups:announce` drives.
   */
  lineupsAnnounced: boolean;
}

export interface SeedCatalog {
  competitions: SeedCompetition[];
  fixtures: SeedFixture[];
  teams: SeedTeam[];
}

/**
 * Chelsea and Liverpool come first and stay first: `lineupFromSeed` takes the first two teams for
 * the database-free sim and tests, and `scenarios/*.json` name their players by ref.
 */
export const catalog: SeedCatalog = {
  competitions: competitionData.competitions as SeedCompetition[],
  fixtures: fixtureData.fixtures as SeedFixture[],
  teams: [
    ...(coreSquads.teams as SeedTeam[]),
    ...(englandSquads.teams as SeedTeam[]),
    ...(spainSquads.teams as SeedTeam[]),
    ...(italySquads.teams as SeedTeam[]),
    ...(germanySquads.teams as SeedTeam[]),
    ...(franceSquads.teams as SeedTeam[]),
    ...(nationsSquads.teams as SeedTeam[]),
  ],
};

/** Resolves a fixture's `dayOffset` + `kickoffTime` against the day the seed is running. */
export function kickoffFor(fixture: SeedFixture, today = new Date()): Date {
  const [hours, minutes] = fixture.kickoffTime.split(':').map(Number);
  const kickoff = new Date(today);
  kickoff.setDate(kickoff.getDate() + fixture.dayOffset);
  kickoff.setHours(hours ?? 0, minutes ?? 0, 0, 0);
  return kickoff;
}

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
): Promise<{ competitions: number; teams: number; players: number; fixtures: number }> {
  const competitionIdByRef = new Map<string, string>();
  const teamIdByRef = new Map<string, string>();
  let playerCount = 0;

  for (const competition of catalog.competitions) {
    const [row] = await exec
      .insert(competitions)
      .values(competition)
      .onConflictDoUpdate({
        target: competitions.externalRef,
        set: {
          name: competition.name,
          type: competition.type,
          countryName: competition.countryName,
          countryCode: competition.countryCode,
          flagUrl: competition.flagUrl,
          logoUrl: competition.logoUrl,
          priority: competition.priority,
        },
      })
      .returning({ id: competitions.id });

    if (!row) throw new Error(`Failed to resolve competition ${competition.externalRef}`);
    competitionIdByRef.set(competition.externalRef, row.id);
  }

  for (const team of catalog.teams) {
    const [row] = await exec
      .insert(teams)
      .values({
        externalRef: team.externalRef,
        name: team.name,
        shortName: team.shortName,
        crestUrl: team.crestUrl,
        countryName: team.countryName,
        national: team.national,
      })
      .onConflictDoUpdate({
        target: teams.externalRef,
        set: {
          name: team.name,
          shortName: team.shortName,
          crestUrl: team.crestUrl,
          countryName: team.countryName,
          national: team.national,
        },
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

  const today = new Date();

  for (const seedFixture of catalog.fixtures) {
    const homeTeamId = teamIdByRef.get(seedFixture.homeTeamRef);
    const awayTeamId = teamIdByRef.get(seedFixture.awayTeamRef);
    if (!homeTeamId || !awayTeamId) {
      throw new Error(`Fixture ${seedFixture.externalRef} references an unseeded team`);
    }
    const competitionId = competitionIdByRef.get(seedFixture.competitionRef);
    if (!competitionId) {
      throw new Error(`Fixture ${seedFixture.externalRef} references an unseeded competition`);
    }

    // Re-seeding re-anchors kickoffs to today, so a database left alone for a week still opens on
    // a populated host screen rather than a wall of fixtures that have already been played.
    const kickoffAt = kickoffFor(seedFixture, today);
    const values = {
      homeTeamId,
      awayTeamId,
      competitionId,
      round: seedFixture.round,
      kickoffAt,
    };

    const [row] = await exec
      .insert(fixtures)
      .values({ externalRef: seedFixture.externalRef, status: 'scheduled', ...values })
      .onConflictDoUpdate({ target: fixtures.externalRef, set: values })
      .returning({ id: fixtures.id, lineupsAnnouncedAt: fixtures.lineupsAnnouncedAt });
    if (!row) throw new Error(`Failed to resolve fixture ${seedFixture.externalRef}`);

    // Never un-announce on a re-seed: a lobby may already be waiting on (or drafting from) it.
    if (seedFixture.lineupsAnnounced && !row.lineupsAnnouncedAt) {
      const entries = await seedLineupFor(exec, [homeTeamId, awayTeamId]);
      await exec.transaction((tx) => saveFixtureLineup(tx, row.id, entries));
    }
  }

  return {
    competitions: catalog.competitions.length,
    teams: catalog.teams.length,
    players: playerCount,
    fixtures: catalog.fixtures.length,
  };
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

  const [homeTeam, awayTeam, competition] = await Promise.all([
    exec.select().from(teams).where(eq(teams.id, fixture.homeTeamId)).limit(1),
    exec.select().from(teams).where(eq(teams.id, fixture.awayTeamId)).limit(1),
    exec.select().from(competitions).where(eq(competitions.id, fixture.competitionId)).limit(1),
  ]);

  return {
    fixture,
    homeTeam: homeTeam[0]!,
    awayTeam: awayTeam[0]!,
    competition: competition[0]!,
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