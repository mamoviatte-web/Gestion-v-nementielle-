/**
 * RhBillingGrid — grille RH « vue quantité » : tous les agents (resto + hors
 * resto) avec leur facturation (mode horaire/forfait, prix, coût). Sélection
 * multiple (par pôle / espace / rôle) pour généraliser un tarif en une action
 * via rh_bulk_billing. Lecture seule si l'événement RH est clôturé.
 * RG-003 : rh_bulk_billing est is_stade()-gardée côté base.
 */

import { useMemo, useState } from 'react';
import { CheckSquare, Square, Wand2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import { Button, Select } from '@/components/ui';
import { BillingChip } from '@/components/rh/BillingChip';

interface BillingAgent {
  id: string; nom: string; prenom: string; role: string; status: string;
  billing_mode?: string; taux: number; forfait?: number | null; cout?: number;
  pole?: string; space_name?: string;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const eur = (v: number): string => v.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
const ratt = (a: BillingAgent): string => a.space_name ?? a.pole ?? '—';

export function RhBillingGrid({
  eventId, agents, closed, by, onChanged,
}: {
  eventId: string;
  agents: BillingAgent[];
  closed: boolean;
  by: string;
  onChanged: () => void | Promise<void>;
}) {
  const { showToast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fRatt, setFRatt] = useState('');
  const [fRole, setFRole] = useState('');
  const [mode, setMode] = useState('forfait');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);

  const active = useMemo(
    () => agents.filter((a) => a.status !== 'retiré' && a.status !== 'absent'),
    [agents],
  );
  const rattOptions = useMemo(
    () => Array.from(new Set(active.map(ratt))).sort(),
    [active],
  );
  const roleOptions = useMemo(
    () => Array.from(new Set(active.map((a) => a.role))).sort(),
    [active],
  );
  const filtered = useMemo(
    () => active.filter((a) => (!fRatt || ratt(a) === fRatt) && (!fRole || a.role === fRole)),
    [active, fRatt, fRole],
  );

  const allShownSelected = filtered.length > 0 && filtered.every((a) => selected.has(a.id));
  const toggleAll = () =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (allShownSelected) filtered.forEach((a) => n.delete(a.id));
      else filtered.forEach((a) => n.add(a.id));
      return n;
    });
  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  async function apply() {
    const ids = [...selected];
    if (ids.length === 0) {
      showToast('Sélectionnez au moins un agent.', 'warning');
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc('rh_bulk_billing', {
      p_event: eventId,
      p_ids: ids,
      p_mode: mode,
      p_rate: mode === 'horaire' && price ? num(price) : null,
      p_forfait: mode === 'forfait' && price ? num(price) : null,
      p_by: by,
    });
    setBusy(false);
    const res = data as { success?: boolean; error?: string; updated?: number } | null;
    if (error || !res?.success) {
      showToast(`Échec : ${res?.error ?? error?.message ?? 'erreur'}`, 'warning');
      return;
    }
    showToast(`${res.updated ?? ids.length} agent(s) mis à jour.`, 'success');
    setSelected(new Set());
    setPrice('');
    await onChanged();
  }

  return (
    <div className="space-y-3 rounded-2xl border border-stone-100 bg-white p-4">
      {/* Filtres + barre d'édition en masse */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[150px]">
          <label className="mb-1 block text-[11px] font-semibold text-stone-500">Filtrer par poste</label>
          <Select value={fRatt} onChange={(e) => setFRatt(e.target.value)} options={[{ value: '', label: 'Tous les postes' }, ...rattOptions.map((r) => ({ value: r, label: r }))]} />
        </div>
        <div className="min-w-[140px]">
          <label className="mb-1 block text-[11px] font-semibold text-stone-500">Filtrer par rôle</label>
          <Select value={fRole} onChange={(e) => setFRole(e.target.value)} options={[{ value: '', label: 'Tous les rôles' }, ...roleOptions.map((r) => ({ value: r, label: r }))]} />
        </div>
        <div className="ml-auto flex items-end gap-2 rounded-xl bg-stone-50 p-2">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-stone-500">Mode</label>
            <Select value={mode} onChange={(e) => setMode(e.target.value)} options={[{ value: 'forfait', label: 'Forfait' }, { value: 'horaire', label: 'Horaire' }]} />
          </div>
          <div className="w-24">
            <label className="mb-1 block text-[11px] font-semibold text-stone-500">{mode === 'forfait' ? 'Forfait €' : '€/h'}</label>
            <input type="number" step="0.5" value={price} onChange={(e) => setPrice(e.target.value)}
              className="w-full rounded-lg border border-stone-200 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>
          <Button size="sm" disabled={busy || closed || selected.size === 0} onClick={() => void apply()}>
            <Wand2 size={14} /> Appliquer ({selected.size})
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-stone-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-400">
              <th className="px-3 py-2">
                <button onClick={toggleAll} disabled={closed} className="text-stone-500 disabled:opacity-40">
                  {allShownSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                </button>
              </th>
              <th className="px-3 py-2">Agent</th>
              <th className="px-3 py-2">Poste</th>
              <th className="px-3 py-2">Rôle</th>
              <th className="px-3 py-2">Facturation</th>
              <th className="px-3 py-2 text-right">Coût</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-50">
            {filtered.map((a) => {
              const sel = selected.has(a.id);
              return (
                <tr key={a.id} className={sel ? 'bg-amber-50/50' : ''}>
                  <td className="px-3 py-2">
                    <button onClick={() => toggle(a.id)} disabled={closed} className="text-stone-400 disabled:opacity-40">
                      {sel ? <CheckSquare size={16} className="text-amber-600" /> : <Square size={16} />}
                    </button>
                  </td>
                  <td className="px-3 py-2 font-medium text-stone-800">{`${a.prenom} ${a.nom}`.trim()}</td>
                  <td className="px-3 py-2 text-stone-500">{ratt(a)}</td>
                  <td className="px-3 py-2 text-stone-500">{a.role}</td>
                  <td className="px-3 py-2"><BillingChip mode={a.billing_mode} taux={num(a.taux)} forfait={a.forfait} /></td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-stone-800">{eur(num(a.cout))}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-stone-400">Aucun agent.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {closed && <p className="text-xs text-stone-400">Événement clôturé — facturation verrouillée.</p>}
    </div>
  );
}
