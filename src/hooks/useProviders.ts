/**
 * Hook useProviders — module prestataires (Phase 4, CDC §7).
 *
 * Le statut est recalculé côté applicatif via computeProviderStatus (RG-008 :
 * retard > 15 min → en_retard) à chaque saisie d'horaire réel.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { computeProviderStatus } from '@/lib/calculations';
import type { ProviderPresence, ProviderStatus, ProviderType } from '@/lib/types';

/** Statistiques de présence par statut. */
export interface ProviderStats {
  prévu: number;
  présent: number;
  en_retard: number;
  terminé: number;
  absent: number;
  annulé: number;
  total: number;
}

/** Compte les prestataires par statut (statut recalculé — RG-008). */
export function computeStats(providers: ProviderPresence[]): ProviderStats {
  const stats: ProviderStats = {
    prévu: 0,
    présent: 0,
    en_retard: 0,
    terminé: 0,
    absent: 0,
    annulé: 0,
    total: providers.length,
  };
  for (const p of providers) {
    stats[computeProviderStatus(p)] += 1;
  }
  return stats;
}

/** Données de création d'un prestataire. */
export interface NewProvider {
  provider_company: string;
  provider_type: ProviderType;
  space_id: string | null;
  provider_contact_name?: string | null;
  provider_phone?: string | null;
  planned_arrival_time?: string | null;
  planned_end_time?: string | null;
}

export function useProviders(eventId: string | undefined) {
  const queryClient = useQueryClient();

  const providers = useQuery({
    queryKey: ['providers', eventId],
    enabled: !!eventId,
    queryFn: async (): Promise<ProviderPresence[]> => {
      const { data, error } = await supabase
        .from('provider_presence')
        .select('*')
        .eq('event_id', eventId)
        .order('provider_company', { ascending: true });
      if (error) throw error;
      return (data ?? []) as ProviderPresence[];
    },
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['providers', eventId] });
    void queryClient.invalidateQueries({ queryKey: ['lateProviders'] });
  }

  const addMutation = useMutation({
    mutationFn: async (data: NewProvider) => {
      if (!eventId) throw new Error('Événement manquant.');
      if (!data.provider_company.trim()) throw new Error('Société obligatoire.');
      const { error } = await supabase.from('provider_presence').insert({
        event_id: eventId,
        space_id: data.space_id,
        provider_company: data.provider_company.trim(),
        provider_type: data.provider_type,
        provider_contact_name: data.provider_contact_name || null,
        provider_phone: data.provider_phone || null,
        planned_arrival_time: data.planned_arrival_time || null,
        planned_end_time: data.planned_end_time || null,
        status: 'prévu',
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  /** Met à jour des champs et recalcule le statut (RG-008). */
  const updateMutation = useMutation({
    mutationFn: async (vars: { id: string; fields: Partial<ProviderPresence> }) => {
      const current = (providers.data ?? []).find(
        (p) => p.provider_presence_id === vars.id,
      );
      if (!current) throw new Error('Prestataire introuvable.');
      const merged: ProviderPresence = { ...current, ...vars.fields };
      // Statut explicite (absent/annulé) prioritaire, sinon recalcul.
      const status: ProviderStatus =
        vars.fields.status ?? computeProviderStatus(merged);
      const { error } = await supabase
        .from('provider_presence')
        .update({ ...vars.fields, status })
        .eq('provider_presence_id', vars.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return {
    providers,
    stats: computeStats(providers.data ?? []),
    addProvider: (data: NewProvider) => addMutation.mutateAsync(data),
    updateArrival: (id: string, actualArrival: string) =>
      updateMutation.mutateAsync({ id, fields: { actual_arrival_time: actualArrival } }),
    updateStatus: (id: string, fields: Partial<ProviderPresence>) =>
      updateMutation.mutateAsync({ id, fields }),
    submitting: addMutation.isPending || updateMutation.isPending,
  };
}

/**
 * Compte des prestataires en retard sur les événements ouverts (alerte
 * dashboard / barre admin — RG-008).
 */
export function useLateProvidersCount() {
  return useQuery({
    queryKey: ['lateProviders'],
    staleTime: 30_000,
    queryFn: async (): Promise<number> => {
      const { data: events, error: evErr } = await supabase
        .from('events')
        .select('event_id')
        .in('status', ['préparé', 'en_cours', 'clôture_en_attente']);
      if (evErr) throw evErr;
      const ids = (events ?? []).map((e: { event_id: string }) => e.event_id);
      if (ids.length === 0) return 0;

      const { data, error } = await supabase
        .from('provider_presence')
        .select('*')
        .in('event_id', ids);
      if (error) throw error;
      return (data ?? []).filter(
        (p) => computeProviderStatus(p as ProviderPresence) === 'en_retard',
      ).length;
    },
  });
}
