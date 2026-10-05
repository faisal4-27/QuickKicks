export const POSITIONS = ['GK', 'DEF', 'MID', 'FWD'] as const;
export type Position = (typeof POSITIONS)[number];

export const ROOM_STATUSES = ['lobby', 'drafting', 'live', 'finished'] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

export const MATCH_EVENT_TYPES = [
  'pass.completed',
  'pass.missed',
  'tackle.won',
  'interception',
  'foul.committed',
  'shot.on_target',
  'shot.off_target',
  'goal.scored',
  /**
   * A goal put into his own net. The player is the one who conceded it, so it counts for the
   * other side on the scoreboard and against his own side's clean sheet.
   */
  'goal.own',
  'assist',
  'save',
  'goal.conceded',
  'card.yellow',
  'card.red',
  'clean_sheet.awarded',
  'sub.on',
  'sub.off',
  'period.start',
  'period.end',
] as const;
export type MatchEventType = (typeof MATCH_EVENT_TYPES)[number];

/** Events that describe match structure rather than something a player did. */
export const NON_SCORING_EVENT_TYPES: readonly MatchEventType[] = [
  'sub.on',
  'sub.off',
  'period.start',
  'period.end',
];

export const POWER_UP_KINDS = ['double_passes', 'double_goals', 'double_all'] as const;
export type PowerUpKind = (typeof POWER_UP_KINDS)[number];

export const POWER_UP_STATUSES = ['active', 'expired'] as const;
export type PowerUpStatus = (typeof POWER_UP_STATUSES)[number];

export const TRADE_STATUSES = ['pending', 'accepted', 'rejected', 'cancelled', 'expired'] as const;
export type TradeStatus = (typeof TRADE_STATUSES)[number];

export const ACQUISITION_SOURCES = ['draft', 'swap', 'trade'] as const;
export type AcquisitionSource = (typeof ACQUISITION_SOURCES)[number];

export const MATCH_STATUSES = ['scheduled', 'live', 'half_time', 'finished'] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

/** API-Football's two competition types, lowercased. */
export const COMPETITION_TYPES = ['league', 'cup'] as const;
export type CompetitionType = (typeof COMPETITION_TYPES)[number];

/**
 * How long before kickoff the starting XIs are expected. Real lineups land roughly an hour out,
 * and no feed publishes the release time, so the host screen counts down to this estimate and
 * then switches to the announcement it actually received.
 */
export const LINEUP_RELEASE_LEAD_MINUTES = 60;

/**
 * Continental and international competitions have no country of their own. API-Football reports
 * them under this name with a null code and flag, and the fixture browser groups them under it.
 */
export const WORLD_COUNTRY_NAME = 'World';

export const POWER_UP_LABELS: Record<PowerUpKind, string> = {
  double_passes: 'Double Passes',
  double_goals: 'Double Goals',
  double_all: 'Double Everything',
};

export const EVENT_LABELS: Record<MatchEventType, string> = {
  'pass.completed': 'Completed pass',
  'pass.missed': 'Misplaced pass',
  'tackle.won': 'Tackle won',
  interception: 'Interception',
  'foul.committed': 'Foul',
  'shot.on_target': 'Shot on target',
  'shot.off_target': 'Shot off target',
  'goal.scored': 'Goal',
  'goal.own': 'Own goal',
  assist: 'Assist',
  save: 'Save',
  'goal.conceded': 'Goal conceded',
  'card.yellow': 'Yellow card',
  'card.red': 'Red card',
  'clean_sheet.awarded': 'Clean sheet',
  'sub.on': 'Substituted on',
  'sub.off': 'Substituted off',
  'period.start': 'Period start',
  'period.end': 'Period end',
};
