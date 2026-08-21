/**
 * SeminaireStaffHoursPanel — horaires RH staff d'un séminaire, par espace.
 *
 * Écrit dans `zone_staff_hours` (même table que les matchs) : hours_worked et
 * rh_cost sont des colonnes GÉNÉRÉES (calculées en base à partir de l'arrivée /
 * départ / pause / taux), et le trigger force event_category='seminaire'. La
 * synthèse RH (rh_monthly_hours) agrège zone_staff_hours sans filtre de type →
 * ces heures remontent automatiquement dans le reporting paie.
 *
 * RG-003 : réservé ROLE_STADE (RLS `stade_all_staff_hours` = is_stade()).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Check, X, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Button, Input, Select, Spinner } from '@/components/ui';

const ROLES = [
  'Serveur', 'Chef de rang', 'Barman', 'Agent de sécurité',
  'Runner', 'Hôte / Hôtesse', 'Responsable espace', 'Autre',
] as const;

const PAYMENTS = [
  { value: 'contrat', label: 'Contrat (paie)' },
  { value: 'franchise', label: 'Franchise (facture)' },
] as const;

interface Row {
  id: string;
  staff_name: string;
  role: string | null;
  arrival_time: string | null;
  departure_time: string | null;
  break_minutes: number | null;
  hours_worked: number | null;
  hourly_rate: number | null;
  rh_cost: number | null;
  payment_type: string | null;
}

interface FormState {
  id: string | null; nom: string; role: string; arrival: string; departure: string;
  breakMin: string; rate: string; payment: string;
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const eur = (v: number): string => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const hhmm = (t: string | null): string => (t ? t.slice(0, 5) : '');

/** Heures entre deux HH:MM moins la pause (gère le passage minuit). */
function diffHours(start: string, end: string, breakMin: number): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let d = eh * 60 + em - (sh * 60 + sm);
  if (d < 0) d += 1440;
  return Math.max(0, Math.round((d / 60 - breakMin / 60) * 100) / 100);
}

export function SeminaireStaffHoursPanel({ eventId, spaceId, spaceName }: { eventId: string; spaceId: string; spaceName: string }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const by = user?.name ?? user?.email ?? 'Stade';
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('zone_staff_hours')
      .select('id, staff_name, role, arrival_time, departure_time, break_minutes, hours_worked, hourly_rate, rh_cost, payment_type')
      .eq('event_id', eventId)
      .eq('space_id', spaceId)
      .order('role')
      .order('staff_name');
    setRows((data as Row[] | null) ?? []);
    setLoading(false);
  }, [eventId, spaceId]);
  useEffect(() => { void load(); }, [load]);

  const totalH = rows.reduce((s, r) => s + num(r.hours_worked), 0);
  const totalC = rows.reduce((s, r) => s + num(r.rh_cost), 0);

  const emptyForm = (): FormState => ({ id: null, nom: '', role: 'Serveur', arrival: '', departure: '', breakMin: '0', rate: '', payment: 'contrat' });

  const previewHours = useMemo(() => (form ? diffHours(form.arrival, form.departure, num(form.breakMin)) : 0), [form]);
  const previewCost = previewHours * (form ? num(form.rate) : 0);

  async function save() {
    if (!form) return;
    if (form.nom.trim().length < 2) { showToast('Nom requis (2 caractères min).', 'warning'); return; }
    setBusy(true);
    const payload = {
      event_id: eventId,
      space_id: spaceId,
      staff_name: form.nom.trim(),
      role: form.role,
      arrival_time: form.arrival || null,
      departure_time: form.departure || null,
      break_minutes: num(form.breakMin),
      hourly_rate: form.rate.trim() ? num(form.rate) : null,
      payment_type: form.payment,
      entered_by: by,
    };
    const { error } = form.id
      ? await supabase.from('zone_staff_hours').update(payload).eq('id', form.id)
      : await supabase.from('zone_staff_hours').insert(payload);
    setBusy(false);
    if (error) { showToast(`Échec : ${error.message}`, 'warning'); return; }
    showToast('Horaire enregistré.', 'success');
    setForm(null);
    await load();
  }

  async function remove(id: string) {
    if (!window.confirm('Supprimer cet agent ?')) return;
    const { error } = await supabase.from('zone_staff_hours').delete().eq('id', id);
    if (error) { showToast(`Échec : ${error.message}`, 'warning'); return; }
    showToast('Agent supprimé.', 'success');
    await load();
  }

  return (
    <section className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-sm font-bold text-stone-800"><Users size={15} className="text-pr-gold" /> Staff — {spaceName}</p>
          <p className="mt-0.5 text-xs text-stone-400">Horaires RH par agent (arrivée / départ / pause). Coût calculé automatiquement, intégré à la synthèse paie.</p>
        </div>
        {!form && <Button size="sm" onClick={() => setForm(emptyForm())}><Plus size={14} /> Ajouter un agent</Button>}
      </div>

      {form && (
        <div className="mb-4 grid grid-cols-2 gap-2 rounded-xl border border-pr-gold/30 bg-pr-gold/5 p-3 sm:grid-cols-4">
          <Input label="Nom *" value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} placeholder="Prénom NOM" />
          <Select label="Rôle" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} options={ROLES.map((r) => ({ value: r, label: r }))} />
          <Input type="time" label="Arrivée" value={form.arrival} onChange={(e) => setForm({ ...form, arrival: e.target.value })} />
          <Input type="time" label="Départ" value={form.departure} onChange={(e) => setForm({ ...form, departure: e.target.value })} />
          <Input type="number" step="5" label="Pause (min)" value={form.breakMin} onChange={(e) => setForm({ ...form, breakMin: e.target.value })} />
          <Input type="number" step="0.5" label="Taux €/h" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
          <Select label="Paiement" value={form.payment} onChange={(e) => setForm({ ...form, payment: e.target.value })} options={PAYMENTS.map((p) => ({ value: p.value, label: p.label }))} />
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
        <p className="rounded-xl bg-stone-50 px-4 py-4 text-center text-sm text-stone-400">Aucun agent saisi pour cet espace.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-400">
                <th className="px-3 py-2">Nom</th><th className="px-3 py-2">Rôle</th>
                <th className="px-3 py-2">Arr.</th><th className="px-3 py-2">Dép.</th><th className="px-3 py-2 text-right">Pause</th>
                <th className="px-3 py-2 text-right">Heures</th><th className="px-3 py-2 text-right">Taux</th>
                <th className="px-3 py-2 text-right">Coût HT</th><th className="px-3 py-2">Paie</th><th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-50">
              {rows.map((r) => (
                <tr key={r.id} className="text-stone-800">
                  <td className="px-3 py-2 font-medium">{r.staff_name}</td>
                  <td className="px-3 py-2 text-stone-500">{r.role ?? '—'}</td>
                  <td className="px-3 py-2 tabular-nums text-stone-500">{hhmm(r.arrival_time) || '—'}</td>
                  <td className="px-3 py-2 tabular-nums text-stone-500">{hhmm(r.departure_time) || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-stone-500">{num(r.break_minutes)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.hours_worked != null ? num(r.hours_worked).toFixed(2) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-stone-500">{r.hourly_rate != null ? eur(num(r.hourly_rate)) : '—'}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{r.rh_cost != null ? eur(num(r.rh_cost)) : '—'}</td>
                  <td className="px-3 py-2 text-xs text-stone-500">{r.payment_type === 'franchise' ? 'Franchise' : r.payment_type === 'contrat' ? 'Contrat' : '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setForm({ id: r.id, nom: r.staff_name, role: r.role ?? 'Serveur', arrival: hhmm(r.arrival_time), departure: hhmm(r.departure_time), breakMin: String(num(r.break_minutes)), rate: r.hourly_rate != null ? String(r.hourly_rate) : '', payment: r.payment_type ?? 'contrat' })} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"><Pencil size={14} /></button>
                      <button onClick={() => void remove(r.id)} className="rounded-lg p-1.5 text-stone-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              <tr className="border-t border-stone-200 font-bold text-stone-800">
                <td className="px-3 py-2" colSpan={5}>TOTAL espace</td>
                <td className="px-3 py-2 text-right tabular-nums">{totalH.toFixed(2)}</td>
                <td />
                <td className="px-3 py-2 text-right tabular-nums">{eur(totalC)}</td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
