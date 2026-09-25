import type { ScoringRules } from '../scoring/rules.js';
import type { DraftConfig, Player, Team } from './entities.js';
import type {
  AcquisitionSource,
  MatchEventType,
  Position,
  PowerUpKind,
  RoomStatus,
  TradeStatus,
} from './enums.js';

/**
 * Everything the client needs to render a room, in one payload. The server sends this on
 * subscribe and on reconnect; individual deltas afterwards keep it up to date.
 */
export interface RoomSnapshot {
  room: {
    id: string;
    joinCode: string;
    status: RoomStatus;
    hostMemberId: string;
    draftConfig: DraftConfig;
    msPerMatchMinute: number;
    scoringRules: ScoringRules;
  };
  fixture: {
    id: string;
    homeTeam: Team;
    awayTeam: Team;
  };
  players: Player[];
  members: MemberView[];
  draft: DraftView;
  match: MatchView;
  trades: TradeView[];
  /** Most recent events first, capped by the server. */
  feed: FeedItem[];
}

export interface MemberView {
  id: string;
  displayName: string;
  draftPosition: number;
  isHost: boolean;
  connected: boolean;
  points: number;
  roster: RosterEntryView[];
  powerUps: PowerUpView[];
  powerUpChargesRemaining: number;
  swapsRemaining: number;
}

export interface RosterEntryView {
  playerId: string;
  slotIndex: number;
  acquiredAtMinute: number;
  acquiredVia: AcquisitionSource;
  /** Points this manager earned from this player, under this ownership stint. */
  points: number;
}

export interface PowerUpView {
  id: string;
  /** The boosted player. */
  playerId: string;
  kind: PowerUpKind;
  activatedAtMinute: number;
  expiresAtMinute: number;
  active: boolean;
}

export interface DraftView {
  rounds: number;
  totalPicks: number;
  picks: DraftPickView[];
  /** Null in the lobby and once the draft is complete. */
  onTheClock: {
    memberId: string;
    pickNumber: number;
    round: number;
    /** Server wall-clock epoch ms when this pick auto-picks. */
    deadlineMs: number;
  } | null;
  availablePlayerIds: string[];
}

export interface DraftPickView {
  pickNumber: number;
  round: number;
  memberId: string;
  playerId: string;
  wasAutopick: boolean;
}

export interface MatchView {
  minute: number;
  status: 'scheduled' | 'live' | 'half_time' | 'finished';
  homeGoals: number;
  awayGoals: number;
}

export interface TradeView {
  id: string;
  fromMemberId: string;
  toMemberId: string;
  offeredPlayerId: string;
  requestedPlayerId: string;
  status: TradeStatus;
  createdAtMinute: number;
  expiresAtMinute: number;
}

/** A single line in the live event feed. */
export interface FeedItem {
  id: string;
  minute: number;
  type: MatchEventType;
  playerId: string | null;
  playerName: string | null;
  position: Position | null;
  /** Managers who were paid (or charged) for this event, and how much. */
  awards: { memberId: string; awardedPoints: number; multiplier: number }[];
}

export interface StandingRow {
  memberId: string;
  displayName: string;
  points: number;
  rank: number;
  /** True when this row shares its point total with another row. */
  tied: boolean;
}

export interface RecapPlayerLine {
  playerId: string;
  playerName: string;
  points: number;
  fromMinute: number;
  toMinute: number | null;
  acquiredVia: AcquisitionSource;
}

export interface RecapRow {
  memberId: string;
  displayName: string;
  rank: number;
  points: number;
  tied: boolean;
  players: RecapPlayerLine[];
  /** Points grouped by what produced them, biggest contributor first. */
  breakdown: { type: MatchEventType; count: number; points: number }[];
  powerUpPoints: number;
}

export interface MatchRecap {
  roomId: string;
  finalMinute: number;
  homeGoals: number;
  awayGoals: number;
  rows: RecapRow[];
}
