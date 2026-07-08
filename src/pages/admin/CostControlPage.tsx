/**
 * CostControlPage — Contrôle de charges (ROLE_STADE). Tableau de bord Stadium
 * Manager en 3 onglets : F&B consommations · Prestataires externes · Traiteurs.
 * Sources : vues charges_fb_by_event / _products_ranking / _external_by_event /
 * _traiteurs_summary (coûts réels liés aux clôtures d'événements).
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertCircle, CheckCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Tab = 'fb' | 'external' | 'traiteur';
type EventType = 'tous' | 'match' | 'seminaire' | 'autre';

interface FbEventRow {
  event_id: string;
  event_name: string;
  event_type: string;
  event_date: string;
  status: string;
  pax: number;
  vins_ht: number;
  bieres_ht: number;
  soft_ht: number;
  sirops_ht: number;
  spiritueux_ht: number;
  materiel_ht: number;
  total_fb_ht: number;
  fb_per_pax: number;
  missing_clotures: number;
  missing_prices: number;
  rh_ht: number;
  external_ht: number;
  total_charges_ht: number;
  ca_ht: number;
  gain_net_ht: number;
  marge_pct: number;
}
interface ExtChargeRow {
  event_id: string;
  event_name: string;
  event_type: string;
  event_date: string;
  pax: number;
  charge_type: string;
  provider_name: string;
  total_ht: number;
  nb_charges: number;
  all_confirmed: boolean;
  cost_per_pax: number;
}
interface TraiteurRow {
  event_id: string;
  event_name: string;
  event_date: string;
  pax: number;
  traiteur_name: string;
  traiteur_ht: number;
  traiteur_ttc: number;
  traiteur_per_pax: number;
  facture_confirmee: boolean;
  fb_cost_ht: number;
  ca_ht: number;
  pct_ca: number;
}
interface ProductRow {
  product_id: string;
  product_name: string;
  category: string;
  unit: string;
  nb_events: number;
  total_cost_ht: number;
  avg_cost_per_event: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  Vins: '#7C3AED',
  Bières: '#D97706',
  Soft: '#2563EB',
  Sirops: '#DB2777',
  Spiritueux: '#EA580C',
  Matériel: '#6B7280',
};

const CHARGE_TYPE_CONFIG: Record<string, { label: string; emoji: string; color: string }> = {
  traiteur: { label: 'Traiteur', emoji: '🍽️', color: '#F97316' },
  securite: { label: 'Sécurité', emoji: '🔒', color: '#DC2626' },
  technique: { label: 'Technique', emoji: '🎛️', color: '#2563EB' },
  decoration: { label: 'Décoration', emoji: '🌸', color: '#DB2777' },
  transport: { label: 'Transport', emoji: '🚐', color: '#CA8A04' },
  animation: { label: 'Animation', emoji: '🎤', color: '#7C3AED' },
  photo_video: { label: 'Photo/Vidéo', emoji: '📸', color: '#0D9488' },
  nettoyage: { label: 'Nettoyage', emoji: '🧹', color: '#16A34A' },
  location: { label: 'Location', emoji: '📦', color: '#6B7280' },
  communication: { label: 'Communication', emoji: '🖨️', color: '#4F46E5' },
  autre: { label: 'Autre', emoji: '➕', color: '#9CA3AF' },
};

const SEMINAR_TYPES = ['séminaire', 'réunion', 'cocktail', 'réception_vip', 'événement_partenaire'];

const fmt = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type KpiColor = 'stone' | 'green' | 'red' | 'amber' | 'purple';
function KPICard({ label, value, sub, color = 'stone' }: { label: string; value: string; sub?: string; color?: KpiColor }) {
  const colors: Record<KpiColor, string> = {
    stone: 'bg-white border-stone-200',
    green: 'bg-green-50 border-green-200',
    red: 'bg-red-50 border-red-200',
    amber: 'bg-amber-50 border-amber-200',
    purple: 'bg-purple-50 border-purple-200',
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</p>
      <p className="text-2xl font-bold text-stone-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-stone-400">{sub}</p>}
    </div>
  );
}

function EventComparisonTable({ events, showExternal = false }: { events: FbEventRow[]; showExternal?: boolean }) {
  const [sort, setSort] = useState<{ key: keyof FbEventRow; dir: 'asc' | 'desc' }>({ key: 'event_date', dir: 'desc' });
  const sorted = [...events].sort((a, b) => {
    const mul = sort.dir === 'asc' ? 1 : -1;
    const av = a[sort.key];
    const bv = b[sort.key];
    return typeof av === 'number' && typeof bv === 'number'
      ? (av - bv) * mul
      : String(av ?? '').localeCompare(String(bv ?? '')) * mul;
  });
  const TH = ({ k, label }: { k: keyof FbEventRow; label: string }) => (
    <th
      onClick={() => setSort((s) => ({ key: k, dir: s.key === k && s.dir === 'desc' ? 'asc' : 'desc' }))}
      className="cursor-pointer select-none px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-stone-500 hover:text-stone-800"
    >
      {label} {sort.key === k ? (sort.dir === 'desc' ? '↓' : '↑') : ''}
    </th>
  );
  const cell = (v: number) => (v > 0 ? fmt(v) + ' €' : '—');
  const sum = (k: keyof FbEventRow) => sorted.reduce((s, e) => s + (Number(e[k]) || 0), 0);

  return (
    <div className="overflow-x-auto rounded-xl border border-stone-200">
      <table className="w-full text-sm">
        <thead className="border-b border-stone-200 bg-stone-50">
          <tr>
            <TH k="event_name" label="Événement" />
            <TH k="event_date" label="Date" />
            <TH k="event_type" label="Type" />
            <TH k="pax" label="PAX" />
            <TH k="total_fb_ht" label="F&B HT" />
            {showExternal && <TH k="external_ht" label="Externes HT" />}
            <TH k="rh_ht" label="RH HT" />
            <TH k="total_charges_ht" label="Total charges" />
            <TH k="ca_ht" label="CA HT" />
            <TH k="gain_net_ht" label="Gain net" />
            <TH k="marge_pct" label="Marge %" />
            <TH k="fb_per_pax" label="€/PAX" />
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {sorted.map((ev) => (
            <tr key={ev.event_id} className="hover:bg-stone-50">
              <td className="px-3 py-3 font-medium text-stone-900">{ev.event_name}</td>
              <td className="px-3 py-3 text-xs text-stone-500">{new Date(ev.event_date).toLocaleDateString('fr-FR')}</td>
              <td className="px-3 py-3">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ev.event_type === 'match' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                  {ev.event_type === 'match' ? '🏉 Match' : '📋 Séminaire'}
                </span>
              </td>
              <td className="px-3 py-3 text-center font-medium">{ev.pax > 0 ? ev.pax : '—'}</td>
              <td className="px-3 py-3 text-right font-medium">{cell(ev.total_fb_ht)}</td>
              {showExternal && <td className="px-3 py-3 text-right font-medium text-orange-600">{cell(ev.external_ht)}</td>}
              <td className="px-3 py-3 text-right">{cell(ev.rh_ht)}</td>
              <td className="px-3 py-3 text-right font-bold text-red-700">{cell(ev.total_charges_ht)}</td>
              <td className="px-3 py-3 text-right font-medium text-green-700">{cell(ev.ca_ht)}</td>
              <td className={`px-3 py-3 text-right font-bold ${ev.gain_net_ht >= 0 ? 'text-green-700' : 'text-red-700'}`}>{cell(ev.gain_net_ht)}</td>
              <td className={`px-3 py-3 text-right font-medium ${ev.marge_pct >= 50 ? 'text-green-600' : ev.marge_pct >= 20 ? 'text-amber-600' : 'text-red-600'}`}>
                {ev.marge_pct > 0 ? `${ev.marge_pct.toFixed(1)} %` : '—'}
              </td>
              <td className="px-3 py-3 text-right text-xs text-stone-500">{ev.fb_per_pax > 0 ? `${ev.fb_per_pax.toFixed(2)} €` : '—'}</td>
            </tr>
          ))}
        </tbody>
        {sorted.length > 1 && (
          <tfoot className="border-t-2 border-stone-300 bg-stone-100">
            <tr>
              <td colSpan={4} className="px-3 py-2 text-sm font-bold text-stone-700">TOTAL</td>
              <td className="px-3 py-2 text-right font-bold">{cell(sum('total_fb_ht'))}</td>
              {showExternal && <td className="px-3 py-2 text-right font-bold text-orange-600">{cell(sum('external_ht'))}</td>}
              <td className="px-3 py-2 text-right font-bold">{cell(sum('rh_ht'))}</td>
              <td className="px-3 py-2 text-right font-bold text-red-700">{cell(sum('total_charges_ht'))}</td>
              <td className="px-3 py-2 text-right font-bold text-green-700">{cell(sum('ca_ht'))}</td>
              <td className="px-3 py-2 text-right font-bold">{cell(sum('gain_net_ht'))}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export default function CostControlPage() {
  const [activeTab, setActiveTab] = useState<Tab>('fb');
  const [eventType, setEventType] = useState<EventType>('tous');
  const [fbEvents, setFbEvents] = useState<FbEventRow[]>([]);
  const [extCharges, setExtCharges] = useState<ExtChargeRow[]>([]);
  const [traiteurs, setTraiteurs] = useState<TraiteurRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [fb, ext, tr, prod] = await Promise.all([
        supabase.from('charges_fb_by_event').select('*').order('event_date', { ascending: false }),
        supabase.from('charges_external_by_event').select('*').order('event_date', { ascending: false }),
        supabase.from('charges_traiteurs_summary').select('*').order('event_date', { ascending: false }),
        supabase.from('charges_products_ranking').select('*').limit(20),
      ]);
      setFbEvents((fb.data ?? []) as FbEventRow[]);
      setExtCharges((ext.data ?? []) as ExtChargeRow[]);
      setTraiteurs((tr.data ?? []) as TraiteurRow[]);
      setProducts((prod.data ?? []) as ProductRow[]);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(
    () =>
      fbEvents.filter((e) =>
        eventType === 'tous'
          ? true
          : eventType === 'match'
            ? e.event_type === 'match'
            : eventType === 'seminaire'
              ? SEMINAR_TYPES.includes(e.event_type)
              : e.event_type !== 'match' && !SEMINAR_TYPES.includes(e.event_type),
      ),
    [fbEvents, eventType],
  );

  const kpis = useMemo(() => {
    const matches = fbEvents.filter((e) => e.event_type === 'match');
    const semis = fbEvents.filter((e) => e.event_type !== 'match');
    const avg = (arr: FbEventRow[]) => (arr.length ? arr.reduce((s, e) => s + e.total_fb_ht, 0) / arr.length : 0);
    const avgMarge = filtered.length ? filtered.reduce((s, e) => s + e.marge_pct, 0) / filtered.length : 0;
    return {
      avgFbMatch: avg(matches),
      avgFbSemi: avg(semis),
      avgMarge,
      totalExt: extCharges.reduce((s, e) => s + e.total_ht, 0),
      totalTrait: traiteurs.reduce((s, e) => s + e.traiteur_ht, 0),
    };
  }, [fbEvents, filtered, extCharges, traiteurs]);

  const barData = useMemo(
    () =>
      filtered
        .slice(0, 10)
        .reverse()
        .map((e) => ({
          name: e.event_name.length > 12 ? e.event_name.slice(0, 12) + '…' : e.event_name,
          Vins: e.vins_ht,
          Bières: e.bieres_ht,
          Soft: e.soft_ht,
          Sirops: e.sirops_ht,
          Spiritueux: e.spiritueux_ht,
          Matériel: e.materiel_ht,
          RH: e.rh_ht,
          Externe: e.external_ht,
        })),
    [filtered],
  );

  const extByType = useMemo(() => {
    const map: Record<string, number> = {};
    extCharges.forEach((c) => {
      map[c.charge_type] = (map[c.charge_type] ?? 0) + c.total_ht;
    });
    return Object.entries(map)
      .map(([type, total]) => ({
        name: CHARGE_TYPE_CONFIG[type]?.label ?? type,
        emoji: CHARGE_TYPE_CONFIG[type]?.emoji ?? '➕',
        color: CHARGE_TYPE_CONFIG[type]?.color ?? '#9CA3AF',
        value: total,
      }))
      .sort((a, b) => b.value - a.value);
  }, [extCharges]);

  if (loading) {
    return (
      <div className="space-y-4 p-8">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-stone-100" />
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-screen-xl space-y-6 p-6">
      {/* En-tête */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Contrôle de charges</h1>
          <p className="mt-1 text-sm text-stone-500">Provence Rugby · Stade Maurice-David — coûts réels liés aux clôtures d'événements</p>
        </div>
        <div className="flex overflow-hidden rounded-lg border border-stone-200 bg-white text-sm">
          {(['tous', 'match', 'seminaire', 'autre'] as EventType[]).map((t) => (
            <button
              key={t}
              onClick={() => setEventType(t)}
              className={`px-3 py-2 transition-colors ${eventType === t ? 'bg-stone-900 font-medium text-white' : 'text-stone-600 hover:bg-stone-50'}`}
            >
              {t === 'tous' ? 'Tous' : t === 'match' ? '🏉 Match' : t === 'seminaire' ? '📋 Séminaire' : 'Autre'}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KPICard label="F&B moy. / match" value={`${fmt(kpis.avgFbMatch)} €`} sub="HT par match clôturé" />
        <KPICard label="F&B moy. / séminaire" value={`${fmt(kpis.avgFbSemi)} €`} sub="HT par séminaire clôturé" />
        <KPICard label="Charges externes totales" value={`${fmt(kpis.totalExt)} €`} sub="Traiteurs + prestataires HT" color="amber" />
        <KPICard label="Marge moyenne" value={`${kpis.avgMarge.toFixed(1)} %`} sub="Sur événements avec CA" color={kpis.avgMarge >= 50 ? 'green' : kpis.avgMarge >= 20 ? 'amber' : 'red'} />
      </div>

      {/* Onglets */}
      <div className="border-b border-stone-200">
        <div className="flex">
          {([
            { key: 'fb', label: '🍷 F&B Consommations' },
            { key: 'external', label: '🏢 Prestataires externes' },
            { key: 'traiteur', label: '🍽️ Traiteurs' },
          ] as { key: Tab; label: string }[]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`border-b-2 px-5 py-3 text-sm font-semibold transition-colors ${activeTab === tab.key ? 'border-stone-900 text-stone-900' : 'border-transparent text-stone-500 hover:text-stone-700'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ONGLET F&B */}
      {activeTab === 'fb' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-stone-200 bg-white p-5">
            <h3 className="mb-4 font-bold text-stone-800">Décomposition par catégorie — 10 derniers événements</h3>
            {barData.length === 0 ? (
              <p className="py-8 text-center text-sm text-stone-400">Aucun événement clôturé.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={barData} barSize={28}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v}€`} />
                  <Tooltip formatter={(value) => `${fmt(Number(value))} €`} />
                  <Legend iconType="circle" iconSize={10} />
                  {Object.entries(CATEGORY_COLORS).map(([cat, color]) => (
                    <Bar key={cat} dataKey={cat} stackId="a" fill={color} />
                  ))}
                  <Bar dataKey="RH" stackId="a" fill="#374151" />
                  <Bar dataKey="Externe" stackId="a" fill="#F97316" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="rounded-xl border border-stone-200 bg-white p-5">
            <h3 className="mb-4 font-bold text-stone-800">Produits les plus coûteux</h3>
            <div className="space-y-2">
              {products.slice(0, 10).map((p, i) => {
                const maxCost = products[0]?.total_cost_ht ?? 1;
                const pct = (p.total_cost_ht / maxCost) * 100;
                return (
                  <div key={p.product_id} className="flex items-center gap-3">
                    <span className="w-6 shrink-0 text-right text-xs text-stone-400">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex items-center justify-between text-sm">
                        <span className="truncate font-medium text-stone-800">{p.product_name}</span>
                        <span className="ml-3 shrink-0 font-bold text-stone-900">{fmt(p.total_cost_ht)} € HT</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-100">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: CATEGORY_COLORS[p.category] ?? '#6B7280' }} />
                        </div>
                        <span className="shrink-0 text-xs text-stone-400">{p.nb_events} évt · {fmt(p.avg_cost_per_event)} €/évt</span>
                      </div>
                    </div>
                  </div>
                );
              })}
              {products.length === 0 && <p className="py-6 text-center text-sm text-stone-400">Aucun produit chiffré.</p>}
            </div>
          </div>

          <div className="rounded-xl border border-stone-200 bg-white p-5">
            <h3 className="mb-4 font-bold text-stone-800">
              Comparatif événements <span className="ml-2 text-sm font-normal text-stone-400">({filtered.length})</span>
            </h3>
            <EventComparisonTable events={filtered} />
          </div>
        </div>
      )}

      {/* ONGLET PRESTATAIRES */}
      {activeTab === 'external' && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-stone-200 bg-white p-5">
              <h3 className="mb-4 font-bold text-stone-800">Répartition par type</h3>
              <div className="space-y-3">
                {extByType.map((item) => {
                  const total = extByType.reduce((s, x) => s + x.value, 0);
                  const pct = total > 0 ? (item.value / total) * 100 : 0;
                  return (
                    <div key={item.name} className="flex items-center gap-3">
                      <span className="w-7 text-center text-xl">{item.emoji}</span>
                      <div className="flex-1">
                        <div className="mb-1 flex justify-between text-sm">
                          <span className="font-medium text-stone-700">{item.name}</span>
                          <span className="font-bold text-stone-900">{fmt(item.value)} €</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-stone-100">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: item.color }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
                {extByType.length === 0 && <p className="py-8 text-center text-sm text-stone-400">Aucune charge externe enregistrée.</p>}
              </div>
            </div>
            <div className="rounded-xl border border-stone-200 bg-white p-5">
              <h3 className="mb-4 font-bold text-stone-800">Part de chaque type</h3>
              {extByType.length === 0 ? (
                <p className="py-16 text-center text-sm text-stone-400">—</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={extByType}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      labelLine={false}
                      label={(e: { name?: string; percent?: number }) => `${e.name} ${((e.percent ?? 0) * 100).toFixed(0)}%`}
                    >
                      {extByType.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => `${fmt(Number(value))} €`} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-stone-200 bg-white p-5">
            <h3 className="mb-4 font-bold text-stone-800">Détail par événement</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-stone-200 bg-stone-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-stone-500">Événement</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-stone-500">Prestataire</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-stone-500">Type</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-stone-500">HT</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-stone-500">€/PAX</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold uppercase text-stone-500">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {extCharges.map((row, i) => {
                    const cfg = CHARGE_TYPE_CONFIG[row.charge_type] ?? CHARGE_TYPE_CONFIG.autre;
                    return (
                      <tr key={i} className="hover:bg-stone-50">
                        <td className="px-3 py-2.5 font-medium text-stone-800">
                          {row.event_name}
                          <span className="ml-2 text-xs text-stone-400">{new Date(row.event_date).toLocaleDateString('fr-FR')}</span>
                        </td>
                        <td className="px-3 py-2.5 text-stone-700">{row.provider_name}</td>
                        <td className="px-3 py-2.5">
                          <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: cfg.color + '20', color: cfg.color }}>
                            {cfg.emoji} {cfg.label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-bold text-orange-700">{fmt(row.total_ht)} €</td>
                        <td className="px-3 py-2.5 text-right text-xs text-stone-500">{row.cost_per_pax > 0 ? `${row.cost_per_pax.toFixed(2)} €` : '—'}</td>
                        <td className="px-3 py-2.5 text-center">
                          {row.all_confirmed ? <CheckCircle size={15} className="mx-auto text-green-600" /> : <AlertCircle size={15} className="mx-auto text-amber-500" />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {extCharges.length > 0 && (
                  <tfoot className="border-t-2 border-stone-300 bg-stone-50">
                    <tr>
                      <td colSpan={3} className="px-3 py-2 font-bold text-stone-800">TOTAL CHARGES EXTERNES</td>
                      <td className="px-3 py-2 text-right text-base font-bold text-orange-700">{fmt(extCharges.reduce((s, r) => s + r.total_ht, 0))} €</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                )}
              </table>
              {extCharges.length === 0 && <p className="py-8 text-center text-sm text-stone-400">Aucune charge externe sur les événements clôturés.</p>}
            </div>
          </div>

          <div className="rounded-xl border border-stone-200 bg-white p-5">
            <h3 className="mb-4 font-bold text-stone-800">P&L complet par événement</h3>
            <EventComparisonTable events={filtered} showExternal />
          </div>
        </div>
      )}

      {/* ONGLET TRAITEURS */}
      {activeTab === 'traiteur' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <KPICard label="Total traiteurs HT" value={`${fmt(kpis.totalTrait)} €`} sub="Tous événements clôturés" color="amber" />
            <KPICard label="Traiteur moyen / événement" value={traiteurs.length ? `${fmt(kpis.totalTrait / traiteurs.length)} €` : '—'} sub="HT par événement avec traiteur" />
            <KPICard
              label="Traiteur moyen / PAX"
              value={(() => {
                const totalPax = traiteurs.reduce((s, t) => s + t.pax, 0);
                return totalPax > 0 ? `${fmt(kpis.totalTrait / totalPax)} €` : '—';
              })()}
              sub="Coût traiteur par participant"
            />
          </div>

          <div className="rounded-xl border border-stone-200 bg-white p-5">
            <h3 className="mb-4 font-bold text-stone-800">Détail par événement</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-stone-200 bg-stone-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-stone-500">Événement</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-stone-500">Traiteur</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-stone-500">PAX</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-stone-500">Traiteur HT</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-stone-500">€/PAX</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-stone-500">F&B HT</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-stone-500">CA HT</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-stone-500">% CA</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold uppercase text-stone-500">Facture</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {traiteurs.map((t, i) => (
                    <tr key={i} className="hover:bg-stone-50">
                      <td className="px-3 py-3 font-medium text-stone-800">
                        {t.event_name}
                        <p className="text-xs font-normal text-stone-400">{new Date(t.event_date).toLocaleDateString('fr-FR')}</p>
                      </td>
                      <td className="px-3 py-3 font-medium text-stone-700">{t.traiteur_name}</td>
                      <td className="px-3 py-3 text-right">{t.pax || '—'}</td>
                      <td className="px-3 py-3 text-right font-bold text-orange-700">{fmt(t.traiteur_ht)} €</td>
                      <td className="px-3 py-3 text-right text-stone-500">{t.traiteur_per_pax > 0 ? `${fmt(t.traiteur_per_pax)} €` : '—'}</td>
                      <td className="px-3 py-3 text-right text-stone-600">{fmt(t.fb_cost_ht)} €</td>
                      <td className="px-3 py-3 text-right font-medium text-green-700">{fmt(t.ca_ht)} €</td>
                      <td className="px-3 py-3 text-right">
                        <span className={`font-bold ${t.pct_ca > 40 ? 'text-red-600' : t.pct_ca > 25 ? 'text-amber-600' : 'text-green-600'}`}>{t.pct_ca.toFixed(1)} %</span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        {t.facture_confirmee ? <CheckCircle size={16} className="mx-auto text-green-600" /> : <AlertCircle size={16} className="mx-auto text-amber-500" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {traiteurs.length > 1 && (
                  <tfoot className="border-t-2 border-stone-300 bg-stone-50">
                    <tr>
                      <td colSpan={3} className="px-3 py-2 font-bold text-stone-800">TOTAL</td>
                      <td className="px-3 py-2 text-right text-base font-bold text-orange-700">{fmt(traiteurs.reduce((s, t) => s + t.traiteur_ht, 0))} €</td>
                      <td colSpan={5} />
                    </tr>
                  </tfoot>
                )}
              </table>
              {traiteurs.length === 0 && (
                <p className="py-8 text-center text-sm text-stone-400">
                  Aucune prestation traiteur. Ajoutez les charges traiteur depuis la fiche événement (Rapport → Bilan financier).
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
