/**
 * BuvetteAnalyticsSection — synthèse des consommations buvettes sur les matchs
 * historiques (top produits + tendance), lue depuis consumption_analytics.
 */

import { useQuery } from '@tanstack/react-query';
import { Beer, TrendingUp } from 'lucide-react';
import { Badge, Spinner } from '@/components/ui';
import { supabase } from '@/lib/supabase';

interface BuvetteAnalyticRow {
  product_name: string;
  avg_qty_per_event: number;
  trend_direction: string | null;
  trend_pct_change: number | null;
  nb_events_analyzed: number;
  confidence_score: number;
  return_rate_avg: number | null;
}

const TREND_META: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  forte_hausse: { label: '↑↑ forte hausse', tone: 'danger' },
  hausse: { label: '↑ hausse', tone: 'warning' },
  stable: { label: '→ stable', tone: 'neutral' },
  baisse: { label: '↓ baisse', tone: 'success' },
};

export function BuvetteAnalyticsSection() {
  const q = useQuery({
    queryKey: ['buvetteAnalytics'],
    staleTime: 30_000,
    queryFn: async (): Promise<BuvetteAnalyticRow[]> => {
      const { data, error } = await supabase
        .from('consumption_analytics')
        .select(
          'avg_qty_per_event, trend_direction, trend_pct_change, nb_events_analyzed, confidence_score, return_rate_avg, product:products(product_name), space:spaces(space_type)',
        )
        .eq('event_type', 'match');
      if (error) throw error;
      type Row = {
        avg_qty_per_event: number;
        trend_direction: string | null;
        trend_pct_change: number | null;
        nb_events_analyzed: number;
        confidence_score: number;
        return_rate_avg: number | null;
        product: { product_name: string } | null;
        space: { space_type: string } | null;
      };
      // Agrège par produit sur les espaces de type Buvette.
      const byProduct = new Map<string, BuvetteAnalyticRow>();
      for (const r of ((data ?? []) as unknown as Row[]).filter((x) => x.space?.space_type === 'Buvette')) {
        const name = r.product?.product_name ?? '—';
        const cur = byProduct.get(name);
        const row: BuvetteAnalyticRow = {
          product_name: name,
          avg_qty_per_event: Number(r.avg_qty_per_event),
          trend_direction: r.trend_direction,
          trend_pct_change: r.trend_pct_change == null ? null : Number(r.trend_pct_change),
          nb_events_analyzed: Number(r.nb_events_analyzed),
          confidence_score: Number(r.confidence_score),
          return_rate_avg: r.return_rate_avg == null ? null : Number(r.return_rate_avg),
        };
        if (!cur || row.avg_qty_per_event > cur.avg_qty_per_event) byProduct.set(name, row);
      }
      return [...byProduct.values()].sort((a, b) => b.avg_qty_per_event - a.avg_qty_per_event);
    },
  });

  if (q.isLoading) return <Spinner label="Chargement des analytics buvettes…" />;
  const rows = q.data ?? [];
  if (rows.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-pr-black-soft/60">
        <Beer className="h-4 w-4" /> Buvettes — top produits sur {rows[0]?.nb_events_analyzed ?? 5} matchs
      </h2>
      <div className="overflow-x-auto rounded-xl border border-pr-stone bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-pr-stone text-left text-xs uppercase tracking-wide text-pr-black-soft/60">
              <th className="px-4 py-2.5 font-semibold">#</th>
              <th className="px-4 py-2.5 font-semibold">Produit</th>
              <th className="px-4 py-2.5 text-right font-semibold">Moy./buvette</th>
              <th className="px-4 py-2.5 text-right font-semibold">Taux retour</th>
              <th className="px-4 py-2.5 font-semibold">Tendance</th>
              <th className="px-4 py-2.5 text-right font-semibold">Confiance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-pr-stone">
            {rows.map((r, i) => {
              const meta = TREND_META[r.trend_direction ?? 'stable'] ?? TREND_META.stable;
              return (
                <tr key={r.product_name} className="hover:bg-pr-cream/40">
                  <td className="px-4 py-2 text-pr-black-soft/40">{i + 1}</td>
                  <td className="px-4 py-2 font-medium text-pr-black">{r.product_name}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-pr-black">
                    {r.avg_qty_per_event.toFixed(1)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-pr-black-soft/60">
                    {r.return_rate_avg == null ? '—' : `${Math.round(r.return_rate_avg * 100)} %`}
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone={meta.tone}>
                      {meta.label}
                      {r.trend_pct_change != null ? ` ${r.trend_pct_change > 0 ? '+' : ''}${Math.round(r.trend_pct_change)} %` : ''}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-pr-olive-dark">
                    <span className="inline-flex items-center gap-1">
                      <TrendingUp className="h-3.5 w-3.5" />
                      {Math.round(r.confidence_score * 100)} %
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
