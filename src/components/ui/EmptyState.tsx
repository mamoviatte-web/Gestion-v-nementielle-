import type { ReactNode } from 'react';
import { Inbox, type LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  message?: string;
  action?: ReactNode;
}

/** État vide avec icône, titre et message. */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  message,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-pr-stone bg-white px-6 py-12 text-center">
      <Icon className="h-10 w-10 text-pr-black-soft/45" aria-hidden />
      <h3 className="mt-3 text-sm font-semibold text-pr-black">{title}</h3>
      {message && <p className="mt-1 max-w-sm text-sm text-pr-black-soft/50">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
