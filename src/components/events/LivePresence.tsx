/**
 * LivePresence — présence temps réel des responsables de zone (côté admin).
 * Badges verts pulsants pour les connectés, gris pour les récemment déconnectés
 * (< 5 min). Aucun rechargement : Supabase Realtime + rafraîchissement de
 * fraîcheur toutes les 20 s (une session « stale » n'émet aucun event DB).
 *
 * Réconciliation schéma : l'icône d'espace dérive de spaceProfile(space_name)
 * (9 profils) et NON de service_type (limité à vip/bar/buvette/bodega).
 * PostgREST sérialise les jointures ; on remonte l'espace via space:spaces(...).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { spaceProfile, type SpaceProfile } from '@/lib/eventUtils';

interface Session {
  id: string;
  staff_name: string;
  space_name: string;
  profile: SpaceProfile | null;
  is_active: boolean;
  last_active_at: string;
}

const ONLINE_THRESHOLD_MS = 45_000; // ping < 45 s → en ligne
const RECENT_WINDOW_MS = 5 * 60 * 1000; // déconnecté < 5 min → encore affiché

const PROFILE_ICON: Record<SpaceProfile, string> = {
  salon: '⭐', loge: '🏆', wine_bar: '🍷', club: '🎵', bodega: '🎭',
  bar_pub: '🍺', pmr: '♿', terrasse: '🌿', buvette: '🥤',
};

function isOnline(s: Session): boolean {
  return s.is_active && Date.now() - new Date(s.last_active_at).getTime() < ONLINE_THRESHOLD_MS;
}

function timeSince(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min`;
  return `${Math.floor(diff / 3600)}h`;
}

export function LivePresence({ eventId }: { eventId: string }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [newlyAdded, setNewlyAdded] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const onlineIds = useRef<Set<string>>(new Set());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const flash = useCallback((id: string, setter: typeof setNewlyAdded, ms: number) => {
    setter((prev) => new Set(prev).add(id));
    const t = setTimeout(() => setter((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    }), ms);
    timers.current.push(t);
  }, []);

  const fetchSessions = useCallback(async () => {
    const { data } = await supabase
      .from('match_access_sessions')
      .select('id, staff_name, is_active, last_active_at, space:spaces(space_name)')
      .eq('event_id', eventId)
      .order('last_active_at', { ascending: false });

    const mapped: Session[] = (data ?? []).map((s) => {
      const spaceName = (s.space as { space_name?: string } | null)?.space_name ?? '—';
      return {
        id: String(s.id),
        staff_name: String(s.staff_name),
        space_name: spaceName,
        profile: spaceName === '—' ? null : spaceProfile(spaceName),
        is_active: Boolean(s.is_active),
        last_active_at: String(s.last_active_at),
      };
    });

    // Diff vs état précédent → animations d'entrée / sortie.
    const nowOnline = new Set(mapped.filter(isOnline).map((s) => s.id));
    nowOnline.forEach((id) => { if (!onlineIds.current.has(id)) flash(id, setNewlyAdded, 800); });
    onlineIds.current.forEach((id) => { if (!nowOnline.has(id)) flash(id, setRemoving, 500); });
    onlineIds.current = nowOnline;

    setSessions(mapped);
  }, [eventId, flash]);

  useEffect(() => {
    if (!eventId) return;
    void fetchSessions();

    const channel: RealtimeChannel = supabase
      .channel(`presence-event-${eventId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'match_access_sessions', filter: `event_id=eq.${eventId}` },
        () => void fetchSessions(),
      )
      .subscribe();

    // Re-évalue la fraîcheur (staleness) même sans event DB.
    const timer = setInterval(() => void fetchSessions(), 20_000);
    const localTimers = timers.current;

    return () => {
      void supabase.removeChannel(channel);
      clearInterval(timer);
      localTimers.forEach(clearTimeout);
    };
  }, [eventId, fetchSessions]);

  const online = sessions.filter(isOnline);
  const recent = sessions.filter(
    (s) => !isOnline(s) && Date.now() - new Date(s.last_active_at).getTime() < RECENT_WINDOW_MS,
  );

  return (
    <div className="mt-4 space-y-3 border-t border-pr-stone/60 pt-4">
      {/* Compteur + dot pulsant */}
      <div className="flex items-center gap-2">
        {online.length > 0 ? (
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
          </span>
        ) : (
          <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
        )}
        <span className="text-xs font-bold uppercase tracking-wide text-stone-500">
          {online.length > 0
            ? `${online.length} responsable${online.length > 1 ? 's' : ''} connecté${online.length > 1 ? 's' : ''}`
            : 'Aucun responsable connecté'}
        </span>
      </div>

      {/* Badges connectés */}
      {online.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {online.map((s) => (
            <div
              key={s.id}
              className={`flex items-center gap-2 rounded-full border bg-white px-3 py-1.5 shadow-sm transition-all duration-500 ${
                newlyAdded.has(s.id) ? 'scale-110 border-green-300 bg-green-50 shadow-green-100' : 'scale-100 border-stone-200'
              }`}
            >
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative h-2 w-2 rounded-full bg-green-500" />
              </span>
              <span className="text-sm">{s.profile ? PROFILE_ICON[s.profile] : '👤'}</span>
              <span className="leading-tight">
                <span className="text-xs font-bold text-stone-900">{s.staff_name?.split(' ')[0] ?? s.staff_name}</span>
                <span className="ml-1.5 text-xs text-stone-400">{s.space_name}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Récemment déconnectés (< 5 min) */}
      {recent.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {recent.map((s) => (
            <div
              key={s.id}
              className={`flex items-center gap-2 rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 transition-all duration-500 ${
                removing.has(s.id) ? 'scale-95 opacity-0' : 'scale-100 opacity-60'
              }`}
            >
              <span className="h-2 w-2 shrink-0 rounded-full bg-stone-300" />
              <span className="text-sm">{s.profile ? PROFILE_ICON[s.profile] : '👤'}</span>
              <span className="text-xs text-stone-500">
                {s.staff_name?.split(' ')[0]} · {s.space_name}
              </span>
              <span className="text-[10px] text-stone-400">il y a {timeSince(s.last_active_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
