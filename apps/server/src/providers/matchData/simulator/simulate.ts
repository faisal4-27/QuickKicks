import type { Lineup, LineupPlayer, LineupTeam, MatchEvent, MatchEventType } from '@quickkicks/shared';
import { createRng, type Rng } from './rng.js';
import {
  ASSIST_P,
  ASSIST_WEIGHT,
  CONVERSION_BIAS,
  ON_TARGET_CONVERSION_P,
  POSITION_RATES,
  SAVE_GIVEN_NO_GOAL_P,
  SHOT_ON_TARGET_P,
  STRAIGHT_RED_GIVEN_FOUL_P,
  YELLOW_GIVEN_FOUL_P,
  ratingFactor,
} from './rates.js';

export interface SimulationConfig {
  finalMinute: number;
  halfTimeMinute: number;
}

export const DEFAULT_SIMULATION_CONFIG: SimulationConfig = {
  finalMinute: 90,
  halfTimeMinute: 45,
};

export interface SimulateInput {
  matchId: string;
  lineup: Lineup;
  seed: string | number;
  /** Ratings keyed by player ref. Missing entries fall back to an average player. */
  ratings?: Record<string, number>;
  config?: Partial<SimulationConfig>;
}

/** Match-level events carry no player; consumers map this to a null player id. */
export const MATCH_LEVEL_REF = '';

interface SimPlayer {
  ref: string;
  position: LineupPlayer['position'];
  rating: number;
  teamRef: string;
  sentOff: boolean;
  onYellow: boolean;
}

interface SimTeam {
  ref: string;
  players: SimPlayer[];
  goals: number;
  /** Activity multiplier from relative squad strength, so the better side sees more of the ball. */
  possession: number;
}

function buildTeam(team: LineupTeam, ratings: Record<string, number>): SimTeam {
  const players = team.players
    .filter((p) => p.isStarter)
    .map<SimPlayer>((p) => ({
      ref: p.playerRef,
      position: p.position,
      rating: ratings[p.playerRef] ?? 78,
      teamRef: team.teamRef,
      sentOff: false,
      onYellow: false,
    }));
  return { ref: team.teamRef, players, goals: 0, possession: 1 };
}

function averageRating(team: SimTeam): number {
  if (team.players.length === 0) return 78;
  return team.players.reduce((sum, p) => sum + p.rating, 0) / team.players.length;
}

/**
 * Generates a complete match up-front. Being a pure function of (lineup, seed) means the same
 * seed always replays the same match, which is what makes power-up and swap behaviour testable.
 */
export function simulateMatch(input: SimulateInput): MatchEvent[] {
  const config = { ...DEFAULT_SIMULATION_CONFIG, ...input.config };
  const rng = createRng(input.seed);
  const ratings = input.ratings ?? {};

  const home = buildTeam(input.lineup.home, ratings);
  const away = buildTeam(input.lineup.away, ratings);
  const homeStrength = averageRating(home);
  const awayStrength = averageRating(away);
  const total = homeStrength + awayStrength;
  home.possession = (2 * homeStrength) / total;
  away.possession = (2 * awayStrength) / total;

  const events: MatchEvent[] = [];
  let sequence = 0;

  const push = (
    minute: number,
    type: MatchEventType,
    playerRef: string,
    teamRef: string,
    meta?: Record<string, unknown>,
  ): void => {
    sequence += 1;
    events.push({
      id: `sim:${input.matchId}:${sequence}`,
      matchId: input.matchId,
      sequence,
      minute,
      playerRef,
      teamRef,
      type,
      ...(meta ? { meta } : {}),
    });
  };

  const emitRepeated = (
    minute: number,
    type: MatchEventType,
    player: SimPlayer,
    count: number,
  ): void => {
    for (let i = 0; i < count; i += 1) push(minute, type, player.ref, player.teamRef);
  };

  const opponentOf = (team: SimTeam): SimTeam => (team === home ? away : home);

  const handleGoal = (minute: number, scorer: SimPlayer, team: SimTeam): void => {
    const candidates = team.players.filter((p) => !p.sentOff && p.ref !== scorer.ref);
    if (candidates.length > 0 && rng.chance(ASSIST_P)) {
      const assister = rng.weighted(candidates, (p) => ASSIST_WEIGHT[p.position]);
      // Emitted immediately before the goal so the feed reads the way the moment happened.
      push(minute, 'assist', assister.ref, assister.teamRef, { forPlayerRef: scorer.ref });
    }
    push(minute, 'goal.scored', scorer.ref, scorer.teamRef);
    team.goals += 1;

    const opponent = opponentOf(team);
    for (const defender of opponent.players) {
      if (defender.position === 'GK' || defender.position === 'DEF') {
        push(minute, 'goal.conceded', defender.ref, defender.teamRef);
      }
    }
  };

  const handleFoul = (minute: number, player: SimPlayer): void => {
    push(minute, 'foul.committed', player.ref, player.teamRef);
    if (rng.chance(STRAIGHT_RED_GIVEN_FOUL_P)) {
      push(minute, 'card.red', player.ref, player.teamRef);
      player.sentOff = true;
      return;
    }
    if (rng.chance(YELLOW_GIVEN_FOUL_P)) {
      if (player.onYellow) {
        push(minute, 'card.red', player.ref, player.teamRef, { secondYellow: true });
        player.sentOff = true;
      } else {
        push(minute, 'card.yellow', player.ref, player.teamRef);
        player.onYellow = true;
      }
    }
  };

  const simulateMinuteForTeam = (minute: number, team: SimTeam): void => {
    for (const player of team.players) {
      if (player.sentOff) continue;
      const rates = POSITION_RATES[player.position];
      const activity = ratingFactor(player.rating) * team.possession;

      emitRepeated(minute, 'pass.completed', player, rng.poisson(rates.passCompleted * activity));
      emitRepeated(minute, 'pass.missed', player, rng.poisson(rates.passMissed * activity));
      emitRepeated(minute, 'tackle.won', player, rng.poisson(rates.tackle * activity));
      emitRepeated(minute, 'interception', player, rng.poisson(rates.interception * activity));

      const fouls = rng.poisson(rates.foul);
      for (let i = 0; i < fouls; i += 1) {
        if (player.sentOff) break;
        handleFoul(minute, player);
      }
    }

    // Shots run in a second pass so goals land after the minute's build-up play.
    for (const player of team.players) {
      if (player.sentOff) continue;
      const rates = POSITION_RATES[player.position];
      const shots = rng.poisson(rates.shot * ratingFactor(player.rating) * team.possession);
      for (let i = 0; i < shots; i += 1) {
        if (!rng.chance(SHOT_ON_TARGET_P)) {
          push(minute, 'shot.off_target', player.ref, player.teamRef);
          continue;
        }
        const converts = ON_TARGET_CONVERSION_P * CONVERSION_BIAS[player.position];
        if (rng.chance(converts)) {
          // One shot, one scoring event. A shot that goes in is paid as the goal and nothing
          // else; emitting `shot.on_target` too would pay the same moment twice. The stat line
          // in `snapshotAt` still counts the goal as a shot on target.
          handleGoal(minute, player, team);
          continue;
        }
        push(minute, 'shot.on_target', player.ref, player.teamRef);
        if (rng.chance(SAVE_GIVEN_NO_GOAL_P)) {
          const keeper = opponentOf(team).players.find((p) => p.position === 'GK' && !p.sentOff);
          if (keeper) push(minute, 'save', keeper.ref, keeper.teamRef);
        }
      }
    }
  };

  push(0, 'period.start', MATCH_LEVEL_REF, input.lineup.home.teamRef, { period: 1 });

  for (let minute = 1; minute <= config.finalMinute; minute += 1) {
    // Alternate which side is resolved first so neither gets a systematic edge.
    const order = minute % 2 === 0 ? [home, away] : [away, home];
    for (const team of order) simulateMinuteForTeam(minute, team);

    if (minute === config.halfTimeMinute) {
      push(minute, 'period.end', MATCH_LEVEL_REF, input.lineup.home.teamRef, { period: 1 });
      push(minute, 'period.start', MATCH_LEVEL_REF, input.lineup.home.teamRef, { period: 2 });
    }
  }

  // Emitted at the final whistle for every outfield defensive player regardless of the score,
  // because whether it is worth anything is not a fact about the match. A clean sheet belongs to
  // the manager who held the player through a goalless stretch of his own, and a provider has no
  // idea who owned whom — so this says "full time, here is a shut-out candidate" and scoring
  // decides. See `scoring/cleanSheet.ts`.
  for (const team of [home, away]) {
    for (const player of team.players) {
      if (player.position === 'FWD') continue;
      push(config.finalMinute, 'clean_sheet.awarded', player.ref, player.teamRef);
    }
  }

  push(config.finalMinute, 'period.end', MATCH_LEVEL_REF, input.lineup.home.teamRef, { period: 2 });

  return events;
}

export function rngFor(seed: string | number): Rng {
  return createRng(seed);
}
