import { describe, expect, it } from 'vitest';
import { cleanSheetClaimant, concededMinutes } from './cleanSheet.js';
import type { OwnershipStint } from './ownership.js';
import { DEFAULT_SCORING_RULES } from './rules.js';

const config = DEFAULT_SCORING_RULES.cleanSheet;
const FINAL = 90;

function claim(stints: OwnershipStint[], concededMinutes: number[] = []) {
  return cleanSheetClaimant({
    stints,
    playerRef: 'vandijk',
    concededMinutes,
    finalMinute: FINAL,
    config,
  });
}

/** Held from `from` to the whistle, which is how an undisturbed draft pick looks. */
function heldTo(memberId: string, from: number): OwnershipStint {
  return { memberId, playerRef: 'vandijk', fromMinute: from, toMinute: null };
}

function held(memberId: string, from: number, to: number): OwnershipStint {
  return { memberId, playerRef: 'vandijk', fromMinute: from, toMinute: to };
}

describe('cleanSheetClaimant', () => {
  it('pays the manager who drafted the player and never let go', () => {
    expect(claim([heldTo('alice', 0)])).toBe('alice');
  });

  it('pays nobody when the team conceded with that manager holding the player', () => {
    expect(claim([heldTo('alice', 0)], [40])).toBeNull();
  });

  it('counts a 90th-minute concession against the manager holding him at the whistle', () => {
    // The open stint runs through the final minute, so a goal at 90' still lands inside it.
    expect(claim([heldTo('alice', 0)], [FINAL])).toBeNull();
  });

  it('does not hold a manager responsible for goals conceded before they arrived', () => {
    // Traded in at 20' with the team already a goal down, and clean from there.
    expect(claim([held('alice', 0, 20), heldTo('bob', 20)], [10])).toBe('bob');
  });

  it('requires the full threshold, so a late arrival earns nothing', () => {
    const stints = [held('alice', 0, 40), heldTo('bob', 40)];
    // Bob's 50 minutes fall short, and Alice's 40 fall short too — a clean sheet can go unclaimed.
    expect(claim(stints)).toBeNull();
  });

  it('pays at most one manager, since two qualifying stints cannot fit in a match', () => {
    for (let handover = 1; handover < FINAL; handover += 1) {
      const aliceQualifies = handover >= config.minMinutesOwned;
      const bobQualifies = FINAL - handover >= config.minMinutesOwned;
      // The property the threshold buys us: 60 and 60 do not fit inside 90, at any handover.
      expect(aliceQualifies && bobQualifies, `handover at ${handover}'`).toBe(false);

      const claimant = claim([held('alice', 0, handover), heldTo('bob', handover)]);
      expect(claimant, `handover at ${handover}'`).toBe(
        aliceQualifies ? 'alice' : bobQualifies ? 'bob' : null,
      );
    }
  });

  it('adds up split spells and ignores what happened while the player was away', () => {
    // Owned 0'-30' and 50'-90' is 70 minutes, and the 40' goal went in on somebody else's watch.
    expect(claim([held('alice', 0, 30), held('bob', 30, 50), heldTo('alice', 50)], [40])).toBe(
      'alice',
    );
  });

  it('still fails a split owner who was holding the player for the goal', () => {
    expect(claim([held('alice', 0, 30), held('bob', 30, 50), heldTo('alice', 50)], [70])).toBeNull();
  });

  it('ignores stints belonging to other players', () => {
    const other: OwnershipStint = {
      memberId: 'bob',
      playerRef: 'salah',
      fromMinute: 0,
      toMinute: null,
    };
    expect(claim([other, heldTo('alice', 0)])).toBe('alice');
  });

  it('pays nobody for a player who was never drafted', () => {
    expect(claim([])).toBeNull();
  });
});

describe('concededMinutes', () => {
  it('counts goals by the other side and own goals by this side', () => {
    const goals = [
      { minute: 10, teamRef: 'liv' },
      { minute: 20, teamRef: 'che' },
      { minute: 30, teamRef: 'liv', ownGoal: true },
      { minute: 40, teamRef: 'che', ownGoal: true },
    ];
    expect(concededMinutes(goals, 'liv')).toEqual([20, 30]);
    expect(concededMinutes(goals, 'che')).toEqual([10, 40]);
  });
});
