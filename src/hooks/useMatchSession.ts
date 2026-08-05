/**
 * useMatchSession — session responsable de zone (flux token /zone/match/:token).
 * Charge get_match_session (SECURITY DEFINER, sans login). Partagé par toutes
 * les pages zone. `rpc` typé pour appeler les fonctions zone_* côté serveur.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useSessionHeartbeat } from '@/hooks/useSessionHeartbeat';

export interface MatchSession {
  success: boolean;
  session_token: string;
  event_id: string;
  event_name: string;
  event_date: string;
  match_access_code: string | null;
  space_id: string;
  space_name: string;
  service_type: 'vip' | 'bar' | 'buvette' | 'bodega' | null;
  staff_name: string;
  error?: string;
}

export function useMatchSession() {
  const { sessionToken } = useParams<{ sessionToken: string }>();
  const [session, setSession] = useState<MatchSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!sessionToken) return;
      const { data } = await supabase.rpc('get_match_session', { p_token: sessionToken });
      if (!cancelled) {
        setSession(data as MatchSession | null);
        setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionToken]);

  // Présence live : heartbeat pour toutes les pages zone (centralisé ici).
  useSessionHeartbeat(sessionToken);

  return { token: sessionToken ?? '', session, loading };
}
