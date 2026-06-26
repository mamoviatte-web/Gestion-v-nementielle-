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
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <Icon className="h-10 w-10 text-slate-400" aria-hidden />
      <h3 className="mt-3 text-sm font-semibold text-slate-900">{title}</h3>
      {message && <p className="mt-1 max-w-sm text-sm text-slate-500">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
