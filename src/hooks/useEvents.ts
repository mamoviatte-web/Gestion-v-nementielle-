/**
 * Hooks événements — Stade Maurice David.
 *
 * - useEventsList()        : liste des événements (admin).
 * - useEvent(eventId)      : un événement.
 * - useEventSpaces(id)     : espaces activés (jointure spaces) — admin.
 * - useOpenEventForSpace() : événement ouvert visible par un Responsable.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Event, EventSpace, EventStatus, Space } from '@/lib/types';

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
 * Mutations de statut d'événement (ROLE_STADE). « Passer en cours » et
 * « Clôturer » (RG-006 — la RLS réserve déjà l'écriture sur events au Stade).
 */
export function useEventActions(eventId: string | undefined) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (status: EventStatus) => {
      if (!eventId) throw new Error('Événement manquant.');
      const { error } = await supabase
        .from('events')
        .update({ status })
        .eq('event_id', eventId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['event', eventId] });
      void queryClient.invalidateQueries({ queryKey: ['events'] });
    },
  });
  return {
    setStatus: (status: EventStatus) => mutation.mutateAsync(status),
    updating: mutation.isPending,
  };
}

/**
 * Événements ouverts visibles par un Responsable (triés par date décroissante).
 * La RLS restreint déjà aux événements dont l'espace du Responsable fait
 * partie ; on filtre ici sur les statuts ouverts. Un sélecteur côté UI permet
 * de choisir l'événement si plusieurs sont ouverts simultanément.
 */
export function useOpenEventsForSpace(spaceId: string | undefined) {
  return useQuery({
    queryKey: ['openEvents', spaceId],
    enabled: !!spaceId,
    queryFn: async (): Promise<Event[]> => {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .in('status', OPEN_STATUSES)
        .order('event_date', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Event[];
    },
  });
}
