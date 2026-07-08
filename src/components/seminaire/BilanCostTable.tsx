/**
 * BilanCostTable — synthèse des coûts F&B d'un événement, ligne par ligne.
 * Principe métier : COÛT = prix_unitaire_HT × quantité_consommée, avec
 * quantité_consommée = stock_initial + réassort − COALESCE(stock_final, 0).
 *
 * Source : vue `event_stock_summary` (inclut les produits SANS clôture, dont
 * la consommation est estimée à initial + réassort). Deux anomalies tracées :
 *   - is_missing_cloture : stock final non renseigné → conso estimée (badge ⚠️)
 *   - is_missing_price   : prix HT manquant → exclu du total (RG-005)
 * Regroupé par famille, formule au survol, totaux HT / TVA / TTC.
 * Réservé ROLE_STADE (RG-003).
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EmptyState } from '@/components/ui';
import { formatEuro } from '@/lib/calculations';
import { supabase } from '@/lib/supabase';
import { PackageX } from 'lucide-react';

/** Ligne renvoyée par la vue event_stock_summary. */
interface StockSummaryRow {
  space_id: string;
  space_name: string;
  product_id: string;
  product_name: string;
  category: string;
  unit: string;
  unit_price_ht: number | null;
  initial_qty: number;
  reassort_qty: number;
  final_qty: number | null;
  consumed_qty: number;
  cost_ht: number | null;
  is_missing_cloture: boolean;
  is_missing_price: boolean;
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
  cost_ht: number | null;
  is_missing_cloture: boolean;
  is_missing_price: boolean;
}

const CATEGORY_ORDER = ['Vins', 'Champagnes', 'Bières', 'Soft', 'Sirops', 'Spiritueux', 'Matériel'];

function aggregate(rows: StockSummaryRow[]): Map<string, AggLine[]> {
  const byProduct = new Map<string, AggLine>();
  for (const r of rows) {
    const existing = byProduct.get(r.product_id);
    if (existing) {
      existing.initial_qty += r.initial_qty;
      existing.reassort_qty += r.reassort_qty;
      existing.final_qty += r.final_qty ?? 0;
      existing.consumed_qty += r.consumed_qty;
      existing.cost_ht =
        r.cost_ht == null && existing.cost_ht == null ? null : (existing.cost_ht ?? 0) + (r.cost_ht ?? 0);
      existing.is_missing_cloture = existing.is_missing_cloture || r.is_missing_cloture;
      existing.is_missing_price = existing.is_missing_price || r.is_missing_price;
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
        consumed_qty: r.consumed_qty,
        cost_ht: r.cost_ht,
        is_missing_cloture: r.is_missing_cloture,
        is_missing_price: r.is_missing_price,
      });
    }
  }

  const byCategory = new Map<string, AggLine[]>();
  for (const line of byProduct.values()) {
    const arr = byCategory.get(line.category) ?? [];
    arr.push(line);
    byCategory.set(line.category, arr);
  }
  for (const arr of byCategory.values()) arr.sort((a, b) => a.product_name.localeCompare(b.product_name, 'fr'));
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
        <div>
          − Stock final&nbsp;: {line.is_missing_cloture ? '0 (estimé)' : `${line.final_qty} ${line.unit}`}
        </div>
        <div className="mt-1 border-t border-white/25 pt-1">
          = Consommé&nbsp;: <strong>{line.consumed_qty} {line.unit}</strong>
        </div>
        {line.is_missing_cloture && (
          <div className="text-amber-300">⚠️ Clôture non saisie — conso estimée (tout sorti).</div>
        )}
        <div className="mt-2">
          Prix HT&nbsp;: {line.unit_price_ht != null ? `${line.unit_price_ht.toFixed(2)} €/${line.unit}` : '—'}
        </div>
        {line.cost_ht != null && line.unit_price_ht != null && (
          <div className="border-t border-white/25 pt-1">
            Coût = {line.consumed_qty} × {line.unit_price_ht.toFixed(2)} ={' '}
            <strong>{line.cost_ht.toFixed(2)} € HT</strong>
          </div>
        )}
      </div>
    </div>
  );
}

export function BilanCostTable({ eventId }: { eventId: string }) {
  const [tvaRate] = useState(0.2);

  const { data, isLoading } = useQuery({
    queryKey: ['bilanStockSummary', eventId],
    queryFn: async (): Promise<StockSummaryRow[]> => {
      const { data, error } = await supabase
        .from('event_stock_summary')
        .select(
          'space_id, space_name, product_id, product_name, category, unit, unit_price_ht, initial_qty, reassort_qty, final_qty, consumed_qty, cost_ht, is_missing_cloture, is_missing_price',
        )
        .eq('event_id', eventId)
        .or('initial_qty.gt.0,reassort_qty.gt.0');
      if (error) throw error;
      return (data ?? []) as StockSummaryRow[];
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

  const totalHT = useMemo(() => (data ?? []).reduce((s, l) => s + (l.cost_ht ?? 0), 0), [data]);

  // Produits sans clôture (conso estimée) et sans prix (exclus du total).
  const missingClotures = useMemo(() => {
    const seen = new Map<string, string>();
    for (const l of data ?? []) if (l.is_missing_cloture) seen.set(l.product_id, l.product_name);
    return [...seen.values()].sort((a, b) => a.localeCompare(b, 'fr'));
  }, [data]);

  const missingPrice = useMemo(() => {
    const seen = new Map<string, string>();
    for (const l of data ?? []) if (l.is_missing_price && l.consumed_qty !== 0) seen.set(l.product_id, l.product_name);
    return [...seen.values()].sort((a, b) => a.localeCompare(b, 'fr'));
  }, [data]);

  if (isLoading) return <p className="text-sm text-slate-500">Chargement des coûts…</p>;
  if ((data ?? []).length === 0) {
    return (
      <EmptyState
        icon={PackageX}
        title="Aucun mouvement de stock"
        message="Les coûts s'afficheront dès qu'un stock initial ou un réassort aura été saisi."
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Alerte clôtures manquantes */}
      {missingClotures.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          ⚠️ {missingClotures.length} produit(s) sans stock final renseigné — consommation estimée à{' '}
          <strong>initial + réassort</strong> (tout le stock sorti) :{' '}
          <span className="font-medium">{missingClotures.join(', ')}</span>
          <span className="mt-1 block text-amber-600">
            Demande au régisseur de compléter la clôture pour un chiffre exact.
          </span>
        </div>
      )}

      {orderedCategories.map((cat) => {
        const lines = byCategory.get(cat) ?? [];
        const catTotal = lines.reduce((s, l) => s + (l.cost_ht ?? 0), 0);
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
                      className={`border-b border-pr-stone/40 ${
                        l.is_missing_cloture ? 'bg-amber-50/70' : l.consumed_qty < 0 ? 'bg-pr-rust/5' : ''
                      }`}
                    >
                      <td className="relative py-1.5">
                        <span className="group inline-flex items-center gap-1.5">
                          <span className="cursor-help border-b border-dotted border-pr-black-soft/30 text-pr-black">
                            {l.product_name}
                            <FormulaTooltip line={l} />
                          </span>
                          {l.is_missing_cloture && (
                            <span
                              className="rounded border border-amber-200 bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700"
                              title="Stock final non renseigné — consommation estimée"
                            >
                              ⚠️ estimé
                            </span>
                          )}
                          {l.is_missing_price && (
                            <span className="rounded border border-red-200 bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-600">
                              prix manquant
                            </span>
                          )}
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
                        {l.is_missing_cloture ? (
                          <span className="font-medium text-amber-500" title="Stock final non renseigné">
                            ⚠️ N/R
                          </span>
                        ) : (
                          <>
                            {l.final_qty} {l.unit}
                          </>
                        )}
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
                        {l.cost_ht != null ? (
                          <span className={l.cost_ht > 0 ? 'text-pr-black' : 'text-pr-black-soft/30'}>
                            {formatEuro(l.cost_ht)}
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
        {missingClotures.length > 0 && (
          <p className="mt-2 text-xs text-amber-600">
            ⚠️ Ce total inclut {missingClotures.length} produit(s) estimé(s) (stock final non renseigné) — le chiffre
            réel peut être inférieur.
          </p>
        )}
      </div>

      {missingPrice.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          💰 {missingPrice.length} produit(s) consommé(s) sans prix HT, exclus du total :{' '}
          <span className="font-medium">{missingPrice.join(', ')}</span>
          <span className="mt-1 block text-amber-600">
            Renseigne le prix dans le Catalogue pour compléter le coût total.
          </span>
        </div>
      )}
    </div>
  );
}
