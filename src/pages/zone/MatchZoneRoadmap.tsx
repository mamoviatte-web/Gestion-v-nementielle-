/**
 * MatchZoneRoadmap — feuille de route (lecture seule) : dotations + équipe.
 * Route : /zone/match/:sessionToken/roadmap
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useMatchSession } from '@/hooks/useMatchSession';
import { MatchZoneHeader } from '@/components/zone/MatchZoneHeader';

interface Dotation {
  product_name: string;
  category: string;
  unit: string;
  planned_qty: number;
  runner_status: string;
}
interface Sched {
  staff_name: string;
  role: string | null;
  planned_arrival: string | null;
  planned_departure: string | null;
}

export default function MatchZoneRoadmap() {
  const { token, session, loading } = useMatchSession();
  const [dotations, setDotations] = useState<Dotation[]>([]);
  const [schedules, setSchedules] = useState<Sched[]>([]);
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    if (!token || !session?.success) return;
    void supabase.rpc('get_zone_roadmap', { p_token: token }).then(({ data, error }) => {
      const r = data as { success?: boolean; dotations?: Dotation[]; schedules?: Sched[] } | null;
      if (error || !r?.success) return setReady(false);
      setDotations(r.dotations ?? []);
      setSchedules(r.schedules ?? []);
      setReady(true);
    });
  }, [token, session]);

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">Chargement…</div>;
  if (!session?.success) return <div className="p-8 text-center text-slate-500">Session expirée.</div>;

  const byCat = dotations.reduce<Record<string, Dotation[]>>((acc, d) => {
    (acc[d.category] ??= []).push(d);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-slate-50">
      <MatchZoneHeader session={session} back />
      <div className="mx-auto max-w-lg space-y-5 p-4">
        {ready === false && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Fonctionnalité en cours d'activation — applique <code>supabase/zone_rpcs.sql</code>.
          </div>
        )}

        <section>
          <h2 className="mb-3 font-bold text-slate-800">📦 Dotations prévues ({dotations.length})</h2>
          {dotations.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
              Aucune dotation configurée pour cet espace.
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(byCat).map(([cat, lines]) => (
                <div key={cat} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                    {cat}
                  </div>
                  {lines.map((l, i) => (
                    <div key={i} className="flex items-center justify-between border-b border-slate-50 px-4 py-3 last:border-0">
                      <div>
                        <p className="text-sm font-medium text-slate-800">{l.product_name}</p>
                        <p className="text-xs text-slate-400">{l.unit}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-slate-900">{l.planned_qty}</p>
                        <p className="text-xs text-slate-400">{l.runner_status?.replace(/_/g, ' ')}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 font-bold text-slate-800">⏱ Équipe prévue</h2>
          {schedules.length === 0 ? (
            <div className="rounded-xl bg-slate-100 p-4 text-sm text-slate-500">Aucun horaire configuré.</div>
          ) : (
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {schedules.map((s, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600">
                    {s.staff_name.charAt(0).toUpperCase()}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-800">{s.staff_name}</p>
                    <p className="text-xs text-slate-400">{s.role}</p>
                  </div>
                  <p className="text-sm font-medium text-slate-700">
                    {s.planned_arrival?.slice(0, 5)} → {s.planned_departure?.slice(0, 5)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        <p className="pb-6 text-center text-xs text-slate-400">Configuré par l'équipe stade · Lecture seule</p>
      </div>
    </div>
  );
}
