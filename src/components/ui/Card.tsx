import { clsx } from 'clsx';
import type { ElementType, ReactNode } from 'react';

/**
 * Card — surface blanche homogène (remplace les ~500 blocs
 * `rounded-* border bg-white` bricolés). Palette Provence.
 *  - `accent` : liseré gauche coloré (or / olive / terre cuite) pour signaler.
 *  - `pad` : densité intérieure (`sm` compact, `md` défaut, `none` pour tables).
 */
type Accent = 'none' | 'gold' | 'olive' | 'rust';
const ACCENT: Record<Accent, string> = {
  none: 'border-pr-stone',
  gold: 'border-pr-stone border-l-4 border-l-pr-gold',
  olive: 'border-pr-stone border-l-4 border-l-pr-olive',
  rust: 'border-pr-stone border-l-4 border-l-pr-rust',
};
const PAD = { none: '', sm: 'p-3', md: 'p-4 sm:p-5' } as const;

export function Card({
  children,
  className,
  accent = 'none',
  pad = 'md',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  accent?: Accent;
  pad?: keyof typeof PAD;
  as?: ElementType;
}) {
  return (
    <Tag className={clsx('rounded-2xl border bg-white', ACCENT[accent], PAD[pad], className)}>
      {children}
    </Tag>
  );
}
