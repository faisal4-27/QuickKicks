import type { MatchStatus, Position } from '@quickkicks/shared';

/**
 * External refs for rows that came from API-Football. The prefix is what tells a real fixture
 * from a seeded one, so the clock knows whether to poll the feed or simulate the match.
 */
const PREFIX = 'apifootball';

export const apiRefs = {
  league: (id: number) => `${PREFIX}:league:${id}`,
  team: (id: number) => `${PREFIX}:team:${id}`,
  player: (id: number) => `${PREFIX}:player:${id}`,
  fixture: (id: number) => `${PREFIX}:fixture:${id}`,
};

export const API_FIXTURE_REF_PREFIX = `${PREFIX}:fixture:`;

export function apiFixtureId(externalRef: string | null | undefined): number | null {
  if (!externalRef?.startsWith(API_FIXTURE_REF_PREFIX)) return null;
  const id = Number(externalRef.slice(API_FIXTURE_REF_PREFIX.length));
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function isApiFixtureRef(externalRef: string | null | undefined): boolean {
  return apiFixtureId(externalRef) !== null;
}

const SCHEDULED = new Set(['TBD', 'NS']);
const BREAK = new Set(['HT', 'BT']);
/**
 * Over, or never going to be played in this slot. A postponed fixture comes back as NS with a new
 * date if it is rescheduled; a room drafted on the old slot ends either way.
 */
const OVER = new Set(['FT', 'AET', 'PEN', 'PST', 'CANC', 'ABD', 'AWD', 'WO']);

/** Played to a result, as opposed to over because it was called off. Only these award clean sheets. */
export function isFullTime(short: string): boolean {
  return short === 'FT' || short === 'AET' || short === 'PEN';
}

export function mapStatus(short: string): MatchStatus {
  if (SCHEDULED.has(short)) return 'scheduled';
  if (BREAK.has(short)) return 'half_time';
  if (OVER.has(short)) return 'finished';
  // 1H, 2H, ET, P, LIVE, plus SUSP and INT, which may still resume.
  return 'live';
}

export function mapPosition(pos: string | null | undefined): Position {
  switch (pos?.toUpperCase()) {
    case 'G': return 'GK';
    case 'D': return 'DEF';
    case 'F': return 'FWD';
    default: return 'MID';
  }
}

/**
 * Match-minute for a provider time. Stoppage time stays on the minute it was added to (45+2 is
 * 45), which keeps minutes monotonic across the break: first-half stoppage can never overtake the
 * start of the second half.
 */
export function minuteOf(elapsed: number | null | undefined): number {
  return Math.max(0, elapsed ?? 0);
}

const NAME_NOISE = new Set(['FC', 'AFC', 'CF', 'SC', 'AC', 'SV', 'FK', 'SK', 'AS', 'SS', 'CD', 'UD', 'RC', 'VFL', 'VFB', '1.']);

/**
 * `/fixtures` carries no short code, and fetching `/teams` for one would cost a request per team,
 * so the code is derived: "Manchester United" is MUN, "Arsenal" is ARS.
 */
export function shortNameFor(name: string): string {
  const words = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !NAME_NOISE.has(w.toUpperCase()));
  const letters = (s: string) => s.replace(/[^A-Za-z]/g, '').toUpperCase();
  if (words.length === 0) return letters(name).slice(0, 3) || name.slice(0, 3).toUpperCase();
  if (words.length === 1) return letters(words[0]!).slice(0, 3);
  return (letters(words[0]!).slice(0, 1) + letters(words[words.length - 1]!).slice(0, 2)).padEnd(3, 'X');
}

/** API-Football flags are `.../flags/gb.svg`; the code is the file name. */
export function countryCodeFromFlag(flag: string | null | undefined): string | null {
  const match = flag?.match(/\/flags\/([a-z-]+)\.svg$/i);
  return match ? match[1]!.toUpperCase() : null;
}
