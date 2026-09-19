import { clsx } from 'clsx';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** Titre de section homogène : petites capitales apaisées + icône + zone d'action à droite. */
export function SectionTitle({
  icon: Icon,
  children,
  right,
  className,
}: {
  icon?: LucideIcon;
  children: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('mb-3 flex items-center justify-between gap-2', className)}>
      <h2 className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-pr-black-soft/60">
        {Icon && <Icon className="h-4 w-4 text-pr-black-soft/40" />}
        {children}
      </h2>
      {right}
    </div>
  );
}
