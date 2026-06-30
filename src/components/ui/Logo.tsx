import { clsx } from 'clsx';

interface LogoProps {
  /** full = rameau + texte ; mark = rameau seul ; mark-white = rameau blanc. */
  variant?: 'full' | 'mark' | 'mark-white';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const MARK_SIZE: Record<NonNullable<LogoProps['size']>, number> = {
  sm: 24,
  md: 40,
  lg: 96,
};

/** Rameau d'olivier (silhouette pleine, monochrome via currentColor). */
function Sprig({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden
      className="shrink-0"
    >
      <defs>
        <path id="prleafC" d="M0 0 C 2.6 -4 2.6 -13 0 -18 C -2.6 -13 -2.6 -4 0 0 Z" fill="currentColor" />
      </defs>
      <path
        d="M32 60 C 28 48 28 34 31 22 C 32.5 16 32 11 32 7"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        fill="none"
      />
      <ellipse cx="27.5" cy="52" rx="4.2" ry="5.2" fill="currentColor" />
      <use href="#prleafC" transform="translate(30 46) rotate(-36) scale(0.95)" />
      <use href="#prleafC" transform="translate(34 43) rotate(34) scale(0.95)" />
      <use href="#prleafC" transform="translate(29.5 39) rotate(-28)" />
      <use href="#prleafC" transform="translate(34.5 36) rotate(27)" />
      <use href="#prleafC" transform="translate(30 31) rotate(-21)" />
      <use href="#prleafC" transform="translate(34 28) rotate(20)" />
      <use href="#prleafC" transform="translate(31 23) rotate(-13)" />
      <use href="#prleafC" transform="translate(33 20) rotate(12)" />
      <use href="#prleafC" transform="translate(32 14) rotate(0) scale(0.9)" />
    </svg>
  );
}

/** Logo Provence Rugby (rameau d'olivier monochrome). */
export function Logo({ variant = 'full', size = 'md', className }: LogoProps) {
  const px = MARK_SIZE[size];

  if (variant === 'full') {
    return (
      <div className={clsx('flex flex-col items-center text-pr-black', className)}>
        <Sprig size={MARK_SIZE.lg} />
        <div className="mt-2 text-center font-display font-black leading-none tracking-[0.18em] text-pr-black">
          <div className="text-2xl">PROVENCE</div>
          <div className="text-2xl tracking-[0.34em]">RUGBY</div>
        </div>
      </div>
    );
  }

  return (
    <span className={clsx(variant === 'mark-white' ? 'text-pr-white' : 'text-pr-black', className)}>
      <Sprig size={px} />
    </span>
  );
}
