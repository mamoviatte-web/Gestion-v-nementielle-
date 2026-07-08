/**
 * MatchZoneSchedule — horaires agents responsable de zone (flux token).
 * Saisie du départ réel + double confirmation (agent / responsable).
 * Enregistre via save_zone_schedule (SECURITY DEFINER).
 * Route : /zone/match/:sessionToken/schedules
 */

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useMatchSession } from '@/hooks/useMatchSession';
import { MatchZoneHeader } from '@/components/zone/MatchZoneHeader';

interface Sched {
  schedule_id: string;
  staff_name: string;
  role: string | null;
  planned_arrival: string | null;
  planned_departure: string | null;
  actual_departure: string | null;
  confirmed_by_staff: boolean;
  confirmed_by_manager: boolean;
}

function hm(t: string | null): string {
  return t ? t.slice(0, 5) : '—';
}

export default function MatchZoneSchedule() {
  const { token, session, loading } = useMatchSession();
  const [rows, setRows] = useState<Sched[]>([]);
  const [ready, setReady] = useState<boolean | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token || !session?.success) return;
    void supabase.rpc('get_zone_schedule', { p_token: token }).then(({ data, error: err }) => {
      const r = data as { success?: boolean; schedules?: Sched[] } | null;
      if (err || !r?.success) return setReady(false);
      setRows(r.schedules ?? []);
      setReady(true);
    });
  }, [token, session]);

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">Chargement…</div>;
  if (!session?.success) return <div className="p-8 text-center text-slate-500">Session expirée.</div>;

  const patch = (id: string, upd: Partial<Sched>) =>
    setRows((prev) => prev.map((s) => (s.schedule_id === id ? { ...s, ...upd } : s)));

  async function save(s: Sched) {
    setError('');
    setSavingId(s.schedule_id);
    const { data, error: err } = await supabase.rpc('save_zone_schedule', {
      p_token: token,
      p_schedule_id: s.schedule_id,
      p_actual_departure: s.actual_departure || null,
      p_staff: s.confirmed_by_staff,
      p_manager: s.confirmed_by_manager,
    });
    setSavingId(null);
    const r = data as { success?: boolean; error?: string } | null;
    if (err || !r?.success) setError(r?.error ?? 'Enregistrement indisponible (applique zone_rpcs.sql).');
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-12">
      <MatchZoneHeader session={session} back />
      <div className="mx-auto max-w-lg space-y-3 p-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-bold text-slate-800">⏱ Horaires de l'équipe</h2>
          <p className="mt-1 text-sm text-slate-500">
            Notez l'heure de départ réelle de chaque agent puis confirmez.
          </p>
        </div>

        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}

        {ready === false && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Fonctionnalité en cours d'activation — applique <code>supabase/zone_rpcs.sql</code>.
          </div>
        )}
        {ready && rows.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            Aucun agent planifié sur cet espace.
          </div>
        )}

        {rows.map((s) => (
          <div key={s.schedule_id} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-slate-800">{s.staff_name}</p>
                <p className="text-xs text-slate-400">{s.role ?? 'Agent'}</p>
              </div>
              <p className="text-sm text-slate-500">
                {hm(s.planned_arrival)} → {hm(s.planned_departure)} <span className="text-xs">(prévu)</span>
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Départ réel</label>
              <input
                type="time"
                value={s.actual_departure ? s.actual_departure.slice(0, 5) : ''}
                onChange={(e) => patch(s.schedule_id, { actual_departure: e.target.value })}
                className="min-h-[48px] w-full rounded-lg border border-slate-200 px-3 py-2.5 text-base focus:ring-2 focus:ring-amber-400"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              {(['confirmed_by_staff', 'confirmed_by_manager'] as const).map((k) => {
                const on = s[k];
                const label = k === 'confirmed_by_staff' ? 'Confirmé agent' : 'Confirmé responsable';
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => patch(s.schedule_id, { [k]: !on } as Partial<Sched>)}
                    className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg text-sm font-medium ${
                      on ? 'bg-green-500 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {on && <Check className="h-4 w-4" />}
                    {label}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => void save(s)}
              disabled={savingId === s.schedule_id}
              className="min-h-[48px] w-full rounded-lg bg-slate-900 py-3 text-sm font-bold text-white disabled:opacity-40"
            >
              {savingId === s.schedule_id ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
