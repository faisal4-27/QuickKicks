import type { RoomSnapshot, Team } from '@quickkicks/shared';
import { useEffect, type ReactNode } from 'react';

/** Particles that belong to the surname: van Dijk, De Bruyne, dos Santos. */
const PARTICLES = new Set(['mac', 'van', 'von', 'de', 'da', 'di', 'do', 'dos', 'das', 'del', 'der', 'den', 'le', 'la', 'ten', 'ter']);

/** Surname only, which is how shirts, pills and chips name a player. */
export function surname(fullName: string | undefined): string {
  if (!fullName) return 'Unknown';
  const parts = fullName.trim().split(/\s+/);
  let start = parts.length - 1;
  // Stop at index 1 so a first name is never swallowed, whatever it happens to be.
  while (start > 1 && PARTICLES.has(parts[start - 1]!.toLowerCase())) start -= 1;
  return parts.slice(start).join(' ');
}

export function teamFor(snapshot: RoomSnapshot, teamId: string): Team {
  return teamId === snapshot.fixture.homeTeam.id ? snapshot.fixture.homeTeam : snapshot.fixture.awayTeam;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]![0]}${parts[1]![0]}` : name.slice(0, 2);
  return letters.toUpperCase();
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const dims = size === 'sm' ? 'size-6 text-[0.65rem]' : 'size-9 text-sm';
  return (
    <span
      aria-hidden
      className={`${dims} grid shrink-0 place-items-center rounded-full border border-sky/60 bg-navy-700 font-display font-bold text-white`}
    >
      {initials(name)}
    </span>
  );
}

/** Small uppercase section label used across all three panels. */
export function SectionLabel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-mist ${className}`}>
      {children}
    </p>
  );
}

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ title, onClose, children }: ModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-navy-950/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-navy-600 bg-navy-850 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-navy-600 px-5 py-4">
          <h2 className="font-display text-xl font-bold uppercase tracking-wide text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-mist hover:bg-navy-700 hover:text-white"
          >
            Close
          </button>
        </header>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
