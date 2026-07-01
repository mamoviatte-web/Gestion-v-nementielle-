/**
 * Hook & fonctions du moteur d'analyse de consommation (ROLE_STADE).
 * Lit consumption_analytics / event_context_log / runner_recommendations,
 * déclenche le recalcul, et fournit l'historique détaillé par produit.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { ConsumptionAnalytics } from '@/lib/types';

/* ─── 1. Analytics d'un espace × produit × type d'événement ─────────── */
export async function fetchAnalytics(
  spaceId: string,
  productId: string,
  eventType: string,
): Promise<ConsumptionAnalytics | null> {
  const { data, error } = await supabase
    .from('consumption_analytics')
    .select('*')
    .eq('space_id', spaceId)
    .eq('product_id', productId)
    .eq('event_type', eventType)
    .maybeSingle();
  if (error) return null;
  return (data as ConsumptionAnalytics) ?? null;
}

/* ─── 2. Toutes les analytics d'un espace ───────────────────────────── */
export async function fetchSpaceAnalytics(
  spaceId: string,
  eventType: string,
): Promise<ConsumptionAnalytics[]> {
  const { data, error } = await supabase
    .from('consumption_analytics')
    .select('*, product:products(*)')
    .eq('space_id', spaceId)
    .eq('event_type', eventType)
    .order('avg_qty_per_event', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ConsumptionAnalytics[];
}

/* ─── 3. Déclencher le recalcul complet (aussi fait par le trigger) ─── */
export async function triggerAnalyticsRefresh(): Promise<void> {
  const { error } = await supabase.rpc('refresh_all_analytics');
  if (error) throw error;
}

/* ─── 4. Score de confiance global d'un espace ──────────────────────── */
export interface SpaceConfidence {
  avgConfidence: number;
  nbProductsWithHistory: number;
  nbProductsWithoutHistory: number;
}

export async function getSpaceConfidenceScore(
  spaceId: string,
  eventType: string,
): Promise<SpaceConfidence> {
  const { data, error } = await supabase
    .from('consumption_analytics')
    .select('confidence_score, nb_events_analyzed')
    .eq('space_id', spaceId)
    .eq('event_type', eventType);
  if (error) throw error;
  const rows = (data ?? []) as { confidence_score: number | null; nb_events_analyzed: number }[];
  const withHistory = rows.filter((r) => r.nb_events_analyzed > 0);
  const without = rows.length - withHistory.length;
  const avg =
    withHistory.length > 0
      ? withHistory.reduce((s, r) => s + (r.confidence_score ?? 0), 0) / withHistory.length
      : 0;
  return {
    avgConfidence: avg,
    nbProductsWithHistory: withHistory.length,
    nbProductsWithoutHistory: without,
  };
}

/* ─── 5. Enregistrer la consommation réelle après clôture ───────────── */
export interface ClosureStockLine {
  space_id: string;
  product_id: string;
  initial_qty: number;
  reassort_qty: number;
  final_qty: number | null;
  unit_price_ht?: number | null;
}

export async function recordClosureConsumption(
  eventId: string,
  eventType: string,
  expectedAttendance: number | null,
  weatherType: string | null,
  stockLines: ClosureStockLine[],
): Promise<void> {
  const rows = stockLines
    .filter((l) => l.final_qty !== null)
    // consumed_qty et total_cost_ht sont des colonnes GÉNÉRÉES → jamais insérées.
    .map((l) => ({
      event_id: eventId,
      space_id: l.space_id,
      product_id: l.product_id,
      initial_stock: l.initial_qty,
      restock_qty: l.reassort_qty,
      final_stock: l.final_qty as number,
      unit_price_ht: l.unit_price_ht ?? null,
      event_type: eventType,
      expected_attendance: expectedAttendance,
      weather_type: weatherType,
    }));
  if (rows.length === 0) return;
  const { error } = await supabase
    .from('event_consumptions')
    .upsert(rows, { onConflict: 'event_id,space_id,product_id' });
  if (error) throw error;
}

/* ─── 6. Écart recommandation vs validation manager ─────────────────── */
export interface ManagerCorrection {
  avgDeltaPct: number;
  products: { productName: string; avgCorrectionPct: number; correctionDirection: 'up' | 'down' }[];
}

export async function getManagerCorrectionRate(eventType: string): Promise<ManagerCorrection> {
  const { data, error } = await supabase
    .from('runner_recommendations')
    .select('validation_delta_pct, product:products(product_name), event:events(event_type)')
    .not('validation_delta_pct', 'is', null);
  if (error) throw error;
  const rows = (data ?? []) as unknown as {
    validation_delta_pct: number;
    product: { product_name: string } | null;
    event: { event_type: string } | null;
  }[];
  const filtered = rows.filter((r) => r.event?.event_type === eventType);
  if (filtered.length === 0) return { avgDeltaPct: 0, products: [] };

  const avgDeltaPct = filtered.reduce((s, r) => s + r.validation_delta_pct, 0) / filtered.length;
  const byProduct = new Map<string, number[]>();
  for (const r of filtered) {
    const name = r.product?.product_name ?? '—';
    const arr = byProduct.get(name) ?? [];
    arr.push(r.validation_delta_pct);
    byProduct.set(name, arr);
  }
  const products = [...byProduct.entries()]
    .map(([productName, deltas]) => {
      const avg = deltas.reduce((s, d) => s + d, 0) / deltas.length;
      return {
        productName,
        avgCorrectionPct: Math.abs(avg),
        correctionDirection: (avg >= 0 ? 'up' : 'down') as 'up' | 'down',
      };
    })
    .sort((a, b) => b.avgCorrectionPct - a.avgCorrectionPct)
    .slice(0, 10);
  return { avgDeltaPct, products };
}

/* ─── 7. Historique détaillé par produit ────────────────────────────── */
export interface ProductHistoryRow {
  eventName: string;
  eventDate: string;
  attendance: number;
  weather: string;
  consumedQty: number;
  dotationQty: number;
  returnRate: number;
  hadRupture: boolean;
}

export async function getProductHistory(
  spaceId: string,
  productId: string,
  eventType: string,
  limit = 10,
): Promise<ProductHistoryRow[]> {
  const { data, error } = await supabase
    .from('event_consumptions')
    .select('initial_stock, restock_qty, final_stock, consumed_qty, expected_attendance, weather_type, event:events(event_name, event_date, event_type)')
    .eq('space_id', spaceId)
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as unknown as {
    initial_stock: number;
    restock_qty: number;
    final_stock: number;
    consumed_qty: number;
    expected_attendance: number | null;
    weather_type: string | null;
    event: { event_name: string; event_date: string; event_type: string } | null;
  }[];
  return rows
    .filter((r) => r.event?.event_type === eventType)
    .map((r) => {
      const dotation = r.initial_stock + r.restock_qty;
      return {
        eventName: r.event?.event_name ?? '—',
        eventDate: r.event?.event_date ?? '',
        attendance: r.expected_attendance ?? 0,
        weather: r.weather_type ?? 'normal',
        consumedQty: r.consumed_qty,
        dotationQty: dotation,
        returnRate: dotation > 0 ? (dotation - r.consumed_qty) / dotation : 0,
        hadRupture: dotation > 0 && r.consumed_qty >= dotation * 0.95,
      };
    });
}

/* ─── Wrappers react-query pour l'UI ────────────────────────────────── */

export function useSpaceAnalytics(spaceId: string | undefined, eventType: string) {
  return useQuery({
    queryKey: ['spaceAnalytics', spaceId, eventType],
    enabled: !!spaceId,
    queryFn: () => fetchSpaceAnalytics(spaceId!, eventType),
  });
}

export function useSpaceConfidence(spaceId: string | undefined, eventType: string) {
  return useQuery({
    queryKey: ['spaceConfidence', spaceId, eventType],
    enabled: !!spaceId,
    queryFn: () => getSpaceConfidenceScore(spaceId!, eventType),
  });
}

/** Toutes les analytics (vue globale AnalyticsPage), filtrables côté client. */
export function useAllAnalytics() {
  return useQuery({
    queryKey: ['allAnalytics'],
    queryFn: async (): Promise<ConsumptionAnalytics[]> => {
      const { data, error } = await supabase
        .from('consumption_analytics')
        .select('*, product:products(*), space:spaces(*)')
        .order('confidence_score', { ascending: false });
      if (error) throw error;
      return (data ?? []) as ConsumptionAnalytics[];
    },
  });
}

export function useProductHistory(
  spaceId: string | undefined,
  productId: string | undefined,
  eventType: string,
  limit = 10,
) {
  return useQuery({
    queryKey: ['productHistory', spaceId, productId, eventType, limit],
    enabled: !!spaceId && !!productId,
    queryFn: () => getProductHistory(spaceId!, productId!, eventType, limit),
  });
}
