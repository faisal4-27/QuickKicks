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
  const windows: PowerUpWindow[] = [
    { memberId: 'alice', kind: 'double_goals', fromMinute: 20, toMinute: 30 },
  ];

  it('is inclusive of the activation minute and exclusive of the expiry minute', () => {
    expect(activeKindsAt(windows, 'alice', 19)).toEqual([]);
    expect(activeKindsAt(windows, 'alice', 20)).toEqual(['double_goals']);
    expect(activeKindsAt(windows, 'alice', 29)).toEqual(['double_goals']);
    expect(activeKindsAt(windows, 'alice', 30)).toEqual([]);
  });

  it('does not leak between managers', () => {
    expect(activeKindsAt(windows, 'bob', 25)).toEqual([]);
  });
});

describe('replayLedger', () => {
  it('doubles a goal inside the power-up window and not outside it', () => {
    // The scripted scenario the plan called for: a boost live from 20' to 30'.
    const events: ReplayEvent[] = [
      { minute: 15, type: 'goal.scored', playerRef: 'salah' },
      { minute: 24, type: 'goal.scored', playerRef: 'salah' },
      { minute: 35, type: 'goal.scored', playerRef: 'salah' },
    ];
    const result = replayLedger({
      events,
      positions,
      stints: [{ memberId: 'alice', playerRef: 'salah', fromMinute: 0, toMinute: null }],
      powerUps: [{ memberId: 'alice', kind: 'double_goals', fromMinute: 20, toMinute: 30 }],
      rules,
    });

    expect(result.entries.map((e) => e.multiplier)).toEqual([1, 2, 1]);
    // 9 + 18 + 9
    expect(result.totals.alice).toBe(36);
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

    expect(result.totals).toEqual({ alice: 9, bob: 9 });
    // Nothing is retroactively moved: the 30' goal stays with Alice forever.
    expect(result.byMemberPlayer['alice:salah']).toBe(9);
    expect(result.byMemberPlayer['bob:salah']).toBe(9);
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
    expect(result.totals).toEqual({ bob: 5 });
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
      powerUps: [{ memberId: 'alice', kind: 'double_passes', fromMinute: 20, toMinute: 30 }],
      rules,
    });
    expect(result.entries[0]?.multiplier).toBe(1);
    expect(result.totals.alice).toBe(-0.05);
  });
});
