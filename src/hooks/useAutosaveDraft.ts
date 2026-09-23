/**
 * Sauvegarde locale de formulaire (offline-first RENFORCÉE).
 * Persiste `value` dans localStorage :
 *   - à CHAQUE changement (debounce léger 700 ms),
 *   - toutes les 30 s (filet),
 *   - et immédiatement quand l'appli passe en arrière-plan / se ferme
 *     (pagehide / visibilitychange / beforeunload) — critique sur mobile.
 * Fournit la restauration, l'effacement, et l'horodatage du dernier enregistrement.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const PREFIX = 'smd.draft.';
const AUTOSAVE_INTERVAL_MS = 30_000;
const DEBOUNCE_MS = 700;

export function useAutosaveDraft<T>(key: string, value: T) {
  const storageKey = PREFIX + key;
  const valueRef = useRef(value);
  valueRef.current = value;
  const suppressed = useRef(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const save = useCallback(() => {
    if (suppressed.current) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(valueRef.current));
      setLastSavedAt(Date.now());
    } catch {
      // Quota dépassé ou stockage indisponible — ignoré silencieusement.
    }
  }, [storageKey]);

  // Sauvegarde à chaque changement (debounce léger).
  useEffect(() => {
    const id = window.setTimeout(save, DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [value, save]);

  // Filet périodique (30 s).
  useEffect(() => {
    const id = window.setInterval(save, AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [save]);

  // Sauvegarde immédiate quand l'appli est masquée / fermée (mobile).
  useEffect(() => {
    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') save();
    };
    window.addEventListener('pagehide', save);
    window.addEventListener('beforeunload', save);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', save);
      window.removeEventListener('beforeunload', save);
      document.removeEventListener('visibilitychange', onVisibility);
      // Sauvegarde une dernière fois au démontage (changement de page interne).
      save();
    };
  }, [save]);

  const loadDraft = useCallback((): T | null => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }, [storageKey]);

  const clearDraft = useCallback(() => {
    suppressed.current = true; // évite qu'un save différé ne ressuscite le brouillon
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // ignoré
    }
    setLastSavedAt(null);
  }, [storageKey]);

  return { saveNow: save, loadDraft, clearDraft, lastSavedAt };
}
