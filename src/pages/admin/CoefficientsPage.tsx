/**
 * CoefficientsPage (ROLE_STADE) — coefficients de consommation par espace.
 * Dotations intelligentes : chaque combinaison espace × produit reçoit un
 * coefficient vs la moyenne du profil d'espace, calculé sur l'historique des
 * matchs clôturés (vue v_space_dotation_recommendations).
 *
 * PostgREST sérialise numeric en chaînes → coercition Number() au chargement.
 */

import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, RotateCcw, AlertTriangle, ChevronDown, ChevronRight, FileSpreadsheet } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { downloadAoaWorkbook, type AoaCell, type AoaSheetOut } from '@/lib/xlsxAoa';
import { INT, DEC1, PCT, type ColumnStyle } from '@/lib/excelTheme';

interface Row {
  space_name: string; service_type: string | null; product_name: string; category: string; unit: string;
  moy_historique: number; std_deviation: number; coeff_espace: number; qte_recommandee: number | null; nb_matchs_historique: number;
  confidence_level: string; min_consumption: number; max_consumption: number;
  conso_per_100_pax: number; pax_normalized: boolean; avg_pax_match: number; last_computed_at: string | null;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/* Niveaux de confiance : ordre + palette (identiques à FactorsVizPanel). */
const CONF_ORDER = ['très élevé', 'élevé', 'moyen', 'faible'];
const CONF_COLOR: Record<string, string> = {
  'très élevé': '#1D7A46', 'élevé': '#4FA96B', 'moyen': '#C98A1E', 'faible': '#B03A2E',
};

/* Styles de colonnes Excel (charte excelTheme). */
const colLeft: ColumnStyle = { align: 'left' };
const colCenter: ColumnStyle = { align: 'center' };
const colDec1: ColumnStyle = { numFmt: DEC1, align: 'right' };
const colCoeff: ColumnStyle = { numFmt: '0.00', align: 'right' };
const colInt: ColumnStyle = { numFmt: INT, align: 'right' };
const colIntC: ColumnStyle = { numFmt: INT, align: 'center' };
const colPart: ColumnStyle = { numFmt: PCT };

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
  { space: 'Loges Est', product: 'BUD bouteille 33cl', coeff: 1.82, detail: '4× plus que Loges Ouest Nord' },
  { space: 'Loges Est', product: 'Pepsi bouteille', coeff: 2.09, detail: '5× plus que Loges Ouest Nord' },
  { space: 'Wine Bar Nord', product: 'BUD bouteille 33cl', coeff: 1.25, detail: '25% plus que Wine Bar Sud' },
  { space: 'Wine Bar Sud', product: 'Cristalline 50CL', coeff: 1.34, detail: '2× plus que Wine Bar Nord' },
  { space: 'Bistrot', product: 'Lillet Blanc', coeff: 1.5, detail: '3.9× plus que Comptoir' },
  { space: 'Salon Sud', product: 'MUMM Cordon Rouge', coeff: 1.32, detail: '94% de plus que Salon Nord' },
];

export default function CoefficientsPage() {
  const [data, setData] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [filterSpace, setFilterSpace] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [sortBy, setSortBy] = useState<'coeff_desc' | 'coeff_asc' | 'moy'>('coeff_desc');
  const [simulPax, setSimulPax] = useState<number>(0);
  const [showTable, setShowTable] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function fetchData() {
    setLoading(true);
    const { data: rows } = await supabase.from('v_space_dotation_recommendations').select('*');
    setData((rows ?? []).map((r): Row => ({
      space_name: String(r.space_name), service_type: r.service_type == null ? null : String(r.service_type),
      product_name: String(r.product_name), category: String(r.category), unit: String(r.unit ?? ''),
      moy_historique: num(r.moy_historique), std_deviation: num(r.std_deviation), coeff_espace: num(r.coeff_espace),
      qte_recommandee: r.qte_recommandee == null ? null : num(r.qte_recommandee),
      nb_matchs_historique: num(r.nb_matchs_historique), confidence_level: String(r.confidence_level ?? 'faible'),
      min_consumption: num(r.min_consumption), max_consumption: num(r.max_consumption),
      conso_per_100_pax: num(r.conso_per_100_pax), pax_normalized: r.pax_normalized === true,
      avg_pax_match: num(r.avg_pax_match), last_computed_at: r.last_computed_at == null ? null : String(r.last_computed_at),
    })));
    setLoading(false);
  }

  useEffect(() => { void fetchData(); }, []);

  async function recompute() {
    setComputing(true);
    setFeedback(null);
    const { data: res, error } = await supabase.rpc('compute_space_coefficients');
    await fetchData();
    setComputing(false);
    if (error) setFeedback(`Erreur : ${error.message}`);
    else if (res && typeof res === 'object' && 'message' in res) setFeedback(String((res as { message?: unknown }).message ?? 'Recalcul terminé.'));
    else setFeedback('Recalcul terminé.');
  }

  async function resetAll() {
    setResetting(true);
    setFeedback(null);
    const { data: res, error } = await supabase.rpc('reset_all_coefficients');
    await fetchData();
    setResetting(false);
    setShowReset(false);
    if (error) setFeedback(`Erreur : ${error.message}`);
    else if (res && typeof res === 'object' && 'message' in res) setFeedback(String((res as { message?: unknown }).message ?? 'Reset terminé.'));
    else setFeedback('Reset terminé.');
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

  // Dernier recalcul (max des dates de calcul).
  const lastComputed = useMemo(() => {
    const ds = data.map((d) => d.last_computed_at).filter(Boolean) as string[];
    return ds.length ? ds.sort().slice(-1)[0] : null;
  }, [data]);
  const lastComputedLabel = lastComputed
    ? new Date(lastComputed).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';

  // Répartition par niveau de confiance.
  const confDist = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of data) m.set(d.confidence_level, (m.get(d.confidence_level) ?? 0) + 1);
    const total = [...m.values()].reduce((s, v) => s + v, 0) || 1;
    return CONF_ORDER.filter((c) => m.has(c)).map((c) => ({ level: c, n: m.get(c) ?? 0, pct: Math.round(((m.get(c) ?? 0) / total) * 100) }));
  }, [data]);

  // Top coefficients (demande la plus forte), triés décroissant.
  const topCoeffs = useMemo(() => [...data].sort((a, b) => b.coeff_espace - a.coeff_espace).slice(0, 12), [data]);
  const coeffMax = useMemo(() => Math.max(1, ...topCoeffs.map((r) => r.coeff_espace)), [topCoeffs]);

  /**
   * Export Excel complet et habillé (charte excelTheme via downloadAoaWorkbook) :
   *  - feuille « Synthèse » : KPIs + répartition de confiance + top coefficients ;
   *  - feuille « Coefficients » : détail ligne-à-ligne complet (toutes colonnes,
   *    tous les couples espace × produit, hors filtre écran).
   */
  async function exportExcel() {
    setExporting(true);
    try {
      const totalConf = confDist.reduce((s, c) => s + c.n, 0);
      const synthAoa: AoaCell[][] = [
        ['Coefficients de consommation — Provence Rugby · Stade Maurice-David'],
        [],
        ['Indicateur', 'Valeur', 'Détail'],
        ['Combinaisons espace × produit', data.length, 'couples analysés'],
        ['Anomalies (×1.5 ou ÷2)', anomalies, 'coefficient extrême'],
        ['Forte demande (coeff > 1.3)', highDemand, ''],
        ['Faible demande (coeff < 0.7)', lowDemand, ''],
        ['Dernier recalcul', lastComputedLabel, ''],
        [],
        ['Répartition par niveau de confiance', 'Nb couples', 'Part'],
        ...confDist.map((c): AoaCell[] => [c.level, c.n, totalConf > 0 ? c.n / totalConf : 0]),
        ['Total', totalConf, totalConf > 0 ? 1 : 0],
        [],
        ['Top coefficients', 'Coefficient', 'Espace — Produit'],
        ...topCoeffs.map((r): AoaCell[] => [`${r.space_name} — ${r.product_name}`, r.coeff_espace, r.category]),
      ];

      const detail = [...data].sort(
        (a, b) => a.space_name.localeCompare(b.space_name, 'fr') || b.coeff_espace - a.coeff_espace,
      );
      const detailAoa: AoaCell[][] = [
        ['Détail des coefficients — espace × produit'],
        [],
        ['Espace', 'Service', 'Produit', 'Catégorie', 'Moy./match', 'Écart-type', 'Coefficient', 'Signal', '/100 pax', 'Nb matchs', 'Confiance', 'Recommandé', 'Min', 'Max'],
        ...detail.map((r): AoaCell[] => [
          r.space_name,
          r.service_type ?? '',
          r.product_name,
          r.category,
          r.moy_historique,
          r.std_deviation,
          r.coeff_espace,
          coeffStyle(r.coeff_espace).label,
          r.pax_normalized ? r.conso_per_100_pax : '—',
          r.nb_matchs_historique,
          r.confidence_level,
          r.qte_recommandee ?? '—',
          r.min_consumption,
          r.max_consumption,
        ]),
      ];

      const sheets: AoaSheetOut[] = [
        { name: 'Synthèse', aoa: synthAoa, widths: [40, 16, 30], columns: [colLeft, { align: 'right' }, colPart] },
        {
          name: 'Coefficients',
          aoa: detailAoa,
          widths: [22, 12, 26, 13, 12, 11, 12, 12, 10, 10, 13, 12, 8, 8],
          columns: [colLeft, colCenter, colLeft, colLeft, colDec1, colDec1, colCoeff, colCenter, colDec1, colIntC, colCenter, colInt, colInt, colInt],
        },
      ];
      await downloadAoaWorkbook(sheets, `Coefficients-consommation_Provence-Rugby_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } finally {
      setExporting(false);
    }
  }

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
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => void exportExcel()} disabled={exporting || data.length === 0} className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40">
            <FileSpreadsheet size={14} /> {exporting ? 'Export…' : 'Exporter Excel'}
          </button>
          <button onClick={() => void recompute()} disabled={computing || resetting} className="flex items-center gap-2 rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
            <RefreshCw size={14} className={computing ? 'animate-spin' : ''} /> {computing ? 'Recalcul…' : 'Recalculer'}
          </button>
          <button onClick={() => setShowReset(true)} disabled={computing || resetting} className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-600 disabled:opacity-40">
            <RotateCcw size={14} /> Reset total
          </button>
        </div>
      </div>

      {feedback && (
        <div className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-600 shadow-sm">{feedback}</div>
      )}

      {showReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !resetting && setShowReset(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-red-600"><AlertTriangle size={20} /></div>
              <h3 className="text-lg font-black text-stone-900">Reset total des coefficients</h3>
            </div>
            <p className="mb-2 text-sm text-stone-600">
              Cette action efface tous les coefficients <strong>calculés</strong> puis les recalcule intégralement à partir des matchs clôturés (hors simulations).
            </p>
            <p className="mb-5 text-sm text-stone-500">
              La base de référence injectée (5 matchs, <em>seed</em>) est <strong>préservée</strong>. Les orphelins issus de simulations ou d'événements supprimés sont éliminés.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowReset(false)} disabled={resetting} className="flex-1 rounded-xl border border-stone-200 py-3 text-sm font-medium text-stone-600 disabled:opacity-40">Annuler</button>
              <button onClick={() => void resetAll()} disabled={resetting} className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-bold text-white disabled:opacity-40">
                {resetting ? 'Reset en cours…' : 'Confirmer le reset'}
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* ── Synthèse & graphes ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Répartition des niveaux de confiance + dernier recalcul */}
        <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-stone-700">🎯 Fiabilité — niveaux de confiance</h3>
            <span className="text-xs text-stone-400">Dernier recalcul : {lastComputedLabel}</span>
          </div>
          {confDist.length > 0 ? (
            <>
              <div className="flex h-4 w-full overflow-hidden rounded-full bg-stone-100">
                {confDist.map((c) => (
                  <div key={c.level} className="h-full" style={{ width: `${c.pct}%`, background: CONF_COLOR[c.level] ?? '#94A2B3' }} title={`${c.level} : ${c.n} couple(s) (${c.pct} %)`} />
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                {confDist.map((c) => (
                  <span key={c.level} className="flex items-center gap-1.5 text-xs text-stone-600">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CONF_COLOR[c.level] ?? '#94A2B3' }} />
                    {c.level} · <span className="font-semibold tabular-nums">{c.n}</span> <span className="text-stone-400">({c.pct} %)</span>
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p className="py-6 text-center text-sm text-stone-400">Aucun coefficient calculé.</p>
          )}
        </div>

        {/* Top coefficients (demande la plus forte) — barres décroissantes */}
        <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-stone-700">🔝 Top coefficients (demande la plus forte)</h3>
          {topCoeffs.length > 0 ? (
            <div className="space-y-1.5">
              {topCoeffs.map((r) => {
                const s = coeffStyle(r.coeff_espace);
                return (
                  <div key={`${r.space_name}-${r.product_name}`} className="flex items-center gap-2" title={`${r.space_name} — ${r.product_name} · ×${r.coeff_espace.toFixed(2)}`}>
                    <span className="w-36 shrink-0 truncate text-xs font-medium text-stone-600 sm:w-44">{r.product_name}</span>
                    <div className="h-4 flex-1 overflow-hidden rounded bg-stone-100">
                      <div className="h-full rounded" style={{ width: `${(r.coeff_espace / coeffMax) * 100}%`, background: s.color }} />
                    </div>
                    <span className="w-12 shrink-0 text-right text-xs font-bold tabular-nums" style={{ color: s.color }}>×{r.coeff_espace.toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-stone-400">Aucun coefficient calculé.</p>
          )}
        </div>
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

      {/* Simulateur de jauge : recalcule la dotation recommandée pour un PAX donné */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
        <span className="shrink-0 text-sm font-semibold text-stone-700">🎟️ Simuler une jauge :</span>
        <input
          type="number"
          min={0}
          value={simulPax || ''}
          onChange={(e) => setSimulPax(parseInt(e.target.value) || 0)}
          placeholder="ex. 8500 spectateurs"
          className="w-44 rounded-lg border border-stone-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        {simulPax > 0 && (
          <span className="text-xs text-stone-500">
            → dotations « Recommandé » recalculées pour {simulPax.toLocaleString('fr-FR')} pax (produits normalisés PAX)
          </span>
        )}
        {simulPax > 0 && (
          <button onClick={() => setSimulPax(0)} className="text-xs text-stone-400 hover:text-stone-700">
            ✕ Réinitialiser
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-stone-100 bg-white shadow-sm">
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="flex w-full items-center justify-between gap-2 border-b border-stone-100 bg-stone-50 px-4 py-3 text-left transition-colors hover:bg-stone-100"
        >
          <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-stone-500">
            {showTable ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            Détail des coefficients ligne-à-ligne
            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-stone-500">
              {filtered.length} ligne{filtered.length > 1 ? 's' : ''}
            </span>
          </span>
          <span className="hidden text-[11px] font-medium normal-case tracking-normal text-stone-400 sm:inline">
            {showTable ? 'Masquer' : 'Afficher'} · détail complet dans l'export Excel ↑
          </span>
        </button>
        {showTable && (
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
                    <td className="px-4 py-3">
                      {simulPax > 0 && row.pax_normalized && row.conso_per_100_pax > 0 ? (
                        <div>
                          <span className="text-base font-black text-stone-900">
                            {Math.ceil((simulPax / 100) * row.conso_per_100_pax * 1.2)}
                          </span>
                          <span className="ml-1 text-xs text-stone-400">{row.unit}</span>
                          <p className="mt-0.5 text-[10px] text-amber-600">
                            ↗ {simulPax.toLocaleString('fr-FR')} pax
                            {row.avg_pax_match > 0 && Math.abs(simulPax / row.avg_pax_match - 1) > 0.25 && (
                              <span className="ml-1">⚠️ réf. {row.avg_pax_match.toLocaleString('fr-FR')}</span>
                            )}
                          </p>
                        </div>
                      ) : (
                        <div>
                          <span className="font-black text-stone-900">{row.qte_recommandee ?? '—'}</span>
                          <span className="ml-1 text-xs text-stone-400">{row.unit}</span>
                          {row.pax_normalized && row.conso_per_100_pax > 0 && (
                            <p className="mt-0.5 text-[10px] text-stone-400">{row.conso_per_100_pax.toFixed(2)} / 100 pax</p>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3"><div className="flex items-center gap-1"><span className="font-mono text-xs text-stone-500">{CONFIDENCE_DOTS[row.confidence_level] ?? '○○○○'}</span><span className="text-[10px] text-stone-400">{row.nb_matchs_historique}M</span></div></td>
                    <td className="px-4 py-3 text-xs text-stone-400">{row.min_consumption.toFixed(0)}–{row.max_consumption.toFixed(0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
      </div>
    </div>
  );
}
