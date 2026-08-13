/**
 * Hook useRunnerPlanning — module Runner Auto-Planning (ROLE_STADE).
 * Génération automatique des fiches runner + cycle de validation/terrain.
 */

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type {
  RunnerGenerationParams,
  RunnerPlanWithDetails,
} from '@/lib/types';

export function useRunnerPlanning(eventId: string | undefined) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userName = user?.name ?? 'Stade';

  /* 2. Récupérer les plans (JOIN produits + espaces). */
  const plans = useQuery({
    queryKey: ['runnerPlans', eventId],
    enabled: !!eventId,
    queryFn: async (): Promise<RunnerPlanWithDetails[]> => {
      const { data, error } = await supabase
        .from('runner_auto_planning')
        .select('*, product:products(*), space:spaces(*)')
        .eq('event_id', eventId);
      if (error) throw error;
      return (data ?? []) as RunnerPlanWithDetails[];
    },
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['runnerPlans', eventId] });
  }

  /* 1. Génération automatique. */
  const generateMutation = useMutation({
    mutationFn: async (params: RunnerGenerationParams) => {
      // Contexte de génération mémorisé sur l'événement (météo / tendance / référence).
      // Référence = match précédent (chaînage) sinon la référence éventuellement fournie.
      const { data: ev } = await supabase
        .from('events')
        .select('previous_event_id')
        .eq('event_id', params.event_id)
        .single();
      const autoReferenceId =
        (ev?.previous_event_id as string | null) ?? params.reference_event_id ?? null;
      await supabase
        .from('events')
        .update({
          weather_type: params.weather_type,
          temperature: params.temperature,
          consumption_trend: params.consumption_trend,
          reference_event_id: autoReferenceId,
        })
        .eq('event_id', params.event_id);

      // Écraser : dévalider d'abord toutes les lignes de l'événement, pour que la
      // régénération (qui ne remplace que les lignes « brouillon ») réinjecte les
      // produits manquants (vin…) sur des fiches déjà validées.
      if (params.overwrite) {
        const { error: resetErr } = await supabase
          .from('runner_auto_planning')
          .update({
            validation_status: 'brouillon',
            validated_quantity: null,
            validated_by: null,
            validated_at: null,
          })
          .eq('event_id', params.event_id);
        if (resetErr) throw resetErr;
      }

      // Génération SERVEUR (source unique de vérité) : remplit runner_auto_planning
      // depuis l'union socle CDC + complément historique (space_product_coefficients :
      // tout produit réellement consommé dans l'espace, vin inclus). Purge les lignes
      // « brouillon », préserve les lignes déjà validées. Aucun calcul côté client.
      const { data, error } = await supabase.rpc('generate_runner_dotations', {
        p_event_id: params.event_id,
      });
      if (error) throw error;
      return data as {
        success: boolean;
        event_id: string;
        lignes_generees: number;
        lignes_socle?: number;
        lignes_historique?: number;
        pax_total?: number;
        vip_pax?: number;
        grand_public_pax?: number;
        ratio_grand_public?: number;
      };
    },
    onSuccess: invalidate,
  });

  /* 3. Valider une ligne. */
  const validateLineMutation = useMutation({
    mutationFn: async (vars: { planId: string; validatedQty: number; comment?: string }) => {
      const { error } = await supabase
        .from('runner_auto_planning')
        .update({
          validated_quantity: vars.validatedQty,
          stadium_manager_comment: vars.comment ?? null,
          validated_by: userName,
          validated_at: new Date().toISOString(),
          validation_status: 'validé',
        })
        .eq('id', vars.planId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  /* 4. Valider tout un espace (quantités recommandées par défaut). */
  const validateSpaceMutation = useMutation({
    mutationFn: async (spaceId: string) => {
      const current = (plans.data ?? []).filter((p) => p.space_id === spaceId);
      for (const p of current) {
        const qty = p.validated_quantity ?? p.recommended_quantity ?? 0;
        const { error } = await supabase
          .from('runner_auto_planning')
          .update({
            validated_quantity: qty,
            validated_by: userName,
            validated_at: new Date().toISOString(),
            validation_status: 'validé',
          })
          .eq('id', p.id);
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
  });

  /* 5. Transmettre aux runners. */
  const transmitMutation = useMutation({
    mutationFn: async (spaceId: string) => {
      const { error } = await supabase
        .from('runner_auto_planning')
        .update({ validation_status: 'transmis_runners' })
        .eq('event_id', eventId)
        .eq('space_id', spaceId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  /* 6. Saisir le retour terrain. */
  const terrainMutation = useMutation({
    mutationFn: async (vars: {
      planId: string;
      picked: number;
      returned: number;
      respName: string;
    }) => {
      const { error } = await supabase
        .from('runner_auto_planning')
        .update({
          picked_quantity: vars.picked,
          returned_quantity: vars.returned,
          responsible_name: vars.respName,
          validation_status: 'retour_saisi',
        })
        .eq('id', vars.planId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  /* 7. Clôturer et alimenter l'historique (closeAndLearn). */
  const closeMutation = useMutation({
    mutationFn: async () => {
      const current = plans.data ?? [];

      // Contexte réel de l'événement (nécessaire aux analytics : event_type/affluence/météo).
      const { data: ev } = await supabase
        .from('events')
        .select('event_type, expected_attendees, weather_type')
        .eq('event_id', eventId)
        .single();
      const eventType = (ev?.event_type as string | null) ?? null;
      const expectedAttendance = (ev?.expected_attendees as number | null) ?? null;
      const weatherType = (ev?.weather_type as string | null) ?? null;

      for (const p of current) {
        const picked = p.picked_quantity ?? 0;
        const returned = p.returned_quantity ?? 0;
        // Historique : consumed_qty = initial + réassort - final (colonne générée).
        await supabase.from('event_consumptions').upsert(
          {
            event_id: p.event_id,
            space_id: p.space_id,
            product_id: p.product_id,
            initial_stock: picked,
            restock_qty: 0,
            final_stock: returned,
            unit_price_ht: p.product?.unit_price_ht ?? null,
            event_type: eventType,
            expected_attendance: expectedAttendance,
            weather_type: weatherType,
          },
          { onConflict: 'event_id,space_id,product_id' },
        );
        // Écart recommandation vs validation manager (apprentissage des corrections).
        if (p.recommended_quantity && p.validated_quantity != null) {
          const delta = ((p.validated_quantity - p.recommended_quantity) / p.recommended_quantity) * 100;
          await supabase
            .from('runner_recommendations')
            .update({ validation_delta_pct: delta })
            .eq('event_id', p.event_id)
            .eq('space_id', p.space_id)
            .eq('product_id', p.product_id);
        }
        // Mise à jour du stock espace.
        const newQty = Math.max(0, (p.initial_area_stock ?? 0) - (picked - returned));
        await supabase
          .from('area_stocks')
          .update({ current_qty: newQty, last_updated: new Date().toISOString() })
          .eq('area_id', p.space_id)
          .eq('product_id', p.product_id);
      }

      const { error } = await supabase
        .from('runner_auto_planning')
        .update({ validation_status: 'clôturé' })
        .eq('event_id', eventId);
      if (error) throw error;

      // Recalcul du moteur d'apprentissage (idempotent ; aussi déclenché par trigger).
      await supabase.rpc('refresh_all_analytics').then(undefined, () => undefined);
    },
    onSuccess: invalidate,
  });

  /* 8. KPIs (dérivés des plans). */
  const kpis = useMemo(() => {
    const list = plans.data ?? [];
    const validatedStatuses = new Set([
      'validé',
      'transmis_runners',
      'préparé',
      'livré',
      'retour_saisi',
      'clôturé',
    ]);
    return {
      totalLines: list.length,
      validated: list.filter((p) => validatedStatuses.has(p.validation_status)).length,
      sufficient: list.filter((p) => p.stock_sufficient).length,
      alerts: list.filter(
        (p) => p.alert_type === 'rupture' || p.alert_type === 'surdotation',
      ).length,
      estimatedCostHT: list.reduce((s, p) => s + (p.estimated_cost_ht ?? 0), 0),
    };
  }, [plans.data]);

  return {
    plans,
    kpis,
    generateRunnerPlans: (params: RunnerGenerationParams) =>
      generateMutation.mutateAsync(params),
    validateLine: (planId: string, validatedQty: number, comment?: string) =>
      validateLineMutation.mutateAsync({ planId, validatedQty, comment }),
    validateSpace: (spaceId: string) => validateSpaceMutation.mutateAsync(spaceId),
    transmitToRunners: (spaceId: string) => transmitMutation.mutateAsync(spaceId),
    updateTerrain: (planId: string, picked: number, returned: number, respName: string) =>
      terrainMutation.mutateAsync({ planId, picked, returned, respName }),
    closeAndLearn: () => closeMutation.mutateAsync(),
    submitting:
      generateMutation.isPending ||
      validateLineMutation.isPending ||
      validateSpaceMutation.isPending ||
      transmitMutation.isPending ||
      terrainMutation.isPending ||
      closeMutation.isPending,
  };
}
