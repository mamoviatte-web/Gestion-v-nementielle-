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
  'debrief_photos',
  'runner_auto_planning',
  'runner_recommendations',
  'event_consumptions',
  'event_context_log',
  'event_attachments',
  'event_report_photos',
  'event_commercial_data',
  'client_satisfaction_survey',
  'seminar_report_draft',
  'occasional_hours',
  'match_access_sessions',
  'event_spaces',
] as const;

/**
 * Tables où event_id doit être DÉLIÉ (mis à NULL) plutôt que supprimé :
 * les fûts et les analytics survivent à la suppression de l'événement.
 */
const NULLIFY_EVENT_TABLES = ['keg_inventory'] as const;

/**
 * Niveau de risque d'une suppression, fonction de ce qui sera réellement perdu :
 *  - safe     : événement vide (aucune ligne liée) → suppression en 1 clic.
 *  - moderate : dotations/fiches runner/pièces jointes planifiées, rien saisi
 *               sur le terrain → confirmation avec récapitulatif, sans saisie.
 *  - critical : données opérationnelles réelles (mouvements de stock, débriefs,
 *               prestataires, horaires) → confirmation stricte (retaper le nom).
 */
export type DeletionRiskLevel = 'safe' | 'moderate' | 'critical';

export interface DeletionCounts {
  stockLines: number;
  movements: number;
  providers: number;
  schedules: number;
  debriefs: number;
  runnerPlans: number;
  attachments: number;
}

export interface DeletionSummary extends DeletionCounts {
  riskLevel: DeletionRiskLevel;
}

/** Détermine le niveau de friction requis selon les données liées. */
export function computeRiskLevel(summary: DeletionCounts): DeletionRiskLevel {
  // critical : données opérationnelles réelles déjà saisies.
  if (
    summary.movements > 0 ||
    summary.debriefs > 0 ||
    summary.providers > 0 ||
    summary.schedules > 0
  ) {
    return 'critical';
  }
  // moderate : dotations/runner planifiés mais rien saisi sur le terrain.
  if (summary.stockLines > 0 || summary.runnerPlans > 0 || summary.attachments > 0) {
    return 'moderate';
  }
  // safe : événement vide, juste créé.
  return 'safe';
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
      const counts = { stockLines, movements, providers, schedules, debriefs, runnerPlans, attachments };
      return { ...counts, riskLevel: computeRiskLevel(counts) };
    },
  });
}

/**
 * Carte event_id → niveau de risque pour TOUTE la liste, en ~7 requêtes
 * (une par table enfant) plutôt que 7 × N. Sert au mode sélection multiple
 * pour repérer instantanément les événements vides (« safe »).
 */
async function eventIdsWithRows(table: string): Promise<string[]> {
  const { data, error } = await supabase.from(table).select('event_id');
  if (error) return []; // table inexistante → aucun id
  return (data ?? []).map((r: { event_id: string }) => r.event_id);
}

export function useEventsRiskMap(eventIds: string[]) {
  return useQuery({
    queryKey: ['eventsRiskMap', [...eventIds].sort()],
    enabled: eventIds.length > 0,
    queryFn: async (): Promise<Record<string, DeletionRiskLevel>> => {
      const criticalTables = ['stock_movements', 'debriefs', 'provider_presence', 'schedules'];
      const moderateTables = ['event_stock_lines', 'runner_auto_planning', 'event_attachments'];
      const [critLists, modLists] = await Promise.all([
        Promise.all(criticalTables.map(eventIdsWithRows)),
        Promise.all(moderateTables.map(eventIdsWithRows)),
      ]);
      const critical = new Set(critLists.flat());
      const moderate = new Set(modLists.flat());
      const map: Record<string, DeletionRiskLevel> = {};
      for (const id of eventIds) {
        map[id] = critical.has(id) ? 'critical' : moderate.has(id) ? 'moderate' : 'safe';
      }
      return map;
    },
  });
}

/** Suppression d'un événement + toutes ses données liées. */
async function deleteOne(eventId: string): Promise<void> {
  await deleteEventFiles(eventId);
  // Délier les tables qui survivent (fûts, analytics) — évite le blocage FK.
  for (const t of NULLIFY_EVENT_TABLES) {
    await supabase.from(t).update({ event_id: null }).eq('event_id', eventId);
  }
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
