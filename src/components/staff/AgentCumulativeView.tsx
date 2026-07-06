/**
 * AgentCumulativeView — cumul des heures par agent (plannings + occasionnel),
 * lu depuis la vue agent_hours_cumulative. Réservé ROLE_STADE.
 * Résilient : si la vue/table n'est pas encore provisionnée, affiche un état vide.
 */

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Users, X } from 'lucide-react';
import { Alert, Badge, Button, EmptyState, Input, Select, Spinner } from '@/components/ui';
import { formatHours } from '@/lib/scheduleCalculations';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

interface CumulRow {
  staff_name: string;
  mission: string | null;
  event_name: string;
  event_date: string;
  event_type: string;
  event_id: string | null;
  source: 'planifié' | 'occasionnel';
  hours_worked: number | null;
  hourly_rate: number | null;
  total_cost: number | null;
}

const MISSIONS = ['mise_en_place', 'débarrassage', 'logistique', 'nettoyage', 'technique', 'sécurité', 'autre'];

function frDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function AgentCumulativeView() {
  const [addOpen, setAddOpen] = useState(false);
  const q = useQuery({
    queryKey: ['agentHoursCumulative'],
    staleTime: 15_000,
    queryFn: async (): Promise<{ rows: CumulRow[]; provisioned: boolean }> => {
      const { data, error } = await supabase
        .from('agent_hours_cumulative')
        .select('*')
        .order('staff_name')
        .order('event_date', { ascending: false });
      if (error) return { rows: [], provisioned: false };
      return { rows: (data ?? []) as CumulRow[], provisioned: true };
    },
  });

  const byAgent = useMemo(() => {
    const map = new Map<string, CumulRow[]>();
    for (const r of q.data?.rows ?? []) {
      const arr = map.get(r.staff_name) ?? [];
      arr.push(r);
      map.set(r.staff_name, arr);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [q.data]);

  if (q.isLoading) return <Spinner label="Chargement du cumul…" />;

  return (
    <div className="space-y-4">
      {q.data && !q.data.provisioned && (
        <Alert variant="warning" title="Vue non provisionnée">
          Applique <code>supabase/occasional_hours.sql</code> pour activer le cumul (table
          <code> occasional_hours</code> + vue <code>agent_hours_cumulative</code>).
        </Alert>
      )}

      <div className="flex justify-end">
        <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Heures occasionnelles
        </Button>
      </div>

      {byAgent.length === 0 ? (
        <EmptyState icon={Users} title="Aucune heure enregistrée" message="Plannings clôturés et heures occasionnelles apparaîtront ici." />
      ) : (
        byAgent.map(([name, rows]) => {
          const totalH = rows.reduce((s, r) => s + (r.hours_worked ?? 0), 0);
          const totalCost = rows.reduce((s, r) => s + (r.total_cost ?? 0), 0);
          const occH = rows.filter((r) => r.source === 'occasionnel').reduce((s, r) => s + (r.hours_worked ?? 0), 0);
          return (
            <div key={name} className="overflow-hidden rounded-xl border border-pr-stone bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-pr-stone p-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-pr-black text-sm font-medium text-pr-white">
                    {name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                  </span>
                  <span className="font-medium text-pr-black">{name}</span>
                </div>
                <div className="flex gap-6 text-center">
                  <Stat value={formatHours(totalH)} label="Total heures" />
                  {occH > 0 && <Stat value={formatHours(occH)} label="Mise en place" tone="amber" />}
                  <Stat value={totalCost > 0 ? `${totalCost.toFixed(0)} €` : '—'} label="Coût HT" />
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-pr-stone text-xs text-pr-black-soft/50">
                      <th className="py-2 pl-4 text-left">Événement</th>
                      <th className="py-2 text-left">Mission</th>
                      <th className="py-2 text-right">Date</th>
                      <th className="py-2 text-right">Heures</th>
                      <th className="py-2 text-right">Taux</th>
                      <th className="py-2 text-right">Coût</th>
                      <th className="py-2 pr-4 text-right">Type</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-pr-stone/60">
                    {rows.map((r, i) => (
                      <tr key={i} className="hover:bg-pr-cream/40">
                        <td className="py-2 pl-4 font-medium text-pr-black">{r.event_name}</td>
                        <td className="py-2 text-xs capitalize text-pr-black-soft/60">{r.mission?.replace('_', ' ') ?? '—'}</td>
                        <td className="py-2 text-right text-xs text-pr-black-soft/50">{frDate(r.event_date)}</td>
                        <td className="py-2 text-right font-medium">{formatHours(r.hours_worked)}</td>
                        <td className="py-2 text-right text-pr-black-soft/50">{r.hourly_rate != null ? `${r.hourly_rate} €/h` : '—'}</td>
                        <td className="py-2 text-right">{r.total_cost != null && r.total_cost > 0 ? `${r.total_cost.toFixed(2)} €` : '—'}</td>
                        <td className="py-2 pr-4 text-right">
                          <Badge tone={r.source === 'occasionnel' ? 'warning' : 'neutral'}>
                            {r.source === 'occasionnel' ? 'Mise en place' : 'Planifié'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-pr-stone text-sm font-semibold">
                      <td colSpan={3} className="py-2 pl-4 text-pr-black">Total {name}</td>
                      <td className="py-2 text-right">{formatHours(totalH)}</td>
                      <td />
                      <td className="py-2 text-right">{totalCost > 0 ? `${totalCost.toFixed(2)} €` : '—'}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          );
        })
      )}

      {addOpen && <AddOccasionalModal onClose={() => setAddOpen(false)} />}
    </div>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: 'amber' }) {
  return (
    <div>
      <p className={`font-display text-xl font-black ${tone === 'amber' ? 'text-amber-600' : 'text-pr-black'}`}>{value}</p>
      <p className="text-xs text-pr-black-soft/50">{label}</p>
    </div>
  );
}

/* ─────────────── Saisie d'heures occasionnelles ─────────────── */

function AddOccasionalModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ staff_name: '', mission_type: 'mise_en_place', work_date: new Date().toLocaleDateString('en-CA'), hours_worked: '', hourly_rate: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (form.staff_name.trim().length < 2) return setError('Nom requis.');
    const h = Number(form.hours_worked);
    if (!Number.isFinite(h) || h <= 0) return setError('Heures invalides.');
    setSaving(true);
    const { error: err } = await supabase.from('occasional_hours').insert({
      staff_name: form.staff_name.trim(),
      mission_type: form.mission_type,
      work_date: form.work_date,
      hours_worked: h,
      hourly_rate: form.hourly_rate ? Number(form.hourly_rate) : null,
      created_by: user?.name ?? 'Stade',
    });
    setSaving(false);
    if (err) {
      setError(/does not exist|schema cache/i.test(err.message) ? 'Table non provisionnée (applique occasional_hours.sql).' : err.message);
      return;
    }
    showToast('Heures enregistrées.', 'success');
    void qc.invalidateQueries({ queryKey: ['agentHoursCumulative'] });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-black text-pr-black">Heures occasionnelles</h2>
          <button onClick={onClose} aria-label="Fermer" className="text-pr-black-soft/40 hover:text-pr-black"><X className="h-5 w-5" /></button>
        </div>
        {error && <Alert variant="error" className="mb-3">{error}</Alert>}
        <div className="space-y-3">
          <Input label="Agent *" value={form.staff_name} onChange={(e) => setForm({ ...form, staff_name: e.target.value })} placeholder="Prénom NOM" />
          <Select label="Mission" options={MISSIONS.map((m) => ({ value: m, label: m.replace('_', ' ') }))} value={form.mission_type} onChange={(e) => setForm({ ...form, mission_type: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input type="date" label="Date" value={form.work_date} onChange={(e) => setForm({ ...form, work_date: e.target.value })} />
            <Input type="number" min="0" step="0.5" label="Heures *" value={form.hours_worked} onChange={(e) => setForm({ ...form, hours_worked: e.target.value })} />
          </div>
          <Input type="number" min="0" step="0.5" label="Taux €/h" value={form.hourly_rate} onChange={(e) => setForm({ ...form, hourly_rate: e.target.value })} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button loading={saving} onClick={save}>Enregistrer</Button>
        </div>
      </div>
    </div>
  );
}
