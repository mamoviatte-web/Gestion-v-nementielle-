/**
 * useMatchLiveStatus — suivi live d'un match par espace (ROLE_STADE).
 * Lit la vue match_live_status et se réabonne en Realtime aux mutations des
 * tables clés (stock, sessions, horaires) pour rafraîchir automatiquement.
 * Dégrade proprement si la vue n'est pas encore appliquée (retourne []).
 */

import { useCallback, useEffect, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export interface SpaceLiveStatus {
  event_id: string;
  space_id: string;
  space_name: string;
  service_type: string | null;
  active_sessions: number;
  last_staff_name: string | null;
  last_activity: string | null;
  has_initial: boolean;
  has_reassort: boolean;
  has_final: boolean;
  total_initial: number;
  total_reassort: number;
  total_final: number;
  total_consumed_est: number;
  schedules_done: number;
  schedules_total: number;
  stock_status: 'en_attente' | 'en_cours' | 'clôturé';
}

export function useMatchLiveStatus(eventId: string) {
  const [spaces, setSpaces] = useState<SpaceLiveStatus[]>([]);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    const { data, error } = await supabase
      .from('match_live_status')
      .select('*')
      .eq('event_id', eventId)
      .order('service_type')
      .order('space_name');
    if (error) {
      // Vue absente (migration non appliquée) → dégradation silencieuse.
      if (/does not exist|schema cache|PGRST20/i.test(error.message)) setAvailable(false);
    } else {
      setSpaces((data ?? []) as SpaceLiveStatus[]);
    }
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    void fetchStatus();

    const channel: RealtimeChannel = supabase
      .channel(`match-live-${eventId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_stock_lines', filter: `event_id=eq.${eventId}` }, () => void fetchStatus())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_access_sessions', filter: `event_id=eq.${eventId}` }, () => void fetchStatus())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'schedules', filter: `event_id=eq.${eventId}` }, () => void fetchStatus())
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [eventId, fetchStatus]);

  return { spaces, available, loading, refetch: fetchStatus };
}
