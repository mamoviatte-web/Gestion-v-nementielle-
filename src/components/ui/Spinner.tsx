import { clsx } from 'clsx';
import { Loader2 } from 'lucide-react';

interface SpinnerProps {
  className?: string;
  label?: string;
  /** Centre le spinner dans un bloc de hauteur confortable. */
  fullPage?: boolean;
}

/** Indicateur de chargement. */
export function Spinner({ className, label, fullPage = false }: SpinnerProps) {
  const spinner = (
    <span className="inline-flex items-center gap-2 text-pr-olive">
      <Loader2 className={clsx('h-5 w-5 animate-spin', className)} aria-hidden />
      {label && <span className="text-sm text-pr-black-soft">{label}</span>}
    </span>
  );

  if (fullPage) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center" role="status">
        {spinner}
      </div>
    );
  }
  return spinner;
}
