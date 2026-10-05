/**
 * The slice of API-Football v3 payloads this app reads. Fields the provider documents as nullable
 * are typed that way, because live payloads fill them in gradually during a match.
 */

export interface ApiEnvelope<T> {
  get: string;
  parameters: Record<string, string>;
  /** An empty array on success; on failure, usually an object keyed by error kind. */
  errors: string[] | Record<string, string>;
  results: number;
  paging: { current: number; total: number };
  response: T;
}

export interface ApiTeamRef {
  id: number;
  name: string;
  logo: string | null;
}

export interface ApiFixtureStatus {
  long: string;
  /** NS, 1H, HT, 2H, ET, BT, P, FT, AET, PEN, SUSP, INT, PST, CANC, ABD, AWD, WO, LIVE, TBD. */
  short: string;
  elapsed: number | null;
  extra?: number | null;
}

export interface ApiLeague {
  id: number;
  name: string;
  /** "World" for continental and international competitions. */
  country: string;
  logo: string | null;
  flag: string | null;
  season: number;
  round: string | null;
}

export interface ApiEvent {
  time: { elapsed: number | null; extra: number | null };
  team: ApiTeamRef;
  player: { id: number | null; name: string | null };
  assist: { id: number | null; name: string | null };
  /** "Goal", "Card", "subst" or "Var". */
  type: string;
  /** e.g. "Normal Goal", "Own Goal", "Penalty", "Missed Penalty", "Yellow Card", "Red Card". */
  detail: string;
  comments: string | null;
}

export interface ApiLineupPlayer {
  player: {
    id: number;
    name: string;
    number: number | null;
    /** G, D, M or F. Sometimes null for substitutes. */
    pos: string | null;
    grid: string | null;
  };
}

export interface ApiLineup {
  team: ApiTeamRef;
  formation: string | null;
  startXI: ApiLineupPlayer[];
  substitutes: ApiLineupPlayer[];
}

export interface ApiPlayerStatistics {
  games: {
    minutes: number | null;
    number: number | null;
    position: string | null;
    rating: string | null;
    captain: boolean;
    substitute: boolean;
  };
  shots: { total: number | null; on: number | null };
  goals: {
    total: number | null;
    conceded: number | null;
    assists: number | null;
    saves: number | null;
  };
  /** `accuracy` is the number of accurate passes, delivered as a string ("31"). */
  passes: { total: number | null; key: number | null; accuracy: string | number | null };
  tackles: { total: number | null; blocks: number | null; interceptions: number | null };
  fouls: { drawn: number | null; committed: number | null };
  cards: { yellow: number | null; red: number | null };
}

export interface ApiTeamPlayers {
  team: ApiTeamRef;
  players: { player: { id: number; name: string }; statistics: ApiPlayerStatistics[] }[];
}

/**
 * One row of `/fixtures`. Requested by `id`, the row also embeds the match's events, lineups and
 * per-player statistics, which is why a live poll costs exactly one request.
 */
export interface ApiFixture {
  fixture: {
    id: number;
    date: string;
    timestamp: number;
    status: ApiFixtureStatus;
  };
  league: ApiLeague;
  teams: { home: ApiTeamRef; away: ApiTeamRef };
  goals: { home: number | null; away: number | null };
  events?: ApiEvent[];
  lineups?: ApiLineup[];
  players?: ApiTeamPlayers[];
}
