/**
 * useCostControl — données du module « Contrôle de charges » (business plan).
 * S'appuie sur les vues SQL event_cost_summary / event_cost_details /
 * costly_overdotations. Réservé ROLE_STADE (coûts — RG-003).
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface EventCostSummary {
  event_id: string;
  event_name: string;
  event_type: string | null;
  event_date: string;
  pax: number | null;
  total_fb_cost_ht: number | null;
  total_fb_cost_ttc: number | null;
  fb_cost_per_pax: number | null;
  nb_products_no_price: number;
  nb_negative_conso: number;
  nb_priced_lines: number;
}

export interface CostDetailRow {
  event_id: string;
  event_type: string | null;
  event_date: string;
  product_id: string;
  product_name: string;
  category: string;
  consumed_qty: number | null;
  line_cost_ht: number | null;
}

export interface Overdotation {
  event_id: string;
  event_name: string;
  event_date: string;
  space_name: string;
  product_name: string;
  unit: string;
  unit_price_ht: number;
  total_dotation: number;
  consumed: number;
  returned: number;
  immobilized_cost_ht: number;
  return_rate: number;
}

export interface TopProduct {
  product_id: string;
  product_name: string;
  category: string;
  total_cost_ht: number;
  events_count: number;
  avg_cost_per_event: number;
}

export interface NoPriceProduct {
  product_id: string;
  product_name: string;
  category: string;
}

export interface CostControlFilters {
  eventType?: string | 'all';
  year?: number | 'all';
}

export interface CostControlData {
  summaries: EventCostSummary[];
  categoryBreakdown: { event_id: string; event_name: string; event_date: string; byCat: Record<string, number> }[];
  topProducts: TopProduct[];
  overdotations: Overdotation[];
  noPriceProducts: NoPriceProduct[];
  years: number[];
  kpis: {
    avg_match_per_pax: number | null;
    avg_seminar_per_pax: number | null;
    avg_cost_per_pax: number | null;
    total_fb_ht: number;
  };
}

const CATEGORIES = ['Vins', 'Bières', 'Soft', 'Sirops', 'Spiritueux', 'Matériel'];

function avg(nums: number[]): number | null {
  const valid = nums.filter((n) => Number.isFinite(n));
  return valid.length ? valid.reduce((s, n) => s + n, 0) / valid.length : null;
}

export function useCostControl(filters: CostControlFilters = {}) {
  const query = useQuery({
    queryKey: ['costControl'],
    staleTime: 30_000,
    queryFn: async () => {
      const [summaryRes, detailRes, overRes, productsRes] = await Promise.all([
        supabase.from('event_cost_summary').select('*'),
        supabase
          .from('event_cost_details')
          .select('event_id, event_type, event_date, product_id, product_name, category, consumed_qty, line_cost_ht')
          .not('final_qty', 'is', null),
        supabase.from('costly_overdotations').select('*'),
        supabase.from('products').select('product_id, product_name, category, unit_price_ht, active').eq('active', true),
      ]);
      if (summaryRes.error) throw summaryRes.error;
      return {
        summaries: (summaryRes.data ?? []) as EventCostSummary[],
        details: (detailRes.data ?? []) as CostDetailRow[],
        overdotations: (overRes.data ?? []) as Overdotation[],
        products: (productsRes.data ?? []) as {
          product_id: string;
          product_name: string;
          category: string;
          unit_price_ht: number | null;
        }[],
      };
    },
  });

  const data = useMemo<CostControlData | null>(() => {
    if (!query.data) return null;
    const { summaries, details, overdotations, products } = query.data;

    const years = [...new Set(summaries.map((s) => new Date(s.event_date).getFullYear()))].sort((a, b) => b - a);

    const matchType = (t: string | null) => t === 'match';
    const inScope = (t: string | null, date: string) => {
      if (filters.eventType && filters.eventType !== 'all') {
        if (filters.eventType === 'match' ? !matchType(t) : matchType(t)) return false;
      }
      if (filters.year && filters.year !== 'all' && new Date(date).getFullYear() !== filters.year) return false;
      return true;
    };

    const summariesF = summaries
      .filter((s) => inScope(s.event_type, s.event_date))
      .map((s) => ({
        ...s,
        total_fb_cost_ht: s.total_fb_cost_ht == null ? null : Number(s.total_fb_cost_ht),
        total_fb_cost_ttc: s.total_fb_cost_ttc == null ? null : Number(s.total_fb_cost_ttc),
        fb_cost_per_pax: s.fb_cost_per_pax == null ? null : Number(s.fb_cost_per_pax),
      }))
      .sort((a, b) => b.event_date.localeCompare(a.event_date));

    const detailsF = details.filter((d) => inScope(d.event_type, d.event_date));

    // Décomposition par catégorie et par événement (pour le graphique empilé).
    const catByEvent = new Map<string, { event_name: string; event_date: string; byCat: Record<string, number> }>();
    const eventName = new Map(summaries.map((s) => [s.event_id, s.event_name]));
    for (const d of detailsF) {
      const entry =
        catByEvent.get(d.event_id) ??
        { event_name: eventName.get(d.event_id) ?? '—', event_date: d.event_date, byCat: {} };
      if (CATEGORIES.includes(d.category)) {
        entry.byCat[d.category] = (entry.byCat[d.category] ?? 0) + (d.line_cost_ht ?? 0);
      }
      catByEvent.set(d.event_id, entry);
    }
    const categoryBreakdown = [...catByEvent.entries()]
      .map(([event_id, v]) => ({ event_id, ...v }))
      .sort((a, b) => a.event_date.localeCompare(b.event_date));

    // Produits les plus coûteux (cumul sur la période).
    const prodAgg = new Map<string, { name: string; category: string; total: number; events: Set<string> }>();
    for (const d of detailsF) {
      if (d.line_cost_ht == null || d.line_cost_ht <= 0) continue;
      const a = prodAgg.get(d.product_id) ?? { name: d.product_name, category: d.category, total: 0, events: new Set() };
      a.total += Number(d.line_cost_ht);
      a.events.add(d.event_id);
      prodAgg.set(d.product_id, a);
    }
    const topProducts: TopProduct[] = [...prodAgg.entries()]
      .map(([product_id, a]) => ({
        product_id,
        product_name: a.name,
        category: a.category,
        total_cost_ht: a.total,
        events_count: a.events.size,
        avg_cost_per_event: a.total / a.events.size,
      }))
      .sort((a, b) => b.total_cost_ht - a.total_cost_ht)
      .slice(0, 8);

    const overF = overdotations
      .filter((o) => inScope(null, o.event_date) || filters.eventType === 'all' || !filters.eventType)
      .map((o) => ({
        ...o,
        unit_price_ht: Number(o.unit_price_ht),
        immobilized_cost_ht: Number(o.immobilized_cost_ht),
        return_rate: Number(o.return_rate),
      }))
      .filter((o) => (filters.year && filters.year !== 'all' ? new Date(o.event_date).getFullYear() === filters.year : true))
      .sort((a, b) => b.immobilized_cost_ht - a.immobilized_cost_ht);

    const noPriceProducts: NoPriceProduct[] = products
      .filter((p) => p.unit_price_ht == null)
      .map((p) => ({ product_id: p.product_id, product_name: p.product_name, category: p.category }));

    const matchPax = summariesF.filter((s) => matchType(s.event_type)).map((s) => s.fb_cost_per_pax ?? NaN);
    const semiPax = summariesF.filter((s) => !matchType(s.event_type)).map((s) => s.fb_cost_per_pax ?? NaN);
    const allPax = summariesF.map((s) => s.fb_cost_per_pax ?? NaN);
    const total_fb_ht = summariesF.reduce((s, e) => s + (e.total_fb_cost_ht ?? 0), 0);

    return {
      summaries: summariesF,
      categoryBreakdown,
      topProducts,
      overdotations: overF,
      noPriceProducts,
      years,
      kpis: {
        avg_match_per_pax: avg(matchPax),
        avg_seminar_per_pax: avg(semiPax),
        avg_cost_per_pax: avg(allPax),
        total_fb_ht,
      },
    };
  }, [query.data, filters.eventType, filters.year]);

  return { data, isLoading: query.isLoading, error: query.error };
}
