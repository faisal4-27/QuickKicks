import type { FixtureView } from '@quickkicks/shared';

/** "Premier League · Sat 27 Sep, 15:00", or "Simulated match" for a mock fixture. */
export function fixtureMeta(fixture: FixtureView): string {
  const kickoff = fixture.kickoffAt
    ? new Date(fixture.kickoffAt).toLocaleString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Simulated match';
  return fixture.competition ? `${fixture.competition} · ${kickoff}` : kickoff;
}
