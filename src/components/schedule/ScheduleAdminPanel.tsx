import { useMemo, useState } from 'react';
import { UserPlus, Check, X } from 'lucide-react';
import { useSchedules, type NewSchedule } from '@/hooks/useSchedules';
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
  const { schedules, addSchedule, submitting } = useSchedules(eventId, spaceId);
  const [form, setForm] = useState(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        <div className="space-y-3 rounded-lg bg-white p-4 ring-1 ring-slate-200">
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
                  <TD className="font-medium text-slate-900">{s.staff_name}</TD>
                  <TD>{s.role ?? '—'}</TD>
                  <TD>{s.planned_arrival?.slice(0, 5) ?? '—'}</TD>
                  <TD>{s.planned_departure?.slice(0, 5) ?? '—'}</TD>
                  <TD>{s.actual_departure?.slice(0, 5) ?? '—'}</TD>
                  <TD className="text-right">{hours === null ? '—' : formatHours(hours)}</TD>
                  <TD>{s.confirmed_by_staff ? <Check className="h-4 w-4 text-emerald-600" /> : <X className="h-4 w-4 text-slate-300" />}</TD>
                  <TD>{s.confirmed_by_manager ? <Check className="h-4 w-4 text-emerald-600" /> : <X className="h-4 w-4 text-slate-300" />}</TD>
                </TR>
              );
            })}
          </TBody>
          <TFoot>
            <TR>
              <TD className="font-semibold">Total</TD>
              <TD /><TD /><TD /><TD />
              <TD className="text-right font-semibold">{formatHours(totalHours)}</TD>
              <TD /><TD />
            </TR>
          </TFoot>
        </Table>
      )}
    </div>
  );
}
