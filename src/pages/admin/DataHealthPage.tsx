/**
 * DataHealthPage — « Santé des données » (ROLE_STADE). Vérifie l'intégrité des
 * dérivés par rapport aux registres (sources de vérité immuables) :
 *   1. Audit fûts : keg_true_balance (reçus − consommés − purges − en espace)
 *      vs keg_summary (affiché) → l'écart doit être NUL par construction.
 *   2. Complétude clôture : event_consumption_completeness → finals manquants
 *      (les chiffres bougent parce qu'il MANQUE des finals, pas parce qu'on
 *      « recalcule » — à compléter, pas à recalculer).
 * Principe : registres append-only, chiffres dérivés, aucune suppression auto.
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, Beer, Boxes, CheckCircle2, ClipboardCheck, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Spinner } from '@/components/ui';
import { formatEuro } from '@/lib/calculations';

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

interface TrueBalance { product_id: string; product_name: string; recus: number; consommes: number; purges: number; pleins_theoriques: number; vides_theoriques: number; valeur_pleins_ht: number | null }
interface KegSummary { product_id: string; product_name: string; pleins: number; en_espace: number; vides: number }
interface CompletenessRow { event_id: string; event_name: string; status: string; space_id: string; space_name: string; finals_manquants: number; unites_en_attente: number }
interface StockRow { product_id: string; product_name: string; category: string; qty_auc: number; qty_est: number; qty_futs: number; qty_total_depot: number; qty_in_event: number; valeur_depot_ht: number | null; alert_status: string | null; min_stock: number | null }
interface LedgerSynth { location_name: string; location_type: string; refs: number; refs_en_ecart: number; refs_negatives: number; ecart_abs_total: number | null; refs_sans_ancre: number; derniere_ancre: string | null }
interface LedgerEcart { product_id: string; location_name: string; location_type: string; anchor_qty: number; derived_qty: number; counter_qty: number; ecart: number; product_name?: string }
interface PhantomRow { movement_id: string; depot: string; movement_type: string; qty: number; product_id: string; product_name?: string }

export default function DataHealthPage() {
  const kegQ = useQuery({
    queryKey: ['dataHealthKegs'],
    queryFn: async () => {
      const [t, s] = await Promise.all([
        supabase.from('keg_true_balance').select('*').order('product_name'),
        supabase.from('keg_summary').select('product_id, product_name, pleins, en_espace, vides'),
      ]);
      return { truth: (t.data as TrueBalance[] | null) ?? [], summary: (s.data as KegSummary[] | null) ?? [] };
    },
  });

  const compQ = useQuery({
    queryKey: ['dataHealthCompleteness'],
    queryFn: async (): Promise<CompletenessRow[]> => {
      const { data } = await supabase.from('event_consumption_completeness').select('*').gt('finals_manquants', 0).order('finals_manquants', { ascending: false });
      return (data as CompletenessRow[] | null) ?? [];
    },
  });

  // CDC V5 #1/#5 — cohérence du stock général : stade = Σ localisations (dérivé).
  const stockQ = useQuery({
    queryKey: ['dataHealthStock'],
    queryFn: async (): Promise<StockRow[]> => {
      const { data } = await supabase.from('stock_live_balance').select('*');
      return (data as StockRow[] | null) ?? [];
    },
  });
  // Socle de précision : compteur (stock_balances) vs dérivé (ancre + Σ flux).
  const ledgerQ = useQuery({
    queryKey: ['dataHealthLedger'],
    queryFn: async () => {
      const [syn, ec, ph, pr] = await Promise.all([
        supabase.from('v_stock_audit_synthese').select('*'),
        supabase.from('v_stock_audit_ecarts').select('product_id, location_name, location_type, anchor_qty, derived_qty, counter_qty, ecart').order('ecart'),
        supabase.from('v_stock_audit_sorties_fantomes').select('movement_id, depot, movement_type, qty, product_id'),
        supabase.from('products').select('product_id, product_name'),
      ]);
      const nameById = new Map(((pr.data as { product_id: string; product_name: string }[] | null) ?? []).map((p) => [p.product_id, p.product_name]));
      return {
        synth: (syn.data as LedgerSynth[] | null) ?? [],
        ecarts: ((ec.data as LedgerEcart[] | null) ?? []).map((r) => ({ ...r, product_name: nameById.get(r.product_id) ?? r.product_id })),
        phantoms: ((ph.data as PhantomRow[] | null) ?? []).map((r) => ({ ...r, product_name: nameById.get(r.product_id) ?? r.product_id })),
      };
    },
  });
  const ledger = ledgerQ.data ?? { synth: [], ecarts: [], phantoms: [] };
  const ledgerEcartsTot = ledger.synth.reduce((s, r) => s + num(r.refs_en_ecart), 0);
  const ledgerNegTot = ledger.synth.reduce((s, r) => s + num(r.refs_negatives), 0);

  const stock = stockQ.data ?? [];
  const stockIncoherences = useMemo(
    () => stock.filter((r) => Math.round(num(r.qty_total_depot)) !== Math.round(num(r.qty_auc) + num(r.qty_est) + num(r.qty_futs))),
    [stock],
  );
  const stockAlerts = useMemo(
    () => stock.filter((r) => {
      const a = String(r.alert_status ?? '').toLowerCase();
      return a.includes('rupture') || a.includes('critique') || a.includes('alerte');
    }),
    [stock],
  );
  const stockValue = stock.reduce((s, r) => s + num(r.valeur_depot_ht), 0);

  const kegRows = useMemo(() => {
    const summaryById = new Map((kegQ.data?.summary ?? []).map((s) => [s.product_id, s]));
    return (kegQ.data?.truth ?? []).map((t) => {
      const affiche = summaryById.get(t.product_id);
      const pleinsAffiche = num(affiche?.pleins);
      return { ...t, pleins_affiche: pleinsAffiche, en_espace: num(affiche?.en_espace), ecart: pleinsAffiche - num(t.pleins_theoriques) };
    });
  }, [kegQ.data]);

  const ecarts = kegRows.filter((r) => r.ecart !== 0);
  const totalPleins = kegRows.reduce((s, r) => s + num(r.pleins_affiche), 0);
  const totalValeur = kegRows.reduce((s, r) => s + num(r.valeur_pleins_ht), 0);

  const compByEvent = useMemo(() => {
    const m = new Map<string, { event_id: string; event_name: string; status: string; spaces: CompletenessRow[]; miss: number; pending: number }>();
    for (const r of compQ.data ?? []) {
      const g = m.get(r.event_id) ?? { event_id: r.event_id, event_name: r.event_name, status: r.status, spaces: [], miss: 0, pending: 0 };
      g.spaces.push(r); g.miss += num(r.finals_manquants); g.pending += num(r.unites_en_attente);
      m.set(r.event_id, g);
    }
    return [...m.values()].sort((a, b) => b.miss - a.miss);
  }, [compQ.data]);

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-5">
        <h1 className="flex items-center gap-2 text-xl font-black text-stone-900"><Activity className="text-pr-olive" /> Santé des données</h1>
        <p className="mt-1 text-sm text-stone-500">Contrôle d'intégrité : les chiffres affichés sont dérivés des registres (sources de vérité immuables). Rien n'est supprimé automatiquement.</p>
      </div>

      {/* Principe */}
      <div className="mb-6 flex items-start gap-2 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-stone-600">
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-pr-olive" />
        <span>Registres append-only : <b>event_stock_lines</b> (conso), réceptions <b>keg_inventory</b>, <b>event_revenue</b>, <b>occasional_hours</b>. Les vues (keg_summary, consommation, marge…) en dérivent. Chaque process est idempotent : relancé, il converge sans dupliquer.</span>
      </div>

      {/* 0.bis Précision du ledger : compteur vs dérivé (ancre + Σ flux) */}
      <section className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-stone-800"><ShieldCheck size={16} className="text-pr-olive" /> Précision du ledger (compteur vs dérivé)</h2>
        {ledgerQ.isLoading ? <Spinner /> : (
          <>
            <div className={`mb-3 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${ledgerEcartsTot === 0 && ledger.phantoms.length === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
              {ledgerEcartsTot === 0 && ledger.phantoms.length === 0
                ? <><CheckCircle2 size={16} /> Aligné — chaque solde = dernière ancre physique + Σ flux. Aucun écart, aucun mouvement fantôme.</>
                : <><AlertTriangle size={16} /> {ledgerEcartsTot} écart(s) compteur/dérivé · {ledger.phantoms.length} mouvement(s) fantôme(s) · {ledgerNegTot} solde(s) négatif(s) — à ancrer par comptage physique.</>}
            </div>

            {/* Synthèse par emplacement */}
            <div className="mb-3 overflow-x-auto rounded-xl border border-stone-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-100 bg-stone-50 text-left text-[11px] uppercase tracking-wide text-stone-400">
                    <th className="px-3 py-2">Emplacement</th><th className="px-2 py-2 text-right">Réfs</th>
                    <th className="px-2 py-2 text-right">Écarts</th><th className="px-2 py-2 text-right">Négatifs</th>
                    <th className="px-2 py-2 text-right">Sans ancre</th><th className="px-3 py-2">Dernière ancre</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-50">
                  {ledger.synth.map((r) => (
                    <tr key={r.location_name} className={num(r.refs_en_ecart) > 0 ? 'bg-amber-50/50' : 'text-stone-800'}>
                      <td className="px-3 py-2 font-medium">{r.location_name} <span className="text-[10px] text-stone-400">{r.location_type === 'reserve_centrale' ? '· dépôt' : '· espace'}</span></td>
                      <td className="px-2 py-2 text-right tabular-nums text-stone-500">{num(r.refs)}</td>
                      <td className={`px-2 py-2 text-right font-bold tabular-nums ${num(r.refs_en_ecart) ? 'text-amber-600' : 'text-emerald-600'}`}>{num(r.refs_en_ecart)}</td>
                      <td className={`px-2 py-2 text-right tabular-nums ${num(r.refs_negatives) ? 'text-rose-600 font-bold' : 'text-stone-400'}`}>{num(r.refs_negatives) || '—'}</td>
                      <td className={`px-2 py-2 text-right tabular-nums ${num(r.refs_sans_ancre) ? 'text-amber-500' : 'text-stone-400'}`}>{num(r.refs_sans_ancre) || '—'}</td>
                      <td className="px-3 py-2 text-xs text-stone-500">{r.derniere_ancre ? new Date(r.derniere_ancre).toLocaleDateString('fr-FR') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Détail des écarts */}
            {ledger.ecarts.length > 0 && (
              <div className="mb-3 overflow-x-auto rounded-xl border border-amber-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-amber-100 bg-amber-50 text-left text-[11px] uppercase tracking-wide text-amber-700">
                      <th className="px-3 py-2">Produit</th><th className="px-3 py-2">Emplacement</th>
                      <th className="px-2 py-2 text-right">Ancre</th><th className="px-2 py-2 text-right">Dérivé</th>
                      <th className="px-2 py-2 text-right">Compteur</th><th className="px-2 py-2 text-right">Écart</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-50">
                    {ledger.ecarts.map((r) => (
                      <tr key={`${r.product_id}_${r.location_name}`} className="text-stone-800">
                        <td className="px-3 py-2 font-medium">{r.product_name}</td>
                        <td className="px-3 py-2 text-stone-500">{r.location_name}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-stone-400">{num(r.anchor_qty)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{num(r.derived_qty)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{num(r.counter_qty)}</td>
                        <td className={`px-2 py-2 text-right font-bold tabular-nums ${num(r.ecart) === 0 ? 'text-emerald-600' : 'text-amber-600'}`}>{num(r.ecart) > 0 ? `+${num(r.ecart)}` : num(r.ecart)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Mouvements fantômes */}
            {ledger.phantoms.length > 0 && (
              <div className="rounded-xl border border-rose-200 bg-rose-50/40 px-4 py-3">
                <p className="text-xs font-semibold text-rose-700">{ledger.phantoms.length} mouvement(s) sans ligne de solde source (« fantômes ») :</p>
                <p className="mt-1 text-xs text-stone-600">{ledger.phantoms.map((p) => `${p.product_name} (${p.movement_type} ${num(p.qty)} · ${p.depot})`).join(' · ')}</p>
              </div>
            )}
            <p className="mt-2 text-xs text-stone-400">Principe : <b>solde = dernière ancre physique + Σ flux depuis</b>. Un écart ≠ 0 se résout par un <b>comptage physique</b> (ré-ancrage), jamais par un recalcul aveugle.</p>
          </>
        )}
      </section>

      {/* 0. Cohérence du stock général */}
      <section className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-stone-800"><Boxes size={16} className="text-pr-olive" /> Cohérence du stock général (Σ localisations)</h2>
        {stockQ.isLoading ? <Spinner /> : (
          <>
            <div className={`mb-3 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${stockIncoherences.length === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
              {stockIncoherences.length === 0
                ? <><CheckCircle2 size={16} /> Cohérent — stock stade = Σ localisations (AUC + Stock EST + Fûts) sur {stock.length} produit(s). Aucune valeur libre.</>
                : <><AlertTriangle size={16} /> {stockIncoherences.length} produit(s) avec du stock dépôt hors AUC / Stock EST / Fûts — à rattacher à une localisation.</>}
            </div>
            <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-stone-100 bg-white p-3"><p className="text-[11px] uppercase tracking-wide text-stone-400">Produits suivis</p><p className="mt-1 text-lg font-black text-stone-800">{stock.length}</p></div>
              <div className="rounded-xl border border-stone-100 bg-white p-3"><p className="text-[11px] uppercase tracking-wide text-stone-400">Valeur dépôt HT</p><p className="mt-1 text-lg font-black text-stone-800">{formatEuro(stockValue)}</p></div>
              <div className="rounded-xl border border-stone-100 bg-white p-3"><p className="text-[11px] uppercase tracking-wide text-stone-400">En alerte</p><p className={`mt-1 text-lg font-black ${stockAlerts.length ? 'text-rose-600' : 'text-stone-300'}`}>{stockAlerts.length}</p></div>
              <div className="rounded-xl border border-stone-100 bg-white p-3"><p className="text-[11px] uppercase tracking-wide text-stone-400">Hors dépôts nommés</p><p className={`mt-1 text-lg font-black ${stockIncoherences.length ? 'text-amber-600' : 'text-emerald-600'}`}>{stockIncoherences.length}</p></div>
            </div>
            {stockAlerts.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-stone-100">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-100 bg-stone-50 text-left text-[11px] uppercase tracking-wide text-stone-400">
                      <th className="px-3 py-2">Produit</th><th className="px-2 py-2 text-right">AUC</th><th className="px-2 py-2 text-right">EST</th>
                      <th className="px-2 py-2 text-right">Fûts</th><th className="px-2 py-2 text-right">Total dépôt</th><th className="px-2 py-2 text-right">Mini</th><th className="px-3 py-2">Alerte</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-50">
                    {stockAlerts.map((r) => (
                      <tr key={r.product_id} className="text-stone-800">
                        <td className="px-3 py-2 font-medium">{r.product_name}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-stone-500">{num(r.qty_auc)}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-stone-500">{num(r.qty_est)}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-stone-500">{num(r.qty_futs)}</td>
                        <td className="px-2 py-2 text-right font-semibold tabular-nums">{num(r.qty_total_depot)}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-stone-400">{num(r.min_stock) || '—'}</td>
                        <td className="px-3 py-2"><span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">{r.alert_status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      {/* 1. Audit fûts */}
      <section className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-stone-800"><Beer size={16} className="text-amber-600" /> Audit des fûts (registre → dépôt)</h2>
        {kegQ.isLoading ? <Spinner /> : (
          <>
            <div className={`mb-3 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${ecarts.length === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
              {ecarts.length === 0
                ? <><CheckCircle2 size={16} /> Cohérent — écart nul entre le registre et le dépôt ({totalPleins} pleins · {formatEuro(totalValeur)}).</>
                : <><AlertTriangle size={16} /> {ecarts.length} écart(s) détecté(s) entre pleins théoriques et affichés — à investiguer.</>}
            </div>
            <div className="overflow-x-auto rounded-xl border border-stone-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-100 bg-stone-50 text-left text-[11px] uppercase tracking-wide text-stone-400">
                    <th className="px-3 py-2">Fût</th>
                    <th className="px-2 py-2 text-right">Reçus</th>
                    <th className="px-2 py-2 text-right">Consommés</th>
                    <th className="px-2 py-2 text-right">Purges</th>
                    <th className="px-2 py-2 text-right">En espace</th>
                    <th className="px-2 py-2 text-right">Pleins théoriques</th>
                    <th className="px-2 py-2 text-right">Pleins affichés</th>
                    <th className="px-2 py-2 text-right">Écart</th>
                    <th className="px-3 py-2 text-right">Vides</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-50">
                  {kegRows.map((r) => (
                    <tr key={r.product_id} className={r.ecart !== 0 ? 'bg-rose-50/60' : 'text-stone-800'}>
                      <td className="px-3 py-2 font-medium">{r.product_name}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-stone-500">{num(r.recus)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-stone-500">{num(r.consommes)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-stone-500">{num(r.purges)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-stone-500">{num(r.en_espace) || '—'}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{num(r.pleins_theoriques)}</td>
                      <td className="px-2 py-2 text-right font-semibold tabular-nums">{num(r.pleins_affiche)}</td>
                      <td className={`px-2 py-2 text-right font-bold tabular-nums ${r.ecart === 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{r.ecart === 0 ? '0' : (r.ecart > 0 ? `+${r.ecart}` : r.ecart)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-stone-500">{num(r.vides_theoriques) || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* 2. Complétude clôture */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-stone-800"><ClipboardCheck size={16} className="text-amber-600" /> Complétude de clôture (stocks finaux manquants)</h2>
        {compQ.isLoading ? <Spinner /> : compByEvent.length === 0 ? (
          <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700"><CheckCircle2 size={16} /> Aucun final manquant — tous les chiffres de conso/marge sont fiables.</div>
        ) : (
          <>
            <p className="mb-3 text-xs text-stone-500">Ces événements ont des chiffres <b>provisoires</b> tant que les finals ne sont pas saisis. À <b>compléter</b> (Analyse conso → Finaliser par espace), pas à « recalculer ».</p>
            <div className="space-y-2">
              {compByEvent.map((g) => (
                <div key={g.event_id} className="rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link to={`/admin/events/${g.event_id}`} className="text-sm font-bold text-stone-800 hover:underline">{g.event_name} <span className="text-xs font-normal text-stone-400">· {g.status}</span></Link>
                    <span className="text-xs font-semibold text-amber-700">{g.miss} final(s) manquant(s) · {g.pending} u. en attente · {g.spaces.length} espace(s)</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-stone-500">{g.spaces.map((s) => s.space_name).join(', ')}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
