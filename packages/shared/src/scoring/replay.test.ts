import { describe, expect, it } from 'vitest';
import type { Position } from '../types/enums.js';
import { DEFAULT_SCORING_RULES } from './rules.js';
import {
  activeKindsAt,
  ownerAt,
  replayLedger,
  type OwnershipStint,
  type PowerUpWindow,
  type ReplayEvent,
} from './replay.js';

const positions: Record<string, Position> = {
  salah: 'FWD',
  palmer: 'MID',
  vandijk: 'DEF',
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
      stints: [{ memberId: 'alice', playerRef: 'salah', fromMinute: 0, toMinute: null }],
      powerUps: [boost('alice', 'salah', 'double_goals')],
      rules,
    });

    expect(result.entries.map((e) => e.multiplier)).toEqual([1, 2, 1]);
    // 180 + 360 + 180
    expect(result.totals.alice).toBe(720);
  });

  it('boosts both players at once when each carries its own power-up', () => {
    const result = replayLedger({
      events: [
        { minute: 25, type: 'goal.scored', playerRef: 'salah' },
        { minute: 25, type: 'pass.completed', playerRef: 'palmer' },
      ],
      positions,
      stints: [
        { memberId: 'alice', playerRef: 'salah', fromMinute: 0, toMinute: null },
        { memberId: 'alice', playerRef: 'palmer', fromMinute: 0, toMinute: null },
      ],
      powerUps: [boost('alice', 'salah', 'double_goals'), boost('alice', 'palmer', 'double_passes')],
      rules,
    });

    expect(result.entries.map((e) => e.multiplier)).toEqual([2, 2]);
    expect(result.totals.alice).toBe(360 + 2);
  });

  it("leaves the manager's other player unboosted", () => {
    const result = replayLedger({
      events: [{ minute: 25, type: 'goal.scored', playerRef: 'palmer' }],
      positions,
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
      stints: [
        { memberId: 'alice', playerRef: 'salah', fromMinute: 0, toMinute: 22 },
        { memberId: 'bob', playerRef: 'salah', fromMinute: 22, toMinute: null },
      ],
      powerUps: [boost('alice', 'salah', 'double_goals')],
      rules,
    });

    expect(result.totals).toEqual({ bob: 180 });
  });

  it('pays the outgoing manager for what happened before a swap and the new one after', () => {
    const events: ReplayEvent[] = [
      { minute: 30, type: 'goal.scored', playerRef: 'salah' },
      { minute: 82, type: 'goal.scored', playerRef: 'salah' },
    ];
    const result = replayLedger({
      events,
      positions,
      stints: [
        { memberId: 'alice', playerRef: 'salah', fromMinute: 0, toMinute: 70 },
        { memberId: 'bob', playerRef: 'salah', fromMinute: 70, toMinute: null },
      ],
      powerUps: [],
      rules,
    });

    expect(result.totals).toEqual({ alice: 180, bob: 180 });
    // Nothing is retroactively moved: the 30' goal stays with Alice forever.
    expect(result.byMemberPlayer['alice:salah']).toBe(180);
    expect(result.byMemberPlayer['bob:salah']).toBe(180);
  });

  it('gives an end-of-match clean sheet to whoever holds the player at the whistle', () => {
    const result = replayLedger({
      events: [{ minute: 90, type: 'clean_sheet.awarded', playerRef: 'vandijk' }],
      positions,
      stints: [
        { memberId: 'alice', playerRef: 'vandijk', fromMinute: 0, toMinute: 70 },
        { memberId: 'bob', playerRef: 'vandijk', fromMinute: 70, toMinute: null },
      ],
      powerUps: [],
      rules,
    });

    // The consequence of event-time attribution: Alice held him for 70 minutes and gets nothing.
    expect(result.totals).toEqual({ bob: 100 });
  });

  it('ignores events for players nobody owns', () => {
    const result = replayLedger({
      events: [{ minute: 10, type: 'goal.scored', playerRef: 'palmer' }],
      positions,
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
      stints: [{ memberId: 'alice', playerRef: 'palmer', fromMinute: 0, toMinute: null }],
      powerUps: [boost('alice', 'palmer', 'double_passes')],
      rules,
    });
    expect(result.entries[0]?.multiplier).toBe(1);
    expect(result.totals.alice).toBe(-1);
  });
});
