import {
  DEFAULT_SCORING_RULES,
  EVENT_LABELS,
  type MatchEvent,
  type MatchEventType,
  type Position,
  cleanSheetClaimant,
  formatPoints,
  roundPoints,
  scoreEvent,
} from '@quickkicks/shared';
import { MockMatchDataProvider } from '../providers/matchData/MockMatchDataProvider.js';
import { loadScenario } from '../providers/matchData/scenarios.js';
import { lineupFromSeed, starterRefs } from '../seed/lineupFromSeed.js';

interface Options {
  seed: string;
  runs: number;
  scenario: string | null;
  verbose: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { seed: 'quickkicks', runs: 1, scenario: null, verbose: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--seed' && next) { options.seed = next; i += 1; }
    else if (arg === '--runs' && next) { options.runs = Math.max(1, Number(next) || 1); i += 1; }
    else if (arg === '--scenario' && next) { options.scenario = next; i += 1; }
    else if (arg === '--verbose' || arg === '-v') options.verbose = true;
  }
  return options;
}

interface PlayerTally {
  ref: string;
  name: string;
  position: Position;
  points: number;
  counts: Map<MatchEventType, number>;
}

function tally(events: readonly MatchEvent[], seed: ReturnType<typeof lineupFromSeed>) {
  const byRef = new Map<string, PlayerTally>();
  const goalMinutesByTeam = new Map<string, number[]>();
  for (const event of events) {
    if (event.type !== 'goal.scored') continue;
    const minutes = goalMinutesByTeam.get(event.teamRef) ?? [];
    minutes.push(event.minute);
    goalMinutesByTeam.set(event.teamRef, minutes);
  }

  for (const event of events) {
    if (!event.playerRef) continue;
    const position = seed.positions[event.playerRef];
    if (!position) continue;
    // The provider offers a clean sheet for every defensive player and leaves the judging to
    // scoring, which needs ownership. There are no managers here, so the CLI measures the player's
    // ceiling: one notional manager who drafted him and held him to the whistle.
    if (event.type === 'clean_sheet.awarded' && !keptCleanSheet(event, goalMinutesByTeam)) continue;

    const entry =
      byRef.get(event.playerRef) ??
      {
        ref: event.playerRef,
        name: seed.names[event.playerRef] ?? event.playerRef,
        position,
        points: 0,
        counts: new Map<MatchEventType, number>(),
      };

    // No power-ups here: the CLI measures the raw scale, which is the thing being tuned.
    const scored = scoreEvent(event.type, position, [], DEFAULT_SCORING_RULES);
    entry.points = roundPoints(entry.points + scored.awardedPoints);
    entry.counts.set(event.type, (entry.counts.get(event.type) ?? 0) + 1);
    byRef.set(event.playerRef, entry);
  }

  return byRef;
}

/** The real rule, asked on behalf of a manager who owned the player for the whole match. */
function keptCleanSheet(event: MatchEvent, goalMinutesByTeam: Map<string, number[]>): boolean {
  const conceded = [...goalMinutesByTeam.entries()]
    .filter(([teamRef]) => teamRef !== event.teamRef)
    .flatMap(([, minutes]) => minutes);
  const owner = cleanSheetClaimant({
    stints: [
      { memberId: 'sim', playerRef: event.playerRef ?? '', fromMinute: 0, toMinute: null },
    ],
    playerRef: event.playerRef ?? '',
    concededMinutes: conceded,
    finalMinute: event.minute,
    config: DEFAULT_SCORING_RULES.cleanSheet,
  });
  return owner !== null;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value.padEnd(width);
}

function padStart(value: string, width: number): string {
  return value.length >= width ? value : value.padStart(width);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const seed = lineupFromSeed('sim');
  const starters = new Set(starterRefs());

  const perRunTotals: Map<string, number[]> = new Map();
  let lastProvider: MockMatchDataProvider | null = null;
  let lastTally: Map<string, PlayerTally> = new Map();

  for (let run = 0; run < options.runs; run += 1) {
    const runSeed = options.runs === 1 ? options.seed : `${options.seed}:${run}`;
    const events = options.scenario ? await loadScenario(options.scenario, 'sim') : undefined;
    const provider = new MockMatchDataProvider({
      matchId: 'sim',
      lineup: seed.lineup,
      ratings: seed.ratings,
      seed: runSeed,
      ...(events ? { events } : {}),
    });
    lastProvider = provider;
    lastTally = tally(provider.allEvents(), seed);

    for (const [ref, entry] of lastTally) {
      const list = perRunTotals.get(ref) ?? [];
      list.push(entry.points);
      perRunTotals.set(ref, list);
    }
  }

  if (!lastProvider) throw new Error('No simulation ran');
  const snapshot = lastProvider.snapshotAt(200);

  console.log('');
  console.log(`QuickKicks match simulation  (seed "${options.seed}", runs ${options.runs})`);
  console.log(`Ruleset v${DEFAULT_SCORING_RULES.version}`);
  console.log('');

  if (options.runs === 1) {
    console.log(
      `Final score: ${seed.lineup.home.shortName} ${snapshot.score.home} - ` +
        `${snapshot.score.away} ${seed.lineup.away.shortName}` +
        `   (${lastProvider.allEvents().length} events)`,
    );
    console.log('');
    console.log(
      `${pad('Player', 24)}${pad('Pos', 5)}${padStart('Pts', 7)}` +
        `${padStart('Pass', 7)}${padStart('Acc%', 6)}${padStart('G', 4)}${padStart('A', 4)}` +
        `${padStart('Tkl', 5)}${padStart('Sv', 4)}${padStart('Fls', 5)}`,
    );
    console.log('-'.repeat(71));

    const ranked = [...lastTally.values()]
      .filter((p) => starters.has(p.ref))
      .sort((a, b) => b.points - a.points);

    for (const player of ranked) {
      const line = snapshot.perPlayer[player.ref];
      const completed = line?.passesCompleted ?? 0;
      const missed = line?.passesMissed ?? 0;
      const attempted = completed + missed;
      const accuracy = attempted === 0 ? 0 : Math.round((completed / attempted) * 100);
      console.log(
        pad(player.name, 24) +
          pad(player.position, 5) +
          padStart(formatPoints(player.points), 7) +
          padStart(String(completed), 7) +
          padStart(String(accuracy), 6) +
          padStart(String(line?.goals ?? 0), 4) +
          padStart(String(line?.assists ?? 0), 4) +
          padStart(String(line?.tackles ?? 0), 5) +
          padStart(String(line?.saves ?? 0), 4) +
          padStart(String(line?.fouls ?? 0), 5),
      );
    }

    if (options.verbose) {
      console.log('');
      console.log('Point sources for the top scorer:');
      const top = ranked[0];
      if (top) {
        for (const [type, count] of [...top.counts.entries()].sort()) {
          const per = scoreEvent(type, top.position, [], DEFAULT_SCORING_RULES);
          if (per.awardedPoints === 0) continue;
          console.log(
            `  ${pad(EVENT_LABELS[type], 20)} x${padStart(String(count), 4)}` +
              ` = ${formatPoints(roundPoints(per.awardedPoints * count), { signed: true })}`,
          );
        }
      }
    }
  }

  // The calibration view: this game is two players, so what matters is the spread of a pair.
  const averages = [...perRunTotals.entries()]
    .filter(([ref]) => starters.has(ref))
    .map(([ref, totals]) => ({
      ref,
      name: seed.names[ref] ?? ref,
      position: seed.positions[ref] ?? ('MID' as Position),
      average: roundPoints(totals.reduce((sum, v) => sum + v, 0) / totals.length),
      min: roundPoints(Math.min(...totals)),
      max: roundPoints(Math.max(...totals)),
    }))
    .sort((a, b) => b.average - a.average);

  console.log('');
  console.log(`Average points per player over ${options.runs} run(s)`);
  console.log('');
  const byPosition = new Map<Position, number[]>();
  for (const row of averages) {
    const list = byPosition.get(row.position) ?? [];
    list.push(row.average);
    byPosition.set(row.position, list);
  }
  for (const position of ['GK', 'DEF', 'MID', 'FWD'] as Position[]) {
    const list = byPosition.get(position) ?? [];
    if (list.length === 0) continue;
    const mean = roundPoints(list.reduce((s, v) => s + v, 0) / list.length);
    console.log(
      `  ${pad(position, 5)} mean ${padStart(formatPoints(mean), 7)}` +
        `   range ${formatPoints(Math.min(...list))} to ${formatPoints(Math.max(...list))}`,
    );
  }

  console.log('');
  console.log('Top 8 by average:');
  for (const row of averages.slice(0, 8)) {
    console.log(
      `  ${pad(row.name, 24)}${pad(row.position, 5)}` +
        `${padStart(formatPoints(row.average), 7)}` +
        `   (${formatPoints(row.min)} to ${formatPoints(row.max)})`,
    );
  }

  const best = averages[0];
  const worst = averages[averages.length - 1];
  if (best && worst) {
    console.log('');
    console.log(
      `Spread across starters: ${formatPoints(worst.average)} to ${formatPoints(best.average)}.`,
    );
    console.log(
      'A drafted pair sums two of these, so a healthy game wants the gap between the best and ' +
        'worst pair to feel winnable rather than decided at the draft.',
    );
  }
  console.log('');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
