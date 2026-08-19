/**
 * DataPilotFacteursPage (ROLE_STADE) — référentiel « Facteurs historiques ».
 *
 * Donnée DÉRIVÉE (jamais saisie à la main) : pour chaque espace × produit, les
 * facteurs statistiques calculés sur l'historique des matchs clôturés —
 * moyenne, écart-type, niveau de confiance, conso normalisée /100 pax, nombre de
 * matchs. Ils alimentent la génération des dotations runner et l'analyse conso.
 * Le recalcul se déclenche dans DataPilot → Coefficients (compute_space_coefficients).
 * Source : vue `v_space_dotation_recommendations`. Route : /admin/datapilot/facteurs.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Database, Sigma, ExternalLink, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface FactorRow {
  space_name: string;
  service_type: string | null;
  product_name: string;
  category: string;
  moy_historique: number;
  std_deviation: number;
  confidence_level: string;
  conso_per_100_pax: number;
  avg_pax_match: number;
  nb_matchs_historique: number;
  pax_normalized: boolean;
  last_computed_at: string | null;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const CONF_STYLE: Record<string, string> = {
  élevé: 'bg-emerald-100 text-emerald-700', moyen: 'bg-amber-100 text-amber-700',
  faible: 'bg-rose-100 text-rose-700',
};

export default function DataPilotFacteursPage() {
  const [rows, setRows] = useState<FactorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => {
    void supabase.from('v_space_dotation_recommendations')
      .select('space_name, service_type, product_name, category, moy_historique, std_deviation, confidence_level, conso_per_100_pax, avg_pax_match, nb_matchs_historique, pax_normalized, last_computed_at')
      .then(({ data }) => {
        setRows((data ?? []) as FactorRow[]);
        setLoading(false);
      });
  }, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => `${r.space_name} ${r.product_name} ${r.category}`.toLowerCase().includes(t));
  }, [rows, q]);

  const lastComputed = useMemo(() => {
    const ds = rows.map((r) => r.last_computed_at).filter(Boolean) as string[];
    return ds.length ? ds.sort().slice(-1)[0] : null;
  }, [rows]);

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="h-8 w-1.5 rounded-full bg-violet-500" />
          <div>
            <h1 className="text-2xl font-black text-stone-900">Facteurs historiques</h1>
            <p className="text-sm text-stone-400">Moyenne, écart-type, confiance, /100 pax — dérivés de l'historique, non éditables.</p>
          </div>
        </div>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-300" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer espace / produit…"
            className="rounded-xl border border-stone-200 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-xs leading-relaxed text-violet-900">
        <Database size={16} className="mt-0.5 shrink-0" />
        <p><b>D'où ça vient :</b> conso réelle des matchs clôturés → agrégée dans <code>space_product_coefficients</code>. <b>Ce que ça pilote :</b> quantités recommandées des dotations runner et analyse conso. <b>Non éditable</b> — le recalcul se déclenche dans <Link to="/admin/datapilot/coefficients" className="font-semibold underline">Coefficients</Link>.
        {lastComputed && <> Dernier calcul : {new Date(lastComputed).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}.</>}</p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-stone-100 bg-white">
        <div className="flex items-center gap-2 border-b border-stone-100 bg-stone-50 px-4 py-2 text-sm font-bold text-stone-700">
          <Sigma size={15} />Facteurs par espace × produit<span className="ml-1 text-xs font-normal text-stone-400">({filtered.length})</span>
        </div>
        {loading ? (
          <div className="h-64 animate-pulse bg-stone-50" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-100 text-left text-xs uppercase tracking-wide text-stone-400">
                  <th className="px-4 py-2">Espace</th>
                  <th className="px-3 py-2">Produit</th>
                  <th className="px-3 py-2 text-right">Moy.</th>
                  <th className="px-3 py-2 text-right">Écart-type</th>
                  <th className="px-3 py-2 text-right">/100 pax</th>
                  <th className="px-3 py-2 text-right">Matchs</th>
                  <th className="px-4 py-2">Confiance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50">
                {filtered.map((r, i) => (
                  <tr key={`${r.space_name}-${r.product_name}-${i}`} className="text-stone-800">
                    <td className="px-4 py-2 font-medium">{r.space_name}</td>
                    <td className="px-3 py-2 text-stone-600">{r.product_name}<span className="ml-1 text-xs text-stone-400">{r.category}</span></td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(r.moy_historique).toFixed(1)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-stone-500">±{num(r.std_deviation).toFixed(1)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.pax_normalized ? num(r.conso_per_100_pax).toFixed(1) : <span className="text-stone-300" title="Non normalisé pax">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-stone-500">{num(r.nb_matchs_historique)}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${CONF_STYLE[r.confidence_level] ?? 'bg-stone-100 text-stone-500'}`}>
                        {r.confidence_level || '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Link to="/admin/datapilot/coefficients" className="inline-flex items-center gap-1.5 text-sm font-semibold text-violet-700 hover:text-violet-900">
        <ExternalLink size={14} />Voir / recalculer les coefficients
      </Link>
    </div>
  );
}
