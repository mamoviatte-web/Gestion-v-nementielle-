/**
 * CoefficientsPage (ROLE_STADE) — coefficients de consommation par espace.
 * Dotations intelligentes : chaque combinaison espace × produit reçoit un
 * coefficient vs la moyenne du profil d'espace, calculé sur l'historique des
 * matchs clôturés (vue v_space_dotation_recommendations).
 *
 * PostgREST sérialise numeric en chaînes → coercition Number() au chargement.
 */

import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface Row {
  space_name: string; service_type: string | null; product_name: string; category: string; unit: string;
  moy_historique: number; coeff_espace: number; qte_recommandee: number | null; nb_matchs_historique: number;
  confidence_level: string; min_consumption: number; max_consumption: number;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const coeffStyle = (c: number) =>
  c >= 1.5 ? { color: '#DC2626', bg: 'bg-red-50', label: '🔺 Forte' }
  : c >= 1.2 ? { color: '#F97316', bg: 'bg-amber-50', label: '↑ Élevée' }
  : c <= 0.5 ? { color: '#2563EB', bg: 'bg-blue-50', label: '🔻 Faible' }
  : c <= 0.8 ? { color: '#7C3AED', bg: 'bg-purple-50', label: '↓ Basse' }
  : { color: '#059669', bg: 'bg-green-50', label: '→ Normale' };

const CONFIDENCE_DOTS: Record<string, string> = {
  faible: '●○○○', moyen: '●●○○', élevé: '●●●○', 'très élevé': '●●●●',
};

const INSIGHTS: { space: string; product: string; coeff: number; detail: string }[] = [
  { space: 'Salon Sud', product: 'San Pellegrino bouteille', coeff: 1.49, detail: 'consomme 3× plus que Salon Nord' },
  { space: 'Salon Nord', product: 'Lillet Blanc', coeff: 2.0, detail: 'exclusif Salon Nord (×2.0 vs ×0.0 au Sud)' },
  { space: 'Salon Nord', product: 'Perrier grande bouteille', coeff: 1.58, detail: '3.8× plus que Salon Sud' },
  { space: 'Salon Nord', product: 'Rosé Miraval', coeff: 1.64, detail: '4.5× plus que Salon Sud' },
  { space: 'Loges Est', product: 'Bière en verre', coeff: 1.82, detail: '4× plus que Loges Ouest Nord' },
  { space: 'Loges Est', product: 'Pepsi bouteille', coeff: 2.09, detail: '5× plus que Loges Ouest Nord' },
  { space: 'Wine Bar Nord', product: 'Bière en verre', coeff: 1.25, detail: '25% plus que Wine Bar Sud' },
  { space: 'Wine Bar Sud', product: 'Cristalline 50CL', coeff: 1.34, detail: '2× plus que Wine Bar Nord' },
  { space: 'Bistrot', product: 'Lillet Blanc', coeff: 1.5, detail: '3.9× plus que Comptoir' },
  { space: 'Salon Sud', product: 'MUMM Cordon Rouge', coeff: 1.32, detail: '94% de plus que Salon Nord' },
];

export default function CoefficientsPage() {
  const [data, setData] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [filterSpace, setFilterSpace] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [sortBy, setSortBy] = useState<'coeff_desc' | 'coeff_asc' | 'moy'>('coeff_desc');

  async function fetchData() {
    setLoading(true);
    const { data: rows } = await supabase.from('v_space_dotation_recommendations').select('*');
    setData((rows ?? []).map((r): Row => ({
      space_name: String(r.space_name), service_type: r.service_type == null ? null : String(r.service_type),
      product_name: String(r.product_name), category: String(r.category), unit: String(r.unit ?? ''),
      moy_historique: num(r.moy_historique), coeff_espace: num(r.coeff_espace),
      qte_recommandee: r.qte_recommandee == null ? null : num(r.qte_recommandee),
      nb_matchs_historique: num(r.nb_matchs_historique), confidence_level: String(r.confidence_level ?? 'faible'),
      min_consumption: num(r.min_consumption), max_consumption: num(r.max_consumption),
    })));
    setLoading(false);
  }

  useEffect(() => { void fetchData(); }, []);

  async function recompute() {
    setComputing(true);
    await supabase.rpc('compute_space_coefficients');
    await fetchData();
    setComputing(false);
  }

  const spaces = useMemo(() => [...new Set(data.map((d) => d.space_name))].sort(), [data]);
  const categories = useMemo(() => [...new Set(data.map((d) => d.category))].sort(), [data]);

  const filtered = useMemo(() => {
    const rows = data.filter((d) => !filterSpace || d.space_name === filterSpace).filter((d) => !filterCat || d.category === filterCat);
    if (sortBy === 'coeff_desc') rows.sort((a, b) => b.coeff_espace - a.coeff_espace);
    if (sortBy === 'coeff_asc') rows.sort((a, b) => a.coeff_espace - b.coeff_espace);
    if (sortBy === 'moy') rows.sort((a, b) => b.moy_historique - a.moy_historique);
    return rows;
  }, [data, filterSpace, filterCat, sortBy]);

  const anomalies = data.filter((d) => d.coeff_espace >= 1.5 || d.coeff_espace <= 0.5).length;
  const highDemand = data.filter((d) => d.coeff_espace >= 1.3).length;
  const lowDemand = data.filter((d) => d.coeff_espace <= 0.7).length;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6" style={{ background: '#FAFAF8' }}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="h-8 w-1.5 rounded-full bg-amber-500" />
            <h1 className="text-3xl font-black text-stone-900">Coefficients de consommation</h1>
          </div>
          <p className="ml-3.5 mt-1 text-sm text-stone-400">Dotations intelligentes par espace spécifique · historique des matchs clôturés</p>
        </div>
        <button onClick={() => void recompute()} disabled={computing} className="flex items-center gap-2 rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
          <RefreshCw size={14} className={computing ? 'animate-spin' : ''} /> {computing ? 'Recalcul…' : 'Recalculer'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: 'Combinaisons espace×produit', value: data.length, icon: '📊', accent: '#1A1A2E' },
          { label: 'Anomalies (×1.5 ou ÷2)', value: anomalies, icon: '⚡', accent: '#DC2626' },
          { label: 'Forte demande (coeff > 1.3)', value: highDemand, icon: '🔺', accent: '#F97316' },
          { label: 'Faible demande (coeff < 0.7)', value: lowDemand, icon: '🔻', accent: '#2563EB' },
        ].map((k) => (
          <div key={k.label} className="relative overflow-hidden rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
            <div className="absolute inset-x-0 top-0 h-1 rounded-t-2xl" style={{ background: k.accent }} />
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">{k.label}</p>
              <span className="text-xl">{k.icon}</span>
            </div>
            <p className="text-3xl font-black text-stone-900">{k.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
        <h3 className="mb-4 font-bold text-stone-800">💡 Insights majeurs (5 matchs analysés)</h3>
        <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          {INSIGHTS.map((insight) => {
            const s = coeffStyle(insight.coeff);
            return (
              <div key={`${insight.space}-${insight.product}`} className={`${s.bg} flex items-center gap-3 rounded-xl px-3 py-2.5`}>
                <div className="min-w-[3.5rem] text-center text-lg font-black" style={{ color: s.color }}>×{insight.coeff.toFixed(2)}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-stone-800">{insight.space} — {insight.product}</p>
                  <p className="text-xs text-stone-500">{insight.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <select value={filterSpace} onChange={(e) => setFilterSpace(e.target.value)} className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
          <option value="">Tous les espaces</option>
          {spaces.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)} className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
          <option value="">Toutes catégories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="flex overflow-hidden rounded-xl border border-stone-200 bg-white text-sm">
          {([{ key: 'coeff_desc', label: '↓ Coeff' }, { key: 'coeff_asc', label: '↑ Coeff' }, { key: 'moy', label: 'Moy.' }] as const).map((s) => (
            <button key={s.key} onClick={() => setSortBy(s.key)} className={`px-3 py-2 font-medium transition-colors ${sortBy === s.key ? 'bg-stone-900 text-white' : 'text-stone-500 hover:bg-stone-50'}`}>{s.label}</button>
          ))}
        </div>
        <span className="self-center text-xs text-stone-400">{filtered.length} résultats</span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-stone-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50">
                {['Espace', 'Produit', 'Catégorie', 'Moy./match', 'Coefficient', 'Signal', 'Recommandé', 'Confiance', 'Min-Max'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-stone-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-50">
              {loading ? (
                <tr><td colSpan={9} className="py-10 text-center text-stone-400">Chargement…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="py-10 text-center text-sm text-stone-400">Aucun coefficient calculé — l'historique se remplit à la clôture des matchs.</td></tr>
              ) : filtered.slice(0, 100).map((row, i) => {
                const s = coeffStyle(row.coeff_espace);
                return (
                  <tr key={i} className="transition-colors hover:bg-stone-50">
                    <td className="px-4 py-3"><p className="whitespace-nowrap text-xs font-semibold text-stone-800">{row.space_name}</p><p className="text-[10px] text-stone-400">{row.service_type}</p></td>
                    <td className="px-4 py-3 font-medium text-stone-700">{row.product_name}</td>
                    <td className="px-4 py-3"><span className="rounded-lg bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{row.category}</span></td>
                    <td className="px-4 py-3 font-bold text-stone-800">{row.moy_historique.toFixed(1)}<span className="ml-1 text-xs font-normal text-stone-400">{row.unit}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-black" style={{ color: s.color }}>×{row.coeff_espace.toFixed(2)}</span>
                        <div className="h-2 w-16 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full" style={{ width: `${Math.min(row.coeff_espace * 50, 100)}%`, background: s.color }} /></div>
                      </div>
                    </td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.bg}`} style={{ color: s.color }}>{s.label}</span></td>
                    <td className="px-4 py-3"><span className="font-black text-stone-900">{row.qte_recommandee ?? '—'}</span><span className="ml-1 text-xs text-stone-400">{row.unit}</span></td>
                    <td className="px-4 py-3"><div className="flex items-center gap-1"><span className="font-mono text-xs text-stone-500">{CONFIDENCE_DOTS[row.confidence_level] ?? '○○○○'}</span><span className="text-[10px] text-stone-400">{row.nb_matchs_historique}M</span></div></td>
                    <td className="px-4 py-3 text-xs text-stone-400">{row.min_consumption.toFixed(0)}–{row.max_consumption.toFixed(0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
