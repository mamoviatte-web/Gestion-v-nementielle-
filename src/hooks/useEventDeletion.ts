/**
 * Hook useEventDeletion — suppression d'événement(s) (ROLE_STADE).
 * Cascade applicative résiliente (les contraintes ON DELETE CASCADE peuvent
 * ne pas encore être posées) + nettoyage Storage + réparation de la chaîne.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { deleteEventFiles } from '@/lib/storage';

/** Tables enfant référençant events(event_id), dans l'ordre de suppression. */
const CHILD_TABLES = [
  'stock_movements',
  'event_stock_lines',
  'runner_dotations',
  'provider_presence',
  'schedules',
  'debriefs',
  'runner_auto_planning',
  'event_consumptions',
  'event_attachments',
  'event_spaces',
] as const;

export interface DeletionSummary {
  stockLines: number;
  movements: number;
  providers: number;
  schedules: number;
  debriefs: number;
  runnerPlans: number;
  attachments: number;
}

async function countFor(table: string, eventId: string): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('event_id', eventId);
  if (error) return 0; // table inexistante → 0
  return count ?? 0;
}

/** Récapitulatif des données liées (pour la modale de confirmation). */
export function useDeletionSummary(eventId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['deletionSummary', eventId],
    enabled: !!eventId && enabled,
    queryFn: async (): Promise<DeletionSummary> => {
      const [stockLines, movements, providers, schedules, debriefs, runnerPlans, attachments] =
        await Promise.all([
          countFor('event_stock_lines', eventId!),
          countFor('stock_movements', eventId!),
          countFor('provider_presence', eventId!),
          countFor('schedules', eventId!),
          countFor('debriefs', eventId!),
          countFor('runner_auto_planning', eventId!),
          countFor('event_attachments', eventId!),
        ]);
      return { stockLines, movements, providers, schedules, debriefs, runnerPlans, attachments };
    },
  });
}

/** Suppression d'un événement + toutes ses données liées. */
async function deleteOne(eventId: string): Promise<void> {
  await deleteEventFiles(eventId);
  for (const t of CHILD_TABLES) {
    await supabase.from(t).delete().eq('event_id', eventId); // erreurs ignorées (table absente)
  }
  const { error } = await supabase.from('events').delete().eq('event_id', eventId);
  if (error) throw error;
  // Réparation de la chaîne des matchs (fonction optionnelle).
  await supabase.rpc('repair_match_chain').then(undefined, () => undefined);
}

export function useEventDeletion() {
  const queryClient = useQueryClient();

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['events'] });
    void queryClient.invalidateQueries({ queryKey: ['feuilleEvents'] });
  }

  const deleteMutation = useMutation({
    mutationFn: (eventId: string) => deleteOne(eventId),
    onSuccess: invalidate,
  });

  const bulkMutation = useMutation({
    mutationFn: async (eventIds: string[]) => {
      for (const id of eventIds) await deleteOne(id);
    },
    onSuccess: invalidate,
  });

  return {
    deleteEvent: (eventId: string) => deleteMutation.mutateAsync(eventId),
    bulkDelete: (eventIds: string[]) => bulkMutation.mutateAsync(eventIds),
    deleting: deleteMutation.isPending || bulkMutation.isPending,
  };
}
