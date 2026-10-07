/**
 * ForfaitsRhPanel — forfaits RH d'un événement : montants forfaitaires (freelance,
 * manutention…) non liés à des heures. Intégrés au coût RH de l'événement (KPI RH)
 * et persistés dans event_rh_forfaits. RG-003 : réservé ROLE_STADE (RLS is_stade()).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Check, X, BadgeEuro } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useAutosaveDraft } from '@/hooks/useAutosaveDraft';
import { Button, Input, Select, Spinner } from '@/components/ui';

const savedLabel = (ts: number | null): string =>
  ts ? `Brouillon enregistré · ${new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : '';

interface Forfait {
  forfait_id: string;
  label: string;
  category: 'freelance' | 'manutention' | 'autre';
  amount_ht: number;
  note: string | null;
}

const CATEGORIES = [
  { value: 'freelance', label: 'Freelance' },
  { value: 'manutention', label: 'Manutention' },
  { value: 'autre', label: 'Autre' },
] as const;
const CAT_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const eur = (v: number): string => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

type FormState = { category: 'freelance' | 'manutention' | 'autre'; label: string; amount: string; note: string };
const emptyForm = (): FormState => ({ category: 'freelance', label: '', amount: '', note: '' });

export function ForfaitsRhPanel({ eventId, onChanged }: { eventId: string; onChanged?: () => void }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [rows, setRows] = useState<Forfait[] | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);

  // Autosave du brouillon de saisie : un forfait en cours de saisie n'est jamais
  // perdu si l'on change d'onglet/de page avant de cliquer « Enregistrer ».
  // Pas de clearDraft (qui suspendrait l'autosave) : remettre le form à null
  // persiste un brouillon vide → rien à restaurer au prochain montage.
  const { loadDraft, lastSavedAt } = useAutosaveDraft(`forfait.${eventId}`, form);
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    if (restoredFor.current === eventId) return;
    restoredFor.current = eventId;
    const d = loadDraft();
    if (d) setForm(d);
  }, [eventId, loadDraft]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('event_rh_forfaits')
      .select('forfait_id, label, category, amount_ht, note')
      .eq('event_id', eventId)
      .order('created_at', { ascending: true });
    setRows((data as Forfait[] | null) ?? []);
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  async function add() {
    if (form!.label.trim().length < 2) { showToast('Intitulé requis (min. 2 caractères).', 'warning'); return; }
    if (num(form!.amount) <= 0) { showToast('Montant HT requis (> 0).', 'warning'); return; }
    setBusy(true);
    const { error } = await supabase.from('event_rh_forfaits').insert({
      event_id: eventId,
      label: form!.label.trim(),
      category: form!.category,
      amount_ht: num(form!.amount),
      note: form!.note.trim() || null,
      created_by: user?.email ?? user?.name ?? null,
    });
    setBusy(false);
    if (error) { showToast(`Échec : ${error.message}`, 'warning'); return; }
    showToast('Forfait enregistré.', 'success');
    setForm(null);
    await load();
    onChanged?.();
  }

  async function remove(id: string) {
    const { error } = await supabase.from('event_rh_forfaits').delete().eq('forfait_id', id);
    if (error) { showToast(`Échec : ${error.message}`, 'warning'); return; }
    showToast('Forfait supprimé.', 'success');
    await load();
    onChanged?.();
  }

  const total = (rows ?? []).reduce((s, r) => s + num(r.amount_ht), 0);

  return (
    <section className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-bold text-stone-800">
            <BadgeEuro size={15} className="text-emerald-500" /> Forfaits (freelance / manutention)
          </p>
          <p className="mt-0.5 text-xs text-stone-400">Montants forfaitaires sans heures — intégrés au coût RH de l'événement.</p>
        </div>
        {!form && <Button size="sm" onClick={() => setForm(emptyForm())}><Plus size={14} /> Ajouter un forfait</Button>}
      </div>

      {form && (
        <div className="mb-4 space-y-3 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              label="Type"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as FormState['category'] })}
              options={CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
            />
            <Input
              label="Montant HT (€)"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="Ex : 350"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </div>
          <Input
            label="Intitulé"
            placeholder="Ex : Prestataire son freelance · Équipe manutention montage"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
          <Input
            label="Note (optionnel)"
            placeholder="Précision libre"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void add()} loading={busy}><Check size={14} /> Enregistrer</Button>
            <Button size="sm" variant="secondary" onClick={() => setForm(null)}><X size={14} /> Annuler</Button>
            {lastSavedAt && <span className="text-xs text-stone-400">{savedLabel(lastSavedAt)}</span>}
          </div>
        </div>
      )}

      {rows === null ? (
        <Spinner label="Chargement des forfaits…" />
      ) : rows.length === 0 ? (
        <p className="rounded-xl bg-stone-50 px-4 py-3 text-center text-sm text-stone-400">Aucun forfait pour cet événement.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-400">
                <th className="px-3 py-2">Type</th><th className="px-3 py-2">Intitulé</th>
                <th className="px-3 py-2 text-right">Montant HT</th><th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-50">
              {rows.map((r) => (
                <tr key={r.forfait_id} className="text-stone-800">
                  <td className="px-3 py-2">
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">{CAT_LABEL[r.category] ?? r.category}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-medium">{r.label}</span>
                    {r.note && <span className="block text-xs text-stone-400">{r.note}</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{eur(num(r.amount_ht))}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => void remove(r.forfait_id)} className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-rose-50 hover:text-rose-600" aria-label="Supprimer le forfait">
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="border-t border-stone-100 bg-stone-50 font-bold text-stone-900">
                <td className="px-3 py-2" colSpan={2}>Total forfaits</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(total)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
