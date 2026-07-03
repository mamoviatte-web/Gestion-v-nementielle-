import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  GlassWater,
  Package,
  Presentation,
  Trophy,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { Badge, EmptyState, Spinner } from '@/components/ui';
import {
  useDashboardLive,
  type DashboardData,
  type DashboardProviderAlert,
  type DashboardSpaceStatus,
  type DashboardStockAlert,
  type TodayEvent,
} from '@/hooks/useDashboardLive';
import { useDepotsSummary, type DepotSummary } from '@/hooks/useDepots';
import { formatEuro } from '@/lib/calculations';
import type { StatusTone } from '@/lib/types';

/* ─────────────────────────── Helpers ─────────────────────────── */

/** Ordre d'affichage des événements du jour. */
const STATUS_ORDER: Record<string, number> = {
  en_cours: 0,
  préparé: 1,
  clôture_en_attente: 2,
  clôturé: 3,
  archivé: 4,
  brouillon: 5,
};

const STATUS_LABEL: Record<string, string> = {
  brouillon: 'Brouillon',
  préparé: 'Préparé',
  en_cours: 'En cours',
  clôture_en_attente: 'Clôture en attente',
  clôturé: 'Clôturé',
  archivé: 'Archivé',
};

const STATUS_TONE: Record<string, StatusTone> = {
  brouillon: 'neutral',
  préparé: 'info',
  en_cours: 'success',
  clôture_en_attente: 'warning',
  clôturé: 'neutral',
  archivé: 'neutral',
};

const EVENT_TYPE_LABEL: Record<string, string> = {
  match: 'Match',
  séminaire: 'Séminaire',
  cocktail: 'Cocktail',
  réception_vip: 'Réception VIP',
  événement_partenaire: 'Partenaire',
  réunion: 'Réunion',
  autre: 'Autre',
};

function eventTypeIcon(type: string | null): LucideIcon {
  if (type === 'match') return Trophy;
  if (type === 'séminaire') return Presentation;
  return GlassWater;
}

function statusDotColor(status: string): string {
  if (status === 'en_cours') return 'bg-emerald-500';
  if (status === 'préparé') return 'bg-sky-500';
  if (status === 'clôture_en_attente') return 'bg-amber-500';
  return 'bg-gray-300';
}

function nowHHMM(): string {
  return new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

type AlertTone = 'danger' | 'warning' | 'info';

interface MergedAlert {
  key: string;
  tone: AlertTone;
  title: string;
  detail: string;
  to?: string;
}

function buildAlerts(data: DashboardData): MergedAlert[] {
  const alerts: MergedAlert[] = [];

  data.stock_alerts
    .filter((a) => a.severity === 'rupture')
    .forEach((a, i) => {
      alerts.push({
        key: `rupture-${i}`,
        tone: 'danger',
        title: `Rupture — ${a.product_name}${a.space_name ? ' · ' + a.space_name : ''}`,
        detail: `${a.current_qty} restant(s) — réassort urgent`,
        to: '/admin/stock',
      });
    });

  data.stock_alerts
    .filter((a) => a.severity === 'critique')
    .forEach((a, i) => {
      alerts.push({
        key: `critique-${i}`,
        tone: 'warning',
        title: `Stock critique — ${a.product_name}`,
        detail: `${a.current_qty} restants · min ${a.min_stock}`,
        to: '/admin/stock',
      });
    });

  data.provider_alerts.forEach((p: DashboardProviderAlert, i) => {
    alerts.push({
      key: `provider-${i}`,
      tone: 'warning',
      title: `Prestataire en retard — ${p.company}`,
      detail: `+${Math.round(p.delay_min)} min · prévu ${p.planned_time?.slice(0, 5) ?? '—'}`,
    });
  });

  if (data.kpis.debriefs_pending > 0) {
    alerts.push({
      key: 'debriefs',
      tone: 'info',
      title: `${data.kpis.debriefs_pending} débrief(s) en attente`,
      detail: 'À compléter par les responsables',
      to: '/admin/events',
    });
  }

  return alerts;
}

/* ─────────────────────────── Page ─────────────────────────── */

export default function DashboardPage() {
  const { data, loading } = useDashboardLive();
  const depots = useDepotsSummary();
  const navigate = useNavigate();

  const sortedEvents = useMemo(() => {
    if (!data) return [];
    return [...data.today_events].sort((a, b) => {
      const so = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
      if (so !== 0) return so;
      return (a.start_time ?? '').localeCompare(b.start_time ?? '');
    });
  }, [data]);

  const mergedAlerts = useMemo(() => (data ? buildAlerts(data) : []), [data]);

  const activeEventsSub = useMemo(() => {
    if (!data) return 'Aucun en cours';
    const counts = new Map<string, number>();
    for (const e of data.today_events) {
      const label = e.event_type ? EVENT_TYPE_LABEL[e.event_type] ?? e.event_type : 'autre';
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    if (counts.size === 0) return 'Aucun en cours';
    return [...counts.entries()].map(([label, n]) => `${n} ${label.toLowerCase()}`).join(' · ');
  }, [data]);

  const timeline = useMemo<TimelineItem[]>(() => {
    if (!data) return [];
    const current = nowHHMM();
    const items: TimelineItem[] = data.today_events
      .filter((e) => e.start_time)
      .map((e) => {
        const time = (e.start_time as string).slice(0, 5);
        let state: TimelineState = 'future';
        if (e.status === 'en_cours') state = 'current';
        else if (time < current) state = 'past';
        return {
          time,
          title: e.event_name,
          detail: `${e.spaces_count} espace(s) · ${e.pax ?? 0} pax`,
          state,
        };
      });
    items.push({
      time: '23:30',
      title: 'Clôtures espaces — stocks finaux',
      detail: 'Saisie par les responsables',
      state: 'future',
    });
    return items.sort((a, b) => a.time.localeCompare(b.time));
  }, [data]);

  const eventBySpace = useMemo(() => {
    const map = new Map<string, string>();
    if (!data) return map;
    // Associe (heuristique) chaque espace actif à un événement du jour pour la navigation.
    const firstEvent = data.today_events.find((e) => e.status === 'en_cours') ?? data.today_events[0];
    if (firstEvent) {
      for (const s of data.spaces_status) {
        if (s.has_event_today) map.set(s.space_id, firstEvent.event_id);
      }
    }
    return map;
  }, [data]);

  if (loading) return <Spinner fullPage label="Chargement du tableau de bord…" />;
  if (!data) {
    return (
      <EmptyState
        icon={Activity}
        title="Données indisponibles"
        message="Impossible de charger le tableau de bord opérationnel pour le moment."
      />
    );
  }

  const activeSpacesCount = data.spaces_status.filter((s) => s.has_event_today).length;

  return (
    <div className="space-y-6">
      <LiveHeader />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Événements actifs"
          value={String(data.kpis.active_events)}
          sub={activeEventsSub}
          icon={Activity}
        />
        <KpiCard
          label="Spectateurs"
          value={data.kpis.total_pax_today.toLocaleString('fr-FR')}
          sub="en cours ce soir"
          icon={Users}
        />
        <KpiCard
          label="Alertes stock"
          value={String(data.kpis.critical_alerts)}
          sub={data.kpis.critical_alerts > 0 ? 'dont ruptures critiques' : 'Tout est nominal'}
          icon={AlertTriangle}
          variant={data.kpis.critical_alerts > 0 ? 'danger' : 'success'}
        />
        <KpiCard
          label="Débriefs en attente"
          value={String(data.kpis.debriefs_pending)}
          sub={`sur ${activeSpacesCount} espace(s) actif(s)`}
          icon={ClipboardList}
          variant={data.kpis.debriefs_pending > 5 ? 'warning' : 'default'}
        />
      </div>

      {/* Événements du jour + Alertes actives */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section>
          <SectionTitle>Événements du jour</SectionTitle>
          {sortedEvents.length === 0 ? (
            <EmptyState icon={Trophy} title="Aucun événement aujourd'hui" />
          ) : (
            <ul className="space-y-2">
              {sortedEvents.map((e) => (
                <EventRow key={e.event_id} event={e} onOpen={() => navigate(`/admin/events/${e.event_id}`)} />
              ))}
            </ul>
          )}
        </section>

        <section>
          <SectionTitle>Alertes actives</SectionTitle>
          {mergedAlerts.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm font-medium text-emerald-800">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
              Aucune alerte active ✅
            </div>
          ) : (
            <ul className="space-y-2">
              {mergedAlerts.map((a) => (
                <AlertRow key={a.key} alert={a} />
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Stocks critiques + Timeline */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section>
          <SectionTitle>Stocks critiques</SectionTitle>
          {data.stock_alerts.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm font-medium text-emerald-800">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
              Tous les stocks sont au-dessus du seuil ✅
            </div>
          ) : (
            <ul className="divide-y divide-pr-stone rounded-xl border border-pr-stone bg-white">
              {data.stock_alerts.map((a, i) => (
                <StockAlertRow key={`${a.product_name}-${i}`} alert={a} />
              ))}
            </ul>
          )}
        </section>

        <section>
          <SectionTitle>Fil du jour</SectionTitle>
          <Timeline items={timeline} />
        </section>
      </div>

      {/* Dépôts centraux */}
      {(depots.data ?? []).length > 0 && (
        <section>
          <SectionTitle>Dépôts centraux</SectionTitle>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(depots.data ?? []).map((d) => (
              <DepotCard key={d.id} depot={d} onOpen={() => navigate('/admin/stock')} />
            ))}
          </div>
        </section>
      )}

      {/* Activité par espace */}
      <section>
        <SectionTitle>Activité par espace</SectionTitle>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-pr-stone bg-pr-stone sm:grid-cols-4">
          {data.spaces_status.map((s) => (
            <SpaceCell
              key={s.space_id}
              space={s}
              onOpen={() => {
                const eventId = eventBySpace.get(s.space_id);
                if (eventId) navigate(`/admin/events/${eventId}`);
                else navigate('/admin/spaces');
              }}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

/* ─────────────────────────── LiveHeader ─────────────────────────── */

function LiveHeader() {
  const [now, setNow] = useState<Date>(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const label =
    now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) +
    ' · ' +
    now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
        </span>
        <div>
          <h1 className="font-display text-2xl font-black text-pr-black">Stade Maurice-David</h1>
          <p className="text-sm text-pr-black-soft/60">
            Tableau de bord opérationnel · Journée en cours
          </p>
        </div>
      </div>
      <div className="inline-flex items-center gap-2 self-start rounded-full border border-pr-stone bg-white px-3 py-1.5 text-sm font-medium capitalize text-pr-black-soft">
        <Clock className="h-4 w-4 text-pr-olive-dark" />
        {label}
      </div>
    </div>
  );
}

/* ─────────────────────────── KpiCard ─────────────────────────── */

type KpiVariant = 'default' | 'danger' | 'success' | 'warning';

const KPI_TOP: Record<KpiVariant, string> = {
  default: 'border-t-pr-black',
  danger: 'border-t-red-500',
  success: 'border-t-emerald-500',
  warning: 'border-t-amber-500',
};

const KPI_ICON: Record<KpiVariant, string> = {
  default: 'text-pr-olive-dark',
  danger: 'text-red-500',
  success: 'text-emerald-500',
  warning: 'text-amber-500',
};

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  variant = 'default',
}: {
  label: string;
  value: string;
  sub: string;
  icon: LucideIcon;
  variant?: KpiVariant;
}) {
  return (
    <div className={`rounded-xl border border-t-[3px] border-pr-stone bg-white p-4 ${KPI_TOP[variant]}`}>
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-pr-olive-dark">{label}</p>
        <Icon className={`h-4 w-4 shrink-0 ${KPI_ICON[variant]}`} />
      </div>
      <p className="mt-1 font-display text-3xl font-black text-pr-black">{value}</p>
      <p className="mt-0.5 truncate text-xs text-pr-black-soft/50">{sub}</p>
    </div>
  );
}

/* ─────────────────────────── DepotCard ─────────────────────────── */

function frShortDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

function DepotCard({ depot, onOpen }: { depot: DepotSummary; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center gap-3 rounded-xl border border-t-[3px] border-pr-stone border-t-pr-olive bg-white p-4 text-left transition-colors hover:bg-pr-cream"
    >
      <Warehouse className="h-6 w-6 shrink-0 text-pr-olive-dark" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-pr-black">{depot.name}</p>
        <p className="mt-0.5 text-xs text-pr-black-soft/60">
          {depot.product_lines} référence(s) · dernière livraison {frShortDate(depot.last_delivery_date)}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-display text-xl font-black text-pr-black">{formatEuro(depot.total_value_ht)}</p>
        <p className="text-xs text-pr-black-soft/50">{depot.total_qty.toLocaleString('fr-FR')} u.</p>
      </div>
    </button>
  );
}

/* ─────────────────────────── SectionTitle ─────────────────────────── */

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-pr-black-soft/60">{children}</h2>
  );
}

/* ─────────────────────────── EventRow ─────────────────────────── */

function EventRow({ event, onOpen }: { event: TodayEvent; onOpen: () => void }) {
  const Icon = eventTypeIcon(event.event_type);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-lg border border-pr-stone bg-white p-3 text-left transition-colors hover:bg-pr-cream"
      >
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDotColor(event.status)}`} />
        <Icon className="h-5 w-5 shrink-0 text-pr-olive-dark" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium text-pr-black">{event.event_name}</span>
            <Badge tone={STATUS_TONE[event.status] ?? 'neutral'}>
              {STATUS_LABEL[event.status] ?? event.status}
            </Badge>
            {event.event_type && (
              <Badge tone="info">{EVENT_TYPE_LABEL[event.event_type] ?? event.event_type}</Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-pr-black-soft/60">
            {event.start_time ? `${event.start_time.slice(0, 5)} · ` : ''}
            {event.spaces_count} espace(s) · {(event.pax ?? 0).toLocaleString('fr-FR')} pax
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone="neutral">
            Stocks {event.stocks_submitted}/{event.spaces_count}
          </Badge>
          <ChevronRight className="h-5 w-5 text-pr-black-soft/30" />
        </div>
      </button>
    </li>
  );
}

/* ─────────────────────────── AlertRow ─────────────────────────── */

const ALERT_BAR: Record<AlertTone, string> = {
  danger: 'bg-red-500',
  warning: 'bg-amber-500',
  info: 'bg-sky-500',
};

const ALERT_ICON: Record<AlertTone, LucideIcon> = {
  danger: AlertTriangle,
  warning: AlertTriangle,
  info: ClipboardList,
};

function AlertRow({ alert }: { alert: MergedAlert }) {
  const Icon = ALERT_ICON[alert.tone];
  const content = (
    <div className="flex items-center gap-3 rounded-lg border border-pr-stone bg-white p-3">
      <span className={`h-9 w-1 shrink-0 rounded-full ${ALERT_BAR[alert.tone]}`} />
      <Icon
        className={`h-5 w-5 shrink-0 ${
          alert.tone === 'danger' ? 'text-red-500' : alert.tone === 'warning' ? 'text-amber-500' : 'text-sky-500'
        }`}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-pr-black">{alert.title}</p>
        <p className="truncate text-xs text-pr-black-soft/60">{alert.detail}</p>
      </div>
      {alert.to && <ChevronRight className="h-5 w-5 shrink-0 text-pr-black-soft/30" />}
    </div>
  );

  return <li>{alert.to ? <Link to={alert.to}>{content}</Link> : content}</li>;
}

/* ─────────────────────────── StockAlertRow + StockBar ─────────────────────────── */

function StockBar({ current, min, severity }: { current: number; min: number; severity: DashboardStockAlert['severity'] }) {
  const pct = min > 0 ? Math.min(100, (current / min) * 100) : 0;
  const color = severity === 'rupture' ? 'bg-red-500' : severity === 'critique' ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded bg-gray-100">
      <div className={`h-full rounded ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function StockAlertRow({ alert }: { alert: DashboardStockAlert }) {
  return (
    <li className="flex items-center gap-3 p-3">
      <Package className="h-5 w-5 shrink-0 text-pr-olive-dark" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-pr-black">{alert.product_name}</p>
        <p className="truncate text-xs text-pr-black-soft/50">{alert.category}</p>
      </div>
      <StockBar current={alert.current_qty} min={alert.min_stock} severity={alert.severity} />
      <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums text-pr-black">
        {alert.current_qty}/{alert.min_stock}
      </span>
    </li>
  );
}

/* ─────────────────────────── Timeline ─────────────────────────── */

type TimelineState = 'current' | 'past' | 'future';

interface TimelineItem {
  time: string;
  title: string;
  detail: string;
  state: TimelineState;
}

function Timeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) {
    return <EmptyState icon={Clock} title="Aucun horaire planifié" />;
  }
  return (
    <div className="rounded-xl border border-pr-stone bg-white p-4">
      <ol className="relative ml-2 space-y-4 border-l border-pr-stone pl-6">
        {items.map((item, i) => (
          <li key={`${item.time}-${i}`} className="relative">
            <span
              className={`absolute -left-[1.9rem] top-0.5 flex h-4 w-4 items-center justify-center rounded-full ${
                item.state === 'current'
                  ? 'bg-emerald-500'
                  : item.state === 'past'
                    ? 'bg-gray-300'
                    : 'border-2 border-pr-stone bg-white'
              }`}
            >
              {item.state === 'current' && (
                <span className="h-2 w-2 animate-ping rounded-full bg-white opacity-90" />
              )}
            </span>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-sm font-bold tabular-nums text-pr-black">{item.time}</span>
              <span
                className={`truncate text-sm ${
                  item.state === 'past' ? 'text-pr-black-soft/50' : 'font-medium text-pr-black'
                }`}
              >
                {item.title}
              </span>
            </div>
            <p className="truncate text-xs text-pr-black-soft/60">{item.detail}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ─────────────────────────── SpaceCell ─────────────────────────── */

function SpaceCell({ space, onOpen }: { space: DashboardSpaceStatus; onOpen: () => void }) {
  const bg = space.has_alert
    ? 'bg-orange-50'
    : space.event_type === 'match'
      ? 'bg-purple-50'
      : space.has_event_today
        ? 'bg-green-50'
        : 'bg-white';

  const dot = space.has_alert ? 'bg-orange-500' : space.has_event_today ? 'bg-green-500' : 'bg-gray-300';

  const label = space.has_alert
    ? 'Alerte stock'
    : space.has_event_today
      ? space.operational ?? 'Ouvert'
      : 'Fermé';

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex flex-col gap-1 p-3 text-left transition-colors hover:brightness-95 ${bg}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-pr-black">{space.space_name}</span>
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      </div>
      <span className="truncate text-xs text-pr-black-soft/60">{label}</span>
    </button>
  );
}
