/**
 * AgentSwapModal — gestion no-show jour J côté responsable RH.
 * ⚠ Le token RH ne peut PAS faire de pointage zone (zone_pointage_agent résout
 * le token ZONE via match_access_sessions). On opère donc avec les RPC RH :
 * retrait du no-show (rh_delete_agent_by_token) + remplaçant optionnel
 * (rh_upsert_agent_by_token) dans le même espace / même rôle.
 * Le marquage « absent » avec historique reste l'action du responsable de zone
 * (son interface dispose déjà du pointage).
 */

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export interface SwapTarget {
  id: string;
  prenom: string;
  nom: string;
  role: string;
  space_id: string;
  space_name: string;
}

export function AgentSwapModal({
  absentAgent, token, onDone, onClose,
}: {
  absentAgent: SwapTarget;
  token: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'with_replacement' | 'absent_only'>('with_replacement');
  const [repl, setRepl] = useState({ prenom: '', nom: '', start: '', end: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setError(null);
    if (mode === 'with_replacement' && (!repl.prenom.trim() || !repl.nom.trim())) {
      return setError('Prénom et NOM du remplaçant obligatoires.');
    }
    setSaving(true);
    try {
      // 1) Retirer le no-show du planning.
      await supabase.rpc('rh_delete_agent_by_token', { p_token: token, p_agent_id: absentAgent.id });
      // 2) Ajouter le remplaçant (même espace / même rôle).
      if (mode === 'with_replacement') {
        const { data } = await supabase.rpc('rh_upsert_agent_by_token', {
          p_token: token,
          p_space_id: absentAgent.space_id,
          p_agent_id: null,
          p_nom: repl.nom.toUpperCase().trim(),
          p_prenom: repl.prenom.trim(),
          p_role: absentAgent.role,
          p_start: repl.start || '00:00',
          p_end: repl.end || null,
          p_rate: null,
        });
        if (!(data as { success?: boolean } | null)?.success) throw new Error("Échec de l'ajout du remplaçant.");
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-red-500">Agent absent</p>
        <p className="font-bold text-stone-900">{absentAgent.prenom} {absentAgent.nom}</p>
        <p className="text-xs text-stone-500">{absentAgent.role} · {absentAgent.space_name}</p>
      </div>

      <div className="flex gap-2">
        {([['with_replacement', '🔄 Avec remplacement'], ['absent_only', '❌ Retrait seul']] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setMode(k)}
            className={`flex-1 rounded-xl border py-2.5 text-sm font-semibold transition-colors ${mode === k ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-200 bg-white text-stone-600'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'with_replacement' && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-stone-700">Remplaçant</p>
          <div className="grid grid-cols-2 gap-2">
            <input value={repl.prenom} onChange={(e) => setRepl((p) => ({ ...p, prenom: e.target.value }))} placeholder="Prénom *" autoFocus className="rounded-xl border border-stone-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            <input value={repl.nom} onChange={(e) => setRepl((p) => ({ ...p, nom: e.target.value.toUpperCase() }))} placeholder="NOM *" className="rounded-xl border border-stone-200 px-3 py-2.5 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-stone-400">Arrivée</label>
              <input type="time" value={repl.start} onChange={(e) => setRepl((p) => ({ ...p, start: e.target.value }))} className="min-h-[44px] w-full rounded-xl border border-stone-200 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-400">Départ</label>
              <input type="time" value={repl.end} onChange={(e) => setRepl((p) => ({ ...p, end: e.target.value }))} className="min-h-[44px] w-full rounded-xl border border-stone-200 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
          </div>
          <p className="text-xs text-stone-400">Le remplaçant reprend le même rôle et le même espace.</p>
        </div>
      )}

      {error && <p className="text-xs font-semibold text-red-600">{error}</p>}

      <div className="flex gap-3">
        <button onClick={onClose} className="flex-1 rounded-xl border border-stone-200 py-3 text-sm text-stone-600">Annuler</button>
        <button onClick={() => void handleConfirm()} disabled={saving} className="flex-1 rounded-xl bg-stone-900 py-3 text-sm font-bold text-white disabled:opacity-40">
          {saving ? '⏳…' : mode === 'with_replacement' ? '✅ Confirmer le swap' : '❌ Confirmer le retrait'}
        </button>
      </div>
    </div>
  );
}
