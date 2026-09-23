import type { Lineup, LineupTeam, Player, Team } from '@quickkicks/shared';
import { STARTER_REFS } from '../../seed/catalog.js';

export interface LineupSource {
  matchId: string;
  homeTeam: Team;
  awayTeam: Team;
  homePlayers: Player[];
  awayPlayers: Player[];
}

function teamRefOf(team: Team): string {
  return team.externalRef ?? team.id;
}

function playerRefOf(player: Player): string {
  return player.externalRef ?? player.id;
}

/**
 * Starters are the draft pool. A drafted substitute who never comes on would score nothing all
 * match, which is a miserable way to lose, so v1 only offers the 22 players who start.
 */
function isStarter(player: Player): boolean {
  const ref = player.externalRef;
  // Anything not in the seeded starter list (a future real lineup feed) is treated as starting.
  return ref === null ? true : STARTER_REFS.has(ref) || STARTER_REFS.size === 0;
}

function buildTeam(team: Team, players: Player[]): LineupTeam {
  return {
    teamRef: teamRefOf(team),
    name: team.name,
    shortName: team.shortName,
    players: players.map((player) => ({
      playerRef: playerRefOf(player),
      fullName: player.fullName,
      position: player.position,
      shirtNumber: player.shirtNumber,
      isStarter: isStarter(player),
    })),
  };
}

export function buildLineup(source: LineupSource): Lineup {
  return {
    matchId: source.matchId,
    home: buildTeam(source.homeTeam, source.homePlayers),
    away: buildTeam(source.awayTeam, source.awayPlayers),
  };
}

/** Provider refs back to our own player ids, which is how events become ledger rows. */
export function buildRefIndex(source: LineupSource): Map<string, Player> {
  const index = new Map<string, Player>();
  for (const player of [...source.homePlayers, ...source.awayPlayers]) {
    index.set(playerRefOf(player), player);
  }
  return index;
}

export function starterIds(source: LineupSource): string[] {
  return [...source.homePlayers, ...source.awayPlayers].filter(isStarter).map((p) => p.id);
}

export function ratingsByRef(source: LineupSource): Record<string, number> {
  const ratings: Record<string, number> = {};
  for (const player of [...source.homePlayers, ...source.awayPlayers]) {
    ratings[playerRefOf(player)] = player.rating;
  }
  return ratings;
}
