/**
 * Onglet « 📈 Analyse conso » (ROLE_STADE) — analyse dynamique de la
 * consommation par espace, calculée sur les consommations réelles
 * (event_stock_lines) via les vues space_consumption_summary (synthèse par
 * espace) et space_consumption_view (détail par produit). Live : dès qu'un
 * événement est clôturé/consommé, la conso s'y reflète. RG-003 : vues réservées
 * ROLE_STADE (anon révoqué en base).
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Boxes, CalendarClock, Layers, Search, TrendingUp, Wallet } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { EmptyState, Input, Select, Spinner } from '@/components/ui';
import { formatEuro } from '@/lib/calculations';
import type { Event } from '@/lib/types';
import type { EventSpaceWithSpace } from '@/hooks/useEvents';

interface SummaryRow {
  space_id: string; space_name: string; family: string; service_type: string | null;
  nb_produits: number; total_unites: number; valeur_ht: number; nb_events: number; dernier_event: string | null;
}
interface DetailRow {
  space_id: string; space_name: string; family: string; service_type: string | null;
  product_id: string; product_name: string; category: string; unit: string;
  nb_events: number; total_consomme: number; moy_par_event: number; min_event: number; max_event: number;
  conso_par_100_pax: number; pu_ht: number | null; valeur_ht: number | null; dernier_event: string | null;
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const CATEGORY_ORDER = ['Bières', 'Soft', 'Vins', 'Spiritueux', 'Sirops', 'Champagne', 'Matériel'];
const catRank = (c: string) => { const i = CATEGORY_ORDER.indexOf(c); return i === -1 ? CATEGORY_ORDER.length : i; };
const CAT_COLOR: Record<string, string> = {
  'Bières': '#C2751A', 'Soft': '#2F6FED', 'Vins': '#8B2E5A',
  'Spiritueux': '#6B4CD6', 'Sirops': '#1FA37A', 'Champagne': '#B8860B', 'Matériel': '#64748B',
};
const catColor = (c: string) => CAT_COLOR[c] ?? '#64748B';
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');

export function ConsumptionAnalysisTab({ event, spaces }: { event: Event; spaces: EventSpaceWithSpace[] }) {
  const [mode, setMode] = useState<'espace' | 'tous'>('espace');
  const [spaceId, setSpaceId] = useState('');
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const summaryQuery = useQuery({
    queryKey: ['consoSummary'],
    queryFn: async (): Promise<SummaryRow[]> => {
      const { data, error } = await supabase.from('space_consumption_summary').select('*').order('family').order('space_name');
      if (error) throw error;
      return (data as SummaryRow[] | null) ?? [];
    },
  });

  // Défaut : un espace de l'événement ayant un historique, sinon le premier dispo.
  useEffect(() => {
    if (spaceId || !summaryQuery.data?.length) return;
    const eventSpaceIds = new Set(spaces.map((s) => s.space_id));
    const preferred = summaryQuery.data.find((r) => eventSpaceIds.has(r.space_id));
    setSpaceId(preferred?.space_id ?? summaryQuery.data[0].space_id);
  }, [summaryQuery.data, spaces, spaceId]);

  const detailQuery = useQuery({
    queryKey: ['consoDetail', spaceId],
    enabled: !!spaceId && mode === 'espace',
    queryFn: async (): Promise<DetailRow[]> => {
      const { data, error } = await supabase.from('space_consumption_view').select('*').eq('space_id', spaceId).order('total_consomme', { ascending: false });
      if (error) throw error;
      return (data as DetailRow[] | null) ?? [];
    },
  });

  const summary = summaryQuery.data ?? [];
  const selected = summary.find((r) => r.space_id === spaceId);
  const rows = detailQuery.data ?? [];

  const availableCats = useMemo(() => {
    const set = new Map<string, number>();
    for (const r of rows) set.set(r.category, (set.get(r.category) ?? 0) + 1);
    return [...set.entries()].sort((a, b) => catRank(a[0]) - catRank(b[0]));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => (cats.size === 0 || cats.has(r.category)) && (!q || r.product_name.toLowerCase().includes(q)))
      .sort((a, b) => catRank(a.category) - catRank(b.category) || num(b.total_consomme) - num(a.total_consomme));
  }, [rows, cats, search]);

  const pax = num(event.expected_attendees);
  const project = (r: DetailRow) => (pax > 0 ? Math.round(num(r.conso_par_100_pax) * (pax / 100)) : null);

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-pr-black">
          <TrendingUp className="h-5 w-5 text-pr-olive" /> Analyse de consommation
        </h2>
        <p className="mt-0.5 text-sm text-pr-black-soft">Basée sur la conso réelle (stocks finaux). Mise à jour à chaque événement clôturé.</p>
      </div>
      <div className="inline-flex rounded-lg bg-pr-cream p-1 ring-1 ring-inset ring-pr-stone">
        {(['espace', 'tous'] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${mode === m ? 'bg-white text-pr-black shadow-sm' : 'text-pr-black-soft'}`}>
            {m === 'espace' ? 'Par espace' : 'Tous les espaces'}
          </button>
        ))}
      </div>
    </div>
  );

  if (summaryQuery.isLoading) return <div className="space-y-4">{header}<Spinner label="Chargement de l'historique…" /></div>;
  if (summary.length === 0) {
    return (
      <div className="space-y-4">{header}
        <EmptyState icon={TrendingUp} title="Aucun historique de consommation" message="Clôturez des événements pour alimenter l'analyse." />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {header}

      {mode === 'tous' ? (
        <AllSpacesTable summary={summary} onPick={(id) => { setSpaceId(id); setMode('espace'); }} />
      ) : (
        <>
          <div className="max-w-sm">
            <Select
              label="Espace"
              value={spaceId}
              onChange={(e) => { setSpaceId(e.target.value); setCats(new Set()); setSearch(''); }}
              options={summary.map((s) => ({ value: s.space_id, label: `${s.family} · ${s.space_name}` }))}
            />
          </div>

          {/* Cartes de synthèse */}
          {selected && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
              <StatCard icon={Layers} label="Produits" value={String(num(selected.nb_produits))} hint="avec historique" />
              <StatCard icon={CalendarClock} label="Matchs" value={String(num(selected.nb_events))} hint="analysés" />
              <StatCard icon={Boxes} label="Total consommé" value={num(selected.total_unites).toLocaleString('fr-FR')} hint="unités" />
              <StatCard icon={Wallet} label="Valeur HT" value={formatEuro(num(selected.valeur_ht))} hint="conso cumulée" />
              <StatCard icon={CalendarClock} label="Dernier match" value={fmtDate(selected.dernier_event)} />
            </div>
          )}

          {detailQuery.isLoading ? (
            <Spinner label="Analyse…" />
          ) : rows.length === 0 ? (
            <EmptyState icon={TrendingUp} title="Aucun historique pour cet espace" message="Cet espace n'a pas encore de consommation enregistrée." />
          ) : (
            <>
              {/* Filtres */}
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => setCats(new Set())}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${cats.size === 0 ? 'bg-pr-black text-white ring-pr-black' : 'bg-white text-pr-black-soft ring-pr-stone'}`}>
                  Toutes
                </button>
                {availableCats.map(([c, n]) => {
                  const on = cats.has(c);
                  return (
                    <button key={c} onClick={() => setCats((prev) => { const nx = new Set(prev); nx.has(c) ? nx.delete(c) : nx.add(c); return nx; })}
                      className="rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset"
                      style={on ? { background: catColor(c), color: '#fff', borderColor: catColor(c) } : { background: '#fff', color: catColor(c), boxShadow: `inset 0 0 0 1px ${catColor(c)}55` }}>
                      {c} · {n}
                    </button>
                  );
                })}
                <div className="relative ml-auto">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-pr-black-soft" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un produit…" className="w-52 pl-8" />
                </div>
              </div>

              {/* Graphe barres — top produits */}
              <TopProductsChart rows={filtered} />

              {/* Tableau détaillé, sous-totaux par catégorie */}
              <DetailTable rows={filtered} pax={pax} project={project} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, hint }: { icon: typeof Layers; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-pr-stone bg-white p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-pr-black-soft"><Icon className="h-3.5 w-3.5" /> {label}</p>
      <p className="mt-1 text-lg font-black text-pr-black">{value}</p>
      {hint && <p className="text-[11px] text-pr-black-soft">{hint}</p>}
    </div>
  );
}

function TopProductsChart({ rows }: { rows: DetailRow[] }) {
  const top = rows.slice(0, 12);
  const max = Math.max(1, ...top.map((r) => num(r.total_consomme)));
  if (top.length === 0) return null;
  return (
    <section className="rounded-xl border border-pr-stone bg-white p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-pr-black"><BarChart3 className="h-4 w-4 text-pr-olive" /> Top produits consommés</h3>
      <div className="space-y-2">
        {top.map((r) => (
          <div key={r.product_id} className="flex items-center gap-3">
            <span className="w-40 shrink-0 truncate text-sm text-pr-black" title={r.product_name}>{r.product_name}</span>
            <div className="h-5 flex-1 overflow-hidden rounded bg-pr-cream">
              <div className="flex h-full items-center justify-end rounded pr-2" style={{ width: `${(num(r.total_consomme) / max) * 100}%`, background: catColor(r.category), minWidth: 28 }}>
                <span className="text-[11px] font-bold text-white">{num(r.total_consomme)}</span>
              </div>
            </div>
            <span className="w-16 shrink-0 text-right text-[11px] text-pr-black-soft">{r.category}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function DetailTable({ rows, pax, project }: { rows: DetailRow[]; pax: number; project: (r: DetailRow) => number | null }) {
  // Groupé par catégorie (ordre défini), avec sous-totaux.
  const groups = useMemo(() => {
    const m = new Map<string, DetailRow[]>();
    for (const r of rows) { const a = m.get(r.category) ?? []; a.push(r); m.set(r.category, a); }
    return [...m.entries()].sort((a, b) => catRank(a[0]) - catRank(b[0]));
  }, [rows]);

  const grandUnits = rows.reduce((s, r) => s + num(r.total_consomme), 0);
  const grandVal = rows.reduce((s, r) => s + num(r.valeur_ht), 0);

  return (
    <section className="overflow-x-auto rounded-xl border border-pr-stone">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-pr-stone bg-pr-cream text-left text-[11px] uppercase tracking-wide text-pr-black-soft">
            <th className="px-3 py-2">Produit</th>
            <th className="px-2 py-2 text-right">Nb matchs</th>
            <th className="px-2 py-2 text-right">Total</th>
            <th className="px-2 py-2 text-right">Moy/match</th>
            <th className="px-2 py-2 text-right">Min</th>
            <th className="px-2 py-2 text-right">Max</th>
            <th className="px-2 py-2 text-right">/100 pax</th>
            {pax > 0 && <th className="px-2 py-2 text-right" title="Estimation prochain match = conso/100 pax × pax prévu/100">Estim. ≈</th>}
            <th className="px-2 py-2 text-right">PU HT</th>
            <th className="px-3 py-2 text-right">Valeur HT</th>
          </tr>
        </thead>
        {groups.map(([cat, list]) => {
            const subUnits = list.reduce((s, r) => s + num(r.total_consomme), 0);
            const subVal = list.reduce((s, r) => s + num(r.valeur_ht), 0);
            const cols = pax > 0 ? 10 : 9;
            return (
              <tbody key={cat} className="divide-y divide-pr-stone/40">
                <tr style={{ background: `${catColor(cat)}14` }}>
                  <td className="px-3 py-1.5 text-xs font-bold" style={{ color: catColor(cat) }} colSpan={cols - 2}>
                    <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: catColor(cat) }} />{cat}
                  </td>
                  <td className="px-2 py-1.5 text-right text-xs font-bold text-pr-black">{subUnits}</td>
                  <td className="px-3 py-1.5 text-right text-xs font-bold text-pr-black">{formatEuro(subVal)}</td>
                </tr>
                {list.map((r) => (
                  <tr key={r.product_id} className="text-pr-black">
                    <td className="px-3 py-2 font-medium">{r.product_name}<span className="ml-1 text-[10px] text-pr-black-soft">{r.unit}</span></td>
                    <td className="px-2 py-2 text-right tabular-nums text-pr-black-soft">{num(r.nb_events)}</td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums">{num(r.total_consomme)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{num(r.moy_par_event).toFixed(1)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-pr-black-soft">{num(r.min_event)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-pr-black-soft">{num(r.max_event)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-pr-black-soft">{num(r.conso_par_100_pax).toFixed(1)}</td>
                    {pax > 0 && <td className="px-2 py-2 text-right tabular-nums font-medium text-pr-olive">{project(r) ?? '—'}</td>}
                    <td className="px-2 py-2 text-right tabular-nums text-pr-black-soft">{r.pu_ht != null ? formatEuro(num(r.pu_ht)) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.valeur_ht != null ? formatEuro(num(r.valeur_ht)) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            );
          })}
        <tfoot>
          <tr className="border-t-2 border-pr-stone bg-pr-cream font-bold text-pr-black">
            <td className="px-3 py-2" colSpan={pax > 0 ? 8 : 7}>TOTAL</td>
            <td className="px-2 py-2 text-right tabular-nums">{grandUnits}</td>
            <td className="px-3 py-2 text-right tabular-nums">{formatEuro(grandVal)}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

function AllSpacesTable({ summary, onPick }: { summary: SummaryRow[]; onPick: (id: string) => void }) {
  const sorted = [...summary].sort((a, b) => num(b.valeur_ht) - num(a.valeur_ht));
  const maxUnits = Math.max(1, ...sorted.map((s) => num(s.total_unites)));
  return (
    <section className="overflow-x-auto rounded-xl border border-pr-stone">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-pr-stone bg-pr-cream text-left text-[11px] uppercase tracking-wide text-pr-black-soft">
            <th className="px-3 py-2">Espace</th>
            <th className="px-2 py-2">Famille</th>
            <th className="px-2 py-2 text-right">Produits</th>
            <th className="px-2 py-2 text-right">Matchs</th>
            <th className="px-3 py-2">Volume (unités)</th>
            <th className="px-3 py-2 text-right">Valeur HT</th>
            <th className="px-3 py-2 text-right">Dernier</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-pr-stone/40">
          {sorted.map((s) => (
            <tr key={s.space_id} onClick={() => onPick(s.space_id)} className="cursor-pointer text-pr-black hover:bg-pr-cream/60">
              <td className="px-3 py-2 font-semibold">{s.space_name}</td>
              <td className="px-2 py-2 text-pr-black-soft">{s.family}</td>
              <td className="px-2 py-2 text-right tabular-nums">{num(s.nb_produits)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-pr-black-soft">{num(s.nb_events)}</td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-32 overflow-hidden rounded-full bg-pr-cream">
                    <div className="h-full rounded-full bg-pr-olive" style={{ width: `${(num(s.total_unites) / maxUnits) * 100}%` }} />
                  </div>
                  <span className="tabular-nums text-xs text-pr-black-soft">{num(s.total_unites).toLocaleString('fr-FR')}</span>
                </div>
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatEuro(num(s.valeur_ht))}</td>
              <td className="px-3 py-2 text-right text-xs text-pr-black-soft">{fmtDate(s.dernier_event)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
