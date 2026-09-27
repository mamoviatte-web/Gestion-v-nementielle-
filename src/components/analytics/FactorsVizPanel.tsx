/**
 * FactorsVizPanel — lecture VISUELLE des facteurs historiques (espace × produit).
 * « Lire entre les lignes avec certitude » : chaque produit est montré par sa
 * MOYENNE et sa bande d'incertitude ±écart-type (≈ intervalle 68 %), couleur de
 * famille. On voit d'un coup l'estimation centrale ET sa fiabilité.
 * + Répartition du niveau de confiance de l'espace sélectionné.
 * Div/SVG natif, texte réel, palette catégorielle validée.
 */

import { useMemo, useState } from 'react';
import { catColor } from '@/lib/categoryColors';

export interface FactorVizRow {
  space_name: string;
  product_name: string;
  category: string;
  moy_historique: number;
  std_deviation: number;
  confidence_level: string;
  conso_per_100_pax: number;
  nb_matchs_historique: number;
  pax_normalized: boolean;
}

const CONF_ORDER = ['très élevé', 'élevé', 'moyen', 'faible'];
const CONF_COLOR: Record<string, string> = {
  'très élevé': '#1D7A46', 'élevé': '#4FA96B', 'moyen': '#C98A1E', 'faible': '#B03A2E',
};
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function FactorsVizPanel({ rows }: { rows: FactorVizRow[] }) {
  const spaces = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.space_name, (m.get(r.space_name) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  }, [rows]);
  const [space, setSpace] = useState<string>('');
  const activeSpace = space && spaces.includes(space) ? space : spaces[0] ?? '';

  const spaceRows = useMemo(
    () => rows.filter((r) => r.space_name === activeSpace && num(r.moy_historique) > 0)
      .sort((a, b) => num(b.moy_historique) - num(a.moy_historique))
      .slice(0, 15),
    [rows, activeSpace],
  );

  const scaleMax = useMemo(
    () => Math.max(1, ...spaceRows.map((r) => num(r.moy_historique) + num(r.std_deviation))),
    [spaceRows],
  );

  const confDist = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows.filter((r) => r.space_name === activeSpace)) m.set(r.confidence_level, (m.get(r.confidence_level) ?? 0) + 1);
    const total = [...m.values()].reduce((s, v) => s + v, 0) || 1;
    return CONF_ORDER.filter((c) => m.has(c)).map((c) => ({ level: c, n: m.get(c) ?? 0, pct: Math.round(((m.get(c) ?? 0) / total) * 100) }));
  }, [rows, activeSpace]);

  if (spaces.length === 0) return null;

  return (
    <div className="rounded-2xl border border-stone-100 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-stone-700">📈 Lecture visuelle — moyenne &amp; incertitude (±σ)</p>
        <select
          value={activeSpace}
          onChange={(e) => setSpace(e.target.value)}
          className="rounded-xl border border-stone-200 py-1.5 pl-3 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
        >
          {spaces.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Intervalle moyenne ± écart-type par produit (top 15 par moyenne) */}
      <div className="space-y-1.5">
        {spaceRows.map((r) => {
          const moy = num(r.moy_historique), sig = num(r.std_deviation);
          const lo = Math.max(0, moy - sig), hi = moy + sig;
          const color = catColor(r.category);
          return (
            <div
              key={r.product_name}
              className="flex items-center gap-2"
              title={`${r.product_name} — ${r.category}\nMoyenne ${moy.toFixed(1)} ± ${sig.toFixed(1)} (fourchette ${lo.toFixed(1)}–${hi.toFixed(1)})\n${r.pax_normalized ? `${num(r.conso_per_100_pax).toFixed(1)} /100 pax · ` : ''}${num(r.nb_matchs_historique)} match(s) · confiance ${r.confidence_level || '—'}`}
            >
              <span className="w-32 shrink-0 truncate text-xs font-medium text-stone-600 sm:w-40">{r.product_name}</span>
              <div className="relative h-5 flex-1 rounded bg-stone-100">
                {/* bande ±σ */}
                <div className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full opacity-30" style={{ left: `${(lo / scaleMax) * 100}%`, width: `${((hi - lo) / scaleMax) * 100}%`, background: color }} />
                {/* marqueur moyenne */}
                <div className="absolute top-1/2 h-3.5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded" style={{ left: `${(moy / scaleMax) * 100}%`, background: color }} />
              </div>
              <span className="w-24 shrink-0 text-right text-xs tabular-nums text-stone-700">
                <span className="font-semibold text-stone-900">{moy.toFixed(1)}</span>
                <span className="text-stone-400"> ±{sig.toFixed(1)}</span>
              </span>
            </div>
          );
        })}
        {spaceRows.length === 0 && <p className="py-6 text-center text-sm text-stone-400">Aucune moyenne historique sur cet espace.</p>}
      </div>

      {/* Répartition de la confiance (fiabilité de l'échantillon) */}
      {confDist.length > 0 && (
        <div className="mt-4 border-t border-stone-100 pt-3">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-stone-400">Fiabilité — niveau de confiance</p>
          <div className="flex h-4 w-full overflow-hidden rounded-full">
            {confDist.map((c) => (
              <div key={c.level} className="h-full" style={{ width: `${c.pct}%`, background: CONF_COLOR[c.level] ?? '#94A2B3' }} title={`${c.level} : ${c.n} produit(s) (${c.pct} %)`} />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {confDist.map((c) => (
              <span key={c.level} className="flex items-center gap-1.5 text-xs text-stone-600">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CONF_COLOR[c.level] ?? '#94A2B3' }} />
                {c.level} · <span className="font-semibold tabular-nums">{c.n}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
