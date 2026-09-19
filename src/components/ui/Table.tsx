import { clsx } from 'clsx';
import type { ReactNode, TableHTMLAttributes } from 'react';

interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  children: ReactNode;
}

/** Conteneur de table responsive (scroll horizontal sur mobile).
 *  Palette Provence homogène : anneau stone, en-tête crème, texte apaisé. */
export function Table({ children, className, ...props }: TableProps) {
  return (
    <div className="w-full overflow-x-auto rounded-xl ring-1 ring-pr-stone">
      <table
        className={clsx('w-full text-sm', className)}
        {...props}
      >
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="bg-pr-cream">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-pr-stone/60 bg-white">{children}</tbody>;
}

export function TFoot({ children }: { children: ReactNode }) {
  return (
    <tfoot className="border-t-2 border-pr-stone bg-pr-cream font-semibold text-pr-black">
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
        'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-pr-black-soft/45',
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
  return <td className={clsx('px-3 py-2.5 text-pr-black-soft/80', className)}>{children}</td>;
}
