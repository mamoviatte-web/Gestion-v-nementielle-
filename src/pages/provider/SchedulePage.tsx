/**
 * SchedulePage (Responsable) — horaires des agents de l'espace.
 * Pour chaque agent : saisie du départ réel, confirmations employé/responsable,
 * calcul automatique des heures (passage minuit géré).
 */

import { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Check, Clock } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useOpenEventsForSpace } from '@/hooks/useEvents';
import { useSchedules } from '@/hooks/useSchedules';
import { computeHoursWorked, formatHours } from '@/lib/calculations';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Input,
  Spinner,
} from '@/components/ui';

export default function SchedulePage() {
  const { user, responsableName } = useAuth();
  const spaceId = user?.spaceId;

  if (!responsableName) return <Navigate to="/provider/home" replace />;
  if (!spaceId) {
    return (
      <Alert variant="warning" title="Espace non rattaché">
        Votre compte n'est rattaché à aucun espace.
      </Alert>
    );
  }
  return <ScheduleContent spaceId={spaceId} />;
}

function ScheduleContent({ spaceId }: { spaceId: string }) {
  const eventsQuery = useOpenEventsForSpace(spaceId);
  const event = (eventsQuery.data ?? [])[0] ?? null;
  const { schedules, updateDeparture, setConfirm, submitting } = useSchedules(
    event?.event_id,
    spaceId,
  );
  const [departure, setDeparture] = useState<Record<string, string>>({});

  const list = schedules.data ?? [];
  const totalHours = useMemo(
    () =>
      list.reduce((sum, s) => {
        if (!s.planned_arrival || !s.actual_departure) return sum;
        return sum + (computeHoursWorked(s.planned_arrival, s.actual_departure) ?? 0);
      }, 0),
    [list],
  );
  const allEntered = list.length > 0 && list.every((s) => s.actual_departure);

  if (eventsQuery.isLoading || schedules.isLoading)
    return <Spinner fullPage label="Chargement…" />;
  if (!event) {
    return (
      <EmptyState
        icon={Clock}
        title="Aucun événement ouvert"
        message="Aucun événement n'est actuellement ouvert pour votre espace."
      />
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Horaires" description={event.event_name} />

      {list.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="Aucun agent planifié"
          message="L'équipe Stade n'a pas encore planifié d'agent pour votre espace."
        />
      ) : (
        <div className="space-y-3">
          {list.map((s) => {
            const hours =
              s.planned_arrival && s.actual_departure
                ? computeHoursWorked(s.planned_arrival, s.actual_departure)
                : null;
            return (
              <div
                key={s.schedule_id}
                className="space-y-2 rounded-lg bg-white p-4 ring-1 ring-slate-200"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-slate-900">{s.staff_name}</p>
                    <p className="text-xs text-slate-500">
                      {s.role ?? 'Agent'} · Arr. {s.planned_arrival?.slice(0, 5) ?? '—'} ·
                      Dép. prévu {s.planned_departure?.slice(0, 5) ?? '—'}
                    </p>
                  </div>
                  {hours !== null && <Badge tone="info">{formatHours(hours)}</Badge>}
                </div>

                {!s.actual_departure ? (
                  <div className="flex items-end gap-2">
                    <Input
                      type="time"
                      label="Départ réel"
                      value={departure[s.schedule_id] ?? ''}
                      onChange={(e) =>
                        setDeparture((prev) => ({
                          ...prev,
                          [s.schedule_id]: e.target.value,
                        }))
                      }
                    />
                    <Button
                      size="sm"
                      disabled={submitting || !departure[s.schedule_id]}
                      onClick={() =>
                        void updateDeparture(s.schedule_id, departure[s.schedule_id])
                      }
                    >
                      Enregistrer
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={s.confirmed_by_staff ? 'primary' : 'secondary'}
                      disabled={submitting || s.confirmed_by_staff}
                      onClick={() =>
                        void setConfirm(s.schedule_id, { confirmed_by_staff: true })
                      }
                    >
                      <Check className="h-4 w-4" /> Confirmer employé
                    </Button>
                    <Button
                      size="sm"
                      variant={s.confirmed_by_manager ? 'primary' : 'secondary'}
                      disabled={submitting || s.confirmed_by_manager}
                      onClick={() =>
                        void setConfirm(s.schedule_id, { confirmed_by_manager: true })
                      }
                    >
                      <Check className="h-4 w-4" /> Valider responsable
                    </Button>
                  </div>
                )}
              </div>
            );
          })}

          {allEntered && (
            <Alert variant="success" title="Tous les départs sont saisis">
              Total heures travaillées : <strong>{formatHours(totalHours)}</strong>
            </Alert>
          )}
        </div>
      )}
    </div>
  );
}
