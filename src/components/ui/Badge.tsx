import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import type { StatusTone } from '@/lib/types';

/** Couleurs par tonalité de statut (cf. ST_COLORS / TC_COLORS du prototype). */
const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  info: 'bg-blue-100 text-blue-700 ring-blue-200',
  success: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-100 text-amber-800 ring-amber-200',
  danger: 'bg-red-100 text-red-700 ring-red-200',
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
