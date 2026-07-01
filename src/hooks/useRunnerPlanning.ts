/**
 * Hook useRunnerPlanning — module Runner Auto-Planning (ROLE_STADE).
 * Génération automatique des fiches runner + cycle de validation/terrain.
 */

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import {
  buildCoefficients,
  computeConsumptionReference,
  computeQtyToMove,
  computeRecommendedQty,
  detectAlertType,
} from '@/lib/runnerCalculations';
import type {
  Product,
  RunnerGenerationParams,
  RunnerPlanWithDetails,
} from '@/lib/types';

/** UUID portable (navigateur + Node). */
function uuid(): string {
  return crypto.randomUUID();
}

/** Moyenne historique de consommation (5 derniers événements similaires). */
export async function getHistoricalAvg(
  spaceId: string,
  productId: string,
  eventType: string,
  limit = 5,
): Promise<number | null> {
  const { data, error } = await supabase
    .from('event_consumptions')
    .select('consumed_qty, created_at')
    .eq('space_id', spaceId)
    .eq('product_id', productId)
    .eq('event_type', eventType)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return null;
  const sum = rows.reduce((s, r) => s + (r.consumed_qty ?? 0), 0);
  return sum / rows.length;
}

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
     try {
      // Événement (affluence, type)
      const { data: ev, error: evErr } = await supabase
        .from('events')
        .select('event_id, event_type, expected_attendees, previous_event_id')
        .eq('event_id', params.event_id)
        .single();
      if (evErr) throw evErr;
      const expected = ev.expected_attendees ?? 0;
      const eventType = (ev.event_type as string) ?? 'autre';
      // Référence automatique = match précédent (chaînage). Pas de choix manuel.
      const autoReferenceId =
        (ev.previous_event_id as string | null) ?? params.reference_event_id ?? null;

      // Catalogue (catégorie + prix)
      const { data: products, error: pErr } = await supabase
        .from('products')
        .select('*');
      if (pErr) throw pErr;
      const productMap = new Map<string, Product>(
        (products ?? []).map((p) => [p.product_id, p as Product]),
      );

      for (const spaceId of params.space_ids) {
        const token = uuid();

        // Stocks de l'espace
        const { data: stocks } = await supabase
          .from('area_stocks')
          .select('product_id, current_qty')
          .eq('area_id', spaceId);
        const stockMap = new Map<string, number>(
          (stocks ?? []).map((s) => [s.product_id, s.current_qty]),
        );

        // Historique de l'espace pour ce type d'événement
        const { data: hist } = await supabase
          .from('event_consumptions')
          .select('product_id, consumed_qty, created_at')
          .eq('space_id', spaceId)
          .eq('event_type', eventType)
          .order('created_at', { ascending: false });
        const histByProduct = new Map<string, number[]>();
        for (const h of hist ?? []) {
          const arr = histByProduct.get(h.product_id) ?? [];
          arr.push(h.consumed_qty ?? 0);
          histByProduct.set(h.product_id, arr);
        }

        // Produits candidats = stock espace ∪ historique
        const productIds = new Set<string>([
          ...stockMap.keys(),
          ...histByProduct.keys(),
        ]);
        if (productIds.size === 0) continue;

        const rows = [...productIds].map((pid) => {
          const product = productMap.get(pid);
          const category = product?.category ?? 'autre';
          const price = product?.unit_price_ht ?? null;
          const hvals = histByProduct.get(pid) ?? [];
          const historicalAvg =
            hvals.length > 0
              ? hvals.slice(0, 5).reduce((s, v) => s + v, 0) / Math.min(5, hvals.length)
              : null;
          const lastSimilar = hvals.length > 0 ? hvals[0] : null;
          const reference = computeConsumptionReference(historicalAvg, lastSimilar);
          const coeffs = buildCoefficients({
            expected,
            weather: params.weather_type,
            category,
            eventType,
            trend: params.consumption_trend,
          });
          const recommended = computeRecommendedQty(reference, coeffs);
          const areaStock = stockMap.get(pid) ?? 0;
          const { qty, sufficient } = computeQtyToMove(recommended, areaStock);
          const alert = detectAlertType(recommended, historicalAvg, sufficient);
          const estimatedCost = price === null ? null : recommended * price;

          return {
            event_id: params.event_id,
            space_id: spaceId,
            product_id: pid,
            initial_area_stock: areaStock,
            historical_avg_consumption: historicalAvg,
            last_similar_event_consumption: lastSimilar,
            consumption_reference: reference,
            attendance_coefficient: coeffs.attendance,
            weather_coefficient: coeffs.weather,
            event_type_coefficient: coeffs.event_type,
            trend_coefficient: coeffs.trend,
            recommended_quantity: recommended,
            quantity_to_move: qty,
            stock_sufficient: sufficient,
            estimated_cost_ht: estimatedCost,
            alert_type: alert,
            validation_status: 'brouillon',
            terrain_token: token,
          };
        });

        const { error: upErr } = await supabase
          .from('runner_auto_planning')
          .upsert(rows, { onConflict: 'event_id,space_id,product_id' });
        if (upErr) throw upErr;
      }

      // Mémoriser les paramètres sur l'événement
      await supabase
        .from('events')
        .update({
          weather_type: params.weather_type,
          temperature: params.temperature,
          consumption_trend: params.consumption_trend,
          reference_event_id: autoReferenceId,
        })
        .eq('event_id', params.event_id);
     } catch (err) {
        // Diagnostic détaillé (code / message / details / hint Supabase).
        const e = err as { code?: string; message?: string; details?: string; hint?: string };
        console.error('[Runner] Échec de génération des fiches', {
          code: e?.code,
          message: e?.message,
          details: e?.details,
          hint: e?.hint,
          params,
        });
        throw err;
     }
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
