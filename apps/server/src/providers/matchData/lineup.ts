import type { Lineup, LineupTeam, Player, Team } from '@quickkicks/shared';

export interface LineupSource {
  matchId: string;
  homeTeam: Team;
  awayTeam: Team;
  homePlayers: Player[];
  awayPlayers: Player[];
  /** Our player ids for the announced starting XIs. Empty until the lineups are announced. */
  starterIds: ReadonlySet<string>;
}

function teamRefOf(team: Team): string {
  return team.externalRef ?? team.id;
}

function playerRefOf(player: Player): string {
  return player.externalRef ?? player.id;
}

function buildTeam(team: Team, players: Player[], starters: ReadonlySet<string>): LineupTeam {
  return {
    teamRef: teamRefOf(team),
    name: team.name,
    shortName: team.shortName,
    players: players.map((player) => ({
      playerRef: playerRefOf(player),
      fullName: player.fullName,
      position: player.position,
      shirtNumber: player.shirtNumber,
      isStarter: starters.has(player.id),
    })),
  };
}

export function buildLineup(source: LineupSource): Lineup {
  return {
    matchId: source.matchId,
    home: buildTeam(source.homeTeam, source.homePlayers, source.starterIds),
    away: buildTeam(source.awayTeam, source.awayPlayers, source.starterIds),
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

/**
 * Starters are the draft pool. A drafted substitute who never comes on would score nothing all
 * match, which is a miserable way to lose, so only the 22 players who start are offered.
 */
export function starterIds(source: LineupSource): string[] {
  return [...source.homePlayers, ...source.awayPlayers]
    .filter((p) => source.starterIds.has(p.id))
    .map((p) => p.id);
}

export function ratingsByRef(source: LineupSource): Record<string, number> {
  const ratings: Record<string, number> = {};
  for (const player of [...source.homePlayers, ...source.awayPlayers]) {
    ratings[playerRefOf(player)] = player.rating;
  }
  return ratings;
}
