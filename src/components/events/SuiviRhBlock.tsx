/**
 * SuiviRhBlock — bloc « Suivi RH » du bilan match : charges personnel par espace
 * (restauration) et par pôle (hors resto), + détail agents repliable, + coût
 * total événement (F&B + RH). Source : get_event_rh (RG-003 : ROLE_STADE).
 */

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface RhLine {
  label: string;
  agents: number;
  heures: number;
  cout: number;
}
interface Agent {
  nom: string;
  prenom: string;
  role: string;
  rattachement: string;
  heures: number;
  taux: number;
  cout: number;
}
interface RhData {
  kpis: {
    nb_agents: number;
    total_heures: number | null;
    cout_rh_ht: number | null;
    cout_resto: number;
    cout_hors_resto: number;
    cout_par_pax: number | null;
  };
  par_espace: RhLine[];
  par_pole: RhLine[];
  agents: Agent[];
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const eur = (v: number): string =>
  v.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €';

function LineTable({ title, rows }: { title: string; rows: RhLine[] }) {
  const max = Math.max(1, ...rows.map((r) => r.cout));
  return (
    <div className="overflow-hidden rounded-2xl border border-stone-100">
      <div className="border-b border-stone-100 bg-stone-50 px-4 py-2 text-sm font-bold text-stone-700">{title}</div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-100 text-left text-xs uppercase tracking-wide text-stone-400">
            <th className="px-4 py-2">Espace / Pôle</th>
            <th className="px-3 py-2 text-right">Agents</th>
            <th className="px-3 py-2 text-right">Heures</th>
            <th className="px-4 py-2 text-right">Coût HT</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-50">
          {rows.map((r) => (
            <tr key={r.label} className="text-stone-800">
              <td className="px-4 py-2 font-medium">
                {r.label}
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-100">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(r.cout / max) * 100}%` }} />
                </div>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{r.agents}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.heures.toFixed(1)}</td>
              <td className="px-4 py-2 text-right font-semibold tabular-nums">{eur(r.cout)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SuiviRhBlock({ eventId, fbCost }: { eventId: string; fbCost: number }) {
  const [rh, setRh] = useState<RhData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAgents, setShowAgents] = useState(false);

  useEffect(() => {
    let alive = true;
    void supabase.rpc('get_event_rh', { p_event_id: eventId }).then(({ data }) => {
      if (!alive) return;
      const d = data as Partial<RhData> | null;
      setRh({
        kpis: {
          nb_agents: num(d?.kpis?.nb_agents),
          total_heures: d?.kpis?.total_heures == null ? null : num(d.kpis.total_heures),
          cout_rh_ht: d?.kpis?.cout_rh_ht == null ? null : num(d.kpis.cout_rh_ht),
          cout_resto: num(d?.kpis?.cout_resto),
          cout_hors_resto: num(d?.kpis?.cout_hors_resto),
          cout_par_pax: d?.kpis?.cout_par_pax == null ? null : num(d.kpis.cout_par_pax),
        },
        par_espace: (d?.par_espace ?? []).map((x) => ({
          label: String((x as unknown as { espace?: string }).espace ?? ''),
          agents: num(x.agents),
          heures: num(x.heures),
          cout: num(x.cout),
        })),
        par_pole: (d?.par_pole ?? []).map((x) => ({
          label: String((x as unknown as { pole?: string }).pole ?? ''),
          agents: num(x.agents),
          heures: num(x.heures),
          cout: num(x.cout),
        })),
        agents: (d?.agents ?? []) as Agent[],
      });
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [eventId]);

  if (loading) return <div className="h-24 animate-pulse rounded-2xl bg-stone-100" />;
  if (!rh) return null;

  const rhCost = rh.kpis.cout_rh_ht ?? 0;
  const totalEvent = fbCost + rhCost;

  return (
    <div className="space-y-4 rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-stone-800">⏱ Suivi RH — charges personnel</p>
          <p className="mt-0.5 text-xs text-stone-400">
            {rh.kpis.nb_agents} agents · {(rh.kpis.total_heures ?? 0).toFixed(0)} h · {eur(rhCost)} HT
            {rhCost > 0 && (
              <> (dont resto {eur(rh.kpis.cout_resto)} / hors resto {eur(rh.kpis.cout_hors_resto)})</>
            )}
          </p>
        </div>
        <div className="rounded-xl bg-stone-900 px-4 py-2 text-right text-white">
          <p className="text-[10px] uppercase tracking-wide text-white/60">Coût total événement</p>
          <p className="text-lg font-black">{eur(totalEvent)} <span className="text-xs font-normal text-white/60">F&amp;B + RH</span></p>
        </div>
      </div>

      {rh.kpis.nb_agents === 0 ? (
        <p className="rounded-xl bg-stone-50 px-4 py-6 text-center text-sm text-stone-400">
          Aucune donnée RH pour cet événement — importez l'émargement pour alimenter le coût personnel.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {rh.par_espace.length > 0 && <LineTable title="Par espace (restauration)" rows={rh.par_espace} />}
            {rh.par_pole.length > 0 && <LineTable title="Par pôle (hors restauration)" rows={rh.par_pole} />}
          </div>

          <div>
            <button
              onClick={() => setShowAgents((v) => !v)}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-600 hover:text-stone-900"
            >
              <Users size={14} /> Détail agents ({rh.agents.length})
              {showAgents ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {showAgents && (
              <div className="mt-2 overflow-x-auto rounded-2xl border border-stone-100">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-100 text-left text-xs uppercase tracking-wide text-stone-400">
                      <th className="px-4 py-2">Agent</th>
                      <th className="px-3 py-2">Rôle</th>
                      <th className="px-3 py-2">Rattachement</th>
                      <th className="px-3 py-2 text-right">Heures</th>
                      <th className="px-3 py-2 text-right">Taux</th>
                      <th className="px-4 py-2 text-right">Coût HT</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-50">
                    {rh.agents.map((a, i) => (
                      <tr key={`${a.nom}-${a.prenom}-${i}`} className="text-stone-800">
                        <td className="px-4 py-2 font-medium">{`${a.prenom} ${a.nom}`.trim()}</td>
                        <td className="px-3 py-2 text-stone-500">{a.role}</td>
                        <td className="px-3 py-2 text-stone-500">{a.rattachement}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{num(a.heures).toFixed(1)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{num(a.taux).toFixed(2)} €</td>
                        <td className="px-4 py-2 text-right font-semibold tabular-nums">{eur(num(a.cout))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
