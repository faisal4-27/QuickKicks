import { expectedLineupRelease, type Competition, type FixtureView, type Team } from '@quickkicks/shared';
import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { competitions, fixtures, rooms, teams } from '../../db/schema.js';
import { publishToRoom } from '../../redis/pubsub.js';
import { type LineupEntry, saveFixtureLineup } from '../../seed/catalog.js';

type FixtureRow = typeof fixtures.$inferSelect;
type TeamRow = typeof teams.$inferSelect;
type CompetitionRow = typeof competitions.$inferSelect;

/**
 * How far either side of now the host screen looks. Behind, so a fixture that has just kicked off
 * does not vanish from today's tab mid-scroll; ahead, so the day tabs stop somewhere.
 */
const WINDOW_BEHIND_HOURS = 2;
const WINDOW_AHEAD_DAYS = 8;

function teamView(row: TeamRow): Team {
  return {
    id: row.id,
    externalRef: row.externalRef,
    name: row.name,
    shortName: row.shortName,
    crestUrl: row.crestUrl,
    countryName: row.countryName,
    national: row.national,
  };
}

function competitionView(row: CompetitionRow): Competition {
  return {
    id: row.id,
    externalRef: row.externalRef,
    name: row.name,
    type: row.type,
    countryName: row.countryName,
    countryCode: row.countryCode,
    flagUrl: row.flagUrl,
    logoUrl: row.logoUrl,
    priority: row.priority,
  };
}

export function fixtureView(
  fixture: FixtureRow,
  homeTeam: TeamRow,
  awayTeam: TeamRow,
  competition: CompetitionRow,
): FixtureView {
  const kickoffAt = fixture.kickoffAt.toISOString();
  return {
    id: fixture.id,
    homeTeam: teamView(homeTeam),
    awayTeam: teamView(awayTeam),
    competition: competitionView(competition),
    round: fixture.round,
    kickoffAt,
    lineupsAnnounced: fixture.lineupsAnnouncedAt !== null,
    // Once the XIs are actually out, show when they landed instead of when we guessed they would.
    lineupsExpectedAt:
      fixture.lineupsAnnouncedAt?.toISOString() ?? expectedLineupRelease(kickoffAt),
  };
}

async function viewsFor(rows: FixtureRow[]): Promise<FixtureView[]> {
  if (rows.length === 0) return [];

  const teamIds = [...new Set(rows.flatMap((f) => [f.homeTeamId, f.awayTeamId]))];
  const competitionIds = [...new Set(rows.map((f) => f.competitionId))];
  const [teamRows, competitionRows] = await Promise.all([
    db.select().from(teams).where(inArray(teams.id, teamIds)),
    db.select().from(competitions).where(inArray(competitions.id, competitionIds)),
  ]);

  const teamById = new Map(teamRows.map((t) => [t.id, t]));
  const competitionById = new Map(competitionRows.map((c) => [c.id, c]));

  return rows.map((f) =>
    fixtureView(
      f,
      teamById.get(f.homeTeamId)!,
      teamById.get(f.awayTeamId)!,
      competitionById.get(f.competitionId)!,
    ),
  );
}

/**
 * What a host can create a room for. Scoped to a window around now rather than everything on the
 * books: a real provider carries every competition it covers, and the host screen only draws a
 * handful of days. The client folds this flat list into day/country/competition sections with
 * `groupFixturesByDay`, so ordering here only has to be stable.
 */
export async function listOpenFixtures(): Promise<FixtureView[]> {
  const rows = await db
    .select()
    .from(fixtures)
    .where(
      and(
        eq(fixtures.status, 'scheduled'),
        gte(fixtures.kickoffAt, sql`now() - ${`${WINDOW_BEHIND_HOURS} hours`}::interval`),
        lt(fixtures.kickoffAt, sql`now() + ${`${WINDOW_AHEAD_DAYS} days`}::interval`),
      ),
    )
    .orderBy(asc(fixtures.kickoffAt), asc(fixtures.createdAt));
  return viewsFor(rows);
}

export async function getFixtureView(fixtureId: string): Promise<FixtureView | null> {
  const row = (await db.select().from(fixtures).where(eq(fixtures.id, fixtureId)).limit(1))[0];
  if (!row) return null;
  return (await viewsFor([row]))[0] ?? null;
}

/**
 * Records a fixture's starting XIs and tells every lobby waiting on it. This is the seam a real
 * provider's lineup poller calls; locally it is driven by `npm run lineups:announce`.
 *
 * Rooms are not re-primed here: `startDraft` builds the pool from the lineup at the moment the
 * host starts, which also covers a lineup revised between announcement and draft.
 */
export async function announceLineups(fixtureId: string, entries: LineupEntry[]): Promise<FixtureView> {
  const starters = entries.filter((e) => e.isStarter).length;
  if (starters === 0) throw new Error(`Refusing to announce a lineup with no starters for ${fixtureId}`);

  await db.transaction((tx) => saveFixtureLineup(tx, fixtureId, entries));

  const view = await getFixtureView(fixtureId);
  if (!view) throw new Error(`Unknown fixture ${fixtureId}`);

  const waiting = await db
    .select({ id: rooms.id })
    .from(rooms)
    .where(and(eq(rooms.fixtureId, fixtureId), eq(rooms.status, 'lobby')));
  for (const room of waiting) {
    await publishToRoom(room.id, 'fixture:lineups', { fixture: view });
  }
  return view;
}
