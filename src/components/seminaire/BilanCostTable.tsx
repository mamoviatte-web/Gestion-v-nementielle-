/**
 * BilanCostTable — synthèse des coûts F&B d'un événement, ligne par ligne.
 * Principe métier : COÛT = prix_unitaire_HT × quantité_consommée, avec
 * quantité_consommée = stock_initial + réassort − stock_final.
 * Le coût n'est jamais saisi : il vient de `event_cost_details` (prix source
 * products.unit_price_ht). Regroupé par famille, avec formule au survol et
 * totaux HT / TVA / TTC. Réservé ROLE_STADE (RG-003).
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EmptyState } from '@/components/ui';
import { formatEuro } from '@/lib/calculations';
import { supabase } from '@/lib/supabase';
import { PackageX } from 'lucide-react';

/** Ligne renvoyée par la vue event_cost_details. */
interface CostDetailRow {
  space_id: string;
  product_id: string;
  product_name: string;
  category: string;
  unit: string;
  unit_price_ht: number | null;
  initial_qty: number;
  reassort_qty: number;
  final_qty: number | null;
  consumed_qty: number | null;
  line_cost_ht: number | null;
}

/** Ligne agrégée par produit (cumul des espaces). */
interface AggLine {
  product_id: string;
  product_name: string;
  category: string;
  unit: string;
  unit_price_ht: number | null;
  initial_qty: number;
  reassort_qty: number;
  final_qty: number;
  consumed_qty: number;
  line_cost_ht: number | null;
}

const CATEGORY_ORDER = ['Vins', 'Bières', 'Soft', 'Sirops', 'Spiritueux', 'Matériel'];

function aggregate(rows: CostDetailRow[]): Map<string, AggLine[]> {
  const byProduct = new Map<string, AggLine>();
  for (const r of rows) {
    const existing = byProduct.get(r.product_id);
    const consumed = r.consumed_qty ?? 0;
    const cost = r.line_cost_ht;
    if (existing) {
      existing.initial_qty += r.initial_qty;
      existing.reassort_qty += r.reassort_qty;
      existing.final_qty += r.final_qty ?? 0;
      existing.consumed_qty += consumed;
      existing.line_cost_ht =
        cost == null && existing.line_cost_ht == null
          ? null
          : (existing.line_cost_ht ?? 0) + (cost ?? 0);
    } else {
      byProduct.set(r.product_id, {
        product_id: r.product_id,
        product_name: r.product_name,
        category: r.category,
        unit: r.unit,
        unit_price_ht: r.unit_price_ht,
        initial_qty: r.initial_qty,
        reassort_qty: r.reassort_qty,
        final_qty: r.final_qty ?? 0,
        consumed_qty: consumed,
        line_cost_ht: cost,
      });
    }
  }

  const byCategory = new Map<string, AggLine[]>();
  for (const line of byProduct.values()) {
    const arr = byCategory.get(line.category) ?? [];
    arr.push(line);
    byCategory.set(line.category, arr);
  }
  for (const arr of byCategory.values()) arr.sort((a, b) => a.product_name.localeCompare(b.product_name));
  return byCategory;
}

/** Tooltip pédagogique : détaille la formule initial + réassort − final = coût. */
function FormulaTooltip({ line }: { line: AggLine }) {
  return (
    <div className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 w-64 rounded-lg bg-pr-black p-3 text-xs text-pr-white opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
      <div className="mb-2 font-semibold">{line.product_name}</div>
      <div className="space-y-1 font-mono">
        <div>Stock initial&nbsp;: {line.initial_qty} {line.unit}</div>
        {line.reassort_qty > 0 && (
          <div>+ Réassort&nbsp;: {line.reassort_qty} {line.unit}</div>
        )}
        <div>− Stock final&nbsp;: {line.final_qty} {line.unit}</div>
        <div className="mt-1 border-t border-white/25 pt-1">
          = Consommé&nbsp;: <strong>{line.consumed_qty} {line.unit}</strong>
        </div>
        <div className="mt-2">
          Prix HT&nbsp;: {line.unit_price_ht != null ? `${line.unit_price_ht.toFixed(2)} €/${line.unit}` : '—'}
        </div>
        {line.line_cost_ht != null && line.unit_price_ht != null && (
          <div className="border-t border-white/25 pt-1">
            Coût = {line.consumed_qty} × {line.unit_price_ht.toFixed(2)} ={' '}
            <strong>{line.line_cost_ht.toFixed(2)} € HT</strong>
          </div>
        )}
      </div>
    </div>
  );
}

export function BilanCostTable({ eventId }: { eventId: string }) {
  const [tvaRate] = useState(0.2);

  const { data, isLoading } = useQuery({
    queryKey: ['bilanCostDetails', eventId],
    queryFn: async (): Promise<CostDetailRow[]> => {
      const { data, error } = await supabase
        .from('event_cost_details')
        .select(
          'space_id, product_id, product_name, category, unit, unit_price_ht, initial_qty, reassort_qty, final_qty, consumed_qty, line_cost_ht',
        )
        .eq('event_id', eventId)
        .not('final_qty', 'is', null);
      if (error) throw error;
      return (data ?? []) as CostDetailRow[];
    },
  });

  const byCategory = useMemo(() => aggregate(data ?? []), [data]);

  const orderedCategories = useMemo(() => {
    const keys = [...byCategory.keys()];
    return keys.sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a);
      const ib = CATEGORY_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }, [byCategory]);

  const totalHT = useMemo(
    () => (data ?? []).reduce((s, l) => s + (l.line_cost_ht ?? 0), 0),
    [data],
  );

  if (isLoading) return <p className="text-sm text-slate-500">Chargement des coûts…</p>;
  if ((data ?? []).length === 0) {
    return (
      <EmptyState
        icon={PackageX}
        title="Aucune clôture chiffrée"
        message="Les coûts s'afficheront dès qu'un stock final aura été saisi."
      />
    );
  }

  return (
    <div className="space-y-5">
      {orderedCategories.map((cat) => {
        const lines = byCategory.get(cat) ?? [];
        const catTotal = lines.reduce((s, l) => s + (l.line_cost_ht ?? 0), 0);
        return (
          <div key={cat}>
            <div className="mb-2 flex items-center justify-between border-b-2 border-pr-black py-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-pr-black-soft/60">{cat}</span>
              <span className="text-xs font-medium text-pr-black-soft/60">{formatEuro(catTotal)}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-pr-black-soft/40">
                    <th className="pb-1 text-left font-medium">Produit</th>
                    <th className="pb-1 text-right font-medium">Prix U HT</th>
                    <th className="pb-1 text-right font-medium">Initial</th>
                    <th className="pb-1 text-right font-medium">Réassort</th>
                    <th className="pb-1 text-right font-medium">Final</th>
                    <th className="pb-1 text-right font-medium">Consommé</th>
                    <th className="pb-1 text-right font-semibold text-pr-black-soft/70">Coût HT</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr
                      key={l.product_id}
                      className={`border-b border-pr-stone/40 ${l.consumed_qty < 0 ? 'bg-pr-rust/5' : ''}`}
                    >
                      <td className="relative py-1.5">
                        <span className="group inline-block cursor-help border-b border-dotted border-pr-black-soft/30 text-pr-black">
                          {l.product_name}
                          <FormulaTooltip line={l} />
                        </span>
                      </td>
                      <td className="py-1.5 text-right text-xs text-pr-black-soft/50">
                        {l.unit_price_ht != null ? (
                          `${l.unit_price_ht.toFixed(2)} €/${l.unit}`
                        ) : (
                          <span className="text-amber-500">—</span>
                        )}
                      </td>
                      <td className="py-1.5 text-right text-pr-black-soft/70">
                        {l.initial_qty} {l.unit}
                      </td>
                      <td className="py-1.5 text-right">
                        {l.reassort_qty > 0 ? (
                          <span className="text-sky-600">+{l.reassort_qty}</span>
                        ) : (
                          <span className="text-pr-black-soft/30">—</span>
                        )}
                      </td>
                      <td className="py-1.5 text-right text-pr-black-soft/70">
                        {l.final_qty} {l.unit}
                      </td>
                      <td className="py-1.5 text-right font-medium">
                        <span
                          className={
                            l.consumed_qty > 0
                              ? 'text-pr-black'
                              : l.consumed_qty < 0
                                ? 'text-pr-rust'
                                : 'text-pr-black-soft/30'
                          }
                        >
                          {l.consumed_qty} {l.unit}
                        </span>
                      </td>
                      <td className="py-1.5 text-right font-medium">
                        {l.line_cost_ht != null ? (
                          <span className={l.line_cost_ht > 0 ? 'text-pr-black' : 'text-pr-black-soft/30'}>
                            {formatEuro(l.line_cost_ht)}
                          </span>
                        ) : (
                          <span className="text-xs text-amber-500">Prix manquant</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {/* Total général */}
      <div className="border-t-2 border-pr-black pt-3">
        <div className="flex items-baseline justify-between">
          <span className="font-medium text-pr-black">Total F&amp;B consommé</span>
          <span className="font-display text-xl font-black text-pr-black">{formatEuro(totalHT)}</span>
        </div>
        <div className="mt-1 flex items-baseline justify-between text-sm text-pr-black-soft/60">
          <span>TVA ({Math.round(tvaRate * 100)} % estimé)</span>
          <span>+ {formatEuro(totalHT * tvaRate)}</span>
        </div>
        <div className="mt-1 flex items-baseline justify-between text-sm font-medium text-pr-black-soft/80">
          <span>Total TTC estimé</span>
          <span>{formatEuro(totalHT * (1 + tvaRate))}</span>
        </div>
      </div>
    </div>
  );
}
