import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import {
  Info,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react';

export type AlertVariant = 'info' | 'warning' | 'error' | 'success';

const CONFIG: Record<AlertVariant, { icon: LucideIcon; classes: string }> = {
  info: { icon: Info, classes: 'bg-blue-50 text-blue-800 ring-blue-200' },
  warning: {
    icon: AlertTriangle,
    classes: 'bg-amber-50 text-amber-800 ring-amber-200',
  },
  error: { icon: XCircle, classes: 'bg-red-50 text-red-800 ring-red-200' },
  success: {
    icon: CheckCircle2,
    classes: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  },
};

interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  children?: ReactNode;
  className?: string;
}

/** Encart d'information / avertissement / erreur / succès. */
export function Alert({ variant = 'info', title, children, className }: AlertProps) {
  const { icon: Icon, classes } = CONFIG[variant];
  return (
    <div
      className={clsx(
        'flex gap-3 rounded-lg p-3 text-sm ring-1 ring-inset',
        classes,
        className,
      )}
      role={variant === 'error' ? 'alert' : 'status'}
    >
      <Icon className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden />
      <div>
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={clsx(title && 'mt-0.5')}>{children}</div>}
      </div>
    </div>
  );
}
