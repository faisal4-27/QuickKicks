import { LINEUP_RELEASE_LEAD_MINUTES, WORLD_COUNTRY_NAME } from '@quickkicks/shared';
import { and, eq, gt, inArray, isNull, like, lt, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { competitions, fixtures, players, rooms, teams } from '../../db/schema.js';
import { env } from '../../env.js';
import { redis } from '../../redis/client.js';
import { keys } from '../../redis/keys.js';
import { ApiFootballError, apiGet } from '../../providers/apiFootball/client.js';
import {
  API_FIXTURE_REF_PREFIX,
  apiFixtureId,
  apiRefs,
  countryCodeFromFlag,
  mapPosition,
  mapStatus,
  shortNameFor,
} from '../../providers/apiFootball/refs.js';
import type { ApiFixture, ApiLineup } from '../../providers/apiFootball/types.js';
import { catalog, type LineupEntry, type SeedCompetition } from '../../seed/catalog.js';
import { announceLineups } from './fixtureService.js';

/** Competitions for national sides, whose teams are flagged `national`. */
const NATIONAL_TEAM_LEAGUES = new Set([1, 4, 5, 6, 9, 10]);

/** Display metadata for the competitions we curate, keyed by API-Football league id. */
const curated = new Map<number, SeedCompetition>(
  catalog.competitions.flatMap((c) => {
    const id = Number(c.externalRef.split(':').pop());
    return Number.isInteger(id) ? [[id, c] as const] : [];
  }),
);

export function offeredLeagueIds(): number[] {
  return env.API_FOOTBALL_LEAGUES.length > 0 ? env.API_FOOTBALL_LEAGUES : [...curated.keys()];
}

/** `YYYY-MM-DD` in UTC, the date `/fixtures?date=` reads when no timezone is passed. */
function utcDay(offsetDays: number): string {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + offsetDays);
  return day.toISOString().slice(0, 10);
}

export interface SyncResult {
  days: string[];
  fixtures: number;
  /** Days the API refused, e.g. outside the free plan's yesterday-to-tomorrow window. */
  skipped: { date: string; reason: string }[];
}

/**
 * Pulls the fixture list for the next few days and upserts it, matching on external ref so a
 * re-sync updates kickoffs and statuses in place. One request per day — `/fixtures?date=` returns
 * every competition at once and is filtered here, which is far cheaper than a request per league.
 *
 * A refused day is skipped rather than failing the sync, so a window wider than the plan allows
 * still syncs the days it does. Only a sync that got nothing at all throws.
 */
export async function syncFixtures(days = env.API_FOOTBALL_SYNC_DAYS): Promise<SyncResult> {
  const offered = new Set(offeredLeagueIds());
  const dates = Array.from({ length: days }, (_, i) => utcDay(i));
  const synced: string[] = [];
  const skipped: SyncResult['skipped'] = [];
  let count = 0;

  for (const date of dates) {
    let rows: ApiFixture[];
    try {
      rows = await apiGet<ApiFixture[]>('/fixtures', { date }, { cacheSeconds: 30 * 60 });
    } catch (error) {
      if (!(error instanceof ApiFootballError)) throw error;
      skipped.push({ date, reason: error.message });
      continue;
    }
    for (const row of rows) {
      if (!offered.has(row.league.id)) continue;
      await upsertFixture(row);
      count += 1;
    }
    synced.push(date);
  }

  if (synced.length === 0 && skipped.length > 0) {
    throw new Error(`Fixture sync got nothing: ${skipped.map((s) => s.reason).join(' | ')}`);
  }
  return { days: synced, fixtures: count, skipped };
}

async function upsertFixture(row: ApiFixture): Promise<void> {
  const competitionId = await upsertCompetition(row);
  const national = NATIONAL_TEAM_LEAGUES.has(row.league.id);
  const countryName = row.league.country === WORLD_COUNTRY_NAME ? null : row.league.country;
  const [homeTeamId, awayTeamId] = await Promise.all([
    upsertTeam(row.teams.home, countryName, national),
    upsertTeam(row.teams.away, countryName, national),
  ]);

  const values = {
    homeTeamId,
    awayTeamId,
    competitionId,
    round: row.league.round,
    kickoffAt: new Date(row.fixture.date),
    status: mapStatus(row.fixture.status.short),
  };
  await db
    .insert(fixtures)
    .values({ externalRef: apiRefs.fixture(row.fixture.id), ...values })
    .onConflictDoUpdate({ target: fixtures.externalRef, set: values });
}

async function upsertCompetition(row: ApiFixture): Promise<string> {
  const known = curated.get(row.league.id);
  const values = {
    name: known?.name ?? row.league.name,
    type: known?.type ?? (row.league.country === WORLD_COUNTRY_NAME ? 'cup' : 'league'),
    countryName: row.league.country,
    countryCode: known?.countryCode ?? countryCodeFromFlag(row.league.flag),
    flagUrl: row.league.flag,
    logoUrl: row.league.logo,
    priority: known?.priority ?? 100,
  } as const;
  const [competition] = await db
    .insert(competitions)
    .values({ externalRef: apiRefs.league(row.league.id), ...values })
    .onConflictDoUpdate({ target: competitions.externalRef, set: values })
    .returning({ id: competitions.id });
  if (!competition) throw new Error(`Failed to upsert competition ${row.league.id}`);
  return competition.id;
}

async function upsertTeam(
  team: ApiFixture['teams']['home'],
  countryName: string | null,
  national: boolean,
): Promise<string> {
  const [row] = await db
    .insert(teams)
    .values({
      externalRef: apiRefs.team(team.id),
      name: team.name,
      shortName: shortNameFor(team.name),
      crestUrl: team.logo,
      countryName,
      national,
    })
    // The short code and country are only guessed on first sight, so a hand-corrected row survives.
    .onConflictDoUpdate({ target: teams.externalRef, set: { name: team.name, crestUrl: team.logo } })
    .returning({ id: teams.id });
  if (!row) throw new Error(`Failed to upsert team ${team.id}`);
  return row.id;
}

/**
 * Fetches a fixture's starting XIs and, once both are out, stores both squads and announces them
 * to any waiting lobby. Returns false while the lineups are not published yet.
 */
export async function fetchAndAnnounceLineups(fixtureId: string): Promise<boolean> {
  const fixture = (await db.select().from(fixtures).where(eq(fixtures.id, fixtureId)).limit(1))[0];
  const apiId = apiFixtureId(fixture?.externalRef);
  if (!fixture || apiId === null) throw new Error(`${fixtureId} is not an API-Football fixture`);

  const lineups = await apiGet<ApiLineup[]>('/fixtures/lineups', { fixture: apiId });
  if (lineups.length < 2 || lineups.some((team) => team.startXI.length < 11)) return false;

  const teamRows = await db
    .select({ id: teams.id, externalRef: teams.externalRef })
    .from(teams)
    .where(inArray(teams.id, [fixture.homeTeamId, fixture.awayTeamId]));
  const teamIdByRef = new Map(teamRows.map((t) => [t.externalRef, t.id]));

  const entries: LineupEntry[] = [];
  for (const lineup of lineups) {
    const teamId = teamIdByRef.get(apiRefs.team(lineup.team.id));
    if (!teamId) throw new Error(`Lineup team ${lineup.team.id} is not playing in fixture ${apiId}`);
    for (const [isStarter, squad] of [[true, lineup.startXI], [false, lineup.substitutes]] as const) {
      for (const { player } of squad) {
        const values = {
          teamId,
          fullName: player.name,
          position: mapPosition(player.pos),
          shirtNumber: player.number,
        };
        const [row] = await db
          .insert(players)
          .values({ externalRef: apiRefs.player(player.id), ...values })
          // Substitutes often come without a position; keep whatever we learned from an earlier XI.
          .onConflictDoUpdate({
            target: players.externalRef,
            set: player.pos ? values : { teamId, fullName: player.name, shirtNumber: player.number },
          })
          .returning({ id: players.id });
        if (row) entries.push({ playerId: row.id, isStarter });
      }
    }
  }

  await announceLineups(fixture.id, entries);
  return true;
}

/**
 * Checks lineups for fixtures someone is actually waiting on: a lobby exists, the XIs are not in,
 * and kickoff is close enough that they could be. Fixtures nobody has opened a room for cost
 * nothing, which matters on a 100-request day.
 */
export async function pollPendingLineups(): Promise<void> {
  const leadMinutes = LINEUP_RELEASE_LEAD_MINUTES + 30;
  const due = await db
    .selectDistinct({ id: fixtures.id })
    .from(fixtures)
    .innerJoin(rooms, eq(rooms.fixtureId, fixtures.id))
    .where(
      and(
        like(fixtures.externalRef, `${API_FIXTURE_REF_PREFIX}%`),
        isNull(fixtures.lineupsAnnouncedAt),
        eq(rooms.status, 'lobby'),
        lt(fixtures.kickoffAt, sql`now() + ${`${leadMinutes} minutes`}::interval`),
        gt(fixtures.kickoffAt, sql`now() - interval '3 hours'`),
      ),
    );

  for (const { id } of due) {
    const throttle = keys.feedThrottle(`lineups:${id}`);
    const ttl = Math.max(30, env.API_FOOTBALL_LINEUP_POLL_MINUTES * 60 - 5);
    if (!(await redis.set(throttle, '1', 'EX', ttl, 'NX'))) continue;
    try {
      const announced = await fetchAndAnnounceLineups(id);
      if (announced) console.log(`[feed] lineups announced for fixture ${id}`);
    } catch (error) {
      console.error(`[feed] lineup check for fixture ${id} failed`, error);
    }
  }
}

let timers: NodeJS.Timeout[] = [];

/**
 * The background half of the integration: a periodic fixture-list sync and a once-a-minute look
 * for lobbies whose lineups may be out. Both are throttled through Redis rather than in memory,
 * so `tsx watch` restarting on every save does not spend a request each time.
 */
export function startFixtureFeed(): void {
  const syncSeconds = Math.round(env.API_FOOTBALL_FIXTURE_SYNC_HOURS * 3600);

  const runSync = async () => {
    const throttle = keys.feedThrottle('fixture-sync');
    if (!(await redis.set(throttle, '1', 'EX', Math.max(60, syncSeconds - 60), 'NX'))) return;
    try {
      const result = await syncFixtures();
      console.log(`[feed] synced ${result.fixtures} fixture(s) for ${result.days.join(', ')}`);
      for (const { reason } of result.skipped) console.warn(`[feed] skipped: ${reason}`);
    } catch (error) {
      // Let the next restart or interval retry instead of waiting out the full throttle.
      await redis.del(throttle);
      console.error('[feed] fixture sync failed', error);
    }
  };

  const runLineups = () =>
    pollPendingLineups().catch((error: unknown) => console.error('[feed] lineup poll failed', error));

  void runSync();
  void runLineups();
  timers = [
    setInterval(() => void runSync(), syncSeconds * 1000),
    setInterval(() => void runLineups(), 60_000),
  ];
}

export function stopFixtureFeed(): void {
  for (const timer of timers) clearInterval(timer);
  timers = [];
}
