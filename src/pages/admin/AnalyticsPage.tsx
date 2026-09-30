/**
 * Page « Analyses » (ROLE_STADE) — Stadium Manager Analytics, visual-first.
 *
 * Sélecteur d'événement : « Tous les matchs » (agrégé) ou un match précis, et
 * idem séminaires. Les chiffres sont scopés via get_match_analysis(scope) /
 * get_seminaire_analysis(scope) (source : match_consumption_report, porte event_id).
 * Liste du sélecteur : get_events_list(type). RG-003 : prix réservés ROLE_STADE.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { ChevronDown, ChevronRight, Download, RefreshCw, Zap } from 'lucide-react';
import { AnalyseSeminaire } from '@/components/analytics/AnalyseSeminaire';
import { SuiviFuts } from '@/components/analytics/SuiviFuts';
import { downloadAoaWorkbook, type AoaCell, type AoaSheetOut } from '@/lib/xlsxAoa';
import { DEC1, EUR, INT, PCT } from '@/lib/excelTheme';

/* ─── Constantes visuelles ──────────────────────────────────────────────── */

const CAT_COLORS: Record<string, string> = {
  Bières: '#D97706',
  Soft: '#2563EB',
  Vins: '#7C3AED',
  Sirops: '#DB2777',
  Spiritueux: '#EA580C',
  Matériel: '#6B7280',
  Autre: '#9CA3AF',
};

const OR_PR = '#C9A646';
const BLEU_NUIT = '#1A1A2E';

/* ─── Types ──────────────────────────────────────────────────────────────── */

interface ProductRow {
  product_id: string;
  product_name: string;
  category: string;
  unit: string;
  unit_price_ht: number | null;
  nb_matchs: number;
  nb_semis: number;
  avg_conso_match: number;
  avg_conso_semi: number;
  taux_retour_pct: number;
  total_cost_ht: number;
}

interface HeatCell {
  code: string;
  total_consumed: number;
  nb_events: number;
  total_cost: number;
  top_produit: string | null;
}

type EventFilter = 'tous' | 'match' | 'seminaire';

interface EventItem {
  event_id: string;
  event_name: string;
  event_date: string;
}

interface MatchData {
  nb_matchs: number;
  kpis: {
    unites_consommees: number;
    produits_actifs: number;
    cout_ht: number;
    taux_retour_moyen: number;
    buvette_active: { code: string; unites: number } | null;
  };
  buvettes: HeatCell[];
  categories: { categorie: string; unites: number }[];
  classement: {
    product_name: string;
    category: string;
    total_consumed: number;
    taux_retour: number;
    cout_unitaire: number | null;
    nb_events: number;
  }[];
}

/** Coercition sûre string|null → number. */
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/* ─── Compteur animé ────────────────────────────────────────────────────── */

function AnimatedNumber({
  value,
  suffix = '',
  prefix = '',
  decimals = 0,
}: {
  value: number;
  suffix?: string;
  prefix?: string;
  decimals?: number;
}) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const target = value;
    const step = target / 40;
    let cur = 0;
    const id = setInterval(() => {
      cur += step;
      if ((step >= 0 && cur >= target) || (step < 0 && cur <= target)) {
        setDisplay(target);
        clearInterval(id);
      } else {
        setDisplay(cur);
      }
    }, 16);
    return () => clearInterval(id);
  }, [value]);
  return (
    <span>
      {prefix}
      {display.toLocaleString('fr-FR', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {suffix}
    </span>
  );
}

/* ─── Heatmap buvettes B1→B9 ────────────────────────────────────────────── */

function BuvetteHeatmap({
  data,
  onSelect,
  selected,
}: {
  data: HeatCell[];
  onSelect: (code: string | null) => void;
  selected: string | null;
}) {
  const max = Math.max(...data.map((b) => b.total_consumed), 1);

  function heatColor(value: number): string {
    const pct = value / max;
    if (pct > 0.75) return BLEU_NUIT;
    if (pct > 0.5) return '#2D4A7A';
    if (pct > 0.25) return '#4A7AB5';
    if (pct > 0.05) return '#8EB4D9';
    return '#E2EAF4';
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-stone-800">🗺 Carte des buvettes</h3>
        <div className="flex items-center gap-2 text-xs text-stone-400">
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded" style={{ background: '#E2EAF4' }} />
            faible
          </div>
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded" style={{ background: BLEU_NUIT }} />
            élevée
          </div>
        </div>
      </div>

      {data.length === 0 ? (
        <p className="py-12 text-center text-sm text-stone-400">Aucune consommation buvette sur cette sélection.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2.5">
          {data.map((b) => {
            const isSelected = selected === b.code;
            const pct = b.total_consumed / max;
            return (
              <button
                key={b.code}
                onClick={() => onSelect(isSelected ? null : b.code)}
                className={`relative rounded-2xl p-3 text-left transition-all hover:scale-105 active:scale-100 ${
                  isSelected ? 'ring-2 ring-amber-400 ring-offset-2' : ''
                }`}
                style={{ background: heatColor(b.total_consumed) }}
              >
                <p className={`text-xl font-black ${pct > 0.25 ? 'text-white' : 'text-stone-800'}`}>{b.code}</p>
                <p className={`mt-1 text-sm font-bold ${pct > 0.25 ? 'text-white/90' : 'text-stone-700'}`}>
                  {b.total_consumed > 0 ? b.total_consumed : '—'}
                </p>
                <p className={`mt-0.5 text-[10px] ${pct > 0.25 ? 'text-white/60' : 'text-stone-400'}`}>
                  {b.nb_events > 0 ? `${b.nb_events} évt` : ''}
                </p>
                {b.top_produit && (
                  <p className={`mt-1 truncate text-[9px] ${pct > 0.25 ? 'text-white/50' : 'text-stone-400'}`}>
                    🏆 {b.top_produit}
                  </p>
                )}
                <div className="absolute bottom-0 left-0 right-0 h-1 overflow-hidden rounded-b-2xl">
                  <div className="h-full bg-amber-400/70" style={{ width: `${pct * 100}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      )}

      <p className="text-center text-xs text-stone-400">
        Intensité = consommation totale sur la sélection
      </p>
    </div>
  );
}

/* ─── Donut catégories ──────────────────────────────────────────────────── */

function CategoryDonut({ data }: { data: { name: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={80}
            paddingAngle={3}
            dataKey="value"
            animationBegin={0}
            animationDuration={800}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={CAT_COLORS[entry.name] ?? '#9CA3AF'} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => [`${Number(value)} unités`, '']}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <p className="text-2xl font-black text-stone-900">{Math.round(total)}</p>
        <p className="text-xs text-stone-400">unités</p>
      </div>
    </div>
  );
}

/* ─── Barre produit ─────────────────────────────────────────────────────── */

function ProductBar({
  rank,
  name,
  category,
  value,
  max,
  taux_retour,
  unit_price,
  nb_events,
}: {
  rank: number;
  name: string;
  category: string;
  value: number;
  max: number;
  taux_retour: number;
  unit_price: number | null;
  nb_events: number;
}) {
  const pct = Math.round((value / Math.max(max, 1)) * 100);
  const color = CAT_COLORS[category] ?? '#9CA3AF';
  return (
    <div className="group flex w-full items-center gap-3 rounded-xl px-1 py-3 text-left transition-colors hover:bg-stone-50">
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-black transition-colors ${
          rank <= 3 ? 'bg-amber-100 text-amber-700' : 'bg-stone-100 text-stone-500 group-hover:bg-stone-200'
        }`}
      >
        {rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank}
      </span>

      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-semibold text-stone-800">{name}</p>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-sm font-black text-stone-900">{Math.round(value)}</span>
            <span className="text-xs text-stone-400">
              {nb_events > 1 ? `${(value / nb_events).toFixed(1)}/evt` : '1 evt'}
            </span>
          </div>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-stone-100">
          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: color + '20', color }}>
            {category}
          </span>
          {taux_retour > 20 && (
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600">
              {taux_retour.toFixed(0)}% retour
            </span>
          )}
          {unit_price !== null && (
            <span className="text-[10px] text-stone-400">{unit_price.toFixed(2)} €/{' '}u</span>
          )}
        </div>
      </div>
      <ChevronRight size={14} className="shrink-0 text-stone-300 group-hover:text-stone-500" />
    </div>
  );
}

/* ─── Page ──────────────────────────────────────────────────────────────── */

export default function AnalyticsPage() {
  const [filter, setFilter] = useState<EventFilter>('tous');
  const [scope, setScope] = useState<'all' | string>('all');
  const [events, setEvents] = useState<EventItem[]>([]);
  const [data, setData] = useState<MatchData | null>(null);
  const [suggestions, setSuggestions] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [recalculating, setRecalc] = useState(false);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [exporting, setExporting] = useState(false);

  const isSemi = filter === 'seminaire';

  // Liste d'événements du sélecteur (dépend de l'onglet) ; reset du scope au changement d'onglet.
  useEffect(() => {
    setScope('all');
    setSelectedCode(null);
    let active = true;
    (async () => {
      const { data: ev } = await supabase.rpc('get_events_list', {
        p_type: filter === 'seminaire' ? 'seminaire' : filter === 'match' ? 'match' : 'tous',
      });
      if (active) setEvents((ev as EventItem[] | null) ?? []);
    })();
    return () => {
      active = false;
    };
  }, [filter]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    // Le séminaire est rendu par <AnalyseSeminaire scope=…> ; ici on ne charge que
    // les suggestions agrégées (prochain match) + les données match/tous scopées.
    if (filter === 'seminaire') {
      setLoading(false);
      return;
    }
    const [{ data: m }, { data: prods }] = await Promise.all([
      supabase.rpc(filter === 'tous' ? 'get_all_analysis' : 'get_match_analysis', { p_scope: scope }),
      supabase.from('analytics_products_full').select('*'),
    ]);
    const md = m as Partial<MatchData> | null;
    const kp = (md?.kpis ?? {}) as Partial<MatchData['kpis']>;
    const ba = kp.buvette_active as { code?: unknown; unites?: unknown } | null | undefined;
    setData({
      nb_matchs: num(md?.nb_matchs),
      kpis: {
        unites_consommees: num(kp.unites_consommees),
        produits_actifs: num(kp.produits_actifs),
        cout_ht: num(kp.cout_ht),
        taux_retour_moyen: num(kp.taux_retour_moyen),
        buvette_active: ba ? { code: String(ba.code ?? '—'), unites: num(ba.unites) } : null,
      },
      buvettes: (md?.buvettes ?? []).map((b) => ({
        code: String(b.code),
        nb_events: num(b.nb_events),
        total_consumed: num(b.total_consumed),
        total_cost: num(b.total_cost),
        top_produit: b.top_produit == null ? null : String(b.top_produit),
      })),
      categories: (md?.categories ?? []).map((c) => ({ categorie: String(c.categorie), unites: num(c.unites) })),
      classement: (md?.classement ?? []).map((p) => ({
        product_name: String(p.product_name),
        category: String(p.category ?? 'Autre'),
        total_consumed: num(p.total_consumed),
        taux_retour: num(p.taux_retour),
        cout_unitaire: p.cout_unitaire == null ? null : num(p.cout_unitaire),
        nb_events: num(p.nb_events),
      })),
    });
    setSuggestions(
      (prods ?? []).map((p): ProductRow => ({
        product_id: String(p.product_id),
        product_name: String(p.product_name ?? '—'),
        category: String(p.category ?? 'Autre'),
        unit: String(p.unit ?? ''),
        unit_price_ht: p.unit_price_ht == null ? null : num(p.unit_price_ht),
        nb_matchs: num(p.nb_matchs),
        nb_semis: num(p.nb_semis),
        avg_conso_match: num(p.avg_conso_match),
        avg_conso_semi: num(p.avg_conso_semi),
        taux_retour_pct: num(p.taux_retour_pct),
        total_cost_ht: num(p.total_cost_ht),
      })),
    );
    setLoading(false);
  }, [filter, scope]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  async function handleRecalc() {
    setRecalc(true);
    await fetchData();
    setRecalc(false);
  }

  const heatmap = data?.buvettes ?? [];
  const donutData = useMemo(
    () =>
      (data?.categories ?? [])
        .map((c) => ({ name: c.categorie, value: c.unites }))
        .sort((a, b) => b.value - a.value),
    [data],
  );
  const classement = data?.classement ?? [];
  const maxConso = Math.max(...classement.map((c) => c.total_consumed), 1);

  const filterLabel: Record<EventFilter, string> = { tous: 'Tout', match: '🏉 Match', seminaire: '📋 Séminaire' };
  const aggLabel = isSemi ? 'Tous les séminaires' : 'Tous les matchs';

  // Libellé de la sélection courante (pour titres de feuilles + nom de fichier).
  const scopeLabel =
    scope === 'all' ? aggLabel : events.find((e) => e.event_id === scope)?.event_name ?? 'Événement';

  // Export vide si aucune donnée exploitable sur la sélection.
  const hasExportData = !!data && (classement.length > 0 || donutData.length > 0 || heatmap.length > 0);

  /**
   * Export Excel complet et habillé (charte excelTheme via downloadAoaWorkbook) :
   *  - Synthèse : KPIs de la sélection.
   *  - Par catégorie / Par buvette : ventilations avec ligne TOTAL.
   *  - Classement produits : détail ligne-à-ligne COMPLET (toutes lignes/colonnes).
   *  - Suggestions : reco prochain match (si historique disponible).
   * L'écran ne montre que la synthèse + le top ; le détail complet part ici.
   */
  async function handleExport() {
    if (!data) return;
    setExporting(true);
    try {
      const kpi = data.kpis;
      const label = scopeLabel;

      // Feuille 1 — Synthèse (KPIs, valeurs pré-formatées FR).
      const synthese: AoaCell[][] = [
        [`Analyses — ${label} — Synthèse`],
        [],
        ['Indicateur', 'Valeur', 'Commentaire'],
        [
          'Unités consommées',
          kpi.unites_consommees.toLocaleString('fr-FR'),
          `${kpi.produits_actifs} produit(s) actif(s)`,
        ],
        [
          'Coût consommations HT',
          kpi.cout_ht.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €',
          'F&B consommé',
        ],
        [
          'Taux de retour moyen',
          kpi.taux_retour_moyen.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %',
          kpi.taux_retour_moyen > 20 ? 'À optimiser' : 'Bon niveau',
        ],
        [
          'Buvette la plus active',
          kpi.buvette_active?.code ?? '—',
          kpi.buvette_active ? `${kpi.buvette_active.unites} unités` : 'Pas encore de données',
        ],
        ['Événements analysés', data.nb_matchs, label],
      ];

      // Feuille 2 — Ventilation par catégorie (tri décroissant + TOTAL).
      const catRows = [...data.categories].sort((a, b) => b.unites - a.unites);
      const catTotal = catRows.reduce((s, c) => s + c.unites, 0);
      const parCategorie: AoaCell[][] = [
        [`Ventilation par catégorie — ${label}`],
        [],
        ['Catégorie', 'Unités consommées', 'Part'],
        ...catRows.map((c): AoaCell[] => [c.categorie, Math.round(c.unites), catTotal > 0 ? c.unites / catTotal : 0]),
        ['Total', Math.round(catTotal), catTotal > 0 ? 1 : 0],
      ];

      // Feuille 3 — Consommation par buvette (tri décroissant + TOTAL).
      const buvRows = [...data.buvettes].sort((a, b) => b.total_consumed - a.total_consumed);
      const parBuvette: AoaCell[][] = [
        [`Consommation par buvette — ${label}`],
        [],
        ['Buvette', 'Unités consommées', 'Coût HT', 'Événements', 'Top produit'],
        ...buvRows.map((b): AoaCell[] => [
          b.code,
          Math.round(b.total_consumed),
          b.total_cost,
          b.nb_events,
          b.top_produit ?? '—',
        ]),
        [
          'Total',
          Math.round(buvRows.reduce((s, b) => s + b.total_consumed, 0)),
          buvRows.reduce((s, b) => s + b.total_cost, 0),
          '',
          '',
        ],
      ];

      // Feuille 4 — Classement produits : DÉTAIL COMPLET ligne-à-ligne.
      const clRows = [...classement].sort((a, b) => b.total_consumed - a.total_consumed);
      const totalUnits = clRows.reduce((s, p) => s + p.total_consumed, 0);
      const totalCost = clRows.reduce(
        (s, p) => s + (p.cout_unitaire != null ? p.total_consumed * p.cout_unitaire : 0),
        0,
      );
      const classementSheet: AoaCell[][] = [
        [`Classement produits — ${label}`],
        [],
        [
          'Rang',
          'Produit',
          'Catégorie',
          'Unités consommées',
          'Taux de retour',
          'Coût unitaire HT',
          'Nb événements',
          'Coût total estimé HT',
        ],
        ...clRows.map((p, i): AoaCell[] => [
          i + 1,
          p.product_name,
          p.category,
          Math.round(p.total_consumed),
          p.taux_retour / 100,
          p.cout_unitaire,
          p.nb_events,
          p.cout_unitaire != null ? p.total_consumed * p.cout_unitaire : null,
        ]),
        ['Total', '', '', Math.round(totalUnits), '', '', '', totalCost],
      ];

      const sheets: AoaSheetOut[] = [
        {
          name: 'Synthèse',
          aoa: synthese,
          widths: [28, 20, 34],
          columns: [{ align: 'left' }, { align: 'left' }, { align: 'left' }],
        },
        {
          name: 'Par catégorie',
          aoa: parCategorie,
          widths: [20, 20, 12],
          columns: [undefined, { numFmt: INT, align: 'right' }, { numFmt: PCT, align: 'right' }],
        },
        {
          name: 'Par buvette',
          aoa: parBuvette,
          widths: [16, 20, 16, 14, 28],
          columns: [
            undefined,
            { numFmt: INT, align: 'right' },
            { numFmt: EUR, align: 'right' },
            { numFmt: INT, align: 'right' },
            undefined,
          ],
        },
        {
          name: 'Classement produits',
          aoa: classementSheet,
          widths: [7, 32, 16, 18, 14, 16, 14, 20],
          columns: [
            { numFmt: INT, align: 'center' },
            undefined,
            undefined,
            { numFmt: INT, align: 'right' },
            { numFmt: PCT, align: 'right' },
            { numFmt: EUR, align: 'right' },
            { numFmt: INT, align: 'right' },
            { numFmt: EUR, align: 'right' },
          ],
        },
      ];

      // Feuille 5 — Suggestions (seulement si un historique existe).
      const sug = suggestions
        .filter((p) => p.avg_conso_match > 0)
        .sort((a, b) => b.avg_conso_match - a.avg_conso_match);
      if (sug.length > 0) {
        const sugSheet: AoaCell[][] = [
          ['Suggestions prochain match — moyenne historique + 20 % de marge'],
          [],
          ['Produit', 'Catégorie', 'Unité', 'Moyenne / match', 'Qté suggérée', 'Taux de retour'],
          ...sug.map((p): AoaCell[] => [
            p.product_name,
            p.category,
            p.unit,
            p.avg_conso_match,
            Math.ceil(p.avg_conso_match * 1.2),
            p.taux_retour_pct / 100,
          ]),
        ];
        sheets.push({
          name: 'Suggestions',
          aoa: sugSheet,
          widths: [30, 16, 10, 16, 14, 14],
          columns: [
            undefined,
            undefined,
            undefined,
            { numFmt: DEC1, align: 'right' },
            { numFmt: INT, align: 'right' },
            { numFmt: PCT, align: 'right' },
          ],
        });
      }

      const now = new Date();
      const dstr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
        now.getDate(),
      ).padStart(2, '0')}`;
      const slug = label
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      await downloadAoaWorkbook(sheets, `Analyses_${slug}_${dstr}.xlsx`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="min-h-screen" style={{ background: '#FAFAF8' }}>
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        {/* En-tête */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="h-8 w-1.5 rounded-full" style={{ background: OR_PR }} />
              <h1 className="text-3xl font-black text-stone-900">Analyses</h1>
            </div>
            <p className="ml-3.5 mt-1 text-sm text-stone-400">
              Vue agrégée ou détail par événement — chiffres scopés à la sélection
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex overflow-hidden rounded-xl border border-stone-200 bg-white text-sm shadow-sm">
              {(['tous', 'match', 'seminaire'] as EventFilter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-4 py-2 font-semibold transition-colors ${
                    filter === f ? 'text-white' : 'text-stone-500 hover:text-stone-800'
                  }`}
                  style={filter === f ? { background: BLEU_NUIT } : {}}
                >
                  {filterLabel[f]}
                </button>
              ))}
            </div>
            {/* Sélecteur d'événement (agrégé vs précis) */}
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-700 shadow-sm focus:outline-none"
            >
              <option value="all">{aggLabel}</option>
              {events.map((ev) => (
                <option key={ev.event_id} value={ev.event_id}>
                  {ev.event_name} — {new Date(ev.event_date).toLocaleDateString('fr-FR')}
                </option>
              ))}
            </select>
            <button
              onClick={() => void handleRecalc()}
              disabled={recalculating}
              className="flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-600 shadow-sm hover:bg-stone-50 disabled:opacity-40"
            >
              <RefreshCw size={14} className={recalculating ? 'animate-spin' : ''} />
              Recalculer
            </button>
            {!isSemi && (
              <button
                onClick={() => void handleExport()}
                disabled={exporting || loading || !hasExportData}
                className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-40"
                style={{ background: BLEU_NUIT }}
              >
                <Download size={14} className={exporting ? 'animate-pulse' : ''} />
                {exporting ? 'Génération…' : 'Exporter Excel'}
              </button>
            )}
          </div>
        </div>

        {isSemi ? (
          <AnalyseSeminaire scope={scope} />
        ) : loading ? (
          <div className="animate-pulse space-y-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-32 rounded-2xl bg-stone-100" />
            ))}
          </div>
        ) : (
          <>
            {/* HERO — 4 métriques (système visuel homogène) */}
            <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
              {[
                {
                  label: 'Unités consommées',
                  value: <AnimatedNumber value={data?.kpis.unites_consommees ?? 0} />,
                  sub: `${data?.kpis.produits_actifs ?? 0} produit(s) actif(s)`, tone: '', accent: false,
                },
                {
                  label: 'Coût consommations HT',
                  value: <AnimatedNumber value={data?.kpis.cout_ht ?? 0} suffix=" €" decimals={2} />,
                  sub: 'F&B consommé', tone: '', accent: false,
                },
                {
                  label: 'Taux retour moyen',
                  value: <AnimatedNumber value={data?.kpis.taux_retour_moyen ?? 0} suffix=" %" decimals={1} />,
                  sub: (data?.kpis.taux_retour_moyen ?? 0) > 20 ? 'À optimiser' : 'Bon niveau',
                  tone: (data?.kpis.taux_retour_moyen ?? 0) > 20 ? 'down' : 'up', accent: false,
                },
                {
                  label: 'Buvette la + active',
                  value: <span>{data?.kpis.buvette_active?.code ?? '—'}</span>,
                  sub: data?.kpis.buvette_active ? `${data.kpis.buvette_active.unites} unités` : 'Pas encore de données',
                  tone: '', accent: true,
                },
              ].map((kpi, i) => (
                <div key={i} className={`kpi${kpi.accent ? ' accent' : ''}`}>
                  <div className="kpi-l">{kpi.label}</div>
                  <div className="kpi-v num">{kpi.value}</div>
                  <div className={`kpi-s${kpi.tone ? ` ${kpi.tone}` : ''}`}>{kpi.sub}</div>
                </div>
              ))}
            </div>

            {/* Heatmap + Donut */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm lg:col-span-2">
                <BuvetteHeatmap data={heatmap} onSelect={setSelectedCode} selected={selectedCode} />
              </div>
              <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
                <h3 className="mb-4 font-bold text-stone-800">Répartition par catégorie</h3>
                {donutData.length > 0 ? (
                  <>
                    <CategoryDonut data={donutData} />
                    <div className="mt-3 space-y-1.5">
                      {donutData.slice(0, 5).map((d) => (
                        <div key={d.name} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CAT_COLORS[d.name] ?? '#9CA3AF' }} />
                            <span className="text-stone-600">{d.name}</span>
                          </div>
                          <span className="font-semibold text-stone-800">{Math.round(d.value)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="py-12 text-center text-sm text-stone-400">Aucune consommation sur cette sélection.</p>
                )}
              </div>
            </div>

            {/* Suivi des fûts (masqué si aucun fût, ex. scope séminaire) */}
            <SuiviFuts scope={scope} />

            {/* Classement produits — top visible, détail complet replié → export Excel */}
            <div className="rounded-2xl border border-stone-100 bg-white shadow-sm">
              <div className="flex items-center justify-between px-5 pb-3 pt-5">
                <div>
                  <h3 className="text-lg font-bold text-stone-900">🏅 Classement produits</h3>
                  <p className="mt-0.5 text-xs text-stone-400">
                    {classement.length} produit(s) · triés par consommation décroissante
                  </p>
                </div>
              </div>
              <div className="divide-y divide-stone-50 px-3 pb-1">
                {classement.length === 0 ? (
                  <p className="py-12 text-center text-sm text-stone-400">Aucun produit consommé sur cette sélection.</p>
                ) : (
                  classement.slice(0, 8).map((p, i) => (
                    <ProductBar
                      key={`${p.product_name}-${i}`}
                      rank={i + 1}
                      name={p.product_name}
                      category={p.category}
                      value={p.total_consumed}
                      max={maxConso}
                      taux_retour={p.taux_retour}
                      unit_price={p.cout_unitaire}
                      nb_events={p.nb_events}
                    />
                  ))
                )}
              </div>

              {classement.length > 8 && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowDetail((v) => !v)}
                    className="flex w-full items-center justify-between gap-2 border-t border-stone-100 px-5 py-3 text-left transition-colors hover:bg-stone-50"
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold text-stone-600">
                      {showDetail ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      {showDetail
                        ? 'Masquer le détail complet'
                        : `Afficher les ${classement.length - 8} autres produits`}
                    </span>
                    <span className="hidden text-xs text-stone-400 sm:inline">
                      détail complet dans l'export Excel ↑
                    </span>
                  </button>
                  {showDetail && (
                    <div className="divide-y divide-stone-50 border-t border-stone-100 px-3 pb-4">
                      {classement.slice(8).map((p, i) => (
                        <ProductBar
                          key={`${p.product_name}-${i + 8}`}
                          rank={i + 9}
                          name={p.product_name}
                          category={p.category}
                          value={p.total_consumed}
                          max={maxConso}
                          taux_retour={p.taux_retour}
                          unit_price={p.cout_unitaire}
                          nb_events={p.nb_events}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Suggestions prochain match (agrégées, indépendantes du scope) */}
            <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: OR_PR }}>
                  <Zap size={16} className="text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-stone-900">Suggestions pour le prochain match</h3>
                  <p className="text-xs text-stone-400">Basé sur la moyenne historique · +20 % marge de sécurité</p>
                </div>
              </div>

              {(() => {
                const sug = suggestions
                  .filter((p) => p.avg_conso_match > 0)
                  .sort((a, b) => b.avg_conso_match - a.avg_conso_match)
                  .slice(0, 8);
                if (sug.length === 0) {
                  return <p className="py-6 text-center text-sm text-stone-400">Aucun match clôturé pour établir des suggestions.</p>;
                }
                return (
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    {sug.map((p) => {
                      const suggested = Math.ceil(p.avg_conso_match * 1.2);
                      return (
                        <div key={p.product_id} className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                          <p className="mb-1 truncate text-xs font-semibold text-stone-700">{p.product_name}</p>
                          <p className="text-2xl font-black" style={{ color: CAT_COLORS[p.category] ?? '#6B7280' }}>
                            {suggested}
                          </p>
                          <p className="mt-0.5 text-xs text-stone-400">
                            {p.unit} · moy. {p.avg_conso_match.toFixed(1)}
                          </p>
                          {p.taux_retour_pct > 20 && (
                            <p className="mt-1 text-[10px] text-orange-600">⚠️ {p.taux_retour_pct.toFixed(0)}% retour</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              <p className="mt-4 text-center text-xs text-stone-300">
                Quantités indicatives basées sur l'historique des matchs clôturés.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
