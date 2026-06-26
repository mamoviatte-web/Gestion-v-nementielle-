/**
 * Hooks événements — Stade Maurice David.
 *
 * - useEventsList()        : liste des événements (admin).
 * - useEvent(eventId)      : un événement.
 * - useEventSpaces(id)     : espaces activés (jointure spaces) — admin.
 * - useOpenEventForSpace() : événement ouvert visible par un Responsable.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Event, EventSpace, Space } from '@/lib/types';

/** Statuts considérés comme « ouverts » côté Responsable. */
const OPEN_STATUSES = ['préparé', 'en_cours', 'clôture_en_attente'];

export function useEventsList() {
  return useQuery({
    queryKey: ['events'],
    queryFn: async (): Promise<Event[]> => {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .order('event_date', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Event[];
    },
  });
}

export function useEvent(eventId: string | undefined) {
  return useQuery({
    queryKey: ['event', eventId],
    enabled: !!eventId,
    queryFn: async (): Promise<Event | null> => {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('event_id', eventId)
        .maybeSingle();
      if (error) throw error;
      return (data as Event | null) ?? null;
    },
  });
}

/** Espace activé sur un événement, enrichi de l'espace (admin). */
export interface EventSpaceWithSpace extends EventSpace {
  spaces: Space | null;
}

export function useEventSpaces(eventId: string | undefined) {
  return useQuery({
    queryKey: ['eventSpaces', eventId],
    enabled: !!eventId,
    queryFn: async (): Promise<EventSpaceWithSpace[]> => {
      const { data, error } = await supabase
        .from('event_spaces')
        .select('*, spaces(*)')
        .eq('event_id', eventId);
      if (error) throw error;
      return (data ?? []) as EventSpaceWithSpace[];
    },
  });
}

/**
 * Événement ouvert pour l'espace du Responsable. La RLS restreint déjà aux
 * événements dont l'espace fait partie ; on filtre sur les statuts ouverts
 * et on retient le plus proche.
 */
export function useOpenEventForSpace(spaceId: string | undefined) {
  return useQuery({
    queryKey: ['openEvent', spaceId],
    enabled: !!spaceId,
    queryFn: async (): Promise<Event | null> => {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .in('status', OPEN_STATUSES)
        .order('event_date', { ascending: true });
      if (error) throw error;
      const events = (data ?? []) as Event[];
      return events[0] ?? null;
    },
  });
}
