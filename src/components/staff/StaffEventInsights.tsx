/**
 * StaffEventInsights — Analyse RH d'un seul événement (ROLE_STADE).
 * Intégré en bas de l'onglet « Horaires Staff » du détail d'un événement.
 * Affiche : score d'efficacité, comparaison avec l'événement précédent du
 * même type, alertes RH et une recommandation générée.
 */

import { useMemo } from 'react';
import {
  Users,
  Clock,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Gauge,
} from 'lucide-react';
import {
  Alert,
  Badge,
  EmptyState,
  Spinner,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
} from '@/components/ui';
import {
  useEventStaffSummary,
  useEventStaffHours,
  useStaffSummaries,
} from '@/hooks/useStaffAnalytics';
import type {
  Event,
  StaffEventSummary,
  StaffAlert,
  StatusTone,
} from '@/lib/types';

type BadgeTone = StatusTone;

/** Tonalité d'un score d'efficacité (0..1). */
function scoreTone(score: number | null): BadgeTone {
  if (score === null) return 'neutral';
  if (score >= 0.9) return 'success';
  if (score >= 0.75) return 'warning';
  return 'danger';
}

/** Tonalité d'un encart selon la sévérité d'une alerte. */
function severityVariant(
  severity: StaffAlert['severity'],
): 'info' | 'warning' | 'error' {
  if (severity === 'critical') return 'error';
  if (severity === 'warning') return 'warning';
  return 'info';
}

/** Traduction française des types d'alerte horaire (RPC). */
const ALERT_TYPE_FR: Record<string, string> = {
  heures_sup_importantes: 'Heures sup importantes',
  depart_premature: 'Départ prématuré',
  depart_non_saisi: 'Départ non saisi',
};

function alertTypeFr(type: string): string {
  return ALERT_TYPE_FR[type] ?? type;
}

/** Carte métrique compacte. */
function MetricChip({
  icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: BadgeTone;
}) {
  return (
    <div className="flex min-w-[140px] flex-1 items-center gap-3 rounded-lg bg-pr-cream px-3 py-2 ring-1 ring-pr-stone">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-pr-olive/10 text-pr-olive-dark">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs text-pr-black-soft">{label}</p>
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-pr-black">{value}</span>
          {tone !== 'neutral' && <Badge tone={tone}>●</Badge>}
        </div>
      </div>
    </div>
  );
}

/** Flèche de tendance + delta chiffré. */
function Trend({
  current,
  previous,
  digits = 0,
  suffix = '',
  higherIsBetter = true,
}: {
  current: number;
  previous: number;
  digits?: number;
  suffix?: string;
  higherIsBetter?: boolean;
}) {
  const delta = current - previous;
  const up = delta > 0;
  const good = higherIsBetter ? up : !up;
  if (Math.abs(delta) < 10 ** -digits / 2) {
    return <span className="text-pr-black-soft">= 0{suffix}</span>;
  }
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={
        good ? 'inline-flex items-center gap-1 text-pr-olive-dark'
             : 'inline-flex items-center gap-1 text-pr-rust'
      }
    >
      <Icon className="h-4 w-4" aria-hidden />
      {up ? '+' : ''}
      {delta.toFixed(digits)}
      {suffix}
    </span>
  );
}

/** Recommandation générée à partir des indicateurs RH. */
function buildRecommendation(
  summary: StaffEventSummary,
  prematureCount: number,
): string {
  if (summary.has_overstaffing || prematureCount >= 2) {
    return 'Réduire le staff ou ajuster les horaires de fin dans les espaces concernés.';
  }
  if (summary.has_significant_overtime) {
    return 'Revoir les horaires prévus à la hausse pour les rôles en heures sup.';
  }
  return 'Dimensionnement cohérent — reconduire à l’identique.';
}

export function StaffEventInsights({ event }: { event: Event }) {
  const { data: summary, isLoading } = useEventStaffSummary(event.event_id);
  const { data: hours } = useEventStaffHours(event.event_id);
  const { data: allSummaries } = useStaffSummaries();

  const previous = useMemo<StaffEventSummary | null>(() => {
    if (!allSummaries) return null;
    const candidates = allSummaries.filter(
      (s) =>
        s.event_id !== event.event_id &&
        s.event_type === event.event_type &&
        s.event?.event_date != null &&
        s.event.event_date < event.event_date,
    );
    candidates.sort((a, b) =>
      (b.event?.event_date ?? '').localeCompare(a.event?.event_date ?? ''),
    );
    return candidates[0] ?? null;
  }, [allSummaries, event.event_id, event.event_type, event.event_date]);

  const hoursAlerts = useMemo(
    () => (hours ?? []).filter((h) => h.alert_type !== null),
    [hours],
  );

  const prematureCount = useMemo(
    () => hoursAlerts.filter((h) => h.alert_type === 'depart_premature').length,
    [hoursAlerts],
  );

  const title = (
    <h3 className="font-display text-lg font-semibold text-pr-black">
      🕐 Analyse RH de l’événement
    </h3>
  );

  if (isLoading) {
    return (
      <section className="space-y-3">
        {title}
        <Spinner label="Analyse RH…" />
      </section>
    );
  }

  if (!summary) {
    return (
      <section className="space-y-3">
        {title}
        <Alert variant="info" title="Analyse RH indisponible">
          Le résumé RH est calculé automatiquement à la clôture de l’événement
          (ou dès que des horaires staff sont saisis).
        </Alert>
      </section>
    );
  }

  const efficiencyPct =
    summary.efficiency_score !== null
      ? `${(summary.efficiency_score * 100).toFixed(0)} %`
      : '—';

  return (
    <section className="space-y-6">
      {title}

      {/* 1. Métriques compactes */}
      <div className="flex flex-wrap gap-2">
        <MetricChip
          icon={<Gauge className="h-4 w-4" aria-hidden />}
          label="Score d’efficacité"
          value={efficiencyPct}
          tone={scoreTone(summary.efficiency_score)}
        />
        <MetricChip
          icon={<Users className="h-4 w-4" aria-hidden />}
          label="Agents"
          value={String(summary.total_agents)}
        />
        <MetricChip
          icon={<Clock className="h-4 w-4" aria-hidden />}
          label="Heures réelles / prévues"
          value={`${summary.total_actual_hours.toFixed(0)}h / ${summary.total_planned_hours.toFixed(0)}h`}
        />
        <MetricChip
          icon={<AlertTriangle className="h-4 w-4" aria-hidden />}
          label="Heures sup"
          value={`${summary.total_overtime_hours.toFixed(1)}h · ${summary.total_overtime_agents} agent(s)`}
          tone={summary.has_significant_overtime ? 'warning' : 'neutral'}
        />
        <MetricChip
          icon={<Users className="h-4 w-4" aria-hidden />}
          label="Ratio agents / 100 pax"
          value={summary.agents_per_100pax?.toFixed(2) ?? '—'}
        />
      </div>

      {/* 2. Comparaison événement précédent */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-pr-black">
          Comparaison avec l’événement précédent du même type
        </h4>
        {previous ? (
          <Table>
            <THead>
              <TR>
                <TH>Indicateur</TH>
                <TH className="text-right">Cet événement</TH>
                <TH className="text-right">Précédent</TH>
                <TH className="text-right">Tendance</TH>
              </TR>
            </THead>
            <TBody>
              <TR>
                <TD>Total agents</TD>
                <TD className="text-right">{summary.total_agents}</TD>
                <TD className="text-right">{previous.total_agents}</TD>
                <TD className="text-right">
                  <Trend
                    current={summary.total_agents}
                    previous={previous.total_agents}
                    higherIsBetter={false}
                  />
                </TD>
              </TR>
              <TR>
                <TD>Heures totales</TD>
                <TD className="text-right">
                  {summary.total_actual_hours.toFixed(0)}h
                </TD>
                <TD className="text-right">
                  {previous.total_actual_hours.toFixed(0)}h
                </TD>
                <TD className="text-right">
                  <Trend
                    current={summary.total_actual_hours}
                    previous={previous.total_actual_hours}
                    suffix="h"
                    higherIsBetter={false}
                  />
                </TD>
              </TR>
              <TR>
                <TD>Heures sup</TD>
                <TD className="text-right">
                  {summary.total_overtime_hours.toFixed(1)}h
                </TD>
                <TD className="text-right">
                  {previous.total_overtime_hours.toFixed(1)}h
                </TD>
                <TD className="text-right">
                  <Trend
                    current={summary.total_overtime_hours}
                    previous={previous.total_overtime_hours}
                    digits={1}
                    suffix="h"
                    higherIsBetter={false}
                  />
                </TD>
              </TR>
              <TR>
                <TD>Efficacité</TD>
                <TD className="text-right">
                  {summary.efficiency_score !== null
                    ? `${(summary.efficiency_score * 100).toFixed(0)} %`
                    : '—'}
                </TD>
                <TD className="text-right">
                  {previous.efficiency_score !== null
                    ? `${(previous.efficiency_score * 100).toFixed(0)} %`
                    : '—'}
                </TD>
                <TD className="text-right">
                  {summary.efficiency_score !== null &&
                  previous.efficiency_score !== null ? (
                    <Trend
                      current={summary.efficiency_score * 100}
                      previous={previous.efficiency_score * 100}
                      suffix=" pts"
                      higherIsBetter
                    />
                  ) : (
                    <span className="text-pr-black-soft">—</span>
                  )}
                </TD>
              </TR>
            </TBody>
          </Table>
        ) : (
          <p className="text-sm text-pr-black-soft">
            Premier événement de ce type — pas de comparaison disponible.
          </p>
        )}
      </div>

      {/* 3. Alertes RH */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-pr-black">Alertes RH</h4>
        {summary.alert_details && summary.alert_details.length > 0 ? (
          <div className="space-y-2">
            {summary.alert_details.map((a, i) => (
              <Alert
                key={`${a.space}-${a.role}-${i}`}
                variant={severityVariant(a.severity)}
                title={`${a.space} · ${a.role}`}
              >
                {a.detail}
              </Alert>
            ))}
          </div>
        ) : summary.has_significant_overtime ? (
          <Alert variant="warning" title="Heures supplémentaires">
            Heures supplémentaires significatives détectées.
          </Alert>
        ) : (
          <p className="text-sm text-pr-black-soft">
            Aucune alerte RH sur cet événement.
          </p>
        )}

        {hoursAlerts.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm text-pr-black-soft">
            {hoursAlerts.map((h) => (
              <li key={h.schedule_id} className="flex items-center gap-2">
                <AlertTriangle
                  className="h-4 w-4 flex-shrink-0 text-pr-rust"
                  aria-hidden
                />
                <span className="text-pr-black">{h.staff_name}</span>
                <span>· {h.role_name}</span>
                <span>· {h.space_name}</span>
                <Badge tone="warning">
                  {alertTypeFr(h.alert_type as string)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 4. Recommandation */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-pr-black">
          Recommandation pour le prochain événement similaire
        </h4>
        {hours && hours.length === 0 && !summary.alert_details ? (
          <EmptyState
            icon={Users}
            title="Pas encore de données"
            message="Saisissez des horaires staff pour affiner les recommandations."
          />
        ) : (
          <p className="rounded-lg bg-pr-olive/5 px-3 py-2 text-sm text-pr-black ring-1 ring-pr-olive/20">
            {buildRecommendation(summary, prematureCount)}
          </p>
        )}
      </div>
    </section>
  );
}
