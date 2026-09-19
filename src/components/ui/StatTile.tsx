import { clsx } from 'clsx';
import type { ReactNode } from 'react';

/** Tuile KPI homogène : libellé en petites capitales + valeur display + sous-texte. */
export function StatTile({
  label,
  value,
  sub,
  tone = 'default',
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'good' | 'warn' | 'crit';
  className?: string;
}) {
  const valueColor =
    tone === 'good' ? 'text-pr-olive-dark'
      : tone === 'crit' ? 'text-pr-rust'
        : tone === 'warn' ? 'text-pr-gold'
          : 'text-pr-black';
  return (
    <div className={clsx('rounded-xl border border-pr-stone bg-white px-3.5 py-2.5', className)}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-pr-black-soft/45">{label}</p>
      <p className={clsx('font-display text-lg font-black tabular-nums', valueColor)}>{value}</p>
      {sub != null && <p className="mt-0.5 text-xs text-pr-black-soft/50">{sub}</p>}
    </div>
  );
}
