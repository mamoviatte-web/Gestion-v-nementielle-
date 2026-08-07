import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Zap, ChevronRight, AlertTriangle } from 'lucide-react';
import { useRunnerPlanning } from '@/hooks/useRunnerPlanning';
import { useEventsList } from '@/hooks/useEvents';
import {
  WEATHER_LABELS,
  TREND_LABELS,
  RUNNER_STATUS_LABELS,
} from '@/lib/runnerCalculations';
import { getAttendanceCoeff } from '@/lib/runnerCalculations';
import { formatEuro } from '@/lib/calculations';
import { Alert, Badge, Button, EmptyState, Spinner } from '@/components/ui';
import type { EventSpaceWithSpace } from '@/hooks/useEvents';
import type { Event, RunnerPlanWithDetails } from '@/lib/types';

export function RunnerPlanningTab({
  event,
  spaces,
  onOpenModal,
}: {
  event: Event;
  spaces: EventSpaceWithSpace[];
  onOpenModal: () => void;
}) {
  const { plans, kpis } = useRunnerPlanning(event.event_id);
  const events = useEventsList();

  const referenceName = useMemo(() => {
    if (!event.reference_event_id) return null;
    return (
      (events.data ?? []).find((e) => e.event_id === event.reference_event_id)
        ?.event_name ?? null
    );
  }, [event.reference_event_id, events.data]);

  const bySpace = useMemo(() => {
    const map = new Map<string, RunnerPlanWithDetails[]>();
    for (const p of plans.data ?? []) {
      const arr = map.get(p.space_id) ?? [];
      arr.push(p);
      map.set(p.space_id, arr);
    }
    return map;
  }, [plans.data]);

  // Les buvettes (B1→B9) ont leur propre runner piloté par le CDC + la conso
  // réelle (onglet « 🍺 Runner Buvettes »). On les exclut de l'estimateur
  // générique ici pour éviter la double source et les espaces superviseurs.
  const nonBuvetteSpaces = useMemo(
    () => spaces.filter((s) => s.spaces?.service_type !== 'buvette'),
    [spaces],
  );

  if (plans.isLoading) return <Spinner fullPage label="Chargement…" />;

  const list = plans.data ?? [];
  if (list.length === 0) {
    return (
      <EmptyState
        icon={Zap}
        title="Aucune fiche runner générée"
        message="Lancez la génération automatique des dotations à partir de l'historique et du contexte."
        action={
          <Button onClick={onOpenModal}>
            <Zap className="h-4 w-4" /> Générer les dotations runner
          </Button>
        }
      />
    );
  }

  const attendanceCoeff = getAttendanceCoeff(event.expected_attendees ?? 0);

  return (
    <div className="space-y-4">
      {/* Paramètres de génération */}
      <div className="rounded-lg bg-slate-50 p-4 text-sm ring-1 ring-slate-200">
        <p className="mb-2 font-semibold text-slate-700">📊 Paramètres de génération</p>
        <ul className="grid grid-cols-1 gap-1 text-slate-600 sm:grid-cols-2">
          <li>Affluence : {event.expected_attendees ?? '—'} spect. (coeff ×{attendanceCoeff.toFixed(2)})</li>
          <li>Météo : {event.weather_type ? WEATHER_LABELS[event.weather_type] : '—'}</li>
          <li>Tendance : {event.consumption_trend ? TREND_LABELS[event.consumption_trend] : '—'}</li>
          <li>Référence : {referenceName ?? '—'}</li>
        </ul>
        <div className="mt-3">
          <Button size="sm" variant="secondary" onClick={onOpenModal}>
            <Zap className="h-4 w-4" /> Régénérer
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Lignes" value={`${kpis.validated}/${kpis.totalLines} validées`} />
        <Kpi label="Stock suffisant" value={String(kpis.sufficient)} />
        <Kpi label="Alertes" value={String(kpis.alerts)} tone={kpis.alerts ? 'danger' : 'neutral'} />
        <Kpi label="Coût estimé HT" value={formatEuro(kpis.estimatedCostHT)} />
      </div>

      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-amber-200">
        🍺 Les buvettes (B1→B9) sont gérées dans l'onglet <strong>« Runner Buvettes »</strong> (dotations réelles pilotées par le CDC).
      </p>

      {/* Cards par espace (hors buvettes) */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {nonBuvetteSpaces
          .filter((s) => bySpace.has(s.space_id))
          .map((s) => {
            const rows = bySpace.get(s.space_id) ?? [];
            const validated = rows.filter((r) =>
              ['validé', 'transmis_runners', 'préparé', 'livré', 'retour_saisi', 'clôturé'].includes(
                r.validation_status,
              ),
            ).length;
            const cost = rows.reduce((sum, r) => sum + (r.estimated_cost_ht ?? 0), 0);
            const status = rows[0]?.validation_status ?? 'brouillon';
            const pct = rows.length ? Math.round((validated / rows.length) * 100) : 0;
            return (
              <div key={s.space_id} className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-slate-900">
                    {s.spaces?.space_name ?? s.space_id}
                  </p>
                  <Badge tone="info">{RUNNER_STATUS_LABELS[status]}</Badge>
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {rows.length} produit(s) · Coût estimé {formatEuro(cost)}
                </p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full bg-provence" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1 text-xs text-slate-400">{validated}/{rows.length} validées</p>
                <div className="mt-3">
                  <Link
                    to={`/admin/events/${event.event_id}/runner/${s.space_id}`}
                    className="inline-flex items-center gap-1 text-sm font-medium text-provence hover:underline"
                  >
                    Voir détail <ChevronRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            );
          })}
      </div>

      {kpis.alerts > 0 && (
        <Alert variant="warning" title={`${kpis.alerts} alerte(s) de dotation`}>
          <AlertTriangle className="mr-1 inline h-4 w-4" />
          Vérifiez les lignes en rupture ou surdotation dans le détail des espaces.
        </Alert>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'danger';
}) {
  return (
    <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${tone === 'danger' ? 'text-red-600' : 'text-provence'}`}>
        {value}
      </p>
    </div>
  );
}
