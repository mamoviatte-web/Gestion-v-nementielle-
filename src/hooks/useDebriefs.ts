/**
 * Hook useDebriefs — formulaire de débrief par espace (Phase 5).
 * La soumission est irréversible (submitted_at renseigné) et upsert sur la
 * contrainte unique (event_id, space_id).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
  DEBRIEF_SECTIONS,
  type DebriefFormValues,
} from '@/lib/debriefForm';
import type { Debrief } from '@/lib/types';

/** Transforme les valeurs de formulaire en payload base de données. */
function valuesToRow(values: DebriefFormValues): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const section of DEBRIEF_SECTIONS) {
    for (const field of section.fields) {
      const v = values[field.key];
      if (field.type === 'checkbox') {
        row[field.key] = Boolean(v);
      } else if (field.type === 'number') {
        row[field.key] = v === '' || v === undefined ? null : Number(v);
      } else {
        row[field.key] = v === '' || v === undefined ? null : String(v);
      }
    }
  }
  return row;
}

export function useDebrief(
  eventId: string | undefined,
  spaceId: string | undefined,
) {
  const queryClient = useQueryClient();

  const debrief = useQuery({
    queryKey: ['debrief', eventId, spaceId],
    enabled: !!eventId && !!spaceId,
    queryFn: async (): Promise<Debrief | null> => {
      const { data, error } = await supabase
        .from('debriefs')
        .select('*')
        .eq('event_id', eventId)
        .eq('space_id', spaceId)
        .maybeSingle();
      if (error) throw error;
      return (data as Debrief | null) ?? null;
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (vars: { values: DebriefFormValues; responsable: string }) => {
      if (!eventId || !spaceId) throw new Error('Événement ou espace manquant.');
      if (!vars.responsable || vars.responsable.trim().length < 2) {
        throw new Error('Nom du responsable obligatoire (RG-001).');
      }
      const row = {
        ...valuesToRow(vars.values),
        event_id: eventId,
        space_id: spaceId,
        responsable: vars.responsable.trim(),
        submitted_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from('debriefs')
        .upsert(row, { onConflict: 'event_id,space_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['debrief', eventId, spaceId] });
      void queryClient.invalidateQueries({ queryKey: ['debriefs', eventId] });
    },
  });

  return {
    debrief,
    submitDebrief: (values: DebriefFormValues, responsable: string) =>
      submitMutation.mutateAsync({ values, responsable }),
    submitting: submitMutation.isPending,
  };
}

/** Tous les débriefs d'un événement (admin). */
export function useDebriefsForEvent(eventId: string | undefined) {
  return useQuery({
    queryKey: ['debriefs', eventId],
    enabled: !!eventId,
    queryFn: async (): Promise<Debrief[]> => {
      const { data, error } = await supabase
        .from('debriefs')
        .select('*')
        .eq('event_id', eventId);
      if (error) throw error;
      return (data ?? []) as Debrief[];
    },
  });
}
