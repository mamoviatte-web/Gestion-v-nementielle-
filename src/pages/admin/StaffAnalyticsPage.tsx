/**
 * Staff & Horaires — Analyse RH (ROLE_STADE).
 * Dimensionnement, heures supplémentaires, efficacité par match / séminaire.
 * Réservé au ROLE_STADE (aucun coût produit exposé ici — uniquement du RH).
 */

import { useMemo, useState, type ReactNode } from 'react';
import {
  Plus,
  Users,
  Clock,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Download,
  Building2,
  Calendar,
  UserCheck,
  ChevronDown,
  ChevronRight,
  LineChart,
} from 'lucide-react';
import { downloadAoaWorkbook, type AoaCell } from '@/lib/xlsxAoa';
import { HOURS, DEC1, INT, type ColumnStyle } from '@/lib/excelTheme';
import {
  Badge,
  Button,
  Card,
  SectionTitle,
  Alert,
  EmptyState,
  Spinner,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
} from '@/components/ui';
import { TrendChart, type TrendPoint } from '@/components/ui/charts/TrendChart';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { useToast } from '@/context/ToastContext';
import {
  useStaffSummaries,
  useStaffAnalyticsRows,
  useStaffSchedules,
} from '@/hooks/useStaffAnalytics';
import {
  computeEfficiencyScore,
  VERDICT_META,
  type StaffVerdict,
} from '@/lib/staffTargets';
import { computeHours, computeOvertimeHours } from '@/lib/scheduleCalculations';
import { AgentCumulativeView } from '@/components/staff/AgentCumulativeView';
import { OccasionalHoursModal } from '@/components/staff/OccasionalHoursModal';
import type {
  ScheduleRow,
  StaffEventSummary,
  StaffAlert,
  SpaceType,
} from '@/lib/types';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Format Excel pour un pourcentage déjà exprimé en entier (0–100 → « 85 % »). */
const PCT_INT = '0" %"';

/** Date du jour au format YYYY-MM-DD (pour les noms de fichier). */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Heures prévues d'une ligne planning (passage minuit géré). */
function plannedH(row: ScheduleRow): number | null {
  return computeHours(row.planned_arrival, row.planned_departure);
}

/** Heures réelles (arrivée prévue → départ réel, passage minuit géré). */
function actualH(row: ScheduleRow): number | null {
  return computeHours(row.planned_arrival, row.actual_departure);
}

/** Heures supplémentaires (au-delà du prévu). */
function overtimeH(row: ScheduleRow): number {
  return computeOvertimeHours(plannedH(row), actualH(row));
}

function pct(v: number): string {
  return `${Math.round(v * 100)} %`;
}

function h1(v: number | null | undefined): string {
  return v == null ? '—' : `${v.toFixed(1)} h`;
}

function num1(v: number | null | undefined): string {
  return v == null ? '—' : v.toFixed(1);
}

function asSpaceType(t: string | null | undefined): SpaceType {
  return t === 'VIP' || t === 'Bar' || t === 'Buvette' ? t : 'Bar';
}

const SEVERITY_META: Record<
  StaffAlert['severity'],
  { label: string; tone: 'info' | 'warning' | 'danger'; box: string }
> = {
  critical: { label: 'Critique', tone: 'danger', box: 'border-pr-rust/40 bg-[#F1E0D7]/40' },
  warning: { label: 'Attention', tone: 'warning', box: 'border-[#E8D6A8] bg-[#F5EBD2]/40' },
  info: { label: 'Info', tone: 'info', box: 'border-pr-stone bg-pr-cream' },
};

const ISSUE_LABELS: Record<StaffAlert['issue'], string> = {
  heures_sup_importantes: 'Heures supplémentaires importantes',
  depart_premature: 'Départ prématuré',
  depart_non_saisi: 'Départ non saisi',
  surstaffing_espace: 'Sur-staffing espace',
};

type ViewKey = 'synthese' | 'agent' | 'espace' | 'evenement' | 'cumul' | 'alertes' | 'export';

const VIEWS: { key: ViewKey; label: string }[] = [
  { key: 'synthese', label: 'Synthèse' },
  { key: 'agent', label: 'Par agent' },
  { key: 'espace', label: 'Par espace' },
  { key: 'evenement', label: 'Par événement' },
  { key: 'cumul', label: 'Cumul agents' },
  { key: 'alertes', label: 'Alertes' },
  { key: 'export', label: 'Export' },
];

/* ------------------------------------------------------------------ */
/* Aggregations (shared)                                              */
/* ------------------------------------------------------------------ */

interface SpaceAgg {
  spaceId: string;
  spaceName: string;
  spaceType: SpaceType;
  agentsPerEvent: number;
  agentsPer100pax: number | null;
  plannedHours: number;
  actualHours: number;
}

/** Agrège les plannings par espace (moyennes par événement). */
function aggregateBySpace(schedules: ScheduleRow[]): SpaceAgg[] {
  const byKey = new Map<string, ScheduleRow[]>();
  for (const r of schedules) {
    const key = r.space_id ?? r.spaces?.space_id ?? 'inconnu';
    const arr = byKey.get(key) ?? [];
    arr.push(r);
    byKey.set(key, arr);
  }

  const result: SpaceAgg[] = [];
  for (const [spaceId, rows] of byKey) {
    const events = new Set(rows.map((r) => r.event_id));
    const nbEvents = Math.max(1, events.size);
    const agentsPerEvent = rows.length / nbEvents;

    // Ratio agents/100pax : moyenne des ratios par événement disposant d'une jauge.
    const ratios: number[] = [];
    for (const evId of events) {
      const evRows = rows.filter((r) => r.event_id === evId);
      const attendance = evRows[0]?.events?.expected_attendees ?? null;
      if (attendance && attendance > 0) {
        ratios.push((evRows.length / attendance) * 100);
      }
    }
    const agentsPer100pax = ratios.length
      ? ratios.reduce((a, b) => a + b, 0) / ratios.length
      : null;

    let plannedTot = 0;
    let actualTot = 0;
    for (const r of rows) {
      plannedTot += plannedH(r) ?? 0;
      actualTot += actualH(r) ?? 0;
    }

    result.push({
      spaceId,
      spaceName: rows[0]?.spaces?.space_name ?? 'Espace inconnu',
      spaceType: asSpaceType(rows[0]?.spaces?.space_type),
      agentsPerEvent,
      agentsPer100pax,
      plannedHours: plannedTot / nbEvents,
      actualHours: actualTot / nbEvents,
    });
  }
  return result.sort((a, b) => a.spaceName.localeCompare(b.spaceName, 'fr'));
}

interface RoleAgg {
  role: string;
  avgOvertime: number;
  people: number;
}

/** Agrège les heures sup par rôle (moyenne par personne). */
function aggregateByRole(schedules: ScheduleRow[]): RoleAgg[] {
  const byRole = new Map<string, ScheduleRow[]>();
  for (const r of schedules) {
    const role = r.role ?? 'Non renseigné';
    const arr = byRole.get(role) ?? [];
    arr.push(r);
    byRole.set(role, arr);
  }
  const result: RoleAgg[] = [];
  for (const [role, rows] of byRole) {
    const totalOt = rows.reduce((sum, r) => sum + overtimeH(r), 0);
    result.push({ role, avgOvertime: totalOt / rows.length, people: rows.length });
  }
  return result.sort((a, b) => b.avgOvertime - a.avgOvertime);
}

interface AgentAgg {
  name: string;
  role: string;
  nbEvents: number;
  avgHours: number | null;
  avgOvertime: number;
  hasMissingDeparture: boolean;
}

/** Agrège les plannings par agent (nom). */
function aggregateByAgent(schedules: ScheduleRow[]): AgentAgg[] {
  const byName = new Map<string, ScheduleRow[]>();
  for (const r of schedules) {
    const arr = byName.get(r.staff_name) ?? [];
    arr.push(r);
    byName.set(r.staff_name, arr);
  }
  const result: AgentAgg[] = [];
  for (const [name, rows] of byName) {
    const hours = rows.map(actualH).filter((v): v is number => v != null);
    const avgHours = hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : null;
    const avgOvertime = rows.reduce((s, r) => s + overtimeH(r), 0) / rows.length;
    result.push({
      name,
      role: rows[0]?.role ?? '—',
      nbEvents: new Set(rows.map((r) => r.event_id)).size,
      avgHours,
      avgOvertime,
      hasMissingDeparture: rows.some((r) => !r.actual_departure),
    });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                     */
/* ------------------------------------------------------------------ */

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-pr-stone bg-pr-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-pr-olive">
        <Icon className="h-4 w-4" aria-hidden />
        <span className="text-xs font-medium uppercase tracking-wide text-pr-black-soft">
          {label}
        </span>
      </div>
      <div className="mt-2 font-display text-2xl font-bold text-pr-black">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-pr-black-soft">{sub}</div>}
    </div>
  );
}

/** Barre horizontale simple (ratio 0..1 de fill). */
function Bar({ fill, tone }: { fill: number; tone: 'olive' | 'gold' | 'rust' }) {
  const color =
    tone === 'olive' ? 'bg-pr-olive' : tone === 'gold' ? 'bg-pr-gold' : 'bg-pr-rust';
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-pr-stone/50">
      <div
        className={`h-full rounded-full ${color}`}
        style={{ width: `${Math.max(2, Math.min(100, fill * 100))}%` }}
      />
    </div>
  );
}

/** Ventilation horizontale « top N » (façon Breakdown RH), triée décroissant. */
interface BreakItem {
  key: string;
  label: string;
  value: number;
  sub?: string;
}
function Breakdown({
  title,
  items,
  unit = 'h',
}: {
  title: string;
  items: BreakItem[];
  unit?: string;
}) {
  const max = Math.max(0.001, ...items.map((i) => i.value));
  return (
    <div className="overflow-hidden rounded-2xl border border-pr-stone bg-white">
      <div className="border-b border-pr-stone bg-pr-cream px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-pr-black-soft/50">
        {title}
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-4 text-sm text-pr-black-soft/40">Aucune donnée.</p>
      ) : (
        <div className="divide-y divide-pr-stone/50">
          {items.map((r) => (
            <div key={r.key} className="px-4 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-pr-black-soft/80">{r.label}</span>
                <span className="shrink-0 text-sm font-bold tabular-nums text-pr-olive-dark">
                  {r.value.toFixed(1)} {unit}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-pr-stone/50">
                  <div
                    className="h-full rounded-full bg-pr-olive"
                    style={{ width: `${(r.value / max) * 100}%` }}
                  />
                </div>
                {r.sub && (
                  <span className="shrink-0 text-[11px] text-pr-black-soft/40">{r.sub}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Bloc repliable pour une longue table nominative (détail ligne-à-ligne). */
function CollapsibleDetail({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-pr-stone bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 border-b border-pr-stone bg-pr-cream px-4 py-2.5 text-left transition-colors hover:bg-pr-stone/20"
      >
        <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-pr-black-soft/60">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {title}
          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-pr-black-soft/50">
            {count} ligne{count > 1 ? 's' : ''}
          </span>
        </span>
        <span className="hidden text-[11px] font-medium normal-case tracking-normal text-pr-black-soft/40 sm:inline">
          {open ? 'Masquer' : 'Afficher'} · détail complet dans l’export Excel ↑
        </span>
      </button>
      {open && children}
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: StaffVerdict }) {
  const meta = VERDICT_META[verdict];
  return (
    <Badge tone={meta.tone}>
      {meta.icon} {meta.label}
    </Badge>
  );
}

function trendArrow(current: number | null, previous: number | null) {
  if (current == null || previous == null) return null;
  if (current > previous) return <TrendingUp className="inline h-3.5 w-3.5 text-pr-rust" aria-hidden />;
  if (current < previous) return <TrendingDown className="inline h-3.5 w-3.5 text-pr-olive" aria-hidden />;
  return null;
}

/* ---- 1. Synthèse ---- */

function SyntheseView({
  summaries,
  schedules,
  eventType,
}: {
  summaries: StaffEventSummary[];
  schedules: ScheduleRow[];
  eventType: string;
}) {
  const kpis = useMemo(() => {
    if (summaries.length === 0) {
      return { avgAgents: 0, avgHoursAgent: 0, overtimeRate: 0, avgEfficiency: 0 };
    }
    const totalAgents = summaries.reduce((s, x) => s + x.total_agents, 0);
    const avgAgents = totalAgents / summaries.length;

    const hoursPerAgent = summaries
      .map((x) => x.hours_per_agent)
      .filter((v): v is number => v != null);
    const avgHoursAgent = hoursPerAgent.length
      ? hoursPerAgent.reduce((a, b) => a + b, 0) / hoursPerAgent.length
      : 0;

    const totalOt = summaries.reduce((s, x) => s + x.total_overtime_hours, 0);
    const totalPlanned = summaries.reduce((s, x) => s + x.total_planned_hours, 0);
    const overtimeRate = totalPlanned > 0 ? totalOt / totalPlanned : 0;

    const eff = summaries
      .map((x) => x.efficiency_score)
      .filter((v): v is number => v != null);
    const avgEfficiency = eff.length ? eff.reduce((a, b) => a + b, 0) / eff.length : 0;

    return { avgAgents, avgHoursAgent, overtimeRate, avgEfficiency };
  }, [summaries]);

  const spaceAggs = useMemo(() => aggregateBySpace(schedules), [schedules]);
  const roleAggs = useMemo(() => aggregateByRole(schedules), [schedules]);
  const maxOvertime = Math.max(0.001, ...roleAggs.map((r) => r.avgOvertime));

  // Tendance chronologique : heures prévues (référence) vs réelles par événement.
  const trendData = useMemo<TrendPoint[]>(
    () =>
      [...summaries]
        .filter((s) => s.event?.event_date)
        .sort((a, b) => (a.event?.event_date ?? '').localeCompare(b.event?.event_date ?? ''))
        .map((s) => ({
          label: s.event?.event_date
            ? new Date(s.event.event_date).toLocaleDateString('fr-FR', {
                day: '2-digit',
                month: 'short',
              })
            : '—',
          value: Number(s.total_actual_hours.toFixed(1)),
          ref: Number(s.total_planned_hours.toFixed(1)),
        })),
    [summaries],
  );

  if (summaries.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Aucune donnée RH"
        message="Aucun résumé RH n'a été calculé pour ce type d'événement."
      />
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={Users}
          label="Agents / événement"
          value={num1(kpis.avgAgents)}
          sub="moyenne"
        />
        <KpiCard
          icon={Clock}
          label="Heures / agent"
          value={h1(kpis.avgHoursAgent)}
          sub="moyenne"
        />
        <KpiCard
          icon={TrendingUp}
          label="Taux d'heures sup"
          value={pct(kpis.overtimeRate)}
          sub="sur heures prévues"
        />
        <KpiCard
          icon={UserCheck}
          label="Efficacité moyenne"
          value={pct(kpis.avgEfficiency)}
          sub="score dimensionnement"
        />
      </div>

      {trendData.length > 1 && (
        <Card>
          <SectionTitle
            icon={LineChart}
            right={<span className="text-xs text-pr-black-soft/40">heures · par événement</span>}
          >
            Heures prévues vs réelles
          </SectionTitle>
          <TrendChart
            data={trendData}
            height={210}
            format={(v) => `${v.toFixed(1)} h`}
            valueLabel="Heures réelles"
            refLabel="Heures prévues"
          />
        </Card>
      )}

      <section>
        <h2 className="mb-3 font-display text-lg font-semibold text-pr-black">
          Ratio agents / 100 pax par espace
        </h2>
        {spaceAggs.length === 0 ? (
          <p className="text-sm text-pr-black-soft">Aucun planning disponible.</p>
        ) : (
          <div className="space-y-3">
            {spaceAggs.map((sp) => {
              const eff =
                sp.agentsPer100pax != null
                  ? computeEfficiencyScore(sp.agentsPer100pax, eventType, sp.spaceType)
                  : null;
              return (
                <div
                  key={sp.spaceId}
                  className="rounded-lg border border-pr-stone bg-pr-white p-3"
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-pr-black">
                      {sp.spaceName}{' '}
                      <span className="text-pr-black-soft">({sp.spaceType})</span>
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-pr-black-soft">
                        {sp.agentsPer100pax != null ? sp.agentsPer100pax.toFixed(1) : '—'} /100pax
                      </span>
                      {eff && <VerdictBadge verdict={eff.verdict} />}
                    </div>
                  </div>
                  <Bar
                    fill={sp.agentsPer100pax != null ? sp.agentsPer100pax / 5 : 0}
                    tone={
                      eff?.verdict === 'overstaffed'
                        ? 'rust'
                        : eff?.verdict === 'understaffed'
                          ? 'gold'
                          : 'olive'
                    }
                  />
                  {eff && (
                    <div className="mt-1 text-xs text-pr-black-soft">
                      Cible {eff.target.toFixed(1)} · écart {eff.delta_pct >= 0 ? '+' : ''}
                      {Math.round(eff.delta_pct)} %
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-display text-lg font-semibold text-pr-black">
          Heures supplémentaires par rôle
        </h2>
        {roleAggs.length === 0 ? (
          <p className="text-sm text-pr-black-soft">Aucune donnée.</p>
        ) : (
          <div className="space-y-3">
            {roleAggs.map((r) => (
              <div key={r.role} className="rounded-lg border border-pr-stone bg-pr-white p-3">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-pr-black">{r.role}</span>
                  <span className="text-sm text-pr-black-soft">
                    {r.avgOvertime.toFixed(1)} h / personne
                  </span>
                </div>
                <Bar fill={r.avgOvertime / maxOvertime} tone="gold" />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ---- 2. Par agent ---- */

function AgentView({ schedules }: { schedules: ScheduleRow[] }) {
  const agents = useMemo(() => aggregateByAgent(schedules), [schedules]);
  const [showDetail, setShowDetail] = useState(false);

  const topOvertime = useMemo(
    () =>
      [...agents]
        .filter((a) => a.avgOvertime > 0)
        .sort((a, b) => b.avgOvertime - a.avgOvertime)
        .slice(0, 8),
    [agents],
  );
  const topHours = useMemo(
    () =>
      [...agents]
        .filter((a) => a.avgHours != null)
        .sort((a, b) => (b.avgHours ?? 0) - (a.avgHours ?? 0))
        .slice(0, 8),
    [agents],
  );

  const kpis = useMemo(() => {
    const withOvertime = agents.filter((a) => a.avgOvertime > 1).length;
    const missingDep = agents.filter((a) => a.hasMissingDeparture).length;
    const hours = agents.map((a) => a.avgHours).filter((v): v is number => v != null);
    const avgHours = hours.length ? hours.reduce((x, y) => x + y, 0) / hours.length : null;
    return { withOvertime, missingDep, avgHours };
  }, [agents]);

  if (agents.length === 0) {
    return (
      <EmptyState icon={Users} title="Aucun agent" message="Aucun planning staff enregistré." />
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Users} label="Agents distincts" value={String(agents.length)} />
        <KpiCard icon={Clock} label="Heures / agent" value={h1(kpis.avgHours)} sub="moyenne" />
        <KpiCard
          icon={TrendingUp}
          label="Agents en dépassement"
          value={String(kpis.withOvertime)}
          sub="> 1 h sup moyenne"
        />
        <KpiCard
          icon={AlertTriangle}
          label="Départs non saisis"
          value={String(kpis.missingDep)}
          sub="agents concernés"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Breakdown
          title="Top agents — heures sup (moy.)"
          items={topOvertime.map((a) => ({
            key: a.name,
            label: a.name,
            value: a.avgOvertime,
            sub: `${a.nbEvents} évén.`,
          }))}
        />
        <Breakdown
          title="Top agents — heures réelles (moy.)"
          items={topHours.map((a) => ({
            key: a.name,
            label: a.name,
            value: a.avgHours ?? 0,
            sub: a.role,
          }))}
        />
      </div>

      <CollapsibleDetail
        title="Détail nominatif par agent"
        count={agents.length}
        open={showDetail}
        onToggle={() => setShowDetail((v) => !v)}
      >
        <div className="overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>Agent</TH>
                <TH>Poste</TH>
                <TH className="text-right">Nb évén.</TH>
                <TH className="text-right">Moy. heures</TH>
                <TH className="text-right">Moy. sup</TH>
                <TH>Alertes</TH>
              </TR>
            </THead>
            <TBody>
              {agents.map((a) => (
                <TR key={a.name}>
                  <TD className="font-medium text-pr-black">{a.name}</TD>
                  <TD>{a.role}</TD>
                  <TD className="text-right">{a.nbEvents}</TD>
                  <TD className="text-right">{h1(a.avgHours)}</TD>
                  <TD className="text-right">{a.avgOvertime.toFixed(1)} h</TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {a.avgOvertime > 1 && <Badge tone="warning">⚠️ dépassements</Badge>}
                      {a.hasMissingDeparture && <Badge tone="info">départ non saisi</Badge>}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      </CollapsibleDetail>
    </div>
  );
}

/* ---- 3. Par espace ---- */

function recommendation(verdict: StaffVerdict): string {
  if (verdict === 'overstaffed') return "Réduire d'1 agent";
  if (verdict === 'understaffed') return '+1 agent en pic';
  return 'Pas de changement';
}

function EspaceView({
  schedules,
  eventType,
}: {
  schedules: ScheduleRow[];
  eventType: string;
}) {
  const spaceAggs = useMemo(() => aggregateBySpace(schedules), [schedules]);

  if (spaceAggs.length === 0) {
    return (
      <EmptyState
        icon={Building2}
        title="Aucun espace"
        message="Aucun planning n'est associé à un espace."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {spaceAggs.map((sp) => {
        const eff =
          sp.agentsPer100pax != null
            ? computeEfficiencyScore(sp.agentsPer100pax, eventType, sp.spaceType)
            : null;
        const ecart = sp.actualHours - sp.plannedHours;
        return (
          <div
            key={sp.spaceId}
            className="rounded-xl border border-pr-stone bg-pr-white p-4 shadow-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-base font-semibold text-pr-black">
                {sp.spaceName}
              </h3>
              <Badge tone="neutral">{sp.spaceType}</Badge>
            </div>

            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-pr-black-soft">Staff moyen</dt>
                <dd className="font-medium text-pr-black">
                  {num1(sp.agentsPerEvent)} agents / évén.
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-pr-black-soft">Ratio / 100 pax</dt>
                <dd className="font-medium text-pr-black">
                  {sp.agentsPer100pax != null ? sp.agentsPer100pax.toFixed(1) : '—'}
                  {eff && <span className="text-pr-black-soft"> (cible {eff.target.toFixed(1)})</span>}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-pr-black-soft">Heures prévu / réel</dt>
                <dd className="font-medium text-pr-black">
                  {h1(sp.plannedHours)} / {h1(sp.actualHours)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-pr-black-soft">Écart</dt>
                <dd className={`font-medium ${ecart > 0 ? 'text-pr-rust' : 'text-pr-olive'}`}>
                  {ecart >= 0 ? '+' : ''}
                  {ecart.toFixed(1)} h
                </dd>
              </div>
            </dl>

            <div className="mt-3 flex items-center justify-between gap-2">
              {eff ? <VerdictBadge verdict={eff.verdict} /> : <Badge tone="neutral">N/D</Badge>}
              <span className="text-xs text-pr-black-soft">
                {eff ? recommendation(eff.verdict) : 'Jauge manquante'}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---- 4. Par événement ---- */

function EvenementView({ summaries }: { summaries: StaffEventSummary[] }) {
  const [showDetail, setShowDetail] = useState(false);
  const rows = useMemo(
    () =>
      [...summaries].sort((a, b) => {
        const da = a.event?.event_date ?? '';
        const db = b.event?.event_date ?? '';
        return da.localeCompare(db);
      }),
    [summaries],
  );

  // Tendance : heures supplémentaires par événement (ordre chronologique).
  const otTrend = useMemo<TrendPoint[]>(
    () =>
      rows
        .filter((s) => s.event?.event_date)
        .map((s) => ({
          label: s.event?.event_date
            ? new Date(s.event.event_date).toLocaleDateString('fr-FR', {
                day: '2-digit',
                month: 'short',
              })
            : '—',
          value: Number(s.total_overtime_hours.toFixed(1)),
        })),
    [rows],
  );

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Calendar}
        title="Aucun événement"
        message="Aucun résumé RH par événement."
      />
    );
  }

  return (
    <div className="space-y-6">
      {otTrend.length > 1 && (
        <Card>
          <SectionTitle
            icon={LineChart}
            right={<span className="text-xs text-pr-black-soft/40">heures sup · par événement</span>}
          >
            Heures supplémentaires par événement
          </SectionTitle>
          <TrendChart
            data={otTrend}
            height={210}
            format={(v) => `${v.toFixed(1)} h`}
            valueLabel="Heures sup"
          />
        </Card>
      )}

      <CollapsibleDetail
        title="Détail par événement"
        count={rows.length}
        open={showDetail}
        onToggle={() => setShowDetail((v) => !v)}
      >
        <div className="overflow-x-auto">
          <Table>
            <THead>
        <TR>
          <TH>Événement</TH>
          <TH>Date</TH>
          <TH className="text-right">Spectateurs</TH>
          <TH className="text-right">Total agents</TH>
          <TH className="text-right">Heures totales</TH>
          <TH className="text-right">Heures sup</TH>
          <TH className="text-right">Agents / 100 pax</TH>
          <TH className="text-right">Efficacité</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((s, i) => {
          const prev = i > 0 ? rows[i - 1] : null;
          const date = s.event?.event_date
            ? new Date(s.event.event_date).toLocaleDateString('fr-FR')
            : '—';
          return (
            <TR key={s.event_id}>
              <TD className="font-medium text-pr-black">
                {s.event?.event_name ?? s.event_id}
              </TD>
              <TD>{date}</TD>
              <TD className="text-right">{s.real_attendance ?? '—'}</TD>
              <TD className="text-right">
                {s.total_agents} {trendArrow(s.total_agents, prev?.total_agents ?? null)}
              </TD>
              <TD className="text-right">{h1(s.total_actual_hours)}</TD>
              <TD className="text-right">
                {s.total_overtime_hours.toFixed(1)} h{' '}
                {trendArrow(s.total_overtime_hours, prev?.total_overtime_hours ?? null)}
              </TD>
              <TD className="text-right">
                {num1(s.agents_per_100pax)}{' '}
                {trendArrow(s.agents_per_100pax, prev?.agents_per_100pax ?? null)}
              </TD>
              <TD className="text-right">
                {s.efficiency_score != null ? pct(s.efficiency_score) : '—'}{' '}
                {trendArrow(s.efficiency_score, prev?.efficiency_score ?? null)}
              </TD>
            </TR>
          );
        })}
      </TBody>
          </Table>
        </div>
      </CollapsibleDetail>
    </div>
  );
}

/* ---- 5. Alertes ---- */

function AlertesView({ summaries }: { summaries: StaffEventSummary[] }) {
  const grouped = useMemo(() => {
    const flat: (StaffAlert & { eventName: string })[] = [];
    for (const s of summaries) {
      for (const a of s.alert_details ?? []) {
        flat.push({ ...a, eventName: s.event?.event_name ?? s.event_id });
      }
    }
    const order: StaffAlert['severity'][] = ['critical', 'warning', 'info'];
    return order
      .map((sev) => ({ sev, items: flat.filter((a) => a.severity === sev) }))
      .filter((g) => g.items.length > 0);
  }, [summaries]);

  if (grouped.length === 0) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Aucune alerte"
        message="Aucun signalement RH pour ce type d'événement."
      />
    );
  }

  return (
    <div className="space-y-6">
      {grouped.map((g) => {
        const meta = SEVERITY_META[g.sev];
        return (
          <section key={g.sev}>
            <div className="mb-2 flex items-center gap-2">
              <Badge tone={meta.tone}>{meta.label}</Badge>
              <span className="text-sm text-pr-black-soft">{g.items.length} alerte(s)</span>
            </div>
            <ul className="space-y-2">
              {g.items.map((a, idx) => (
                <li
                  key={`${g.sev}-${idx}`}
                  className={`rounded-lg border p-3 ${meta.box}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-pr-black">
                      {ISSUE_LABELS[a.issue]}
                    </span>
                    <Badge tone="neutral">{a.eventName}</Badge>
                    <span className="text-xs text-pr-black-soft">
                      {a.space} · {a.role}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-pr-black-soft">{a.detail}</p>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/* ---- 6. Export ---- */

function ExportView({
  summaries,
  schedules,
  matchSummaries,
  seminarSummaries,
  eventTypeLabel,
}: {
  summaries: StaffEventSummary[];
  schedules: ScheduleRow[];
  matchSummaries: StaffEventSummary[];
  seminarSummaries: StaffEventSummary[];
  eventTypeLabel: string;
}) {
  const { showToast } = useToast();

  const exportHours = async () => {
    // Feuille 1 — Synthèse par événement (habillée, ligne TOTAL).
    const synthAoa: AoaCell[][] = [
      [`PROVENCE RUGBY — SYNTHÈSE HORAIRES — ${eventTypeLabel} — ${today()}`],
      [],
      [
        'Événement',
        'Date',
        'Spectateurs',
        'Total agents',
        'Agents / 100 pax',
        'Heures prévues',
        'Heures réelles',
        'Heures sup',
        'Efficacité (%)',
      ],
    ];
    let sAgents = 0;
    let sPlanned = 0;
    let sActual = 0;
    let sOt = 0;
    for (const s of summaries) {
      sAgents += s.total_agents;
      sPlanned += s.total_planned_hours;
      sActual += s.total_actual_hours;
      sOt += s.total_overtime_hours;
      synthAoa.push([
        s.event?.event_name ?? s.event_id,
        s.event?.event_date ?? '',
        s.real_attendance ?? '',
        s.total_agents,
        s.agents_per_100pax != null ? Number(s.agents_per_100pax.toFixed(1)) : '',
        Number(s.total_planned_hours.toFixed(1)),
        Number(s.total_actual_hours.toFixed(1)),
        Number(s.total_overtime_hours.toFixed(1)),
        s.efficiency_score != null ? Math.round(s.efficiency_score * 100) : '',
      ]);
    }
    synthAoa.push([
      'TOTAL',
      '',
      '',
      sAgents,
      '',
      Number(sPlanned.toFixed(1)),
      Number(sActual.toFixed(1)),
      Number(sOt.toFixed(1)),
      '',
    ]);

    // Feuille 2 — Détail nominatif par agent (habillé, ligne TOTAL).
    const detailAoa: AoaCell[][] = [
      [`PROVENCE RUGBY — DÉTAIL HORAIRES PAR AGENT — ${eventTypeLabel} — ${today()}`],
      [],
      ['Événement', 'Agent', 'Poste', 'Espace', 'Heures prévues', 'Heures réelles', 'Heures sup'],
    ];
    let dPlanned = 0;
    let dActual = 0;
    let dOt = 0;
    for (const r of schedules) {
      const p = plannedH(r);
      const a = actualH(r);
      const o = overtimeH(r);
      dPlanned += p ?? 0;
      dActual += a ?? 0;
      dOt += o;
      detailAoa.push([
        r.events?.event_name ?? r.event_id,
        r.staff_name,
        r.role ?? '',
        r.spaces?.space_name ?? '',
        p != null ? Number(p.toFixed(2)) : '',
        a != null ? Number(a.toFixed(2)) : '',
        Number(o.toFixed(2)),
      ]);
    }
    detailAoa.push([
      'TOTAL',
      '',
      '',
      '',
      Number(dPlanned.toFixed(2)),
      Number(dActual.toFixed(2)),
      Number(dOt.toFixed(2)),
    ]);

    const synthCols: (ColumnStyle | undefined)[] = [
      undefined,
      { align: 'center' },
      { numFmt: INT, align: 'right' },
      { numFmt: INT, align: 'right' },
      { numFmt: DEC1, align: 'right' },
      { numFmt: HOURS, align: 'right' },
      { numFmt: HOURS, align: 'right' },
      { numFmt: HOURS, align: 'right' },
      { numFmt: PCT_INT, align: 'right' },
    ];
    const detailCols: (ColumnStyle | undefined)[] = [
      undefined,
      undefined,
      undefined,
      undefined,
      { numFmt: HOURS, align: 'right' },
      { numFmt: HOURS, align: 'right' },
      { numFmt: HOURS, align: 'right' },
    ];

    await downloadAoaWorkbook(
      [
        {
          name: 'Synthèse',
          aoa: synthAoa,
          widths: [26, 12, 12, 12, 15, 14, 14, 12, 13],
          columns: synthCols,
        },
        {
          name: 'Détail agents',
          aoa: detailAoa,
          widths: [24, 22, 16, 18, 14, 14, 10],
          columns: detailCols,
        },
      ],
      `Rapport_horaires_${eventTypeLabel}_${today()}.xlsx`,
    );
    showToast('Rapport horaires exporté', 'success');
  };

  const exportEfficiency = async () => {
    const aoa: AoaCell[][] = [
      [`PROVENCE RUGBY — EFFICACITÉ RH — ${eventTypeLabel} — ${today()}`],
      [],
      ['Événement', 'Date', 'Total agents', 'Agents / 100 pax', 'Heures sup', 'Efficacité (%)'],
    ];
    let tAgents = 0;
    let tOt = 0;
    for (const s of summaries) {
      tAgents += s.total_agents;
      tOt += s.total_overtime_hours;
      aoa.push([
        s.event?.event_name ?? s.event_id,
        s.event?.event_date ?? '',
        s.total_agents,
        s.agents_per_100pax != null ? Number(s.agents_per_100pax.toFixed(2)) : '',
        Number(s.total_overtime_hours.toFixed(2)),
        s.efficiency_score != null ? Math.round(s.efficiency_score * 100) : '',
      ]);
    }
    aoa.push(['TOTAL', '', tAgents, '', Number(tOt.toFixed(1)), '']);
    const columns: (ColumnStyle | undefined)[] = [
      undefined,
      { align: 'center' },
      { numFmt: INT, align: 'right' },
      { numFmt: DEC1, align: 'right' },
      { numFmt: HOURS, align: 'right' },
      { numFmt: PCT_INT, align: 'right' },
    ];
    await downloadAoaWorkbook(
      [{ name: 'Efficacité RH', aoa, widths: [24, 14, 12, 16, 12, 14], columns }],
      `Rapport_efficacite_RH_${eventTypeLabel}_${today()}.xlsx`,
    );
    showToast('Rapport efficacité RH exporté', 'success');
  };

  const exportComparison = async () => {
    const build = (title: string, list: StaffEventSummary[]): AoaCell[][] => {
      const aoa: AoaCell[][] = [
        [`PROVENCE RUGBY — SYNTHÈSE ${title} — ${today()}`],
        [],
        ['Événement', 'Spectateurs', 'Total agents', 'Agents / 100 pax', 'Heures totales', 'Heures sup', 'Efficacité (%)'],
      ];
      let tAgents = 0;
      let tHours = 0;
      let tOt = 0;
      for (const s of list) {
        tAgents += s.total_agents;
        tHours += s.total_actual_hours;
        tOt += s.total_overtime_hours;
        aoa.push([
          s.event?.event_name ?? s.event_id,
          s.real_attendance ?? '',
          s.total_agents,
          s.agents_per_100pax != null ? Number(s.agents_per_100pax.toFixed(2)) : '',
          Number(s.total_actual_hours.toFixed(2)),
          Number(s.total_overtime_hours.toFixed(2)),
          s.efficiency_score != null ? Math.round(s.efficiency_score * 100) : '',
        ]);
      }
      aoa.push(['TOTAL', '', tAgents, '', Number(tHours.toFixed(1)), Number(tOt.toFixed(1)), '']);
      return aoa;
    };
    const columns: (ColumnStyle | undefined)[] = [
      undefined,
      { numFmt: INT, align: 'right' },
      { numFmt: INT, align: 'right' },
      { numFmt: DEC1, align: 'right' },
      { numFmt: HOURS, align: 'right' },
      { numFmt: HOURS, align: 'right' },
      { numFmt: PCT_INT, align: 'right' },
    ];
    await downloadAoaWorkbook(
      [
        { name: 'Matchs', aoa: build('MATCHS', matchSummaries), widths: [24, 12, 12, 16, 14, 12, 14], columns },
        { name: 'Séminaires', aoa: build('SÉMINAIRES', seminarSummaries), widths: [24, 12, 12, 16, 14, 12, 14], columns },
      ],
      `Comparaison_matchs_seminaires_${today()}.xlsx`,
    );
    showToast('Comparaison exportée', 'success');
  };

  const printAlerts = () => {
    window.print();
  };

  const cards: {
    title: string;
    desc: string;
    onClick: () => void;
    variant: 'primary' | 'secondary';
  }[] = [
    {
      title: 'Rapport horaires complet',
      desc: 'Classeur habillé 2 feuilles : Synthèse par événement + Détail nominatif par agent (ligne TOTAL).',
      onClick: exportHours,
      variant: 'primary',
    },
    {
      title: 'Rapport efficacité RH',
      desc: 'Synthèse par événement : agents, ratio /100 pax, efficacité.',
      onClick: exportEfficiency,
      variant: 'primary',
    },
    {
      title: 'Comparaison matchs / séminaires',
      desc: 'Classeur 2 feuilles avec les agrégats par type d’événement.',
      onClick: exportComparison,
      variant: 'primary',
    },
    {
      title: 'Rapport alertes (PDF)',
      desc: 'Impression de la page pour archivage PDF des alertes RH.',
      onClick: printAlerts,
      variant: 'secondary',
    },
  ];

  return (
    <div className="space-y-4">
      <Alert variant="info" title="Exports RH réservés au ROLE_STADE">
        Les fichiers ne contiennent aucun coût produit — uniquement des données horaires et RH.
      </Alert>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <div
            key={c.title}
            className="flex flex-col justify-between rounded-xl border border-pr-stone bg-pr-white p-4 shadow-sm"
          >
            <div>
              <h3 className="font-display text-base font-semibold text-pr-black">{c.title}</h3>
              <p className="mt-1 text-sm text-pr-black-soft">{c.desc}</p>
            </div>
            <div className="mt-4">
              <Button variant={c.variant} onClick={c.onClick}>
                <Download className="h-4 w-4" aria-hidden />
                Générer
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */

export default function StaffAnalyticsPage() {
  const [activeTab, setActiveTab] = useState<'match' | 'séminaire'>('match');
  const [activeView, setActiveView] = useState<ViewKey>('synthese');
  const [showAddHours, setShowAddHours] = useState(false);

  const { data: allSummaries, isLoading: loadingSummaries } = useStaffSummaries();
  const { data: schedules, isLoading: loadingSchedules } = useStaffSchedules(activeTab);
  // Chargé pour respecter le contrat du module (ratios historiques par type).
  useStaffAnalyticsRows(activeTab);

  const summaries = useMemo<StaffEventSummary[]>(
    () => (allSummaries ?? []).filter((s) => s.event_type === activeTab),
    [allSummaries, activeTab],
  );

  const matchSummaries = useMemo<StaffEventSummary[]>(
    () => (allSummaries ?? []).filter((s) => s.event_type === 'match'),
    [allSummaries],
  );
  const seminarSummaries = useMemo<StaffEventSummary[]>(
    () => (allSummaries ?? []).filter((s) => s.event_type === 'séminaire'),
    [allSummaries],
  );

  const scheduleRows = schedules ?? [];
  const eventTypeLabel = activeTab === 'match' ? 'Matchs' : 'Seminaires';

  const isLoading = loadingSummaries || loadingSchedules;

  const renderView = () => {
    if (isLoading) return <Spinner fullPage label="Chargement des données RH…" />;
    switch (activeView) {
      case 'synthese':
        return (
          <SyntheseView summaries={summaries} schedules={scheduleRows} eventType={activeTab} />
        );
      case 'agent':
        return <AgentView schedules={scheduleRows} />;
      case 'espace':
        return <EspaceView schedules={scheduleRows} eventType={activeTab} />;
      case 'evenement':
        return <EvenementView summaries={summaries} />;
      case 'cumul':
        return <AgentCumulativeView />;
      case 'alertes':
        return <AlertesView summaries={summaries} />;
      case 'export':
        return (
          <ExportView
            summaries={summaries}
            schedules={scheduleRows}
            matchSummaries={matchSummaries}
            seminarSummaries={seminarSummaries}
            eventTypeLabel={eventTypeLabel}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div>
      <PageHeader
        title="Staff & Horaires"
        description="Analyse RH — dimensionnement, heures supplémentaires, efficacité."
        action={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowAddHours(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-pr-black px-3 py-2 text-sm font-medium text-white hover:bg-pr-black-soft"
            >
              <Plus className="h-4 w-4" /> Ajouter des heures
            </button>
            <Link
              to="/admin/analytics/staff/monthly"
              className="inline-flex items-center gap-1 rounded-lg border border-pr-stone px-3 py-2 text-sm font-medium text-pr-black-soft hover:bg-pr-cream"
            >
              📅 Rapports mensuels
            </Link>
          </div>
        }
      />

      {showAddHours && <OccasionalHoursModal onClose={() => setShowAddHours(false)} />}

      {/* Onglets par type d'événement */}
      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            { key: 'match', label: '🏉 Matchs', count: matchSummaries.length },
            { key: 'séminaire', label: '📋 Séminaires', count: seminarSummaries.length },
          ] as const
        ).map((tab) => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'bg-pr-black text-pr-white'
                  : 'bg-pr-white text-pr-black-soft ring-1 ring-inset ring-pr-stone hover:bg-pr-cream'
              }`}
            >
              {tab.label}
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
                  active ? 'bg-pr-white/20 text-pr-white' : 'bg-pr-stone/60 text-pr-black-soft'
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Sous-navigation */}
      <div className="mb-6 flex flex-wrap gap-1.5 border-b border-pr-stone pb-2">
        {VIEWS.map((v) => {
          const active = activeView === v.key;
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => setActiveView(v.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? 'bg-pr-olive text-pr-white'
                  : 'text-pr-black-soft hover:bg-pr-stone/50'
              }`}
            >
              {v.label}
            </button>
          );
        })}
      </div>

      {renderView()}
    </div>
  );
}
