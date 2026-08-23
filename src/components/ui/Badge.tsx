import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import type { StatusTone } from '@/lib/types';

/** Couleurs par tonalité de statut (cf. ST_COLORS / TC_COLORS du prototype). */
/* Alignées sur les jetons du système visuel homogène (statuts apaisés). */
const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: 'bg-[#f1f0ec] text-[#6a6961] ring-[#e7e5df]',
  info: 'bg-[var(--accent-soft)] text-[var(--accent-ink)] ring-[var(--accent-border)]',
  success: 'bg-[var(--good-bg)] text-[var(--good)] ring-[#d6e8dd]',
  warning: 'bg-[var(--warn-bg)] text-[var(--warn)] ring-[#ecdcae]',
  danger: 'bg-[var(--crit-bg)] text-[var(--crit)] ring-[#ecd3ca]',
};

interface BadgeProps {
  children: ReactNode;
  tone?: StatusTone;
  className?: string;
}

/** Pastille de statut colorée. */
export function Badge({ children, tone = 'neutral', className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
