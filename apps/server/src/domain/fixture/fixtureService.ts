import type { FixtureView, Team } from '@quickkicks/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { fixtures, rooms, teams } from '../../db/schema.js';
import { publishToRoom } from '../../redis/pubsub.js';
import { type LineupEntry, saveFixtureLineup } from '../../seed/catalog.js';

type FixtureRow = typeof fixtures.$inferSelect;
type TeamRow = typeof teams.$inferSelect;

function teamView(row: TeamRow): Team {
  return {
    id: row.id,
    externalRef: row.externalRef,
    name: row.name,
    shortName: row.shortName,
    crestUrl: row.crestUrl,
  };
}

export function fixtureView(fixture: FixtureRow, homeTeam: TeamRow, awayTeam: TeamRow): FixtureView {
  return {
    id: fixture.id,
    homeTeam: teamView(homeTeam),
    awayTeam: teamView(awayTeam),
    competition: fixture.competition,
    kickoffAt: fixture.kickoffAt?.toISOString() ?? null,
    lineupsAnnounced: fixture.lineupsAnnouncedAt !== null,
  };
}

async function viewsFor(rows: FixtureRow[]): Promise<FixtureView[]> {
  if (rows.length === 0) return [];
  const teamIds = [...new Set(rows.flatMap((f) => [f.homeTeamId, f.awayTeamId]))];
  const teamRows = await db.select().from(teams).where(inArray(teams.id, teamIds));
  const byId = new Map(teamRows.map((t) => [t.id, t]));
  return rows.map((f) => fixtureView(f, byId.get(f.homeTeamId)!, byId.get(f.awayTeamId)!));
}

/** What a host can create a room for: anything that has not kicked off yet. */
export async function listOpenFixtures(): Promise<FixtureView[]> {
  const rows = await db
    .select()
    .from(fixtures)
    .where(eq(fixtures.status, 'scheduled'))
    .orderBy(sql`${fixtures.kickoffAt} asc nulls last`, asc(fixtures.createdAt));
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
