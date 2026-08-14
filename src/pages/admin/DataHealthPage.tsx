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
import { Activity, AlertTriangle, Beer, CheckCircle2, ClipboardCheck, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Spinner } from '@/components/ui';
import { formatEuro } from '@/lib/calculations';

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

interface TrueBalance { product_id: string; product_name: string; recus: number; consommes: number; purges: number; pleins_theoriques: number; vides_theoriques: number; valeur_pleins_ht: number | null }
interface KegSummary { product_id: string; product_name: string; pleins: number; en_espace: number; vides: number }
interface CompletenessRow { event_id: string; event_name: string; status: string; space_id: string; space_name: string; finals_manquants: number; unites_en_attente: number }

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
