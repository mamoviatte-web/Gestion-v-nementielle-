/**
 * Onglet « 📈 Analyse conso » (ROLE_STADE) — SECTORISÉ PAR ÉVÉNEMENT.
 *
 * Le calcul est cloisonné à l'événement courant : les espaces proposés sont
 * uniquement ceux réellement servis sur CE match (consumption_by_event_space),
 * et le détail vient de event_space_product_consumption (event × espace ×
 * produit) — plus de mélange Vannes/Barrage/Nice, plus de Loge Ouest sur Nice.
 *
 * Fiabilité de clôture : bloc « Complétude » (event_consumption_completeness) —
 * détecte les stocks finaux manquants (chiffres PROVISOIRES) et permet de les
 * finaliser par espace via finalize_space_finals (épuisé → 0, retour → rempli).
 *
 * Mode « Analyse générale » : vues transversales tous matchs clôturés (produit /
 * espace / match). RG-003 : vues réservées ROLE_STADE (anon révoqué en base).
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BarChart3, Boxes, Layers, Search, TrendingUp, Wallet } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Button, EmptyState, Input, Select, Spinner } from '@/components/ui';
import { formatEuro } from '@/lib/calculations';
import type { Event } from '@/lib/types';

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const CATEGORY_ORDER = ['Bières', 'Soft', 'Vins', 'Spiritueux', 'Sirops', 'Champagne', 'Matériel'];
const catRank = (c: string) => { const i = CATEGORY_ORDER.indexOf(c); return i === -1 ? CATEGORY_ORDER.length : i; };
const CAT_COLOR: Record<string, string> = {
  'Bières': '#C2751A', 'Soft': '#2F6FED', 'Vins': '#8B2E5A',
  'Spiritueux': '#6B4CD6', 'Sirops': '#1FA37A', 'Champagne': '#B8860B', 'Matériel': '#64748B',
};
const catColor = (c: string) => CAT_COLOR[c] ?? '#64748B';
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');

interface EventSummary { nb_espaces: number; nb_produits_consommes: number; total_consomme: number; valeur_ht: number; nb_anomalies: number }
interface ServedSpace { space_id: string; space_name: string; family: string; nb_produits: number; total_consomme: number; valeur_ht: number; nb_anomalies: number }
interface DetailRow {
  space_id: string; product_id: string; product_name: string; category: string; unit: string;
  stock_rempli: number; stock_final: number | null; consomme: number | null; pu_ht: number | null; valeur_ht: number | null; anomalie: boolean;
}
interface CompletenessRow { space_id: string; space_name: string; lignes_remplies: number; finals_saisis: number; finals_manquants: number; unites_en_attente: number }

export function ConsumptionAnalysisTab({ event }: { event: Event }) {
  const [mode, setMode] = useState<'match' | 'general'>('match');
  const eventId = event.event_id;

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-pr-black"><TrendingUp className="h-5 w-5 text-pr-olive" /> Analyse de consommation</h2>
        <p className="mt-0.5 text-sm text-pr-black-soft">Sectorisée sur ce match — conso = stock rempli − stock final.</p>
      </div>
      <div className="inline-flex rounded-lg bg-pr-cream p-1 ring-1 ring-inset ring-pr-stone">
        {(['match', 'general'] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${mode === m ? 'bg-white text-pr-black shadow-sm' : 'text-pr-black-soft'}`}>
            {m === 'match' ? 'Ce match' : 'Analyse générale'}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {header}
      {mode === 'match' ? <MatchAnalysis event={event} /> : <GeneralAnalysis />}
      <p className="text-center text-[11px] text-pr-black-soft/60">Event : {eventId.slice(0, 8)}…</p>
    </div>
  );
}

/* ─────────────────────────── Analyse du match ─────────────────────────── */

function MatchAnalysis({ event }: { event: Event }) {
  const eventId = event.event_id;
  const { user } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const by = user?.name ?? user?.email ?? 'Stade';
  const [spaceId, setSpaceId] = useState('');
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState('');

  const summaryQ = useQuery({
    queryKey: ['consoEventSummary', eventId],
    queryFn: async (): Promise<EventSummary | null> => {
      const { data } = await supabase.from('consumption_by_event').select('*').eq('event_id', eventId).maybeSingle();
      return (data as EventSummary | null) ?? null;
    },
  });
  const completenessQ = useQuery({
    queryKey: ['consoCompleteness', eventId],
    queryFn: async (): Promise<CompletenessRow[]> => {
      const { data } = await supabase.from('event_consumption_completeness').select('*').eq('event_id', eventId).order('finals_manquants', { ascending: false });
      return (data as CompletenessRow[] | null) ?? [];
    },
  });
  const spacesQ = useQuery({
    queryKey: ['consoServedSpaces', eventId],
    queryFn: async (): Promise<ServedSpace[]> => {
      const { data } = await supabase.from('consumption_by_event_space').select('*').eq('event_id', eventId).order('valeur_ht', { ascending: false });
      return (data as ServedSpace[] | null) ?? [];
    },
  });
  const detailQ = useQuery({
    queryKey: ['consoDetail', eventId, spaceId],
    enabled: !!spaceId,
    queryFn: async (): Promise<DetailRow[]> => {
      const { data } = await supabase.from('event_space_product_consumption').select('*').eq('event_id', eventId).eq('space_id', spaceId).order('consomme', { ascending: false });
      return (data as DetailRow[] | null) ?? [];
    },
  });

  const servedSpaces = spacesQ.data ?? [];
  useEffect(() => {
    if (spaceId || servedSpaces.length === 0) return;
    setSpaceId(servedSpaces[0].space_id);
  }, [servedSpaces, spaceId]);

  const completeness = completenessQ.data ?? [];
  const missingTotal = completeness.reduce((s, r) => s + num(r.finals_manquants), 0);
  const pendingUnits = completeness.reduce((s, r) => s + num(r.unites_en_attente), 0);

  async function finalize(sId: string, assume: 'epuise' | 'retour') {
    const label = assume === 'epuise' ? 'épuisé (final = 0)' : 'retour (final = stock rempli)';
    if (!window.confirm(`Finaliser les stocks finaux manquants de cet espace en « ${label} » ?`)) return;
    setBusy(`${sId}:${assume}`);
    const { data, error } = await supabase.rpc('finalize_space_finals', { p_event: eventId, p_space: sId, p_by: by, p_assume: assume });
    setBusy('');
    const r = data as { success?: boolean; lignes_finalisees?: number } | null;
    if (error || !r?.success) { showToast(`Échec : ${error?.message ?? 'refusé'}`, 'warning'); return; }
    showToast(`${num(r?.lignes_finalisees)} ligne(s) finalisée(s) (${assume}).`, 'success');
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['consoEventSummary', eventId] }),
      queryClient.invalidateQueries({ queryKey: ['consoCompleteness', eventId] }),
      queryClient.invalidateQueries({ queryKey: ['consoServedSpaces', eventId] }),
      queryClient.invalidateQueries({ queryKey: ['consoDetail', eventId] }),
      queryClient.invalidateQueries({ queryKey: ['event', eventId] }),
    ]);
  }

  const rows = detailQ.data ?? [];
  const availableCats = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (num(r.consomme) > 0 || showAll) m.set(r.category, (m.get(r.category) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => catRank(a[0]) - catRank(b[0]));
  }, [rows, showAll]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => (showAll ? num(r.stock_rempli) > 0 : num(r.consomme) > 0))
      .filter((r) => (cats.size === 0 || cats.has(r.category)) && (!q || r.product_name.toLowerCase().includes(q)))
      .sort((a, b) => catRank(a.category) - catRank(b.category) || num(b.consomme) - num(a.consomme));
  }, [rows, cats, search, showAll]);

  if (summaryQ.isLoading || spacesQ.isLoading) return <Spinner label="Chargement du match…" />;

  const summary = summaryQ.data;
  const noData = servedSpaces.length === 0 && missingTotal === 0;

  return (
    <div className="space-y-5">
      {/* Complétude clôture */}
      {missingTotal > 0 && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-bold text-amber-800"><AlertTriangle size={16} /> Chiffres PROVISOIRES — stocks finaux manquants</p>
            <p className="text-xs font-semibold text-amber-700">{missingTotal} final(s) manquant(s) · {pendingUnits} unités en attente</p>
          </div>
          <p className="mt-1 text-xs text-amber-700">Finalisez chaque espace incomplet : « Épuisé » (buvette vidée → tout consommé) ou « Retour » (stock rendu → rien consommé).</p>
          <div className="mt-3 space-y-1.5">
            {completeness.filter((c) => num(c.finals_manquants) > 0).map((c) => (
              <div key={c.space_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 ring-1 ring-amber-200">
                <span className="text-sm font-medium text-pr-black">{c.space_name}</span>
                <span className="text-xs text-pr-black-soft">{num(c.finals_manquants)} manquant(s) · {num(c.unites_en_attente)} u. en attente</span>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="secondary" loading={busy === `${c.space_id}:epuise`} onClick={() => void finalize(c.space_id, 'epuise')}>Épuisé (0)</Button>
                  <Button size="sm" variant="ghost" loading={busy === `${c.space_id}:retour`} onClick={() => void finalize(c.space_id, 'retour')}>Retour</Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {noData ? (
        <EmptyState icon={TrendingUp} title="Aucune consommation sur ce match" message="Les chiffres apparaissent une fois les stocks finaux saisis (ou l'événement clôturé)." />
      ) : (
        <>
          {/* Cartes de synthèse du match */}
          {summary && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <StatCard icon={Boxes} label="Espaces servis" value={String(num(summary.nb_espaces))} />
              <StatCard icon={Layers} label="Produits consommés" value={String(num(summary.nb_produits_consommes))} />
              <StatCard icon={Boxes} label="Total consommé" value={num(summary.total_consomme).toLocaleString('fr-FR')} hint="unités" />
              <StatCard icon={Wallet} label="Valeur HT" value={formatEuro(num(summary.valeur_ht))} />
              <StatCard icon={AlertTriangle} label="Anomalies" value={String(num(summary.nb_anomalies))} accent={num(summary.nb_anomalies) > 0 ? '#B45309' : undefined} />
            </div>
          )}

          {servedSpaces.length > 0 && (
            <>
              <div className="max-w-sm">
                <Select label="Espace servi" value={spaceId}
                  onChange={(e) => { setSpaceId(e.target.value); setCats(new Set()); setSearch(''); }}
                  options={servedSpaces.map((s) => ({ value: s.space_id, label: `${s.family} · ${s.space_name} (${num(s.total_consomme)} u.)` }))} />
              </div>

              {detailQ.isLoading ? <Spinner label="Détail…" /> : (
                <>
                  {/* Filtres */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => setCats(new Set())} className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${cats.size === 0 ? 'bg-pr-black text-white ring-pr-black' : 'bg-white text-pr-black-soft ring-pr-stone'}`}>Toutes</button>
                    {availableCats.map(([c, n]) => {
                      const on = cats.has(c);
                      return (
                        <button key={c} onClick={() => setCats((prev) => { const nx = new Set(prev); nx.has(c) ? nx.delete(c) : nx.add(c); return nx; })}
                          className="rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset"
                          style={on ? { background: catColor(c), color: '#fff' } : { background: '#fff', color: catColor(c), boxShadow: `inset 0 0 0 1px ${catColor(c)}55` }}>
                          {c} · {n}
                        </button>
                      );
                    })}
                    <label className="flex items-center gap-1.5 text-xs text-pr-black-soft">
                      <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="h-4 w-4 rounded border-pr-stone" /> voir non consommés
                    </label>
                    <div className="relative ml-auto">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-pr-black-soft" />
                      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher…" className="w-48 pl-8" />
                    </div>
                  </div>

                  <TopChart rows={filtered} />
                  <DetailTable rows={filtered} />
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function TopChart({ rows }: { rows: DetailRow[] }) {
  const top = rows.filter((r) => num(r.consomme) > 0).slice(0, 12);
  const max = Math.max(1, ...top.map((r) => num(r.consomme)));
  if (top.length === 0) return null;
  return (
    <section className="rounded-xl border border-pr-stone bg-white p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-pr-black"><BarChart3 className="h-4 w-4 text-pr-olive" /> Top produits consommés</h3>
      <div className="space-y-2">
        {top.map((r) => (
          <div key={r.product_id} className="flex items-center gap-3">
            <span className="w-40 shrink-0 truncate text-sm text-pr-black" title={r.product_name}>{r.product_name}</span>
            <div className="h-5 flex-1 overflow-hidden rounded bg-pr-cream">
              <div className="flex h-full items-center justify-end rounded pr-2" style={{ width: `${(num(r.consomme) / max) * 100}%`, background: catColor(r.category), minWidth: 28 }}>
                <span className="text-[11px] font-bold text-white">{num(r.consomme)}</span>
              </div>
            </div>
            <span className="w-16 shrink-0 text-right text-[11px] text-pr-black-soft">{r.category}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function DetailTable({ rows }: { rows: DetailRow[] }) {
  const totRempli = rows.reduce((s, r) => s + num(r.stock_rempli), 0);
  const totConso = rows.reduce((s, r) => s + num(r.consomme), 0);
  const totVal = rows.reduce((s, r) => s + num(r.valeur_ht), 0);
  if (rows.length === 0) return <p className="rounded-xl bg-pr-cream px-4 py-6 text-center text-sm text-pr-black-soft">Aucun produit consommé sur cet espace.</p>;
  return (
    <section className="overflow-x-auto rounded-xl border border-pr-stone">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-pr-stone bg-pr-cream text-left text-[11px] uppercase tracking-wide text-pr-black-soft">
            <th className="px-3 py-2">Produit</th><th className="px-2 py-2">Cat.</th>
            <th className="px-2 py-2 text-right">Stock rempli</th><th className="px-2 py-2 text-right">Stock final</th>
            <th className="px-2 py-2 text-right">Consommé</th><th className="px-2 py-2 text-right">PU HT</th><th className="px-3 py-2 text-right">Valeur HT</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-pr-stone/40">
          {rows.map((r) => (
            <tr key={r.product_id} className={r.anomalie ? 'bg-rose-50/60' : ''}>
              <td className="px-3 py-2 font-medium text-pr-black">
                {r.anomalie && <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-rose-500" aria-label="Anomalie" />}
                {r.product_name}<span className="ml-1 text-[10px] text-pr-black-soft">{r.unit}</span>
              </td>
              <td className="px-2 py-2"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: catColor(r.category) }} /> <span className="text-xs text-pr-black-soft">{r.category}</span></td>
              <td className="px-2 py-2 text-right tabular-nums">{num(r.stock_rempli)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-pr-black-soft">{r.stock_final == null ? '—' : num(r.stock_final)}</td>
              <td className="px-2 py-2 text-right font-semibold tabular-nums">{r.consomme == null ? '—' : num(r.consomme)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-pr-black-soft">{r.pu_ht != null ? formatEuro(num(r.pu_ht)) : '—'}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.valeur_ht != null ? formatEuro(num(r.valeur_ht)) : '—'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-pr-stone bg-pr-cream font-bold text-pr-black">
            <td className="px-3 py-2" colSpan={2}>TOTAL</td>
            <td className="px-2 py-2 text-right tabular-nums">{totRempli}</td><td />
            <td className="px-2 py-2 text-right tabular-nums">{totConso}</td><td />
            <td className="px-3 py-2 text-right tabular-nums">{formatEuro(totVal)}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

/* ─────────────────────────── Analyse générale ─────────────────────────── */

interface GenProduct { product_id: string; product_name: string; category: string; nb_matchs: number; nb_espaces: number; total_consomme: number; valeur_ht: number }
interface GenSpace { space_id: string; space_name: string; family: string; nb_matchs: number; nb_produits: number; total_consomme: number; valeur_ht: number }
interface GenEvent { event_id: string; event_name: string; event_date: string; nb_espaces: number; nb_produits_consommes: number; total_consomme: number; valeur_ht: number; nb_anomalies: number }

function GeneralAnalysis() {
  const [sub, setSub] = useState<'produit' | 'espace' | 'match'>('produit');
  const q = useQuery({
    queryKey: ['consoGeneral'],
    queryFn: async () => {
      const [p, s, e] = await Promise.all([
        supabase.from('consumption_general_by_product').select('*').order('total_consomme', { ascending: false }),
        supabase.from('consumption_general_by_space').select('*').order('valeur_ht', { ascending: false }),
        supabase.from('consumption_by_event').select('*').order('event_date', { ascending: false }),
      ]);
      return {
        produit: (p.data as GenProduct[] | null) ?? [],
        espace: (s.data as GenSpace[] | null) ?? [],
        match: (e.data as GenEvent[] | null) ?? [],
      };
    },
  });
  if (q.isLoading) return <Spinner label="Analyse générale…" />;
  const d = q.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(['produit', 'espace', 'match'] as const).map((k) => (
          <button key={k} onClick={() => setSub(k)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${sub === k ? 'bg-pr-black text-white ring-pr-black' : 'bg-white text-pr-black-soft ring-pr-stone'}`}>
            {k === 'produit' ? 'Par produit' : k === 'espace' ? 'Par espace' : 'Par match'}
          </button>
        ))}
      </div>

      {sub === 'produit' && <GenTable head={['Produit', 'Cat.', 'Nb matchs', 'Total', 'Valeur HT']}
        rows={(d?.produit ?? []).map((r) => [r.product_name, r.category, String(num(r.nb_matchs)), num(r.total_consomme).toLocaleString('fr-FR'), formatEuro(num(r.valeur_ht))])}
        max={Math.max(1, ...(d?.produit ?? []).map((r) => num(r.total_consomme)))}
        barVals={(d?.produit ?? []).map((r) => num(r.total_consomme))} colorKey={(d?.produit ?? []).map((r) => r.category)} />}

      {sub === 'espace' && <GenTable head={['Espace', 'Famille', 'Nb matchs', 'Total', 'Valeur HT']}
        rows={(d?.espace ?? []).map((r) => [r.space_name, r.family, String(num(r.nb_matchs)), num(r.total_consomme).toLocaleString('fr-FR'), formatEuro(num(r.valeur_ht))])}
        max={Math.max(1, ...(d?.espace ?? []).map((r) => num(r.total_consomme)))}
        barVals={(d?.espace ?? []).map((r) => num(r.total_consomme))} />}

      {sub === 'match' && <GenTable head={['Match', 'Date', 'Espaces', 'Total', 'Valeur HT', 'Anomalies']}
        rows={(d?.match ?? []).map((r) => [r.event_name, fmtDate(r.event_date), String(num(r.nb_espaces)), num(r.total_consomme).toLocaleString('fr-FR'), formatEuro(num(r.valeur_ht)), String(num(r.nb_anomalies))])}
        max={Math.max(1, ...(d?.match ?? []).map((r) => num(r.total_consomme)))}
        barVals={(d?.match ?? []).map((r) => num(r.total_consomme))} />}
    </div>
  );
}

function GenTable({ head, rows, max, barVals, colorKey }: { head: string[]; rows: string[][]; max: number; barVals: number[]; colorKey?: string[] }) {
  if (rows.length === 0) return <EmptyState icon={TrendingUp} title="Aucun historique" message="Clôturez des matchs pour alimenter l'analyse." />;
  const totalIdx = head.length - 2; // colonne « Total » (avant Valeur HT)
  return (
    <section className="overflow-x-auto rounded-xl border border-pr-stone">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-pr-stone bg-pr-cream text-left text-[11px] uppercase tracking-wide text-pr-black-soft">
            {head.map((h, i) => <th key={h} className={`px-3 py-2 ${i >= 2 ? 'text-right' : ''}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-pr-stone/40">
          {rows.map((cells, ri) => (
            <tr key={ri} className="text-pr-black">
              {cells.map((c, ci) => (
                <td key={ci} className={`px-3 py-2 ${ci >= 2 ? 'text-right tabular-nums' : ci === 0 ? 'font-medium' : 'text-pr-black-soft'}`}>
                  {ci === totalIdx ? (
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-pr-cream">
                        <div className="h-full rounded-full" style={{ width: `${(barVals[ri] / max) * 100}%`, background: colorKey ? catColor(colorKey[ri]) : '#5B7C4B' }} />
                      </div>
                      {c}
                    </div>
                  ) : c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/* ─────────────────────────── commun ─────────────────────────── */

function StatCard({ icon: Icon, label, value, hint, accent }: { icon: typeof Layers; label: string; value: string; hint?: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-pr-stone bg-white p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-pr-black-soft"><Icon className="h-3.5 w-3.5" style={accent ? { color: accent } : undefined} /> {label}</p>
      <p className="mt-1 text-lg font-black" style={accent ? { color: accent } : undefined}>{value}</p>
      {hint && <p className="text-[11px] text-pr-black-soft">{hint}</p>}
    </div>
  );
}
