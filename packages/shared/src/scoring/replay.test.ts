import { describe, expect, it } from 'vitest';
import type { Position } from '../types/enums.js';
import {
  activeKindsAt,
  ownerAt,
  type OwnershipStint,
  type PowerUpWindow,
} from './ownership.js';
import { replayLedger, type ReplayEvent } from './replay.js';
import { DEFAULT_SCORING_RULES } from './rules.js';

const positions: Record<string, Position> = {
  salah: 'FWD',
  palmer: 'MID',
  vandijk: 'DEF',
};

/** Salah and Van Dijk play for Liverpool, Palmer for Chelsea. */
const teams: Record<string, string> = {
  salah: 'LIV',
  palmer: 'CHE',
  vandijk: 'LIV',
};

const rules = DEFAULT_SCORING_RULES;

/** A 20'-30' boost, the window every power-up test below uses. */
function boost(memberId: string, playerRef: string, kind: PowerUpWindow['kind']): PowerUpWindow {
  return { memberId, playerRef, kind, fromMinute: 20, toMinute: 30 };
}

describe('ownerAt', () => {
  const stints: OwnershipStint[] = [
    { memberId: 'alice', playerRef: 'salah', fromMinute: 0, toMinute: 70 },
    { memberId: 'bob', playerRef: 'salah', fromMinute: 70, toMinute: null },
  ];

  it('treats a stint as covering its start minute', () => {
    expect(ownerAt(stints, 'salah', 0)).toBe('alice');
  });

  it('hands the boundary minute to the incoming manager', () => {
    expect(ownerAt(stints, 'salah', 69)).toBe('alice');
    expect(ownerAt(stints, 'salah', 70)).toBe('bob');
  });

  it('returns null for a player nobody drafted', () => {
    expect(ownerAt(stints, 'palmer', 30)).toBeNull();
  });
});

describe('activeKindsAt', () => {
  const windows: PowerUpWindow[] = [boost('alice', 'salah', 'double_goals')];

  it('is inclusive of the activation minute and exclusive of the expiry minute', () => {
    expect(activeKindsAt(windows, 'alice', 'salah', 19)).toEqual([]);
    expect(activeKindsAt(windows, 'alice', 'salah', 20)).toEqual(['double_goals']);
    expect(activeKindsAt(windows, 'alice', 'salah', 29)).toEqual(['double_goals']);
    expect(activeKindsAt(windows, 'alice', 'salah', 30)).toEqual([]);
  });

  it('does not leak between managers', () => {
    expect(activeKindsAt(windows, 'bob', 'salah', 25)).toEqual([]);
  });

  it("does not leak onto the manager's other player", () => {
    expect(activeKindsAt(windows, 'alice', 'palmer', 25)).toEqual([]);
  });
});

describe('replayLedger', () => {
  it('doubles a goal inside the power-up window and not outside it', () => {
    const events: ReplayEvent[] = [
      { minute: 15, type: 'goal.scored', playerRef: 'salah' },
      { minute: 24, type: 'goal.scored', playerRef: 'salah' },
      { minute: 35, type: 'goal.scored', playerRef: 'salah' },
    ];
    const result = replayLedger({
      events,
      positions,
      teams,
      stints: [{ memberId: 'alice', playerRef: 'salah', fromMinute: 0, toMinute: null }],
      powerUps: [boost('alice', 'salah', 'double_goals')],
      rules,
    });

    expect(result.entries.map((e) => e.multiplier)).toEqual([1, 2, 1]);
    // Salah is a forward: 150 + 300 + 150
    expect(result.totals.alice).toBe(600);
  });

  it('boosts both players at once when each carries its own power-up', () => {
    const result = replayLedger({
      events: [
        { minute: 25, type: 'goal.scored', playerRef: 'salah' },
        { minute: 25, type: 'pass.completed', playerRef: 'palmer' },
      ],
      positions,
      teams,
      stints: [
        { memberId: 'alice', playerRef: 'salah', fromMinute: 0, toMinute: null },
        { memberId: 'alice', playerRef: 'palmer', fromMinute: 0, toMinute: null },
      ],
      powerUps: [boost('alice', 'salah', 'double_goals'), boost('alice', 'palmer', 'double_passes')],
      rules,
    });

    expect(result.entries.map((e) => e.multiplier)).toEqual([2, 2]);
    expect(result.totals.alice).toBe(300 + 2);
  });

  it("leaves the manager's other player unboosted", () => {
    const result = replayLedger({
      events: [{ minute: 25, type: 'goal.scored', playerRef: 'palmer' }],
      positions,
      teams,
      stints: [
        { memberId: 'alice', playerRef: 'salah', fromMinute: 0, toMinute: null },
        { memberId: 'alice', playerRef: 'palmer', fromMinute: 0, toMinute: null },
      ],
      powerUps: [boost('alice', 'salah', 'double_all')],
      rules,
    });

    expect(result.entries[0]?.multiplier).toBe(1);
  });

  it('does not hand a running power-up to the manager a player is traded to', () => {
    const result = replayLedger({
      events: [{ minute: 25, type: 'goal.scored', playerRef: 'salah' }],
      positions,
      teams,
      stints: [
        { memberId: 'alice', playerRef: 'salah', fromMinute: 0, toMinute: 22 },
        { memberId: 'bob', playerRef: 'salah', fromMinute: 22, toMinute: null },
      ],
      powerUps: [boost('alice', 'salah', 'double_goals')],
      rules,
    });

    expect(result.totals).toEqual({ bob: 150 });
  });

  it('pays the outgoing manager for what happened before a swap and the new one after', () => {
    const events: ReplayEvent[] = [
      { minute: 30, type: 'goal.scored', playerRef: 'salah' },
      { minute: 82, type: 'goal.scored', playerRef: 'salah' },
    ];
    const result = replayLedger({
      events,
      positions,
      teams,
      stints: [
        { memberId: 'alice', playerRef: 'salah', fromMinute: 0, toMinute: 70 },
        { memberId: 'bob', playerRef: 'salah', fromMinute: 70, toMinute: null },
      ],
      powerUps: [],
      rules,
    });

    expect(result.totals).toEqual({ alice: 150, bob: 150 });
    // Nothing is retroactively moved: the 30' goal stays with Alice forever.
    expect(result.byMemberPlayer['alice:salah']).toBe(150);
    expect(result.byMemberPlayer['bob:salah']).toBe(150);
  });

  it('gives a clean sheet to whoever held the player long enough, not whoever holds him at the whistle', () => {
    const result = replayLedger({
      events: [{ minute: 90, type: 'clean_sheet.awarded', playerRef: 'vandijk' }],
      positions,
      teams,
      stints: [
        { memberId: 'alice', playerRef: 'vandijk', fromMinute: 0, toMinute: 70 },
        { memberId: 'bob', playerRef: 'vandijk', fromMinute: 70, toMinute: null },
      ],
      powerUps: [],
      rules,
    });

    // Alice put in the 70 minutes; Bob's 20 are not enough to claim someone else's shut-out.
    expect(result.totals).toEqual({ alice: 100 });
  });

  it("reads a clean sheet off the opposition's goals, not the defender's own events", () => {
    // Palmer plays for Chelsea, so his goal is a Liverpool concession — and Van Dijk's clean
    // sheet with it, even though nothing in the stream is attributed to Van Dijk.
    const result = replayLedger({
      events: [
        { minute: 40, type: 'goal.scored', playerRef: 'palmer' },
        { minute: 90, type: 'clean_sheet.awarded', playerRef: 'vandijk' },
      ],
      positions,
      teams,
      stints: [{ memberId: 'alice', playerRef: 'vandijk', fromMinute: 0, toMinute: null }],
      powerUps: [],
      rules,
    });

    expect(result.totals.alice ?? 0).toBe(0);
  });

  it('ignores events for players nobody owns', () => {
    const result = replayLedger({
      events: [{ minute: 10, type: 'goal.scored', playerRef: 'palmer' }],
      positions,
      teams,
      stints: [],
      powerUps: [],
      rules,
    });
    expect(result.entries).toHaveLength(0);
    expect(result.totals).toEqual({});
  });

  it('never turns a power-up into a penalty on negative events', () => {
    const result = replayLedger({
      events: [{ minute: 25, type: 'pass.missed', playerRef: 'palmer' }],
      positions,
      teams,
      stints: [{ memberId: 'alice', playerRef: 'palmer', fromMinute: 0, toMinute: null }],
      powerUps: [boost('alice', 'palmer', 'double_passes')],
      rules,
    });
    expect(result.entries[0]?.multiplier).toBe(1);
    expect(result.totals.alice).toBe(-1);
  });
});
