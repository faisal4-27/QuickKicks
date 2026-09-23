import type { Lineup, Position } from '@quickkicks/shared';
import { catalog } from './catalog.js';

export interface SeedLineup {
  lineup: Lineup;
  ratings: Record<string, number>;
  positions: Record<string, Position>;
  names: Record<string, string>;
  teamNames: Record<string, string>;
}

/**
 * Builds a lineup straight from the seed file, with no database involved. This is what lets the
 * sim CLI run and the scoring tests execute without Postgres or Redis.
 */
export function lineupFromSeed(matchId = 'sim'): SeedLineup {
  const [home, away] = catalog.teams;
  if (!home || !away) throw new Error('Seed catalog needs two teams');

  const ratings: Record<string, number> = {};
  const positions: Record<string, Position> = {};
  const names: Record<string, string> = {};
  const teamNames: Record<string, string> = {};

  const toTeam = (team: typeof home) => {
    teamNames[team.externalRef] = team.shortName;
    return {
      teamRef: team.externalRef,
      name: team.name,
      shortName: team.shortName,
      players: team.players.map((player) => {
        ratings[player.externalRef] = player.rating;
        positions[player.externalRef] = player.position;
        names[player.externalRef] = player.fullName;
        return {
          playerRef: player.externalRef,
          fullName: player.fullName,
          position: player.position,
          shirtNumber: player.shirtNumber,
          isStarter: player.starter,
        };
      }),
    };
  };

  return {
    lineup: { matchId, home: toTeam(home), away: toTeam(away) },
    ratings,
    positions,
    names,
    teamNames,
  };
}

export function starterRefs(): string[] {
  return catalog.teams.flatMap((t) => t.players.filter((p) => p.starter).map((p) => p.externalRef));
}
