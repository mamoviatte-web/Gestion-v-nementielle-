/**
 * Sauvegarde locale de formulaire (offline-first basique).
 * Persiste `value` dans localStorage toutes les 30 s et à chaque changement
 * (debounce léger). Fournit la restauration et l'effacement du brouillon.
 */

import { useCallback, useEffect, useRef } from 'react';

const PREFIX = 'smd.draft.';
const AUTOSAVE_INTERVAL_MS = 30_000;

export function useAutosaveDraft<T>(key: string, value: T) {
  const storageKey = PREFIX + key;
  const valueRef = useRef(value);
  valueRef.current = value;

  const save = useCallback(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(valueRef.current));
    } catch {
      // Quota dépassé ou stockage indisponible — ignoré silencieusement.
    }
  }, [storageKey]);

  // Sauvegarde périodique (30 s).
  useEffect(() => {
    const id = window.setInterval(save, AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(id);
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
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // ignoré
    }
  }, [storageKey]);

  return { saveNow: save, loadDraft, clearDraft };
}
