/**
 * Snake draft order as a flat list of zero-based draft positions, one entry per pick.
 * Odd rounds run forwards, even rounds run backwards, so whoever picks first in round 1
 * picks last in round 2.
 *
 * snakeOrder(4, 2) -> [0, 1, 2, 3, 3, 2, 1, 0]
 */
export function snakeOrder(memberCount: number, rounds: number): number[] {
  if (!Number.isInteger(memberCount) || memberCount < 1) {
    throw new Error(`memberCount must be a positive integer, got ${memberCount}`);
  }
  if (!Number.isInteger(rounds) || rounds < 1) {
    throw new Error(`rounds must be a positive integer, got ${rounds}`);
  }

  const order: number[] = [];
  for (let round = 0; round < rounds; round += 1) {
    const positions = Array.from({ length: memberCount }, (_, i) => i);
    if (round % 2 === 1) positions.reverse();
    order.push(...positions);
  }
  return order;
}

export interface PickCoordinates {
  /** One-based pick index across the whole draft. */
  pickNumber: number;
  /** One-based round. */
  round: number;
  /** Zero-based draft position of the manager on the clock. */
  draftPosition: number;
  /** One-based index of this pick within its round. */
  pickInRound: number;
}

/** Expands a snake order into per-pick coordinates, which is what the draft board renders. */
export function draftSchedule(memberCount: number, rounds: number): PickCoordinates[] {
  return snakeOrder(memberCount, rounds).map((draftPosition, index) => ({
    pickNumber: index + 1,
    round: Math.floor(index / memberCount) + 1,
    draftPosition,
    pickInRound: (index % memberCount) + 1,
  }));
}

export function totalPicks(memberCount: number, rounds: number): number {
  return memberCount * rounds;
}

/**
 * Which draft position is on the clock for a given one-based pick number, or null once
 * the draft is complete.
 */
export function draftPositionForPick(
  pickNumber: number,
  memberCount: number,
  rounds: number,
): number | null {
  const order = snakeOrder(memberCount, rounds);
  const entry = order[pickNumber - 1];
  return entry === undefined ? null : entry;
}
