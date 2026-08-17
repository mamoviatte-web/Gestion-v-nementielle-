/**
 * BuvetteSupervisorPage — superviseur buvettes (flux token) en 2 vues :
 *   1. Sélection LIBRE des buvettes B1→B9 gérées ce soir (grille multi-select).
 *   2. Tableau de bord des buvettes choisies (avancement + accès stock + RH).
 * Route : /zone/match/:sessionToken/buvettes
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useMatchSession } from '@/hooks/useMatchSession';
import { MatchZoneHeader } from '@/components/zone/MatchZoneHeader';

interface BuvetteInfo {
  space_id: string;
  code: string;
  label: string;
  selected: boolean;
  has_initial: boolean;
  has_final: boolean;
  has_debrief: boolean;
}
interface ZoneBuvettesResp {
  success?: boolean;
  supervisor?: string;
  all_buvettes?: BuvetteInfo[];
  selected_buvettes?: string[];
  selection_done?: boolean;
}

type View = 'selection' | 'dashboard';

type St = 'todo' | 'started' | 'done';
const STATUS: Record<St, { border: string; badge: string; text: string }> = {
  todo: { border: 'border-slate-200', badge: '⬜ À faire', text: 'text-slate-400' },
  started: { border: 'border-amber-300 bg-amber-50', badge: '🔄 En cours', text: 'text-amber-700' },
  done: { border: 'border-green-300 bg-green-50', badge: '✅ Clôturée', text: 'text-green-700' },
};

export default function BuvetteSupervisorPage() {
  const { token, session, loading } = useMatchSession();
  const navigate = useNavigate();
  const [view, setView] = useState<View>('selection');
  const [all, setAll] = useState<BuvetteInfo[]>([]);
  const [supervisor, setSupervisor] = useState<string>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchBuvettes = useCallback(async () => {
    if (!token) return;
    const { data, error } = await supabase.rpc('get_zone_buvettes', { p_token: token });
    const r = data as ZoneBuvettesResp | null;
    if (error || !r?.success) return setReady(false);
    setSupervisor(r.supervisor ?? '');
    setAll(r.all_buvettes ?? []);
    setSelected(new Set(r.selected_buvettes ?? []));
    if (r.selection_done && (r.selected_buvettes?.length ?? 0) > 0) setView('dashboard');
    setReady(true);
  }, [token]);

  useEffect(() => {
    if (session?.success) void fetchBuvettes();
  }, [session, fetchBuvettes]);

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">Chargement…</div>;
  if (!session?.success) return <div className="p-8 text-center text-slate-500">Session expirée.</div>;

  function toggle(code: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function confirm() {
    if (selected.size === 0) return;
    setSaving(true);
    const { data } = await supabase.rpc('save_buvette_selection', { p_token: token, p_buvette_codes: Array.from(selected) });
    setSaving(false);
    if ((data as { success?: boolean } | null)?.success) {
      await fetchBuvettes();
      setView('dashboard');
    }
  }

  const mine = all.filter((b) => selected.has(b.code));
  // « Terminée » = stock clôturé ET débrief soumis (process complet).
  const isComplete = (b: BuvetteInfo) => b.has_final && b.has_debrief;
  const done = mine.filter(isComplete).length;
  const started = mine.filter((b) => (b.has_initial || b.has_final || b.has_debrief) && !isComplete(b)).length;
  const statusOf = (b: BuvetteInfo): St => (isComplete(b) ? 'done' : b.has_initial || b.has_final || b.has_debrief ? 'started' : 'todo');

  return (
    <div className="min-h-screen bg-slate-50 pb-10">
      <MatchZoneHeader session={session} back />

      {ready === false && (
        <div className="mx-auto max-w-lg p-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Fonctionnalité en cours d'activation — applique <code>supabase/buvette_free_selection.sql</code>.
          </div>
        </div>
      )}

      {/* VUE 1 — Sélection libre */}
      {view === 'selection' && (
        <div className="mx-auto max-w-sm space-y-4 p-4">
          <div className="pt-2 text-center">
            {supervisor && <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">{supervisor}</p>}
            <p className="text-lg font-bold text-slate-900">Quelles buvettes gérez-vous ce soir ?</p>
            <p className="mt-1 text-sm text-slate-400">Sélectionnez une ou plusieurs buvettes</p>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            {all.map((b) => {
              const on = selected.has(b.code);
              return (
                <button
                  key={b.code}
                  onClick={() => toggle(b.code)}
                  className={`flex aspect-square flex-col items-center justify-center gap-1 rounded-2xl border-2 px-1.5 text-center transition-all active:scale-95 ${on ? 'scale-105 border-slate-900 bg-slate-900 text-white shadow-lg' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'}`}
                >
                  <span className={`text-sm font-black leading-tight ${on ? 'text-white' : 'text-slate-900'}`}>{b.label}</span>
                  {on && <span className="text-xs text-green-400">✓</span>}
                </button>
              );
            })}
          </div>

          {selected.size > 0 && (
            <div className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200">
              <span className="text-xl">🍺</span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-slate-800">
                  {selected.size} buvette{selected.size > 1 ? 's' : ''} sélectionnée{selected.size > 1 ? 's' : ''}
                </p>
                <p className="text-xs text-slate-400">{all.filter((b) => selected.has(b.code)).map((b) => b.label).join(' · ')}</p>
              </div>
            </div>
          )}

          <button
            onClick={() => void confirm()}
            disabled={selected.size === 0 || saving}
            className="min-h-[56px] w-full rounded-2xl bg-slate-900 py-4 text-base font-bold text-white disabled:opacity-40"
          >
            {saving ? 'Confirmation…' : selected.size === 0 ? 'Sélectionnez des buvettes' : `Confirmer — ${Array.from(selected).sort().join(', ')} →`}
          </button>
        </div>
      )}

      {/* VUE 2 — Tableau de bord */}
      {view === 'dashboard' && (
        <div className="mx-auto max-w-sm space-y-3 p-4">
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-semibold text-slate-700">VOS BUVETTES</span>
              <button onClick={() => setView('selection')} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-50">
                Modifier
              </button>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: mine.length ? `${(done / mine.length) * 100}%` : '0%' }} />
            </div>
            <div className="mt-2 flex gap-3 text-xs">
              <span className="text-slate-400">{done}/{mine.length} terminées (stock + débrief)</span>
              {started > 0 && <span className="text-amber-600">🔄 {started} en cours</span>}
            </div>
          </div>

          {mine.map((b) => {
            const cfg = STATUS[statusOf(b)];
            return (
              <button
                key={b.code}
                onClick={() => navigate(`/zone/match/${token}/buvette/${b.space_id}`, { state: { code: b.label } })}
                className={`flex w-full items-center gap-4 rounded-2xl border-2 bg-white p-4 text-left transition-transform active:scale-95 ${cfg.border}`}
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-xl text-white">🍺</span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-slate-900">{b.label}</p>
                  <span className={`text-xs font-semibold ${cfg.text}`}>{cfg.badge}</span>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${b.has_final ? 'bg-green-100 text-green-700' : b.has_initial ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-400'}`}>
                      {b.has_final ? '📦 Stock clôturé' : b.has_initial ? '📦 Stock en cours' : '📦 Stock à faire'}
                    </span>
                    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${b.has_debrief ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
                      {b.has_debrief ? '📝 Débrief ✓' : '📝 Débrief à faire'}
                    </span>
                  </div>
                </div>
                <span className="text-lg text-slate-300">›</span>
              </button>
            );
          })}

          <button
            onClick={() => navigate(`/zone/match/${token}/rh`)}
            className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-left"
          >
            <span className="text-xl">⏱</span>
            <div>
              <p className="text-sm font-semibold text-slate-800">Horaires de l'équipe</p>
              <p className="text-xs text-slate-400">Recenser et valider les heures</p>
            </div>
            <span className="ml-auto text-slate-300">›</span>
          </button>
        </div>
      )}
    </div>
  );
}
