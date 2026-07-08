/**
 * BuvetteSupervisorPage — tableau de bord superviseur buvettes (flux token).
 * Liste les buvettes membres (via get_zone_buvettes) avec avancement ; chaque
 * carte ouvre la saisie stock de la buvette. Route : …/buvettes
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useMatchSession } from '@/hooks/useMatchSession';
import { MatchZoneHeader } from '@/components/zone/MatchZoneHeader';

interface BuvetteRow {
  space_id: string;
  code: string;
  label: string;
  location: string;
  has_initial: boolean;
  has_final: boolean;
}

type St = 'todo' | 'started' | 'done';
const STATUS: Record<St, { border: string; badge: string; text: string }> = {
  todo: { border: 'border-slate-200', badge: '⬜ À faire', text: 'text-slate-400' },
  started: { border: 'border-amber-300 bg-amber-50', badge: '🔄 En cours', text: 'text-amber-700' },
  done: { border: 'border-green-300 bg-green-50', badge: '✅ Clôturée', text: 'text-green-700' },
};

export default function BuvetteSupervisorPage() {
  const { token, session, loading } = useMatchSession();
  const navigate = useNavigate();
  const [buvettes, setBuvettes] = useState<BuvetteRow[]>([]);
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    if (!token || !session?.success) return;
    void supabase.rpc('get_zone_buvettes', { p_token: token }).then(({ data, error }) => {
      const r = data as { success?: boolean; buvettes?: BuvetteRow[] } | null;
      if (error || !r?.success) return setReady(false);
      setBuvettes(r.buvettes ?? []);
      setReady(true);
    });
  }, [token, session]);

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">Chargement…</div>;
  if (!session?.success) return <div className="p-8 text-center text-slate-500">Session expirée.</div>;

  const statusOf = (b: BuvetteRow): St => (b.has_final ? 'done' : b.has_initial ? 'started' : 'todo');
  const done = buvettes.filter((b) => b.has_final).length;

  return (
    <div className="min-h-screen bg-slate-50 pb-10">
      <MatchZoneHeader session={session} />
      <div className="mx-auto max-w-lg space-y-3 p-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">Vos buvettes</p>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-green-400 transition-all" style={{ width: buvettes.length ? `${(done / buvettes.length) * 100}%` : '0%' }} />
            </div>
            <span className="shrink-0 text-xs text-slate-500">{done}/{buvettes.length} clôturées</span>
          </div>
        </div>

        {ready === false && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Fonctionnalité en cours d'activation — applique <code>supabase/buvette_supervisor.sql</code>.
          </div>
        )}
        {ready && buvettes.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            Aucune buvette rattachée à ce superviseur.
          </div>
        )}

        {buvettes.map((b) => {
          const cfg = STATUS[statusOf(b)];
          return (
            <button
              key={b.space_id}
              type="button"
              onClick={() => navigate(`/zone/match/${token}/buvette/${b.space_id}`)}
              className={`flex w-full items-center gap-4 rounded-2xl border-2 bg-white p-4 text-left transition-transform active:scale-95 ${cfg.border}`}
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-sm font-black text-white">
                {b.code.replace(/^Buvette\s*/i, '').slice(0, 4)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-base font-bold text-slate-900">{b.label}</p>
                <span className={`mt-0.5 inline-block text-xs font-semibold ${cfg.text}`}>{cfg.badge}</span>
              </div>
              <span className="text-lg text-slate-300">›</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
