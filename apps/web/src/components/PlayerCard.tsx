import type { Player, Team } from '@quickkicks/shared';
import type { ReactNode } from 'react';

interface Props {
  player: Player;
  team: Team | undefined;
  disabled?: boolean;
  selected?: boolean;
  onClick?: () => void;
  footer?: ReactNode;
}

export function PlayerCard({ player, team, disabled, selected, onClick, footer }: Props) {
  const className = [
    'player-card',
    `pos-${player.position.toLowerCase()}`,
    selected ? 'is-selected' : '',
    disabled ? 'is-disabled' : '',
    onClick ? 'is-clickable' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type="button" className={className} disabled={disabled} onClick={onClick}>
      <span className="player-card__position">{player.position}</span>
      <span className="player-card__body">
        <span className="player-card__name">{player.fullName}</span>
        <span className="player-card__meta">
          {team?.shortName ?? '---'}
          {player.shirtNumber === null ? '' : ` · #${player.shirtNumber}`}
          {` · ${player.rating}`}
        </span>
      </span>
      {footer ? <span className="player-card__footer">{footer}</span> : null}
    </button>
  );
}
