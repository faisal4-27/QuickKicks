import {
  emptyStatLine,
  type Lineup,
  type MatchEventType,
  type PlayerStatLine,
  type Position,
} from '@quickkicks/shared';
import { apiRefs, mapPosition, minuteOf } from './refs.js';
import type { ApiEvent, ApiFixture, ApiPlayerStatistics } from './types.js';

/** A provider event before the provider stamps it with a match id and a sequence number. */
export interface DerivedEvent {
  id: string;
  minute: number;
  playerRef: string;
  teamRef: string;
  type: MatchEventType;
  meta?: Record<string, unknown>;
}

export interface DeriveOptions {
  /** The match-minute stamped on events read off cumulative stats, which carry no time. */
  minute: number;
  /** At full time the clean-sheet candidates are added. */
  finished: boolean;
}

interface KnownPlayer {
  teamRef: string;
  position: Position;
}

/**
 * Restates a fixture payload as the app's scoring stream.
 *
 * API-Football's timeline only carries goals, cards and substitutions; passes, tackles, shots and
 * saves exist only as running per-player totals. So this re-derives the *whole* stream from the
 * current payload every poll, and gives every event an id built from what it counts rather than
 * when it was seen — a player's 31st completed pass is `pass.completed:<player>:31` however many
 * times it is derived. That makes redelivery free: the provider forwards ids it has not sent yet,
 * and after a restart the unique index on (room_id, provider_event_id) drops the rest.
 *
 * Revisions are not chased. A VAR-cancelled goal that was already delivered stays paid, and a
 * total that drops simply stops producing new events; reconciling against `getSnapshot` with
 * adjustment rows is the later fix, as `MatchDataProvider` documents.
 */
export function deriveEvents(fixture: ApiFixture, lineup: Lineup, opts: DeriveOptions): DerivedEvent[] {
  const fixtureId = fixture.fixture.id;
  const id = (...parts: (string | number)[]) => [`apifootball:${fixtureId}`, ...parts].join(':');
  const homeRef = apiRefs.team(fixture.teams.home.id);
  const awayRef = apiRefs.team(fixture.teams.away.id);
  const otherSide = (teamRef: string) => (teamRef === homeRef ? awayRef : homeRef);

  const known = knownPlayers(fixture, lineup);
  const onPitch = startingElevens(fixture, lineup, homeRef, awayRef);
  const events: DerivedEvent[] = [];
  const push = (event: DerivedEvent) => events.push(event);

  const goalOrdinals = new Map<string, number>();
  const cardOrdinals = new Map<string, number>();

  for (const raw of fixture.events ?? []) {
    const minute = minuteOf(raw.time.elapsed);
    const kind = raw.type.toLowerCase();
    const detail = raw.detail.toLowerCase();

    if (kind === 'goal') {
      if (detail.includes('missed')) continue;
      const ownGoal = detail.includes('own goal');
      const scorerRef = raw.player.id ? apiRefs.player(raw.player.id) : null;
      // The lineup knows which side a player is on; the event's team field is ambiguous for own goals.
      const scorerTeam = (scorerRef && known.get(scorerRef)?.teamRef) ?? apiRefs.team(raw.team.id);
      const benefiting = ownGoal ? otherSide(scorerTeam) : scorerTeam;
      const conceding = otherSide(benefiting);

      // Keyed on the side and the time rather than the scorer, so a goal later re-credited to a
      // team-mate is recognised as the same goal and not paid twice.
      const slot = `${benefiting}:${raw.time.elapsed ?? 0}+${raw.time.extra ?? 0}`;
      const ordinal = (goalOrdinals.get(slot) ?? 0) + 1;
      goalOrdinals.set(slot, ordinal);
      const goalId = id('goal', slot, ordinal);

      if (!ownGoal && raw.assist.id && scorerRef) {
        const assistRef = apiRefs.player(raw.assist.id);
        push({
          id: `${goalId}:assist`,
          minute,
          playerRef: assistRef,
          teamRef: known.get(assistRef)?.teamRef ?? scorerTeam,
          type: 'assist',
          meta: { forPlayerRef: scorerRef },
        });
      }
      if (scorerRef) {
        push({
          id: goalId,
          minute,
          playerRef: scorerRef,
          teamRef: scorerTeam,
          type: ownGoal ? 'goal.own' : 'goal.scored',
          meta: { detail: raw.detail },
        });
      }
      for (const ref of onPitch.get(conceding) ?? []) {
        const position = known.get(ref)?.position;
        if (position !== 'GK' && position !== 'DEF') continue;
        push({ id: `${goalId}:conceded:${ref}`, minute, playerRef: ref, teamRef: conceding, type: 'goal.conceded' });
      }
      continue;
    }

    if (kind === 'card') {
      if (!raw.player.id) continue;
      const card = cardType(detail);
      if (!card) continue;
      const ref = apiRefs.player(raw.player.id);
      const key = `${ref}:${card.type}`;
      const ordinal = (cardOrdinals.get(key) ?? 0) + 1;
      cardOrdinals.set(key, ordinal);
      const teamRef = known.get(ref)?.teamRef ?? apiRefs.team(raw.team.id);
      push({
        id: id('card', raw.player.id, card.type, ordinal),
        minute,
        playerRef: ref,
        teamRef,
        type: card.type,
        ...(card.secondYellow ? { meta: { secondYellow: true } } : {}),
      });
      if (card.type === 'card.red') onPitch.get(teamRef)?.delete(ref);
      continue;
    }

    if (kind === 'subst') {
      const teamRef = apiRefs.team(raw.team.id);
      const { off, on } = substitution(raw, onPitch.get(teamRef));
      const side = onPitch.get(teamRef);
      if (off) {
        side?.delete(off);
        push({ id: id('sub.off', off), minute, playerRef: off, teamRef, type: 'sub.off' });
      }
      if (on) {
        side?.add(on);
        push({ id: id('sub.on', on), minute, playerRef: on, teamRef, type: 'sub.on' });
      }
    }
  }

  for (const block of fixture.players ?? []) {
    const teamRef = apiRefs.team(block.team.id);
    for (const entry of block.players) {
      const stats = entry.statistics[0];
      if (!stats) continue;
      const ref = apiRefs.player(entry.player.id);
      for (const [type, count] of statCounts(stats)) {
        for (let n = 1; n <= count; n += 1) {
          push({ id: id(type, entry.player.id, n), minute: opts.minute, playerRef: ref, teamRef, type });
        }
      }
    }
  }

  // Offered for every non-forward starter whatever the score: who earned it depends on ownership,
  // which only scoring knows. See `scoring/cleanSheet.ts`.
  if (opts.finished) {
    for (const [teamRef, starters] of startingElevens(fixture, lineup, homeRef, awayRef)) {
      for (const ref of starters) {
        if (known.get(ref)?.position === 'FWD') continue;
        push({ id: id('clean_sheet', ref), minute: opts.minute, playerRef: ref, teamRef, type: 'clean_sheet.awarded' });
      }
    }
  }

  return events;
}

/**
 * The counts behind the stat-derived events. A shot that went in is paid as the goal alone, so
 * goals come off the shots-on-target total here — the one-scoring-event-per-shot rule.
 */
export function statCounts(stats: ApiPlayerStatistics): [MatchEventType, number][] {
  const passes = passCounts(stats);
  const shotsOn = n(stats.shots.on);
  return [
    ['pass.completed', passes.completed],
    ['pass.missed', passes.missed],
    ['tackle.won', n(stats.tackles.total)],
    ['interception', n(stats.tackles.interceptions)],
    ['foul.committed', n(stats.fouls.committed)],
    ['shot.on_target', Math.max(0, shotsOn - n(stats.goals.total))],
    ['shot.off_target', Math.max(0, n(stats.shots.total) - shotsOn)],
    ['save', n(stats.goals.saves)],
  ];
}

export function statLineFrom(stats: ApiPlayerStatistics): PlayerStatLine {
  const passes = passCounts(stats);
  return {
    ...emptyStatLine(),
    passesCompleted: passes.completed,
    passesMissed: passes.missed,
    tackles: n(stats.tackles.total),
    interceptions: n(stats.tackles.interceptions),
    fouls: n(stats.fouls.committed),
    shotsOnTarget: n(stats.shots.on),
    shotsOffTarget: Math.max(0, n(stats.shots.total) - n(stats.shots.on)),
    goals: n(stats.goals.total),
    assists: n(stats.goals.assists),
    saves: n(stats.goals.saves),
    goalsConceded: n(stats.goals.conceded),
    yellowCards: n(stats.cards.yellow),
    redCards: n(stats.cards.red),
    minutesPlayed: n(stats.games.minutes),
  };
}

function n(value: number | string | null | undefined): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function passCounts(stats: ApiPlayerStatistics): { completed: number; missed: number } {
  const total = n(stats.passes.total);
  const accuracy = stats.passes.accuracy;
  // Normally a count of accurate passes; some competitions report a percentage instead.
  const completed =
    typeof accuracy === 'string' && accuracy.trim().endsWith('%')
      ? Math.round((total * n(accuracy.replace('%', ''))) / 100)
      : Math.min(total, n(accuracy));
  return { completed, missed: Math.max(0, total - completed) };
}

function cardType(detail: string): { type: 'card.yellow' | 'card.red'; secondYellow: boolean } | null {
  const secondYellow = detail.includes('second yellow') || detail.includes('yellow-red') || detail.includes('yellow red');
  if (secondYellow) return { type: 'card.red', secondYellow: true };
  if (detail.includes('red')) return { type: 'card.red', secondYellow: false };
  if (detail.includes('yellow')) return { type: 'card.yellow', secondYellow: false };
  return null;
}

/**
 * Which of an event's two players went off. The feed's own convention for which field is which
 * has not been consistent, so the answer comes from who is actually on the pitch, falling back to
 * the documented one (`player` on, `assist` off) when that settles nothing.
 */
function substitution(raw: ApiEvent, side: ReadonlySet<string> | undefined): { off: string | null; on: string | null } {
  const a = raw.player.id ? apiRefs.player(raw.player.id) : null;
  const b = raw.assist.id ? apiRefs.player(raw.assist.id) : null;
  const aOn = a !== null && (side?.has(a) ?? false);
  const bOn = b !== null && (side?.has(b) ?? false);
  if (aOn && !bOn) return { off: a, on: b };
  return { off: b, on: a };
}

/** Our lineup first, then the payload's, so a player we never stored still has a side and position. */
function knownPlayers(fixture: ApiFixture, lineup: Lineup): Map<string, KnownPlayer> {
  const known = new Map<string, KnownPlayer>();
  for (const team of fixture.lineups ?? []) {
    const teamRef = apiRefs.team(team.team.id);
    for (const { player } of [...team.startXI, ...team.substitutes]) {
      known.set(apiRefs.player(player.id), { teamRef, position: mapPosition(player.pos) });
    }
  }
  for (const team of [lineup.home, lineup.away]) {
    for (const player of team.players) {
      known.set(player.playerRef, { teamRef: team.teamRef, position: player.position });
    }
  }
  return known;
}

/**
 * Who started, per side. The payload's XI wins when present, since a late change in the warm-up
 * lands there; otherwise the XI announced to the draft.
 */
function startingElevens(
  fixture: ApiFixture,
  lineup: Lineup,
  homeRef: string,
  awayRef: string,
): Map<string, Set<string>> {
  const elevens = new Map<string, Set<string>>([
    [homeRef, new Set()],
    [awayRef, new Set()],
  ]);
  const fromPayload = fixture.lineups ?? [];
  if (fromPayload.length === 2 && fromPayload.every((t) => t.startXI.length > 0)) {
    for (const team of fromPayload) {
      const side = elevens.get(apiRefs.team(team.team.id));
      for (const { player } of team.startXI) side?.add(apiRefs.player(player.id));
    }
    return elevens;
  }
  for (const team of [lineup.home, lineup.away]) {
    const side = elevens.get(team.teamRef);
    for (const player of team.players) if (player.isStarter) side?.add(player.playerRef);
  }
  return elevens;
}
