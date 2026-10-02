import { useMemo, useState } from 'react';
import { UserPlus, Check, X, Pencil } from 'lucide-react';
import { useSchedules, type NewSchedule } from '@/hooks/useSchedules';
import type { Schedule } from '@/lib/types';
import { computeHoursWorked, formatHours } from '@/lib/calculations';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  Alert,
  Button,
  EmptyState,
  Input,
  Spinner,
  Table,
  TBody,
  TD,
  TFoot,
  TH,
  THead,
  TR,
} from '@/components/ui';
import { Clock } from 'lucide-react';

const EMPTY = { staff_name: '', role: '', planned_arrival: '', planned_departure: '' };

export function ScheduleAdminPanel({
  eventId,
  spaceId,
}: {
  eventId: string;
  spaceId: string;
}) {
  const { schedules, addSchedule, updateSchedule, submitting } = useSchedules(eventId, spaceId);
  const [form, setForm] = useState(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<Schedule | null>(null);

  const list = schedules.data ?? [];
  const totalHours = useMemo(
    () =>
      list.reduce((sum, s) => {
        if (!s.planned_arrival || !s.actual_departure) return sum;
        return sum + (computeHoursWorked(s.planned_arrival, s.actual_departure) ?? 0);
      }, 0),
    [list],
  );

  async function handleAdd() {
    setError(null);
    if (!form.staff_name.trim()) {
      setError('Le nom de l\'agent est obligatoire.');
      return;
    }
    const payload: NewSchedule = {
      staff_name: form.staff_name,
      role: form.role,
      planned_arrival: form.planned_arrival,
      planned_departure: form.planned_departure,
    };
    try {
      await addSchedule(payload);
      setForm(EMPTY);
      setShowForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de l\'ajout.');
    }
  }

  if (schedules.isLoading) return <Spinner fullPage label="Chargement…" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <PageHeader title="Horaires staff" />
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          <UserPlus className="h-4 w-4" /> Ajouter un agent
        </Button>
      </div>

      {showForm && (
        <div className="space-y-3 rounded-lg bg-white p-4 ring-1 ring-pr-stone">
          {error && <Alert variant="error">{error}</Alert>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="Nom *"
              value={form.staff_name}
              onChange={(e) => setForm({ ...form, staff_name: e.target.value })}
            />
            <Input
              label="Poste"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            />
            <Input
              type="time"
              label="Arrivée prévue"
              value={form.planned_arrival}
              onChange={(e) => setForm({ ...form, planned_arrival: e.target.value })}
            />
            <Input
              type="time"
              label="Départ prévu"
              value={form.planned_departure}
              onChange={(e) => setForm({ ...form, planned_departure: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowForm(false)}>
              Annuler
            </Button>
            <Button loading={submitting} onClick={handleAdd}>
              Ajouter
            </Button>
          </div>
        </div>
      )}

      {list.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="Aucun agent planifié"
          message="Ajoutez les agents prévus pour cet espace."
        />
      ) : (
        <>
        {/* Mobile : liste en cartes (bouton Éditer visible sans scroll latéral). */}
        <div className="space-y-2 sm:hidden">
          {list.map((s) => {
            const hours =
              s.planned_arrival && s.actual_departure
                ? computeHoursWorked(s.planned_arrival, s.actual_departure)
                : null;
            return (
              <div key={s.schedule_id} className="rounded-xl border border-pr-stone bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-pr-black">{s.staff_name}</p>
                    <p className="text-xs text-pr-black-soft/50">{s.role ?? '—'}</p>
                  </div>
                  <button
                    onClick={() => setEditTarget(s)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-pr-cream px-3 py-2 text-xs font-semibold text-pr-black transition-colors hover:bg-pr-stone"
                    title="Corriger les horaires"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Éditer
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-2 text-center">
                  {[
                    { l: 'Arrivée', v: s.planned_arrival?.slice(0, 5) ?? '—' },
                    { l: 'Dép. prévu', v: s.planned_departure?.slice(0, 5) ?? '—' },
                    { l: 'Dép. réel', v: s.actual_departure?.slice(0, 5) ?? '—' },
                    { l: 'Heures', v: hours === null ? '—' : formatHours(hours) },
                  ].map((c) => (
                    <div key={c.l}>
                      <p className="text-[10px] uppercase tracking-wide text-pr-black-soft/40">{c.l}</p>
                      <p className="text-sm font-medium text-pr-black">{c.v}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-4 text-xs text-pr-black-soft/50">
                  <span className="inline-flex items-center gap-1">Emp. {s.confirmed_by_staff ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <X className="h-3.5 w-3.5 text-pr-black-soft/30" />}</span>
                  <span className="inline-flex items-center gap-1">Resp. {s.confirmed_by_manager ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <X className="h-3.5 w-3.5 text-pr-black-soft/30" />}</span>
                </div>
              </div>
            );
          })}
          <div className="flex items-center justify-between px-1 pt-1 text-sm font-semibold text-pr-black">
            <span>Total</span>
            <span>{formatHours(totalHours)}</span>
          </div>
        </div>

        {/* Ordinateur : table complète. */}
        <div className="hidden sm:block">
        <Table>
          <THead>
            <TR>
              <TH>Nom</TH>
              <TH>Poste</TH>
              <TH>Arr. prévue</TH>
              <TH>Dép. prévu</TH>
              <TH>Dép. réel</TH>
              <TH className="text-right">Heures</TH>
              <TH>✓ Emp.</TH>
              <TH>✓ Resp.</TH>
              <TH className="text-right">Éditer</TH>
            </TR>
          </THead>
          <TBody>
            {list.map((s) => {
              const hours =
                s.planned_arrival && s.actual_departure
                  ? computeHoursWorked(s.planned_arrival, s.actual_departure)
                  : null;
              return (
                <TR key={s.schedule_id}>
                  <TD className="font-medium text-pr-black">{s.staff_name}</TD>
                  <TD>{s.role ?? '—'}</TD>
                  <TD>{s.planned_arrival?.slice(0, 5) ?? '—'}</TD>
                  <TD>{s.planned_departure?.slice(0, 5) ?? '—'}</TD>
                  <TD>{s.actual_departure?.slice(0, 5) ?? '—'}</TD>
                  <TD className="text-right">{hours === null ? '—' : formatHours(hours)}</TD>
                  <TD>{s.confirmed_by_staff ? <Check className="h-4 w-4 text-emerald-600" /> : <X className="h-4 w-4 text-pr-black-soft/30" />}</TD>
                  <TD>{s.confirmed_by_manager ? <Check className="h-4 w-4 text-emerald-600" /> : <X className="h-4 w-4 text-pr-black-soft/30" />}</TD>
                  <TD className="text-right">
                    <button
                      onClick={() => setEditTarget(s)}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-pr-black-soft/60 transition-colors hover:bg-pr-cream hover:text-pr-black"
                      title="Corriger les horaires"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Éditer
                    </button>
                  </TD>
                </TR>
              );
            })}
          </TBody>
          <TFoot>
            <TR>
              <TD className="font-semibold">Total</TD>
              <TD /><TD /><TD /><TD />
              <TD className="text-right font-semibold">{formatHours(totalHours)}</TD>
              <TD /><TD /><TD />
            </TR>
          </TFoot>
        </Table>
        </div>
        </>
      )}

      {editTarget && (
        <EditScheduleModal
          schedule={editTarget}
          saving={submitting}
          onClose={() => setEditTarget(null)}
          onSave={async (fields) => {
            await updateSchedule(editTarget.schedule_id, fields);
            setEditTarget(null);
          }}
        />
      )}
    </div>
  );
}

/** Correction manuelle des horaires d'un agent/régisseur par l'équipe stade
 *  (arrivée prévue / départ prévu / départ réel). Un champ vidé repasse à NULL.
 *  Les heures/coûts sont recalculés automatiquement. RG-007 : format HH:MM. */
function EditScheduleModal({
  schedule,
  saving,
  onClose,
  onSave,
}: {
  schedule: Schedule;
  saving: boolean;
  onClose: () => void;
  onSave: (fields: Partial<Schedule>) => void;
}) {
  const hhmm = (t: string | null | undefined): string => (t ? t.slice(0, 5) : '');
  const [arr, setArr] = useState(hhmm(schedule.planned_arrival));
  const [depPlan, setDepPlan] = useState(hhmm(schedule.planned_departure));
  const [depReal, setDepReal] = useState(hhmm(schedule.actual_departure));
  const norm = (v: string): string | null => (v.trim() ? v.trim() : null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between">
          <h2 className="font-display text-lg font-black text-pr-black">Corriger les horaires</h2>
          <button onClick={onClose} aria-label="Fermer" className="text-pr-black-soft/40 hover:text-pr-black">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-4 text-sm text-pr-black-soft/60">
          {schedule.staff_name}
          {schedule.role ? ` — ${schedule.role}` : ''}. Les heures sont recalculées automatiquement.
        </p>
        <div className="space-y-3">
          <Input type="time" label="Arrivée prévue" value={arr} onChange={(e) => setArr(e.target.value)} />
          <Input type="time" label="Départ prévu" value={depPlan} onChange={(e) => setDepPlan(e.target.value)} />
          <Input type="time" label="Départ réel" value={depReal} onChange={(e) => setDepReal(e.target.value)} />
        </div>
        <Button
          fullWidth
          className="mt-4"
          loading={saving}
          onClick={() =>
            onSave({
              planned_arrival: norm(arr),
              planned_departure: norm(depPlan),
              actual_departure: norm(depReal),
            })
          }
        >
          Enregistrer les horaires
        </Button>
      </div>
    </div>
  );
}
