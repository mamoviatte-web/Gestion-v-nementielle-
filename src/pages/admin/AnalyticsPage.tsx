/**
 * Page « Analyses » (ROLE_STADE) — Stadium Manager Analytics, visual-first.
 *
 * 4 zones : hero (4 métriques animées + filtre), heatmap buvettes B1→B9 +
 * donut catégories, classement produits (barres animées), suggestions de
 * commande pour le prochain match.
 *
 * Source : vues analytics_products_full + analytics_buvette_heatmap
 * (réservées à ROLE_STADE — RG-003, prix jamais exposés à anon).
 *
 * ⚠ PostgREST sérialise les colonnes numeric/decimal en CHAÎNES → toutes les
 * valeurs chiffrées sont coercées via Number() au chargement.
 */

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { ChevronRight, RefreshCw, Zap } from 'lucide-react';
import { AnalyseSeminaire } from '@/components/analytics/AnalyseSeminaire';

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

/* ─── Types (données normalisées côté client) ───────────────────────────── */

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
  label: string;
  location: string | null;
  sort_order: number;
  total_consumed: number;
  avg_per_event: number;
  nb_events: number;
  total_cost: number;
  top_produit: string | null;
}

type EventFilter = 'tous' | 'match' | 'seminaire';

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

      <p className="text-center text-xs text-stone-400">
        Intensité = consommation totale sur événements clôturés
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
            <span className="text-[10px] text-stone-400">{unit_price.toFixed(2)} €/{' '}u</span>
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
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [heatmap, setHeatmap] = useState<HeatCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [recalculating, setRecalc] = useState(false);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  async function fetchAll() {
    setLoading(true);
    const [{ data: prods }, { data: heat }] = await Promise.all([
      supabase.from('analytics_products_full').select('*'),
      supabase.from('analytics_buvette_heatmap').select('*').order('sort_order'),
    ]);
    setProducts(
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
    setHeatmap(
      (heat ?? []).map((b): HeatCell => ({
        code: String(b.code),
        label: String(b.label ?? b.code),
        location: b.location == null ? null : String(b.location),
        sort_order: num(b.sort_order),
        total_consumed: num(b.total_consumed),
        avg_per_event: num(b.avg_per_event),
        nb_events: num(b.nb_events),
        total_cost: num(b.total_cost),
        top_produit: b.top_produit == null ? null : String(b.top_produit),
      })),
    );
    setLoading(false);
  }

  useEffect(() => {
    void fetchAll();
  }, []);

  async function handleRecalc() {
    setRecalc(true);
    await fetchAll();
    setRecalc(false);
  }

  /* Produits filtrés + total conso agrégée. */
  const filtered = useMemo(() => {
    return products
      .filter((p) => {
        if (filter === 'match') return p.nb_matchs > 0;
        if (filter === 'seminaire') return p.nb_semis > 0;
        return true;
      })
      .map((p) => ({
        ...p,
        total_conso: p.avg_conso_match * p.nb_matchs + p.avg_conso_semi * p.nb_semis,
      }))
      .filter((p) => p.total_conso > 0)
      .sort((a, b) => b.total_conso - a.total_conso);
  }, [products, filter]);

  const kpis = useMemo(() => {
    const totalUnits = filtered.reduce((s, p) => s + p.total_conso, 0);
    const totalCost = filtered.reduce((s, p) => s + p.total_cost_ht, 0);
    const avgRetour = filtered.length > 0 ? filtered.reduce((s, p) => s + p.taux_retour_pct, 0) / filtered.length : 0;
    const topBuvette = [...heatmap].sort((a, b) => b.total_consumed - a.total_consumed)[0];
    return { totalUnits, totalCost, avgRetour, topBuvette };
  }, [filtered, heatmap]);

  const donutData = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach((p) => {
      map[p.category] = (map[p.category] ?? 0) + p.total_conso;
    });
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filtered]);

  const maxConso = filtered[0]?.total_conso ?? 1;

  if (loading) {
    return (
      <div className="animate-pulse space-y-4 p-8">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-32 rounded-2xl bg-stone-100" />
        ))}
      </div>
    );
  }

  const filterLabel: Record<EventFilter, string> = { tous: 'Tout', match: '🏉 Match', seminaire: '📋 Séminaire' };

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
              Moteur d'apprentissage — précision croissante à chaque clôture
            </p>
          </div>
          <div className="flex items-center gap-3">
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
            <button
              onClick={() => void handleRecalc()}
              disabled={recalculating}
              className="flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-600 shadow-sm hover:bg-stone-50 disabled:opacity-40"
            >
              <RefreshCw size={14} className={recalculating ? 'animate-spin' : ''} />
              Recalculer
            </button>
          </div>
        </div>

        {filter === 'seminaire' ? (
          <AnalyseSeminaire />
        ) : (
        <>
        {/* HERO — 4 métriques animées */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            {
              label: 'Unités consommées',
              value: <AnimatedNumber value={kpis.totalUnits} />,
              sub: `${filtered.length} produit(s) actif(s)`,
              icon: '📦',
              accent: BLEU_NUIT,
            },
            {
              label: 'Coût consommations HT',
              value: <AnimatedNumber value={kpis.totalCost} suffix=" €" decimals={2} />,
              sub: 'F&B consommé',
              icon: '💰',
              accent: '#059669',
            },
            {
              label: 'Taux retour moyen',
              value: <AnimatedNumber value={kpis.avgRetour} suffix=" %" decimals={1} />,
              sub: kpis.avgRetour > 20 ? '⚠️ À optimiser' : '✅ Bon niveau',
              icon: '↩️',
              accent: kpis.avgRetour > 25 ? '#DC2626' : '#F97316',
            },
            {
              label: 'Buvette la + active',
              value: <span>{kpis.topBuvette && kpis.topBuvette.total_consumed > 0 ? kpis.topBuvette.code : '—'}</span>,
              sub:
                kpis.topBuvette && kpis.topBuvette.total_consumed > 0
                  ? `${kpis.topBuvette.total_consumed} unités`
                  : 'Pas encore de données',
              icon: '🏆',
              accent: OR_PR,
            },
          ].map((kpi, i) => (
            <div key={i} className="relative overflow-hidden rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
              <div className="absolute left-0 right-0 top-0 h-1 rounded-t-2xl" style={{ background: kpi.accent }} />
              <div className="mb-3 flex items-start justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">{kpi.label}</p>
                <span className="text-xl">{kpi.icon}</span>
              </div>
              <p className="text-3xl font-black text-stone-900">{kpi.value}</p>
              <p className="mt-1 text-xs text-stone-400">{kpi.sub}</p>
            </div>
          ))}
        </div>

        {/* LIGNE 2 — Heatmap + Donut */}
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
              <p className="py-12 text-center text-sm text-stone-400">Aucune consommation sur ce filtre.</p>
            )}
          </div>
        </div>

        {/* LIGNE 3 — Classement produits */}
        <div className="rounded-2xl border border-stone-100 bg-white shadow-sm">
          <div className="flex items-center justify-between px-5 pb-3 pt-5">
            <div>
              <h3 className="text-lg font-bold text-stone-900">🏅 Classement produits</h3>
              <p className="mt-0.5 text-xs text-stone-400">
                {filtered.length} produit(s) · triés par consommation totale
              </p>
            </div>
          </div>
          <div className="divide-y divide-stone-50 px-3 pb-4">
            {filtered.length === 0 ? (
              <p className="py-12 text-center text-sm text-stone-400">Aucun produit consommé pour ce filtre.</p>
            ) : (
              filtered.slice(0, 25).map((p, i) => (
                <ProductBar
                  key={p.product_id}
                  rank={i + 1}
                  name={p.product_name}
                  category={p.category}
                  value={p.total_conso}
                  max={maxConso}
                  taux_retour={p.taux_retour_pct}
                  unit_price={p.unit_price_ht}
                  nb_events={p.nb_matchs + p.nb_semis}
                />
              ))
            )}
          </div>
        </div>

        {/* LIGNE 4 — Suggestions prochain match */}
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
            const suggestions = products.filter((p) => p.avg_conso_match > 0).sort((a, b) => b.avg_conso_match - a.avg_conso_match).slice(0, 8);
            if (suggestions.length === 0) {
              return <p className="py-6 text-center text-sm text-stone-400">Aucun match clôturé pour établir des suggestions.</p>;
            }
            return (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {suggestions.map((p) => {
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
