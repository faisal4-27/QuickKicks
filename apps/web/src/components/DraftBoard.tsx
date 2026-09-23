import { type RoomSnapshot, draftSchedule } from '@quickkicks/shared';

interface Props {
  snapshot: RoomSnapshot;
}

/**
 * The snake laid out as a grid: one column per manager, one row per round, with even rounds
 * visibly running the other way so the reversal is obvious rather than something you infer.
 */
export function DraftBoard({ snapshot }: Props) {
  const memberCount = snapshot.members.length;
  const rounds = snapshot.draft.rounds;
  const schedule = draftSchedule(memberCount, rounds);
  const pickByNumber = new Map(snapshot.draft.picks.map((p) => [p.pickNumber, p]));
  const playerById = new Map(snapshot.players.map((p) => [p.id, p]));
  const memberByPosition = new Map(snapshot.members.map((m) => [m.draftPosition, m]));
  const currentPickNumber = snapshot.draft.onTheClock?.pickNumber ?? null;

  return (
    <div className="draft-board">
      <div className="draft-board__grid" style={{ gridTemplateColumns: `repeat(${memberCount}, minmax(0, 1fr))` }}>
        {snapshot.members.map((member) => (
          <div key={member.id} className="draft-board__head">
            <span className={`dot ${member.connected ? 'is-online' : ''}`} />
            {member.displayName}
          </div>
        ))}

        {Array.from({ length: rounds }, (_, roundIndex) => {
          const round = roundIndex + 1;
          const cells = schedule.filter((s) => s.round === round);
          // Sort by draft position so each manager keeps a stable column.
          const byPosition = new Map(cells.map((c) => [c.draftPosition, c]));
          return Array.from({ length: memberCount }, (_, position) => {
            const cell = byPosition.get(position);
            if (!cell) return <div key={`${round}-${position}`} className="draft-board__cell" />;
            const pick = pickByNumber.get(cell.pickNumber);
            const player = pick ? playerById.get(pick.playerId) : undefined;
            const isCurrent = cell.pickNumber === currentPickNumber;
            return (
              <div
                key={`${round}-${position}`}
                className={`draft-board__cell ${pick ? 'is-filled' : ''} ${isCurrent ? 'is-current' : ''}`}
              >
                <span className="draft-board__pick-no">
                  R{round} · #{cell.pickNumber}
                </span>
                {player ? (
                  <>
                    <span className="draft-board__player">{player.fullName}</span>
                    <span className="draft-board__pos">
                      {player.position}
                      {pick?.wasAutopick ? ' · auto' : ''}
                    </span>
                  </>
                ) : (
                  <span className="draft-board__empty">
                    {isCurrent
                      ? `${memberByPosition.get(position)?.displayName ?? ''} on the clock`
                      : '—'}
                  </span>
                )}
              </div>
            );
          });
        })}
      </div>
    </div>
  );
}
