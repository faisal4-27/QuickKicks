import { useId } from 'react';
import type { Kit } from '../../lib/teamKits.js';

interface Props {
  kit: Kit;
  number: number | null;
  /** Adds a sky-blue glow while a power-up is running on this player. */
  boosted?: boolean;
  className?: string;
}

/** A flat home shirt: body in the team colour, contrasting sleeves and collar, number on the front. */
export function Jersey({ kit, number, boosted = false, className }: Props) {
  // Several jerseys share a page, so gradient and filter ids must be unique per instance.
  const id = useId().replace(/:/g, '');

  return (
    <svg
      viewBox="0 0 200 190"
      role="img"
      aria-label={number === null ? 'Team shirt' : `Shirt number ${number}`}
      className={className}
    >
      <defs>
        <linearGradient id={`shade-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.12" />
          <stop offset="0.55" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.22" />
        </linearGradient>
        <filter id={`glow-${id}`} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0" stdDeviation="7" floodColor="#4da6ff" floodOpacity="0.85" />
        </filter>
        <filter id={`drop-${id}`} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="10" stdDeviation="9" floodColor="#000000" floodOpacity="0.45" />
        </filter>
      </defs>

      <g filter={`url(#${boosted ? 'glow' : 'drop'}-${id})`}>
        {/* Sleeves sit behind the body so its shoulder line stays crisp. */}
        <path d="M84 24 L58 36 L22 70 L46 96 L64 80 Z" fill={kit.trim} />
        <path d="M116 24 L142 36 L178 70 L154 96 L136 80 Z" fill={kit.trim} />
        <path
          d="M62 36 L86 24 C92 36 108 36 114 24 L138 36 L140 176 C114 182 86 182 60 176 Z"
          fill={kit.body}
        />
        <path
          d="M62 36 L86 24 C92 36 108 36 114 24 L138 36 L140 176 C114 182 86 182 60 176 Z"
          fill={`url(#shade-${id})`}
        />
        {/* Collar and neck opening. */}
        <path d="M84 23 C90 40 110 40 116 23 C110 30 90 30 84 23 Z" fill={kit.trim} />
        <ellipse cx="100" cy="22" rx="15" ry="6" fill="#0a1628" />
      </g>

      {number === null ? null : (
        <text
          x="100"
          y="138"
          textAnchor="middle"
          fontFamily="'Barlow Condensed', sans-serif"
          fontWeight={800}
          fontSize="64"
          fill={kit.ink}
        >
          {number}
        </text>
      )}
    </svg>
  );
}
