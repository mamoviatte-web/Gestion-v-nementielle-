/**
 * ExternalChargesManager — saisie libre des charges externes d'un événement
 * (traiteur, sécurité, technique…). Écrit dans event_external_charges (RLS
 * ROLE_STADE). Chaque modif déclenche onCostChange pour recalculer le P&L.
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { CheckCircle, Circle, Plus, Trash2 } from 'lucide-react';

export const CHARGE_TYPES = [
  { value: 'traiteur', label: '🍽️ Traiteur', color: 'bg-orange-100 text-orange-700' },
  { value: 'securite', label: '🔒 Sécurité', color: 'bg-red-100 text-red-700' },
  { value: 'technique', label: '🎛️ Technique / AV', color: 'bg-blue-100 text-blue-700' },
  { value: 'decoration', label: '🌸 Décoration', color: 'bg-pink-100 text-pink-700' },
  { value: 'transport', label: '🚐 Transport', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'animation', label: '🎤 Animation / DJ', color: 'bg-purple-100 text-purple-700' },
  { value: 'photo_video', label: '📸 Photo / Vidéo', color: 'bg-teal-100 text-teal-700' },
  { value: 'nettoyage', label: '🧹 Nettoyage', color: 'bg-green-100 text-green-700' },
  { value: 'location', label: '📦 Location', color: 'bg-stone-100 text-stone-700' },
  { value: 'communication', label: '🖨️ Communication', color: 'bg-indigo-100 text-indigo-700' },
  { value: 'autre', label: '➕ Autre', color: 'bg-gray-100 text-gray-700' },
] as const;

interface ExternalCharge {
  id: string;
  provider_name: string;
  charge_type: string;
  amount_ht: number;
  tva_rate: number;
  invoice_ref: string | null;
  is_confirmed: boolean;
  notes: string | null;
}

function fmt(v: number): string {
  return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function AddChargeRow({ onSave }: { onSave: (c: Omit<ExternalCharge, 'id'>) => Promise<void> }) {
  const [type, setType] = useState('traiteur');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [ref, setRef] = useState('');
  const [saving, setSaving] = useState(false);

  const valid = name.trim() && amount && parseFloat(amount) > 0;

  async function handleSave() {
    if (!valid) return;
    setSaving(true);
    await onSave({
      provider_name: name.trim(),
      charge_type: type,
      amount_ht: parseFloat(amount),
      tva_rate: 20,
      invoice_ref: ref.trim() || null,
      is_confirmed: false,
      notes: null,
    });
    setName('');
    setAmount('');
    setRef('');
    setSaving(false);
  }

  return (
    <div className="grid grid-cols-2 items-end gap-2 rounded-xl border border-dashed border-stone-300 bg-stone-50 p-3 sm:grid-cols-12">
      <div className="sm:col-span-3">
        <label className="mb-1 block text-xs text-stone-500">Type</label>
        <select value={type} onChange={(e) => setType(e.target.value)} className="w-full rounded-lg border border-stone-200 bg-white px-2 py-2 text-sm">
          {CHARGE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-4">
        <label className="mb-1 block text-xs text-stone-500">Nom du prestataire *</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex : ADG Traiteur…" className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs text-stone-500">Montant HT (€) *</label>
        <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="w-full rounded-lg border border-stone-200 px-3 py-2 text-right text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs text-stone-500">Réf. facture</label>
        <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="N° ou BC" className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm" />
      </div>
      <div className="flex justify-end sm:col-span-1">
        <button onClick={() => void handleSave()} disabled={saving || !valid} className="flex items-center gap-1 rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-40">
          <Plus size={14} />
          {saving ? '…' : 'Ajouter'}
        </button>
      </div>
    </div>
  );
}

export function ExternalChargesManager({ eventId, onCostChange }: { eventId: string; onCostChange?: (totalHT: number) => void }) {
  const [charges, setCharges] = useState<ExternalCharge[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchCharges = useCallback(async () => {
    const { data } = await supabase
      .from('event_external_charges')
      .select('id, provider_name, charge_type, amount_ht, tva_rate, invoice_ref, is_confirmed, notes')
      .eq('event_id', eventId)
      .order('charge_type')
      .order('created_at');
    const rows = (data ?? []) as ExternalCharge[];
    setCharges(rows);
    onCostChange?.(rows.reduce((s, c) => s + (Number(c.amount_ht) || 0), 0));
    setLoading(false);
  }, [eventId, onCostChange]);

  useEffect(() => {
    void fetchCharges();
  }, [fetchCharges]);

  async function addCharge(c: Omit<ExternalCharge, 'id'>) {
    const { error } = await supabase.from('event_external_charges').insert({ ...c, event_id: eventId });
    if (!error) await fetchCharges();
  }

  async function toggleConfirm(c: ExternalCharge) {
    await supabase.from('event_external_charges').update({ is_confirmed: !c.is_confirmed }).eq('id', c.id);
    await fetchCharges();
  }

  async function deleteCharge(id: string) {
    if (!confirm('Supprimer cette charge ?')) return;
    setDeleting(id);
    await supabase.from('event_external_charges').delete().eq('id', id);
    await fetchCharges();
    setDeleting(null);
  }

  const totalHT = charges.reduce((s, c) => s + c.amount_ht, 0);
  const totalTTC = charges.reduce((s, c) => s + c.amount_ht * (1 + c.tva_rate / 100), 0);
  const confirmed = charges.filter((c) => c.is_confirmed).reduce((s, c) => s + c.amount_ht, 0);
  const pending = totalHT - confirmed;

  if (loading) return <div className="h-24 animate-pulse rounded-xl bg-stone-100" />;

  return (
    <div className="space-y-5">
      {charges.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-center">
            <p className="text-xs font-medium uppercase tracking-wide text-red-500">Total HT</p>
            <p className="mt-1 text-xl font-bold text-red-700">{fmt(totalHT)} €</p>
          </div>
          <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-center">
            <p className="text-xs font-medium uppercase tracking-wide text-green-500">Confirmé</p>
            <p className="mt-1 text-xl font-bold text-green-700">{fmt(confirmed)} €</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-center">
            <p className="text-xs font-medium uppercase tracking-wide text-amber-500">En attente</p>
            <p className="mt-1 text-xl font-bold text-amber-700">{fmt(pending)} €</p>
          </div>
        </div>
      )}

      {charges.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-stone-200">
          <table className="w-full text-sm">
            <thead className="border-b border-stone-200 bg-stone-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-stone-500">Prestataire</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-stone-500">Type</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-stone-500">HT</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-stone-500">TTC</th>
                <th className="px-3 py-2 text-center text-xs font-semibold uppercase text-stone-500">Statut</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {charges.map((c) => {
                const cfg = CHARGE_TYPES.find((t) => t.value === c.charge_type) ?? CHARGE_TYPES[CHARGE_TYPES.length - 1];
                const ttc = c.amount_ht * (1 + c.tva_rate / 100);
                return (
                  <tr key={c.id} className={`hover:bg-stone-50 ${deleting === c.id ? 'opacity-40' : ''}`}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-stone-800">{c.provider_name}</p>
                      {c.invoice_ref && <p className="text-xs text-stone-400">{c.invoice_ref}</p>}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
                    </td>
                    <td className="px-3 py-3 text-right font-bold text-stone-900">{fmt(c.amount_ht)} €</td>
                    <td className="px-3 py-3 text-right text-xs text-stone-500">{fmt(ttc)} €</td>
                    <td className="px-3 py-3 text-center">
                      <button onClick={() => void toggleConfirm(c)} title={c.is_confirmed ? 'Facture confirmée' : 'Devis — cliquer pour confirmer'}>
                        {c.is_confirmed ? <CheckCircle size={18} className="mx-auto text-green-600" /> : <Circle size={18} className="mx-auto text-amber-400" />}
                      </button>
                    </td>
                    <td className="px-2 py-3">
                      <button onClick={() => void deleteCharge(c.id)} disabled={deleting === c.id} className="text-stone-300 transition-colors hover:text-red-500">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-stone-300 bg-stone-50">
              <tr>
                <td colSpan={2} className="px-4 py-3 text-sm font-bold text-stone-800">TOTAL CHARGES EXTERNES</td>
                <td className="px-3 py-3 text-right text-base font-bold text-red-700">{fmt(totalHT)} € HT</td>
                <td className="px-3 py-3 text-right text-sm text-stone-500">{fmt(totalTTC)} € TTC</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <AddChargeRow onSave={addCharge} />

      {charges.length === 0 && (
        <p className="py-2 text-center text-sm text-stone-400">Aucune charge externe. Ajoutez le traiteur, la sécurité, etc.</p>
      )}
    </div>
  );
}
