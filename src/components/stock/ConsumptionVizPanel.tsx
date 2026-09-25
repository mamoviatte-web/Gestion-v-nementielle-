/**
 * ConsumptionVizPanel — lecture VISUELLE de la consommation d'un espace
 * (Jour J / Clôture). Remplace la lecture ligne à ligne de chiffres par des
 * barres : on voit d'un coup d'œil les postes de coût et le taux d'écoulement.
 *
 * Deux graphiques (barres horizontales, couleur = famille + libellé direct,
 * survol détaillé) : Top produits par coût HT · Coût par famille.
 * Aucune dépendance de charting : SVG/div natif, texte réel, lisible clair/sombre.
 */

import { useMemo } from 'react';
import { catColor, catRank } from '@/lib/categoryColors';
import { formatEuro } from '@/lib/calculations';

export interface VizRow {
  product_name: string;
  category: string;
  consumed: number | null;
  cost: number | null;
  recu: number; // initial + réassort
  final: number | null;
}

const pctOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** Barre horizontale unitaire : libellé · piste · valeur (survol = détail). */
function Bar({
  label, value, ratio, color, title,
}: {
  label: string; value: string; ratio: number; color: string; title: string;
}) {
  return (
    <div className="flex items-center gap-2" title={title}>
      <span className="w-28 shrink-0 truncate text-xs font-medium text-pr-black-soft/75 sm:w-36">{label}</span>
      <div className="relative h-4 flex-1 overflow-hidden rounded bg-pr-stone/40">
        <div
          className="h-full rounded"
          style={{ width: `${Math.max(ratio * 100, value === '—' ? 0 : 2)}%`, background: color }}
        />
      </div>
      <span className="w-20 shrink-0 text-right text-xs font-semibold tabular-nums text-pr-black">{value}</span>
    </div>
  );
}

export function ConsumptionVizPanel({ rows }: { rows: VizRow[] }) {
  // Produits réellement consommés & valorisés (coût connu, conso > 0).
  const priced = useMemo(
    () => rows.filter((r) => (r.cost ?? 0) > 0).sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0)),
    [rows],
  );
  const totalCost = useMemo(() => priced.reduce((s, r) => s + (r.cost ?? 0), 0), [priced]);

  // Top produits par coût HT (les 8 premiers ; le reste agrégé en « Autres »).
  const topProducts = useMemo(() => {
    const head = priced.slice(0, 8);
    const tailCost = priced.slice(8).reduce((s, r) => s + (r.cost ?? 0), 0);
    const items = head.map((r) => ({
      label: r.product_name,
      cost: r.cost ?? 0,
      color: catColor(r.category),
      title: `${r.product_name} — ${r.category}\nConsommé ${r.consumed ?? 0} · ${formatEuro(r.cost)} (${pctOf(r.cost ?? 0, totalCost)} % du coût)`,
    }));
    if (tailCost > 0) items.push({ label: `Autres (${priced.length - 8})`, cost: tailCost, color: '#94A2B3', title: `${priced.length - 8} autres produits — ${formatEuro(tailCost)}` });
    return items;
  }, [priced, totalCost]);

  // Coût par famille (catégorie), ordre catégoriel fixe.
  const byFamily = useMemo(() => {
    const map = new Map<string, { cost: number; consumed: number }>();
    for (const r of priced) {
      const cur = map.get(r.category) ?? { cost: 0, consumed: 0 };
      cur.cost += r.cost ?? 0;
      cur.consumed += r.consumed ?? 0;
      map.set(r.category, cur);
    }
    return [...map.entries()]
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => catRank(a.category) - catRank(b.category) || b.cost - a.cost);
  }, [priced]);

  const maxProd = topProducts.reduce((m, x) => Math.max(m, x.cost), 0) || 1;
  const maxFam = byFamily.reduce((m, x) => Math.max(m, x.cost), 0) || 1;

  if (priced.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-pr-stone bg-pr-cream/30 px-4 py-6 text-center text-sm text-pr-black-soft/50">
        Les graphiques de consommation s'afficheront dès qu'un coût sera valorisé (stock final saisi).
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {/* Top produits par coût HT */}
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <p className="text-xs font-bold uppercase tracking-wide text-pr-black-soft/45">Top produits · coût HT</p>
          <p className="text-xs text-pr-black-soft/50">total {formatEuro(totalCost)}</p>
        </div>
        <div className="space-y-1.5">
          {topProducts.map((it) => (
            <Bar
              key={it.label}
              label={it.label}
              value={formatEuro(it.cost)}
              ratio={it.cost / maxProd}
              color={it.color}
              title={it.title}
            />
          ))}
        </div>
      </div>

      {/* Coût par famille */}
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <p className="text-xs font-bold uppercase tracking-wide text-pr-black-soft/45">Coût par famille</p>
          <p className="text-xs text-pr-black-soft/50">{byFamily.length} famille(s)</p>
        </div>
        <div className="space-y-1.5">
          {byFamily.map((f) => (
            <Bar
              key={f.category}
              label={f.category}
              value={formatEuro(f.cost)}
              ratio={f.cost / maxFam}
              color={catColor(f.category)}
              title={`${f.category} — ${f.consumed} unité(s) consommée(s) · ${formatEuro(f.cost)} (${pctOf(f.cost, totalCost)} % du coût)`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * ConsumptionBar — micro-barre inline (colonne Conso. du tableau) : part écoulée
 * du stock reçu, couleur de la famille. Rend la conso lisible d'un regard.
 */
export function ConsumptionBar({
  consumed, recu, category,
}: {
  consumed: number; recu: number; category: string;
}) {
  const ratio = recu > 0 ? Math.min(consumed / recu, 1) : 0;
  return (
    <div
      className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-pr-stone/40"
      title={`${consumed} / ${recu} reçu écoulé (${pctOf(consumed, recu)} %)`}
    >
      <div className="h-full rounded-full" style={{ width: `${Math.max(ratio * 100, consumed > 0 ? 4 : 0)}%`, background: catColor(category) }} />
    </div>
  );
}
