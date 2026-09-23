import type {
  AcquisitionSource,
  DraftConfig,
  MatchEventType,
  MatchStatus,
  Position,
  PowerUpKind,
  PowerUpStatus,
  RoomStatus,
  ScoringRules,
  TradeStatus,
} from '@quickkicks/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  displayName: text('display_name').notNull(),
  createdAt: createdAt(),
});

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  externalRef: text('external_ref'),
  name: text('name').notNull(),
  shortName: text('short_name').notNull(),
  crestUrl: text('crest_url'),
  createdAt: createdAt(),
});

export const players = pgTable(
  'players',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    externalRef: text('external_ref'),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    position: text('position').$type<Position>().notNull(),
    shirtNumber: integer('shirt_number'),
    rating: integer('rating').notNull().default(70),
    createdAt: createdAt(),
  },
  (t) => ({
    byTeam: index('players_team_idx').on(t.teamId),
    byExternalRef: uniqueIndex('players_external_ref_key').on(t.externalRef),
  }),
);

export const fixtures = pgTable('fixtures', {
  id: uuid('id').primaryKey().defaultRandom(),
  externalRef: text('external_ref'),
  homeTeamId: uuid('home_team_id')
    .notNull()
    .references(() => teams.id),
  awayTeamId: uuid('away_team_id')
    .notNull()
    .references(() => teams.id),
  status: text('status').$type<MatchStatus>().notNull().default('scheduled'),
  createdAt: createdAt(),
});

export const rooms = pgTable(
  'rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    joinCode: text('join_code').notNull(),
    hostUserId: uuid('host_user_id')
      .notNull()
      .references(() => users.id),
    fixtureId: uuid('fixture_id')
      .notNull()
      .references(() => fixtures.id),
    status: text('status').$type<RoomStatus>().notNull().default('lobby'),
    draftConfig: jsonb('draft_config').$type<DraftConfig>().notNull(),
    // Snapshotted at creation so retuning the scale never rewrites a played match.
    scoringRules: jsonb('scoring_rules').$type<ScoringRules>().notNull(),
    msPerMatchMinute: integer('ms_per_match_minute').notNull(),
    createdAt: createdAt(),
    draftStartedAt: timestamp('draft_started_at', { withTimezone: true }),
    matchStartedAt: timestamp('match_started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => ({
    byJoinCode: uniqueIndex('rooms_join_code_key').on(t.joinCode),
  }),
);

export const roomMembers = pgTable(
  'room_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    displayName: text('display_name').notNull(),
    draftPosition: integer('draft_position').notNull(),
    isHost: boolean('is_host').notNull().default(false),
    joinedAt: createdAt(),
  },
  (t) => ({
    uniqueUser: uniqueIndex('room_members_room_user_key').on(t.roomId, t.userId),
    uniquePosition: uniqueIndex('room_members_room_position_key').on(t.roomId, t.draftPosition),
  }),
);

export const draftPicks = pgTable(
  'draft_picks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    round: integer('round').notNull(),
    pickNumber: integer('pick_number').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => roomMembers.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id),
    wasAutopick: boolean('was_autopick').notNull().default(false),
    pickedAt: createdAt(),
  },
  (t) => ({
    // Two managers cannot land the same pick slot, and nobody can draft a taken player,
    // even if two submissions arrive in the same millisecond.
    uniquePick: uniqueIndex('draft_picks_room_pick_key').on(t.roomId, t.pickNumber),
    uniquePlayer: uniqueIndex('draft_picks_room_player_key').on(t.roomId, t.playerId),
  }),
);

/**
 * Append-only ownership timeline. A swap or trade closes the old row (sets
 * released_at_minute) and opens a new one, which is what lets the ledger attribute every
 * event to whoever owned the player at that minute.
 */
export const rosterSlots = pgTable(
  'roster_slots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => roomMembers.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id),
    slotIndex: integer('slot_index').notNull(),
    acquiredAtMinute: integer('acquired_at_minute').notNull().default(0),
    releasedAtMinute: integer('released_at_minute'),
    acquiredVia: text('acquired_via').$type<AcquisitionSource>().notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    byRoom: index('roster_slots_room_idx').on(t.roomId),
    byMember: index('roster_slots_member_idx').on(t.memberId),
  }),
);

export const matchEvents = pgTable(
  'match_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    providerEventId: text('provider_event_id').notNull(),
    sequence: integer('sequence').notNull(),
    matchMinute: integer('match_minute').notNull(),
    playerId: uuid('player_id').references(() => players.id),
    type: text('type').$type<MatchEventType>().notNull(),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => ({
    // The idempotency guarantee: a redelivered event cannot be scored twice.
    uniqueProviderEvent: uniqueIndex('match_events_room_provider_key').on(
      t.roomId,
      t.providerEventId,
    ),
    bySequence: index('match_events_room_sequence_idx').on(t.roomId, t.sequence),
  }),
);

export const scoreEntries = pgTable(
  'score_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => roomMembers.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id),
    matchEventId: uuid('match_event_id').references(() => matchEvents.id, { onDelete: 'cascade' }),
    matchMinute: integer('match_minute').notNull(),
    basePoints: doublePrecision('base_points').notNull(),
    multiplier: doublePrecision('multiplier').notNull().default(1),
    awardedPoints: doublePrecision('awarded_points').notNull(),
    powerUpId: uuid('power_up_id'),
    createdAt: createdAt(),
  },
  (t) => ({
    byRoomMember: index('score_entries_room_member_idx').on(t.roomId, t.memberId),
    byEvent: index('score_entries_event_idx').on(t.matchEventId),
  }),
);

export const powerUps = pgTable(
  'power_ups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => roomMembers.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<PowerUpKind>().notNull(),
    activatedAtMinute: integer('activated_at_minute').notNull(),
    expiresAtMinute: integer('expires_at_minute').notNull(),
    status: text('status').$type<PowerUpStatus>().notNull().default('active'),
    createdAt: createdAt(),
  },
  (t) => ({
    byRoomMember: index('power_ups_room_member_idx').on(t.roomId, t.memberId),
    // One activation per kind per manager keeps the charge accounting simple.
    uniqueKind: uniqueIndex('power_ups_room_member_kind_key').on(t.roomId, t.memberId, t.kind),
  }),
);

export const swaps = pgTable(
  'swaps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => roomMembers.id, { onDelete: 'cascade' }),
    outPlayerId: uuid('out_player_id')
      .notNull()
      .references(() => players.id),
    inPlayerId: uuid('in_player_id')
      .notNull()
      .references(() => players.id),
    matchMinute: integer('match_minute').notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    byRoomMember: index('swaps_room_member_idx').on(t.roomId, t.memberId),
  }),
);

export const trades = pgTable(
  'trades',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    fromMemberId: uuid('from_member_id')
      .notNull()
      .references(() => roomMembers.id, { onDelete: 'cascade' }),
    toMemberId: uuid('to_member_id')
      .notNull()
      .references(() => roomMembers.id, { onDelete: 'cascade' }),
    offeredPlayerId: uuid('offered_player_id')
      .notNull()
      .references(() => players.id),
    requestedPlayerId: uuid('requested_player_id')
      .notNull()
      .references(() => players.id),
    status: text('status').$type<TradeStatus>().notNull().default('pending'),
    createdAtMinute: integer('created_at_minute').notNull(),
    expiresAtMinute: integer('expires_at_minute').notNull(),
    createdAt: createdAt(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => ({
    byRoom: index('trades_room_idx').on(t.roomId),
  }),
);

export const schemaTables = {
  users,
  teams,
  players,
  fixtures,
  rooms,
  roomMembers,
  draftPicks,
  rosterSlots,
  matchEvents,
  scoreEntries,
  powerUps,
  swaps,
  trades,
};

export const nowSql = sql`now()`;
