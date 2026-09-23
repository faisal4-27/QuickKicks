import type { MatchEvent } from '@quickkicks/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { lineupFromSeed } from '../../seed/lineupFromSeed.js';
import { MockMatchDataProvider } from './MockMatchDataProvider.js';
import { buildScenarioEvents } from './scenarios.js';

const seed = lineupFromSeed('test-match');

function provider(seedValue: string | number = 'fixed-seed') {
  return new MockMatchDataProvider({
    matchId: 'test-match',
    lineup: seed.lineup,
    ratings: seed.ratings,
    seed: seedValue,
  });
}

describe('simulated matches', () => {
  it('replays identically for the same seed', () => {
    const a = provider('same').allEvents();
    const b = provider('same').allEvents();
    expect(a).toEqual(b);
  });

  it('produces a different match for a different seed', () => {
    const a = provider('one').allEvents();
    const b = provider('two').allEvents();
    expect(a).not.toEqual(b);
  });

  it('emits strictly increasing sequences and non-decreasing minutes', () => {
    const events = provider().allEvents();
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i]!.sequence).toBe(events[i - 1]!.sequence + 1);
      expect(events[i]!.minute).toBeGreaterThanOrEqual(events[i - 1]!.minute);
    }
  });

  it('gives every event a stable unique id, which is what makes ingestion idempotent', () => {
    const events = provider().allEvents();
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
  });

  it('only involves players who started', () => {
    const starters = new Set(
      [...seed.lineup.home.players, ...seed.lineup.away.players]
        .filter((p) => p.isStarter)
        .map((p) => p.playerRef),
    );
    for (const event of provider().allEvents()) {
      if (!event.playerRef) continue;
      expect(starters.has(event.playerRef)).toBe(true);
    }
  });

  it('puts an assist immediately before the goal it created', () => {
    const events = provider('assists').allEvents();
    const assistIndexes = events.flatMap((e, i) => (e.type === 'assist' ? [i] : []));
    expect(assistIndexes.length).toBeGreaterThan(0);
    for (const index of assistIndexes) {
      const next = events[index + 1];
      expect(next?.type).toBe('goal.scored');
      expect(next?.minute).toBe(events[index]!.minute);
      expect(next?.teamRef).toBe(events[index]!.teamRef);
    }
  });

  it('books a conceded goal against the other side for every goal scored', () => {
    const events = provider('conceded').allEvents();
    const goals = events.filter((e) => e.type === 'goal.scored');
    const conceded = events.filter((e) => e.type === 'goal.conceded');
    // Each goal charges the opposing keeper and every opposing defender.
    expect(conceded.length).toBe(goals.length * 5);
    for (const goal of goals) {
      const sameMinute = conceded.filter((c) => c.minute === goal.minute);
      expect(sameMinute.every((c) => c.teamRef !== goal.teamRef)).toBe(true);
    }
  });

  it('only awards a clean sheet to a side that conceded nothing, and only at the whistle', () => {
    for (const seedValue of ['cs1', 'cs2', 'cs3', 'cs4', 'cs5']) {
      const events = provider(seedValue).allEvents();
      const cleanSheets = events.filter((e) => e.type === 'clean_sheet.awarded');
      for (const awarded of cleanSheets) {
        expect(awarded.minute).toBe(90);
        const conceded = events.some(
          (e) => e.type === 'goal.scored' && e.teamRef !== awarded.teamRef,
        );
        expect(conceded).toBe(false);
      }
      // Forwards never collect a clean sheet.
      const forwardRefs = new Set(
        [...seed.lineup.home.players, ...seed.lineup.away.players]
          .filter((p) => p.position === 'FWD')
          .map((p) => p.playerRef),
      );
      expect(cleanSheets.some((e) => forwardRefs.has(e.playerRef))).toBe(false);
    }
  });

  it('stops a sent-off player from doing anything else', () => {
    for (const seedValue of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8']) {
      const events = provider(seedValue).allEvents();
      const red = events.findIndex((e) => e.type === 'card.red');
      if (red === -1) continue;
      const offender = events[red]!.playerRef;
      const after = events
        .slice(red + 1)
        .filter((e) => e.playerRef === offender && e.type !== 'clean_sheet.awarded');
      expect(after).toEqual([]);
    }
  });
});

describe('advanceTo', () => {
  it('delivers only events up to the requested minute', async () => {
    const p = provider('advance');
    const seen: MatchEvent[] = [];
    await p.subscribe('test-match', async (event) => {
      seen.push(event);
    });

    await p.advanceTo('test-match', 10);
    expect(seen.length).toBeGreaterThan(0);
    expect(Math.max(...seen.map((e) => e.minute))).toBeLessThanOrEqual(10);

    const afterTen = seen.length;
    await p.advanceTo('test-match', 20);
    expect(seen.length).toBeGreaterThan(afterTen);
    expect(Math.max(...seen.map((e) => e.minute))).toBeLessThanOrEqual(20);
  });

  it('never delivers the same event twice', async () => {
    const p = provider('twice');
    const seen: string[] = [];
    await p.subscribe('test-match', async (event) => {
      seen.push(event.id);
    });
    await p.advanceTo('test-match', 45);
    await p.advanceTo('test-match', 45);
    await p.advanceTo('test-match', 90);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('resumes from a sequence without replaying what was already consumed', async () => {
    const full = provider('resume').allEvents();
    const cutoff = full[Math.floor(full.length / 2)]!.sequence;

    const p = provider('resume');
    const seen: number[] = [];
    await p.subscribe(
      'test-match',
      async (event) => {
        seen.push(event.sequence);
      },
      { sinceSequence: cutoff },
    );
    await p.advanceTo('test-match', 90);

    expect(Math.min(...seen)).toBeGreaterThan(cutoff);
  });
});

describe('snapshots', () => {
  let p: MockMatchDataProvider;
  beforeAll(() => {
    p = provider('snapshot');
  });

  it('agrees with the event stream on the final score', () => {
    const events = p.allEvents();
    const snapshot = p.snapshotAt(90);
    const homeGoals = events.filter(
      (e) => e.type === 'goal.scored' && e.teamRef === seed.lineup.home.teamRef,
    ).length;
    expect(snapshot.score.home).toBe(homeGoals);
  });

  it('accumulates monotonically', () => {
    const early = p.snapshotAt(20);
    const late = p.snapshotAt(90);
    for (const [ref, line] of Object.entries(early.perPlayer)) {
      expect(late.perPlayer[ref]!.passesCompleted).toBeGreaterThanOrEqual(line.passesCompleted);
    }
  });

  it('lands in a believable range for a real match', () => {
    const snapshot = p.snapshotAt(90);
    const lines = Object.values(snapshot.perPlayer);
    const attempted = lines.reduce((s, l) => s + l.passesCompleted + l.passesMissed, 0);
    const completed = lines.reduce((s, l) => s + l.passesCompleted, 0);
    // Premier League pass accuracy sits around 80-88%.
    expect(completed / attempted).toBeGreaterThan(0.78);
    expect(completed / attempted).toBeLessThan(0.92);

    const totalGoals = snapshot.score.home + snapshot.score.away;
    expect(totalGoals).toBeLessThan(10);

    const busiest = Math.max(...lines.map((l) => l.passesCompleted));
    expect(busiest).toBeGreaterThan(25);
  });
});

describe('scripted scenarios', () => {
  it('replays exact minutes so power-up and swap behaviour can be pinned', async () => {
    const events = buildScenarioEvents(
      [
        { minute: 24, type: 'goal.scored', playerRef: 'mock:liv:salah', teamRef: 'mock:team:liv' },
        { minute: 82, type: 'goal.scored', playerRef: 'mock:liv:salah', teamRef: 'mock:team:liv' },
      ],
      'test-match',
    );

    const p = new MockMatchDataProvider({
      matchId: 'test-match',
      lineup: seed.lineup,
      events,
    });

    const seen: MatchEvent[] = [];
    await p.subscribe('test-match', async (event) => {
      seen.push(event);
    });
    await p.advanceTo('test-match', 50);
    expect(seen.map((e) => e.minute)).toEqual([24]);
    await p.advanceTo('test-match', 90);
    expect(seen.map((e) => e.minute)).toEqual([24, 82]);
  });

  it('rejects an unknown event type instead of silently dropping it', () => {
    expect(() => buildScenarioEvents([{ minute: 1, type: 'goal.nope' }], 'm')).toThrow();
  });
});
