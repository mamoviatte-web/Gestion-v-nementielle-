import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import type { StatusTone } from '@/lib/types';

/** Couleurs par tonalité de statut (cf. ST_COLORS / TC_COLORS du prototype). */
const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: 'bg-pr-stone/60 text-pr-black-soft ring-pr-stone',
  info: 'bg-pr-stone text-pr-black ring-pr-stone',
  success: 'bg-[#EDEFE6] text-pr-olive-dark ring-[#D8DEC6]',
  warning: 'bg-[#F5EBD2] text-[#8A6D1F] ring-[#E8D6A8]',
  danger: 'bg-[#F1E0D7] text-pr-rust ring-[#E2C5B6]',
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
