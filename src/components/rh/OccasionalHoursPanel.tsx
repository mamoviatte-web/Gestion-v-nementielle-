/**
 * OccasionalHoursPanel — prestations ponctuelles Runner / logistique de
 * PRÉPARATION (montage, livraison, démontage…), saisies sur des jours de prépa
 * avant l'événement. Indépendant du sélecteur d'espace. Le coût (heures × taux)
 * est intégré aux charges RH de l'événement via get_event_rh (pôle « Runner
 * (prépa) »). Source : occasional_hours (RPC occasional_hour_upsert/delete,
 * get_event_occasional). RG-003 : réservé ROLE_STADE (garde base).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Check, X, Truck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Button, Input, Select, Spinner } from '@/components/ui';

interface Presta {
  id: string; staff_name: string; mission: string; date: string;
  start: string | null; end: string | null; hours: number | null; rate: number | null; cost: number | null;
}

const MISSIONS = [
  { value: 'runner', label: 'Runner' }, { value: 'manutention', label: 'Manutention' },
  { value: 'logistique', label: 'Logistique' }, { value: 'livraison', label: 'Livraison' },
  { value: 'montage', label: 'Montage' }, { value: 'démontage', label: 'Démontage' },
  { value: 'mise_en_place', label: 'Mise en place' }, { value: 'nettoyage', label: 'Nettoyage' },
  { value: 'technique', label: 'Technique' }, { value: 'sécurité', label: 'Sécurité' },
  { value: 'autre', label: 'Autre' },
] as const;
const MISSION_LABEL: Record<string, string> = Object.fromEntries(MISSIONS.map((m) => [m.value, m.label]));

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const eur = (v: number): string => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const hhmm = (t: string | null): string => (t ? t.slice(0, 5) : '');

function minusOneDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('en-CA');
}
/** Heures entre deux HH:MM (gère le passage minuit). */
function diffHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let d = eh * 60 + em - (sh * 60 + sm);
  if (d < 0) d += 1440;
  return Math.round((d / 60) * 100) / 100;
}

interface FormState { id: string | null; nom: string; mission: string; date: string; start: string; end: string; hours: string; rate: string; }

export function OccasionalHoursPanel({ eventId, eventDate, onChanged }: { eventId: string; eventDate: string; onChanged?: () => void }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const by = user?.name ?? user?.email ?? 'Stade';
  const [rows, setRows] = useState<Presta[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('get_event_occasional', { p_event: eventId });
    setRows((data as Presta[] | null) ?? []);
    setLoading(false);
  }, [eventId]);
  useEffect(() => { void load(); }, [load]);

  const total = rows.reduce((s, r) => s + num(r.cost), 0);
  const totalH = rows.reduce((s, r) => s + num(r.hours), 0);

  const emptyForm = (): FormState => ({ id: null, nom: '', mission: 'runner', date: minusOneDay(eventDate), start: '', end: '', hours: '', rate: '' });

  const previewHours = useMemo(() => {
    if (!form) return 0;
    if (form.hours.trim()) return num(form.hours);
    if (form.start && form.end) return diffHours(form.start, form.end);
    return 0;
  }, [form]);
  const previewCost = previewHours * (form ? num(form.rate) : 0);

  async function save() {
    if (!form) return;
    if (form.nom.trim().length < 2) { showToast('Nom requis.', 'warning'); return; }
    if (!form.date) { showToast('Date de prépa requise.', 'warning'); return; }
    if (num(form.rate) <= 0) { showToast('Taux horaire requis.', 'warning'); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc('occasional_hour_upsert', {
      p_id: form.id, p_event: eventId, p_staff_name: form.nom.trim(), p_mission: form.mission,
      p_work_date: form.date, p_start: form.start || null, p_end: form.end || null,
      p_hours: form.hours.trim() ? num(form.hours) : null, p_rate: num(form.rate), p_by: by,
    });
    setBusy(false);
    const res = data as { success?: boolean; error?: string } | null;
    if (error || !res?.success) { showToast(`Échec : ${res?.error ?? error?.message ?? 'erreur'}`, 'warning'); return; }
    showToast('Prestation enregistrée.', 'success');
    setForm(null);
    await load();
    onChanged?.();
  }

  async function remove(id: string) {
    if (!window.confirm('Supprimer cette prestation ?')) return;
    const { data, error } = await supabase.rpc('occasional_hour_delete', { p_id: id });
    const res = data as { success?: boolean; error?: string } | null;
    if (error || !res?.success) { showToast(`Échec : ${res?.error ?? error?.message ?? 'erreur'}`, 'warning'); return; }
    showToast('Prestation supprimée.', 'success');
    await load();
    onChanged?.();
  }

  return (
    <section className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-sm font-bold text-stone-800"><Truck size={15} className="text-amber-600" /> Prestations Runner / Logistique (préparation)</p>
          <p className="mt-0.5 text-xs text-stone-400">Montage, livraison, démontage… sur les jours de prépa. Intégré au coût RH de l'événement.</p>
        </div>
        {!form && <Button size="sm" onClick={() => setForm(emptyForm())}><Plus size={14} /> Ajouter une prestation runner</Button>}
      </div>

      {form && (
        <div className="mb-4 grid grid-cols-2 gap-2 rounded-xl border border-amber-200 bg-amber-50/40 p-3 sm:grid-cols-4">
          <Input label="Nom *" value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} placeholder="Prénom NOM" />
          <Select label="Mission" value={form.mission} onChange={(e) => setForm({ ...form, mission: e.target.value })} options={MISSIONS.map((m) => ({ value: m.value, label: m.label }))} />
          <Input type="date" label="Jour de prépa *" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Input type="number" step="0.5" label="Taux €/h *" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
          <Input type="time" label="Arrivée" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
          <Input type="time" label="Départ" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
          <Input type="number" step="0.25" label="Heures (ou A/D)" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} />
          <div className="flex flex-col justify-end">
            <p className="mb-1 text-xs text-stone-500">Coût : <b className="text-stone-800">{eur(previewCost)}</b> ({previewHours.toFixed(2)} h)</p>
            <div className="flex gap-1">
              <Button size="sm" loading={busy} onClick={() => void save()}><Check size={14} /></Button>
              <button onClick={() => setForm(null)} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100"><X size={16} /></button>
            </div>
          </div>
        </div>
      )}

      {loading ? <Spinner /> : rows.length === 0 ? (
        <p className="rounded-xl bg-stone-50 px-4 py-4 text-center text-sm text-stone-400">Aucune prestation runner/logistique saisie.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-400">
                <th className="px-3 py-2">Jour</th><th className="px-3 py-2">Nom</th><th className="px-3 py-2">Mission</th>
                <th className="px-3 py-2">Arr.</th><th className="px-3 py-2">Dép.</th>
                <th className="px-3 py-2 text-right">Heures</th><th className="px-3 py-2 text-right">Taux</th><th className="px-3 py-2 text-right">Coût HT</th><th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-50">
              {rows.map((r) => (
                <tr key={r.id} className="text-stone-800">
                  <td className="px-3 py-2 tabular-nums">{new Date(r.date).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' })}</td>
                  <td className="px-3 py-2 font-medium">{r.staff_name}</td>
                  <td className="px-3 py-2 text-stone-500">{MISSION_LABEL[r.mission] ?? r.mission}</td>
                  <td className="px-3 py-2 tabular-nums text-stone-500">{hhmm(r.start) || '—'}</td>
                  <td className="px-3 py-2 tabular-nums text-stone-500">{hhmm(r.end) || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(r.hours).toFixed(2)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-stone-500">{eur(num(r.rate))}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{eur(num(r.cost))}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setForm({ id: r.id, nom: r.staff_name, mission: r.mission, date: r.date.slice(0, 10), start: hhmm(r.start), end: hhmm(r.end), hours: r.hours != null ? String(r.hours) : '', rate: r.rate != null ? String(r.rate) : '' })} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"><Pencil size={14} /></button>
                      <button onClick={() => void remove(r.id)} className="rounded-lg p-1.5 text-stone-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              <tr className="border-t border-stone-200 font-bold text-stone-800">
                <td className="px-3 py-2" colSpan={5}>TOTAL prépa</td>
                <td className="px-3 py-2 text-right tabular-nums">{totalH.toFixed(2)}</td>
                <td />
                <td className="px-3 py-2 text-right tabular-nums">{eur(total)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
