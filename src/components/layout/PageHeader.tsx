import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

/** En-tête de page standard (titre + description + action optionnelle). */
export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-pr-black">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-pr-black-soft/50">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
