import type { PowerUpKind } from '../types/enums.js';

export interface OwnershipStint {
  memberId: string;
  playerRef: string;
  fromMinute: number;
  /** Null while still held. */
  toMinute: number | null;
}

export interface PowerUpWindow {
  memberId: string;
  /** Power-ups boost one player, and only while the manager who activated it owns them. */
  playerRef: string;
  kind: PowerUpKind;
  fromMinute: number;
  toMinute: number;
}

/**
 * A stint covers [fromMinute, toMinute). A swap at 70' therefore closes the old stint and opens
 * the new one at the same minute, and an event stamped 70' pays the incoming manager.
 */
export function ownerAt(
  stints: readonly OwnershipStint[],
  playerRef: string,
  minute: number,
): string | null {
  const stint = stints.find(
    (s) =>
      s.playerRef === playerRef &&
      s.fromMinute <= minute &&
      (s.toMinute === null || minute < s.toMinute),
  );
  return stint?.memberId ?? null;
}

/**
 * Active over [fromMinute, toMinute), so a 20'-30' boost no longer applies at 30'. Matching on
 * the manager as well as the player means a boosted player who is traded away mid-window does
 * not carry the boost to the new owner.
 */
export function activeKindsAt(
  powerUps: readonly PowerUpWindow[],
  memberId: string,
  playerRef: string,
  minute: number,
): PowerUpKind[] {
  return powerUps
    .filter(
      (p) =>
        p.memberId === memberId &&
        p.playerRef === playerRef &&
        p.fromMinute <= minute &&
        minute < p.toMinute,
    )
    .map((p) => p.kind);
}
