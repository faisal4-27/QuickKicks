/**
 * Every key here is a derived cache. `rehydrateRoom` can rebuild all of them from Postgres,
 * so losing Redis costs a reconnect and nothing more.
 */
export const keys = {
  /** Hash: status, current pick, whose turn, pick deadline, match minute, clock start. */
  roomState: (roomId: string) => `room:${roomId}:state`,
  /** Short-lived lock held while a pick is validated and written. */
  turnLock: (roomId: string) => `room:${roomId}:turn:lock`,
  /** Sorted set: member id -> running point total, for O(1) leaderboard reads. */
  scores: (roomId: string) => `room:${roomId}:scores`,
  /** Set: player ids nobody owns, so swap eligibility is one SISMEMBER. */
  available: (roomId: string) => `room:${roomId}:available`,
  /** Hash: player id -> owning member id, for O(1) event attribution. */
  owners: (roomId: string) => `room:${roomId}:owners`,
  /** Hash: `${memberId}:${kind}` -> expiry match-minute, for active power-ups. */
  powerUps: (roomId: string) => `room:${roomId}:powerups`,
  /** Set of connected member ids. */
  presence: (roomId: string) => `presence:room:${roomId}`,
  /** Pub/sub channel every state delta is published on. */
  channel: (roomId: string) => `room:${roomId}`,
  /** Set of room ids whose clock should be running, so a restart knows what to resume. */
  liveRooms: () => 'rooms:live',
  /**
   * String: a cached API-Football response. Shared by every room on a fixture and across
   * restarts, so neither multiplies requests against the daily quota.
   */
  feedCache: (request: string) => `feed:apifootball:cache:${request}`,
  /** String with a TTL: present while a periodic feed job is not yet due again. */
  feedThrottle: (job: string) => `feed:apifootball:throttle:${job}`,
} as const;

export const ROOM_STATE_FIELDS = {
  status: 'status',
  currentPickNumber: 'current_pick_number',
  currentMemberId: 'current_member_id',
  pickDeadlineMs: 'pick_deadline_ms',
  matchMinute: 'match_minute',
  clockStartedAt: 'clock_started_at',
  matchStatus: 'match_status',
  homeGoals: 'home_goals',
  awayGoals: 'away_goals',
  sequence: 'sequence',
} as const;
