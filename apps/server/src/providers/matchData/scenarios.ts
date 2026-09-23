import { readFile } from 'node:fs/promises';
import { MATCH_EVENT_TYPES, type MatchEvent, type MatchEventType } from '@quickkicks/shared';

interface ScenarioEventInput {
  minute: number;
  type: string;
  playerRef?: string;
  teamRef?: string;
  meta?: Record<string, unknown>;
}

interface ScenarioFile {
  name?: string;
  matchId?: string;
  events: ScenarioEventInput[];
}

/**
 * Scripted scenarios exist because some behaviour is close to untestable against random data:
 * "the power-up was live from 20' to 30', so the 24' goal doubled", or "the player was swapped
 * out at 70', so the 82' goal paid the new owner". A scenario pins the exact minutes.
 */
export async function loadScenario(path: string, matchId: string): Promise<MatchEvent[]> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as ScenarioFile;
  if (!Array.isArray(raw.events)) {
    throw new Error(`Scenario ${path} has no events array`);
  }
  return buildScenarioEvents(raw.events, matchId);
}

export function buildScenarioEvents(
  inputs: readonly ScenarioEventInput[],
  matchId: string,
): MatchEvent[] {
  const sorted = [...inputs].sort((a, b) => a.minute - b.minute);
  return sorted.map((input, index) => {
    if (!MATCH_EVENT_TYPES.includes(input.type as MatchEventType)) {
      throw new Error(`Scenario references unknown event type "${input.type}"`);
    }
    const sequence = index + 1;
    return {
      id: `scenario:${matchId}:${sequence}`,
      matchId,
      sequence,
      minute: input.minute,
      playerRef: input.playerRef ?? '',
      teamRef: input.teamRef ?? '',
      type: input.type as MatchEventType,
      ...(input.meta ? { meta: input.meta } : {}),
    };
  });
}
