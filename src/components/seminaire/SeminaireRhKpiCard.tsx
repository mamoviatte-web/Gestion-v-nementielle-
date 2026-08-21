/**
 * SeminaireRhKpiCard — KPI RH opérationnels d'un séminaire (par événement).
 *
 * Recalcule en direct, à partir des heures saisies (zone_staff_hours par espace
 * + occasional_hours manutention/runner), les mêmes indicateurs que les KPI RH
 * professionnels des matchs : nb d'agents, total d'heures, coût HT, détail par
 * espace + ligne « hors espace ». Ces mêmes chiffres alimentent la vue
 * rh_unified / rh_event_kpis (onglet Staff & RH → Séminaires) dès que
 * l'événement passe « en cours ».
 *
 * RG-003 : réservé ROLE_STADE (lecture des coûts via RLS is_stade()).
 */

import { useCallback, useEffect, useState } from 'react';
import { Users, Clock, Euro, MapPin, Truck } from 'lucide-react';
import { supabase } from '@/lib/supabase';

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const eur = (v: number): string => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

interface Line { label: string; agents: number; hours: number; cost: number; hors?: boolean }

export function SeminaireRhKpiCard({ eventId, reloadKey }: { eventId: string; reloadKey: number }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [tot, setTot] = useState({ agents: 0, hours: 0, cost: 0 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [zone, occ] = await Promise.all([
      supabase.from('zone_staff_hours').select('staff_name, hours_worked, rh_cost, space_id, spaces(space_name)').eq('event_id', eventId),
      supabase.from('occasional_hours').select('staff_name, hours_worked, total_cost').eq('event_id', eventId),
    ]);
    type ZRow = { staff_name: string | null; hours_worked: number | null; rh_cost: number | null; space_id: string | null; spaces: { space_name: string | null } | null };
    type ORow = { staff_name: string | null; hours_worked: number | null; total_cost: number | null };
    const zrows = (zone.data as ZRow[] | null) ?? [];
    const orows = (occ.data as ORow[] | null) ?? [];

    const bySpace = new Map<string, Line>();
    const names = new Set<string>();
    for (const r of zrows) {
      const key = r.spaces?.space_name ?? '—';
      const l = bySpace.get(key) ?? { label: key, agents: 0, hours: 0, cost: 0 };
      l.hours += num(r.hours_worked); l.cost += num(r.rh_cost); l.agents += 1;
      bySpace.set(key, l);
      if (r.staff_name) names.add(r.staff_name.toLowerCase());
    }
    const result = [...bySpace.values()].sort((a, b) => a.label.localeCompare(b.label));

    if (orows.length) {
      const hors: Line = { label: 'Manutention / runner (hors espace)', agents: orows.length, hours: 0, cost: 0, hors: true };
      for (const r of orows) { hors.hours += num(r.hours_worked); hors.cost += num(r.total_cost); if (r.staff_name) names.add(r.staff_name.toLowerCase()); }
      result.push(hors);
    }

    setLines(result);
    setTot({
      agents: names.size,
      hours: result.reduce((a, l) => a + l.hours, 0),
      cost: result.reduce((a, l) => a + l.cost, 0),
    });
    setLoading(false);
  }, [eventId]);

  useEffect(() => { void load(); }, [load, reloadKey]);

  return (
    <section className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
      <p className="mb-3 text-sm font-bold text-stone-800">KPI RH — synthèse de l'événement</p>
      {loading ? (
        <div className="h-20 animate-pulse rounded-xl bg-stone-100" />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-stone-100 bg-stone-50 px-4 py-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-400"><Users size={13} /> Agents</p>
              <p className="mt-1 text-2xl font-black tabular-nums text-stone-900">{tot.agents}</p>
            </div>
            <div className="rounded-xl border border-stone-100 bg-stone-50 px-4 py-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-400"><Clock size={13} /> Heures</p>
              <p className="mt-1 text-2xl font-black tabular-nums text-stone-900">{tot.hours.toFixed(2)}</p>
            </div>
            <div className="rounded-xl border border-stone-100 bg-stone-50 px-4 py-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-400"><Euro size={13} /> Coût HT</p>
              <p className="mt-1 text-2xl font-black tabular-nums text-stone-900">{eur(tot.cost)}</p>
            </div>
          </div>

          {lines.length === 0 ? (
            <p className="rounded-xl bg-stone-50 px-4 py-3 text-center text-sm text-stone-400">Aucune heure saisie pour l'instant.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-stone-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-100 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-400">
                    <th className="px-3 py-2">Espace</th><th className="px-3 py-2 text-right">Agents</th>
                    <th className="px-3 py-2 text-right">Heures</th><th className="px-3 py-2 text-right">Coût HT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-50">
                  {lines.map((l) => (
                    <tr key={l.label} className="text-stone-800">
                      <td className="px-3 py-2 font-medium">
                        <span className="inline-flex items-center gap-1.5">{l.hors ? <Truck size={13} className="text-amber-500" /> : <MapPin size={13} className="text-stone-300" />}{l.label}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-stone-500">{l.agents}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.hours.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{eur(l.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
