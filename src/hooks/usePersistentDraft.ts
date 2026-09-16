/**
 * usePersistentDraft — état local persistant en localStorage (anti-perte de
 * saisie). La valeur survit à un rafraîchissement / changement de page et est
 * effacée explicitement à la validation. Robuste : si la clé change (ex. token
 * de session résolu de façon asynchrone), le brouillon est re-synchronisé.
 * Tout accès localStorage est protégé (private mode, quota, SSR).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export function usePersistentDraft<T>(
  key: string,
  initial: T,
): [T, (v: T | ((p: T) => T)) => void, () => void] {
  const read = (k: string): T => {
    try { const raw = localStorage.getItem(k); if (raw) return JSON.parse(raw) as T; } catch { /* indispo */ }
    return initial;
  };
  const [state, setState] = useState<T>(() => read(key));
  const keyRef = useRef(key);

  // Re-synchronise quand la clé devient disponible / change (token async).
  useEffect(() => {
    if (keyRef.current !== key) {
      keyRef.current = key;
      setState(read(key));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback((v: T | ((p: T) => T)) => {
    setState((prev) => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
      try { localStorage.setItem(keyRef.current, JSON.stringify(next)); } catch { /* indispo */ }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    try { localStorage.removeItem(keyRef.current); } catch { /* indispo */ }
  }, []);

  return [state, set, clear];
}
