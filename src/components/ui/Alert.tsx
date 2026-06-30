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
  info: { icon: Info, classes: 'bg-pr-stone/50 text-pr-black-soft ring-pr-stone' },
  warning: {
    icon: AlertTriangle,
    classes: 'bg-[#F5EBD2] text-[#8A6D1F] ring-[#E8D6A8]',
  },
  error: { icon: XCircle, classes: 'bg-[#F1E0D7] text-pr-rust ring-[#E2C5B6]' },
  success: {
    icon: CheckCircle2,
    classes: 'bg-[#EDEFE6] text-pr-olive-dark ring-[#D8DEC6]',
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
