import { clsx } from 'clsx';
import { forwardRef, type InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string | null;
  hint?: string;
}

/** Champ texte avec label et message d'erreur. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, id, className, ...props },
  ref,
) {
  const inputId = id ?? props.name;
  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={inputId}
          className="mb-1 block text-sm font-medium text-pr-black-soft/80"
        >
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        className={clsx(
          'block w-full rounded-lg border-0 px-3 py-2 text-pr-black shadow-sm ring-1 ring-inset',
          'placeholder:text-pr-black-soft/45 focus:ring-2 focus:ring-inset focus:ring-provence',
          error ? 'ring-red-400' : 'ring-pr-stone',
          className,
        )}
        aria-invalid={error ? true : undefined}
        {...props}
      />
      {error ? (
        <p className="mt-1 text-sm text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-sm text-pr-black-soft/50">{hint}</p>
      ) : null}
    </div>
  );
});
