import type { MatchEventType, MatchStatus, Position } from '../types/enums.js';

/**
 * One thing that happened in a match, as reported by a provider. Deliberately provider-shaped:
 * refs are the provider's own identifiers and get mapped to our rows via `players.external_ref`.
 */
export interface MatchEvent {
  /** Stable across redeliveries. This is what makes scoring idempotent. */
  id: string;
  matchId: string;
  /** Monotonic within a match, so a consumer can resume from where it stopped. */
  sequence: number;
  minute: number;
  playerRef: string;
  teamRef: string;
  type: MatchEventType;
  meta?: Record<string, unknown>;
}

export interface PlayerStatLine {
  passesCompleted: number;
  passesMissed: number;
  tackles: number;
  interceptions: number;
  fouls: number;
  shotsOnTarget: number;
  shotsOffTarget: number;
  goals: number;
  assists: number;
  saves: number;
  goalsConceded: number;
  yellowCards: number;
  redCards: number;
  cleanSheet: boolean;
  minutesPlayed: number;
}

export function emptyStatLine(): PlayerStatLine {
  return {
    passesCompleted: 0,
    passesMissed: 0,
    tackles: 0,
    interceptions: 0,
    fouls: 0,
    shotsOnTarget: 0,
    shotsOffTarget: 0,
    goals: 0,
    assists: 0,
    saves: 0,
    goalsConceded: 0,
    yellowCards: 0,
    redCards: 0,
    cleanSheet: false,
    minutesPlayed: 0,
  };
}

/** Cumulative view of a match, used for recovery and for reconciling revised stats. */
export interface MatchSnapshot {
  matchId: string;
  status: MatchStatus;
  minute: number;
  score: { home: number; away: number };
  perPlayer: Record<string, PlayerStatLine>;
}

export interface LineupPlayer {
  playerRef: string;
  fullName: string;
  position: Position;
  shirtNumber: number | null;
  isStarter: boolean;
}

export interface LineupTeam {
  teamRef: string;
  name: string;
  shortName: string;
  players: LineupPlayer[];
}

/** The draft pool. Sourced separately from the event stream so the draft never waits on kickoff. */
export interface Lineup {
  matchId: string;
  home: LineupTeam;
  away: LineupTeam;
}
