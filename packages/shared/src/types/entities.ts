import type {
  AcquisitionSource,
  MatchEventType,
  MatchStatus,
  Position,
  PowerUpKind,
  PowerUpStatus,
  RoomStatus,
  TradeStatus,
} from './enums.js';

export interface Team {
  id: string;
  externalRef: string | null;
  name: string;
  shortName: string;
  crestUrl: string | null;
}

export interface Player {
  id: string;
  externalRef: string | null;
  teamId: string;
  fullName: string;
  position: Position;
  shirtNumber: number | null;
  /** Static 0-100 strength used only to seed the simulator and to pick sensible autopicks. */
  rating: number;
}

export interface Fixture {
  id: string;
  externalRef: string | null;
  homeTeamId: string;
  awayTeamId: string;
  status: MatchStatus;
}

export interface DraftConfig {
  rounds: number;
  pickTimerSeconds: number;
  maxManagers: number;
  minManagers: number;
}

export interface RoomMember {
  id: string;
  roomId: string;
  userId: string;
  displayName: string;
  draftPosition: number;
  isHost: boolean;
}

export interface DraftPick {
  id: string;
  roomId: string;
  round: number;
  pickNumber: number;
  memberId: string;
  playerId: string;
  wasAutopick: boolean;
  pickedAt: string;
}

export interface RosterSlot {
  id: string;
  roomId: string;
  memberId: string;
  playerId: string;
  slotIndex: number;
  acquiredAtMinute: number;
  releasedAtMinute: number | null;
  acquiredVia: AcquisitionSource;
}

export interface StoredMatchEvent {
  id: string;
  roomId: string;
  providerEventId: string;
  sequence: number;
  matchMinute: number;
  playerId: string | null;
  type: MatchEventType;
  meta: Record<string, unknown>;
}

export interface ScoreEntry {
  id: string;
  roomId: string;
  memberId: string;
  playerId: string;
  matchEventId: string | null;
  basePoints: number;
  multiplier: number;
  awardedPoints: number;
  powerUpId: string | null;
}

export interface PowerUp {
  id: string;
  roomId: string;
  memberId: string;
  kind: PowerUpKind;
  activatedAtMinute: number;
  expiresAtMinute: number;
  status: PowerUpStatus;
}

export interface Swap {
  id: string;
  roomId: string;
  memberId: string;
  outPlayerId: string;
  inPlayerId: string;
  matchMinute: number;
}

export interface Trade {
  id: string;
  roomId: string;
  fromMemberId: string;
  toMemberId: string;
  offeredPlayerId: string;
  requestedPlayerId: string;
  status: TradeStatus;
  createdAtMinute: number;
  expiresAtMinute: number;
  resolvedAt: string | null;
}

export interface Room {
  id: string;
  joinCode: string;
  hostUserId: string;
  fixtureId: string;
  status: RoomStatus;
  draftConfig: DraftConfig;
  msPerMatchMinute: number;
}

/** The current session, established by the nickname handshake. */
export interface SessionUser {
  id: string;
  displayName: string;
}
