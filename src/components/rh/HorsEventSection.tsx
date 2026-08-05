/**
 * HorsEventSection — personnel intervenant HORS événement (manutention,
 * nettoyage, technique, reporting…). Saisie forfait/horaire, coût auto, KPIs
 * de période et CRUD. Réservé ROLE_STADE (table staff_hors_event, RG-003).
 *
 * Dégrade proprement si la table n'est pas encore provisionnée (migration 042).
 * Les colonnes hours_worked / cost_ht sont GÉNÉRÉES en base (jamais envoyées).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Period } from '@/components/rh/PeriodSelector';

const ROLES = [
  'Manutention', 'Nettoyage', 'Technique / Maintenance', 'Reporting / Admin',
  'Sécurité', 'Logistique', 'Prestataire externe', 'Autre',
] as const;
type Role = (typeof ROLES)[number];
type RemunType = 'horaire' | 'forfait';

const ROLE_ICON: Record<string, string> = {
  Manutention: '📦', Nettoyage: '🧹', 'Technique / Maintenance': '🔧',
  'Reporting / Admin': '📋', Sécurité: '🔒', Logistique: '🚚',
  'Prestataire externe': '🤝', Autre: '👤',
};

interface Entry {
  id: string;
  agent_nom: string;
  agent_prenom: string;
  agent_role: string;
  societe: string | null;
  work_date: string;
  start_time: string | null;
  end_time: string | null;
  hours_worked: number | string | null;
  remun_type: RemunType;
  hourly_rate: number | string | null;
  forfait_amount: number | string | null;
  cost_ht: number | string | null;
  description: string | null;
  bon_commande: string | null;
}

const n = (v: number | string | null | undefined): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export function HorsEventSection({ period }: { period: Period }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editEntry, setEditEntry] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const start = period.startDate.toISOString().slice(0, 10);
  const end = period.endDate.toISOString().slice(0, 10);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('staff_hors_event')
      .select('*')
      .gte('work_date', start)
      .lte('work_date', end)
      .order('work_date', { ascending: false });
    if (error) {
      if (/does not exist|schema cache|PGRST20|relation/i.test(error.message)) setUnavailable(true);
      setEntries([]);
    } else {
      setEntries((data ?? []) as Entry[]);
    }
    setLoading(false);
  }, [start, end]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const periodKpis = useMemo(() => {
    if (entries.length === 0) return null;
    return {
      count: entries.length,
      agents: new Set(entries.map((e) => `${e.agent_nom}${e.agent_prenom}`)).size,
      heures: entries.reduce((s, e) => s + n(e.hours_worked), 0),
      cout: entries.reduce((s, e) => s + n(e.cost_ht), 0),
      societes: new Set(entries.map((e) => e.societe).filter(Boolean)).size,
    };
  }, [entries]);

  async function handleDelete(id: string) {
    if (!window.confirm('Supprimer cette intervention ?')) return;
    await supabase.from('staff_hors_event').delete().eq('id', id);
    void fetchData();
  }

  if (unavailable) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center">
        <p className="font-semibold text-amber-800">Module « Hors événement » non provisionné</p>
        <p className="mt-1 text-sm text-amber-600">Applique la migration <code>supabase/staff_hors_event.sql</code> pour activer la saisie.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {periodKpis && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { icon: '🔧', value: String(periodKpis.count), label: 'Interventions', sub: period.label },
            { icon: '👥', value: String(periodKpis.agents), label: 'Agents uniques', sub: `${periodKpis.societes} société(s)` },
            { icon: '⏱', value: `${periodKpis.heures.toFixed(0)}h`, label: 'Heures travaillées', sub: `moy. ${(periodKpis.heures / periodKpis.count).toFixed(1)}h/interv.` },
            { icon: '💰', value: `${periodKpis.cout.toFixed(0)} €`, label: 'Coût HT période', sub: `moy. ${(periodKpis.cout / periodKpis.count).toFixed(0)} €/interv.` },
          ].map((k) => (
            <div key={k.label} className="rounded-2xl border border-stone-100 bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">{k.label}</p>
                <span className="text-xl">{k.icon}</span>
              </div>
              <p className="text-2xl font-black text-stone-900">{k.value}</p>
              <p className="mt-0.5 text-[10px] text-stone-400">{k.sub}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-stone-600">
          {entries.length} intervention{entries.length > 1 ? 's' : ''} sur la période
        </p>
        <button
          onClick={() => { setEditEntry(null); setShowForm(true); }}
          className="flex items-center gap-2 rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-stone-700"
        >
          <Plus size={15} /> Ajouter une intervention
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-stone-100" />)}</div>
      ) : entries.length === 0 ? (
        <div className="rounded-2xl border border-stone-100 bg-white p-12 text-center">
          <p className="font-medium text-stone-400">Aucune intervention hors événement sur cette période</p>
          <button onClick={() => { setEditEntry(null); setShowForm(true); }} className="mt-3 rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white">
            + Ajouter la première
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-center gap-4 rounded-2xl border border-stone-100 bg-white p-4 shadow-sm">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-xl">
                {ROLE_ICON[entry.agent_role] ?? '👤'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-bold text-stone-900">{entry.agent_prenom} {entry.agent_nom}</p>
                  <span className="rounded-lg bg-stone-100 px-2 py-0.5 text-xs text-stone-500">{entry.agent_role}</span>
                  {entry.societe && <span className="text-xs text-stone-400">{entry.societe}</span>}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-stone-400">
                  <span>📅 {new Date(entry.work_date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  {entry.start_time && (
                    <span>⏰ {entry.start_time.slice(0, 5)}{entry.end_time ? ` → ${entry.end_time.slice(0, 5)}` : ''}{entry.hours_worked ? ` (${n(entry.hours_worked).toFixed(1)}h)` : ''}</span>
                  )}
                  {entry.description && <span className="max-w-[200px] truncate">📝 {entry.description}</span>}
                </div>
              </div>
              <div className="shrink-0 text-right">
                {entry.cost_ht !== null ? (
                  <>
                    <p className="text-base font-black text-stone-900">{n(entry.cost_ht).toFixed(0)} €</p>
                    <p className="text-[10px] text-stone-400">{entry.remun_type === 'forfait' ? 'Forfait' : `${n(entry.hourly_rate)} €/h`}</p>
                  </>
                ) : <p className="text-xs text-stone-300">— €</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button onClick={() => { setEditEntry(entry); setShowForm(true); }} className="rounded-lg p-2 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"><Edit2 size={14} /></button>
                <button onClick={() => void handleDelete(entry.id)} className="rounded-lg p-2 text-stone-300 transition-colors hover:bg-red-50 hover:text-red-500"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <HorsEventForm
              initial={editEntry}
              onSave={async (payload) => {
                if (editEntry) await supabase.from('staff_hors_event').update(payload).eq('id', editEntry.id);
                else await supabase.from('staff_hors_event').insert(payload);
                setShowForm(false);
                void fetchData();
              }}
              onClose={() => setShowForm(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

interface FormState {
  agent_prenom: string; agent_nom: string; agent_role: Role; societe: string;
  work_date: string; start_time: string; end_time: string;
  remun_type: RemunType; hourly_rate: string; forfait_amount: string;
  description: string; bon_commande: string;
}

interface SavePayload {
  agent_prenom: string; agent_nom: string; agent_role: string; societe: string | null;
  work_date: string; start_time: string | null; end_time: string | null;
  remun_type: RemunType; hourly_rate: number | null; forfait_amount: number | null;
  description: string | null; bon_commande: string | null;
}

function HorsEventForm({ initial, onSave, onClose }: {
  initial: Entry | null;
  onSave: (data: SavePayload) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>({
    agent_prenom: initial?.agent_prenom ?? '',
    agent_nom: initial?.agent_nom ?? '',
    agent_role: (initial?.agent_role as Role) ?? 'Manutention',
    societe: initial?.societe ?? '',
    work_date: initial?.work_date ?? new Date().toISOString().slice(0, 10),
    start_time: initial?.start_time?.slice(0, 5) ?? '',
    end_time: initial?.end_time?.slice(0, 5) ?? '',
    remun_type: initial?.remun_type ?? 'horaire',
    hourly_rate: initial?.hourly_rate != null ? String(initial.hourly_rate) : '',
    forfait_amount: initial?.forfait_amount != null ? String(initial.forfait_amount) : '',
    description: initial?.description ?? '',
    bon_commande: initial?.bon_commande ?? '',
  });
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof FormState>(field: K, value: FormState[K]) =>
    setForm((p) => ({ ...p, [field]: value }));

  const costPreview = useMemo(() => {
    if (form.remun_type === 'forfait') return form.forfait_amount ? Number(form.forfait_amount) : null;
    if (form.start_time && form.end_time && form.hourly_rate) {
      const [sh, sm] = form.start_time.split(':').map(Number);
      const [eh, em] = form.end_time.split(':').map(Number);
      const hours = (eh * 60 + em - sh * 60 - sm) / 60;
      return hours > 0 ? Math.round(hours * Number(form.hourly_rate)) : null;
    }
    return null;
  }, [form]);

  const valid = form.agent_nom.trim() !== '' && form.agent_prenom.trim() !== '' && form.work_date !== '';

  async function handleSubmit() {
    if (!valid) return;
    setSaving(true);
    await onSave({
      agent_prenom: form.agent_prenom.trim(),
      agent_nom: form.agent_nom.toUpperCase().trim(),
      agent_role: form.agent_role,
      societe: form.societe.trim() || null,
      work_date: form.work_date,
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      remun_type: form.remun_type,
      hourly_rate: form.hourly_rate ? Number(form.hourly_rate) : null,
      forfait_amount: form.forfait_amount ? Number(form.forfait_amount) : null,
      description: form.description.trim() || null,
      bon_commande: form.bon_commande.trim() || null,
    });
    setSaving(false);
  }

  const input = 'w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400';

  return (
    <div className="space-y-4">
      <p className="text-base font-black text-stone-900">{initial ? 'Modifier' : 'Nouvelle intervention hors événement'}</p>

      <div className="grid grid-cols-2 gap-2">
        <input className={input} value={form.agent_prenom} onChange={(e) => set('agent_prenom', e.target.value)} placeholder="Prénom *" autoFocus />
        <input className={`${input} uppercase`} value={form.agent_nom} onChange={(e) => set('agent_nom', e.target.value.toUpperCase())} placeholder="NOM *" />
      </div>

      <select className={input} value={form.agent_role} onChange={(e) => set('agent_role', e.target.value as Role)}>
        {ROLES.map((r) => <option key={r} value={r}>{ROLE_ICON[r]} {r}</option>)}
      </select>
      <input className={input} value={form.societe} onChange={(e) => set('societe', e.target.value)} placeholder="Société / Prestataire (optionnel)" />

      <input type="date" className={input} value={form.work_date} onChange={(e) => set('work_date', e.target.value)} min="2020-01-01" max="2100-12-31" />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs text-stone-400">Début</label>
          <input type="time" className={`${input} min-h-[44px]`} value={form.start_time} onChange={(e) => set('start_time', e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-stone-400">Fin</label>
          <input type="time" className={`${input} min-h-[44px]`} value={form.end_time} onChange={(e) => set('end_time', e.target.value)} />
        </div>
      </div>

      <div className="flex overflow-hidden rounded-xl border border-stone-200">
        {([['horaire', '⏱ Taux horaire'], ['forfait', '💶 Forfait fixe']] as const).map(([key, label]) => (
          <button key={key} onClick={() => set('remun_type', key)} className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${form.remun_type === key ? 'bg-stone-900 text-white' : 'text-stone-500 hover:bg-stone-50'}`}>
            {label}
          </button>
        ))}
      </div>

      {form.remun_type === 'horaire' ? (
        <div className="flex items-center gap-2">
          <input type="number" className={`${input} flex-1`} value={form.hourly_rate} onChange={(e) => set('hourly_rate', e.target.value)} placeholder="Taux horaire" min={0} step={0.5} />
          <span className="shrink-0 text-sm text-stone-400">€/h HT</span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input type="number" className={`${input} flex-1`} value={form.forfait_amount} onChange={(e) => set('forfait_amount', e.target.value)} placeholder="Montant forfait" min={0} step={10} />
          <span className="shrink-0 text-sm text-stone-400">€ HT</span>
        </div>
      )}

      {costPreview !== null && (
        <div className="flex items-center justify-between rounded-xl border border-green-200 bg-green-50 px-4 py-2.5">
          <span className="text-sm font-semibold text-green-700">Coût estimé HT</span>
          <span className="text-lg font-black text-green-800">{costPreview.toFixed(0)} €</span>
        </div>
      )}

      <input className={input} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Description / Mission (optionnel)" />
      <input className={input} value={form.bon_commande} onChange={(e) => set('bon_commande', e.target.value)} placeholder="N° bon de commande (optionnel)" />

      <div className="flex gap-3">
        <button onClick={onClose} className="flex-1 rounded-xl border border-stone-200 py-3 text-sm text-stone-600">Annuler</button>
        <button onClick={() => void handleSubmit()} disabled={saving || !valid} className="flex-1 rounded-xl bg-stone-900 py-3 text-sm font-bold text-white disabled:opacity-40">
          {saving ? '…' : initial ? '✅ Modifier' : '✅ Enregistrer'}
        </button>
      </div>
    </div>
  );
}
