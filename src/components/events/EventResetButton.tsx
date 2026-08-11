/**
 * EventResetButton — « ⟳ Reset » d'un match (ROLE_STADE). Réinitialise la
 * préparation/analytique d'un événement (RH, runner, F&B/consommations, recettes,
 * ou tout) via la RPC reset_event, SANS toucher au stock physique (livraisons,
 * inventaires, purges). Confirmation forte (saisir le nom du match) ; si le match
 * est clôturé, second palier avec p_force=true. RG-003/sécurité : reset_event est
 * is_stade()-gardée en base.
 */

import { useState } from 'react';
import { RotateCcw, X, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Alert, Button } from '@/components/ui';

interface ResetResult {
  success: boolean;
  needs_force?: boolean;
  error?: string;
  scope?: string;
  forced?: boolean;
  deleted?: { rh_agents?: number; runner_lignes?: number; stock_lignes?: number; recettes?: number };
}

const SCOPES = [
  { value: 'all', label: 'Tout le match', desc: 'RH, runner, F&B/consommations et recettes.' },
  { value: 'rh', label: 'RH uniquement', desc: 'Agents planifiés/pointés et pôles.' },
  { value: 'runner', label: 'Runner / dotations', desc: 'Fiches et dotations runner.' },
  { value: 'stock', label: 'F&B / consommations', desc: 'Lignes de consommation de l’événement.' },
  { value: 'revenue', label: 'Recettes', desc: 'CA encaissement saisi.' },
] as const;

export function EventResetButton({ eventId, eventName, onDone }: { eventId: string; eventName: string; onDone: () => void }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const by = user?.name ?? user?.email ?? 'Stade';
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<string>('all');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsForce, setNeedsForce] = useState(false);

  function close() {
    setOpen(false); setScope('all'); setConfirm(''); setError(null); setNeedsForce(false);
  }

  async function run(force: boolean) {
    setBusy(true); setError(null);
    const { data, error: err } = await supabase.rpc('reset_event', {
      p_event: eventId, p_scope: scope, p_by: by, p_force: force,
    });
    setBusy(false);
    const res = data as ResetResult | null;
    if (err) { setError(err.message); return; }
    if (res && !res.success && res.needs_force) { setNeedsForce(true); setError(res.error ?? 'Match clôturé.'); return; }
    if (!res?.success) { setError(res?.error ?? 'Échec de la réinitialisation.'); return; }
    const d = res.deleted ?? {};
    showToast(
      `Reset ${res.scope} — RH ${d.rh_agents ?? 0} · Runner ${d.runner_lignes ?? 0} · F&B ${d.stock_lignes ?? 0} · Recettes ${d.recettes ?? 0}`,
      'success',
    );
    close();
    onDone();
  }

  const confirmOk = confirm.trim() === eventName.trim() || confirm.trim().toUpperCase() === 'RESET';

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Réinitialiser la préparation du match"
        className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50"
      >
        <RotateCcw className="h-4 w-4" /> Reset
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-start justify-between">
              <h2 className="flex items-center gap-2 text-lg font-black text-stone-900">
                <RotateCcw className="h-5 w-5 text-rose-600" /> Réinitialiser le match
              </h2>
              <button onClick={close} className="text-stone-400 hover:text-stone-700"><X className="h-5 w-5" /></button>
            </div>

            {error && <Alert variant={needsForce ? 'warning' : 'error'} className="mb-3">{error}</Alert>}

            <p className="mb-2 text-sm font-semibold text-stone-700">Que veux-tu réinitialiser ?</p>
            <div className="space-y-1.5">
              {SCOPES.map((s) => (
                <label key={s.value} className={`flex cursor-pointer items-start gap-2 rounded-xl border p-2.5 ${scope === s.value ? 'border-rose-300 bg-rose-50/50' : 'border-stone-200'}`}>
                  <input type="radio" name="scope" checked={scope === s.value} onChange={() => setScope(s.value)} className="mt-0.5" />
                  <span>
                    <span className="text-sm font-medium text-stone-800">{s.label}</span>
                    <span className="block text-xs text-stone-400">{s.desc}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="mt-3 rounded-xl bg-stone-50 p-3 text-xs text-stone-500">
              <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-amber-500" />
              Préservé : le <b>stock physique</b> de la réserve (livraisons, inventaires, purges déjà passées). Seule la préparation & l'analytique du match est remise à zéro.
            </div>

            <div className="mt-3">
              <label className="mb-1 block text-xs font-semibold text-stone-500">
                Pour confirmer, saisis le nom du match (« {eventName} ») ou « RESET »
              </label>
              <input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={eventName}
                className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
              />
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={close}>Annuler</Button>
              {needsForce ? (
                <button
                  disabled={busy || !confirmOk}
                  onClick={() => void run(true)}
                  className="inline-flex items-center gap-2 rounded-xl bg-rose-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-rose-800 disabled:opacity-40"
                >
                  <AlertTriangle className="h-4 w-4" /> Match clôturé — forcer la remise à zéro
                </button>
              ) : (
                <button
                  disabled={busy || !confirmOk}
                  onClick={() => void run(false)}
                  className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-40"
                >
                  <RotateCcw className="h-4 w-4" /> Réinitialiser
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
