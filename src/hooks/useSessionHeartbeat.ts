/**
 * useSessionHeartbeat — maintient la présence live d'un responsable de zone.
 *   • ping_session toutes les ~25 s (met à jour last_active_at + réactive)
 *   • leave_session à la fermeture d'onglet (sendBeacon, part même si la page
 *     se ferme) et à l'unmount (navigation interne React)
 *
 * Intégré dans useMatchSession → toutes les pages zone en bénéficient
 * automatiquement, sans appel manuel par page.
 *
 * Note sendBeacon : impossible de poser des en-têtes → la clé anon passe en
 * query param `?apikey=`. leave_session est SECURITY DEFINER accordée à anon.
 */

import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';

const PING_INTERVAL_MS = 25_000;

export function useSessionHeartbeat(token: string | null | undefined) {
  useEffect(() => {
    if (!token) return;

    const ping = () => void supabase.rpc('ping_session', { p_token: token });
    ping(); // ping immédiat à l'arrivée
    const interval = setInterval(ping, PING_INTERVAL_MS);

    // Déconnexion propre même si l'onglet se ferme (headers impossibles → apikey en query).
    const beaconLeave = () => {
      const base = import.meta.env.VITE_SUPABASE_URL;
      const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (!base || !anon) return;
      const url = `${base}/rest/v1/rpc/leave_session?apikey=${anon}`;
      const blob = new Blob([JSON.stringify({ p_token: token })], { type: 'application/json' });
      navigator.sendBeacon(url, blob);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') ping();
    };

    window.addEventListener('beforeunload', beaconLeave);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', beaconLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      // Navigation interne (unmount) → déconnexion propre via RPC standard.
      void supabase.rpc('leave_session', { p_token: token });
    };
  }, [token]);
}
