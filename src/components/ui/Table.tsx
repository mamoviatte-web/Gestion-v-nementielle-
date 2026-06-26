import { clsx } from 'clsx';
import type { ReactNode, TableHTMLAttributes } from 'react';

interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  children: ReactNode;
}

/** Conteneur de table responsive (scroll horizontal sur mobile). */
export function Table({ children, className, ...props }: TableProps) {
  return (
    <div className="w-full overflow-x-auto rounded-lg ring-1 ring-slate-200">
      <table
        className={clsx('w-full divide-y divide-slate-200 text-sm', className)}
        {...props}
      >
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="bg-slate-50">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-slate-100 bg-white">{children}</tbody>;
}

export function TFoot({ children }: { children: ReactNode }) {
  return (
    <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-medium">
      {children}
    </tfoot>
  );
}

export function TR({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={className}>{children}</tr>;
}

export function TH({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={clsx(
        'px-3 py-2.5 text-left font-semibold text-slate-600',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function TD({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return <td className={clsx('px-3 py-2.5 text-slate-700', className)}>{children}</td>;
}
