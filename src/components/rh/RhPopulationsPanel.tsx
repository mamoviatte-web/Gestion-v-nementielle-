/**
 * RhPopulationsPanel — registre inter-matchs (BLOC 5). Liste, par pôle, tous les
 * agents ayant travaillé sur l'ensemble des matchs (récurrence + heures cumulées).
 * Source : vue rh_population_by_pole (RG-003 : réservée ROLE_STADE).
 */

import { useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Spinner } from '@/components/ui';

interface PopRow {
  pole: string;
  agent_nom: string;
  agent_prenom: string;
  nb_matchs: number;
  total_heures: number;
  cout_cumule: number;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const eur = (v: number): string =>
  v.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';

export function RhPopulationsPanel() {
  const [rows, setRows] = useState<PopRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void supabase
      .from('rh_population_by_pole')
      .select('*')
      .order('total_heures', { ascending: false })
      .then(({ data }) => {
        if (!alive) return;
        setRows((data as PopRow[] | null) ?? []);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const byPole = useMemo(() => {
    const m = new Map<string, PopRow[]>();
    for (const r of rows) {
      if (!m.has(r.pole)) m.set(r.pole, []);
      m.get(r.pole)!.push(r);
    }
    return [...m.entries()];
  }, [rows]);

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Users size={18} className="text-stone-500" />
        <h2 className="text-lg font-bold text-stone-800">Populations RH — registre inter-matchs</h2>
      </div>
      {byPole.length === 0 ? (
        <p className="text-sm text-stone-400">Aucune donnée RH cumulée pour l'instant.</p>
      ) : (
        byPole.map(([pole, agents]) => (
          <section key={pole} className="overflow-hidden rounded-2xl border border-stone-100">
            <div className="border-b border-stone-100 bg-stone-50 px-4 py-2 text-sm font-bold text-stone-700">
              {pole} <span className="ml-1 text-xs font-normal text-stone-400">({agents.length})</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-100 text-left text-xs uppercase tracking-wide text-stone-400">
                  <th className="px-4 py-2">Agent</th>
                  <th className="px-3 py-2 text-right">Matchs</th>
                  <th className="px-3 py-2 text-right">Heures cumulées</th>
                  <th className="px-4 py-2 text-right">Coût cumulé HT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50">
                {agents.map((a, i) => (
                  <tr key={`${a.agent_nom}-${a.agent_prenom}-${i}`} className="text-stone-800">
                    <td className="px-4 py-2 font-medium">{`${a.agent_prenom} ${a.agent_nom}`.trim()}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(a.nb_matchs)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(a.total_heures).toFixed(1)} h</td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums">{eur(num(a.cout_cumule))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
    </div>
  );
}
