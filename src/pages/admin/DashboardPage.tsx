import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AlertTriangle, ChevronRight, CalendarDays } from 'lucide-react';
import { useEventsList, useEventSpaces } from '@/hooks/useEvents';
import { useEventStats } from '@/hooks/useEventStats';
import { useLateProvidersCount, useProviders } from '@/hooks/useProviders';
import { useCatalog } from '@/hooks/useCatalog';
import { formatEuro } from '@/lib/calculations';
import { EVENT_STATUS_META } from '@/lib/labels';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, Badge, EmptyState, Spinner } from '@/components/ui';
import type { Event } from '@/lib/types';

const OPEN_STATUSES = ['préparé', 'en_cours', 'clôture_en_attente'];

export default function DashboardPage() {
  const eventsQuery = useEventsList();
  const catalog = useCatalog();
  const { data: lateCount = 0 } = useLateProvidersCount();

  const events = eventsQuery.data ?? [];
  const lastEvent = events[0];
  const stats = useEventStats(lastEvent?.event_id);

  const products = catalog.products.data ?? [];
  const activeProducts = products.filter((p) => p.active);
  const missingPrice = activeProducts.filter((p) => p.unit_price_ht === null);

  const openCount = events.filter((e) => OPEN_STATUSES.includes(e.status)).length;
  const archivedCount = events.filter((e) => e.status === 'archivé').length;

  const finishedNotAllClosed =
    lastEvent &&
    (lastEvent.status === 'clôturé' || lastEvent.status === 'archivé') &&
    stats.spacesClosed < stats.spacesTotal;

  const hasAlerts =
    missingPrice.length > 0 ||
    lateCount > 0 ||
    stats.negatives.length > 0 ||
    finishedNotAllClosed;

  if (eventsQuery.isLoading) return <Spinner fullPage label="Chargement…" />;

  return (
    <div className="space-y-6">
      <PageHeader title="Tableau de bord" description="Vue d'ensemble du stade." />

      {/* Alertes */}
      {hasAlerts && (
        <div className="space-y-2">
          {missingPrice.length > 0 && (
            <Alert variant="warning" title={`${missingPrice.length} produit(s) sans prix HT — RG-005`}>
              {missingPrice.map((p) => p.product_name).join(', ')}
            </Alert>
          )}
          {lateCount > 0 && (
            <Alert variant="error" title={`${lateCount} prestataire(s) en retard — RG-008`}>
              Voir le détail dans l'onglet Prestataires de l'événement concerné.
            </Alert>
          )}
          {stats.negatives.length > 0 && (
            <Alert variant="error" title={`${stats.negatives.length} consommation(s) négative(s) — RG-004`}>
              Dernier événement : anomalies de stock à vérifier.
            </Alert>
          )}
          {finishedNotAllClosed && (
            <Alert variant="warning" title="Inventaires de clôture incomplets">
              {stats.spacesClosed}/{stats.spacesTotal} espaces clôturés sur le
              dernier événement terminé.
            </Alert>
          )}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          label="Événements"
          value={String(events.length)}
          hint={`${openCount} ouverts · ${archivedCount} archivés`}
        />
        <KpiCard
          label="Coût dernier événement"
          value={stats.loading ? '…' : `${formatEuro(stats.totalCost)}${stats.hasMissingCost ? ' *' : ''}`}
          hint={lastEvent?.event_name}
        />
        <KpiCard
          label="Taux de retour moyen"
          value={stats.loading ? '…' : `${Math.round(stats.returnRate * 100)} %`}
          hint="final / (initial + réassort)"
        />
        <KpiCard
          label="Débriefs reçus"
          value={`${stats.debriefsReceived}/${stats.spacesTotal}`}
          hint="dernier événement"
        />
        <KpiCard
          label="Produits actifs"
          value={String(activeProducts.length)}
          hint={`${missingPrice.length} sans prix`}
        />
      </div>

      {/* Événements */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Événements
        </h2>
        {events.length === 0 ? (
          <EmptyState icon={CalendarDays} title="Aucun événement" />
        ) : (
          <ul className="space-y-2">
            {events.map((e) => (
              <EventRow key={e.event_id} event={e} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
}) {
  return (
    <div className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-provence">{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function EventRow({ event }: { event: Event }) {
  const spacesQuery = useEventSpaces(event.event_id);
  const stats = useEventStats(event.event_id);
  const { stats: providerStats } = useProviders(event.event_id);
  const status = EVENT_STATUS_META[event.status];
  const spacesTotal = spacesQuery.data?.length ?? 0;

  return (
    <li>
      <Link
        to={`/admin/events/${event.event_id}`}
        className="flex items-center justify-between gap-3 rounded-lg bg-white p-4 ring-1 ring-slate-200 transition-colors hover:bg-slate-50"
      >
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">{event.event_name}</p>
          <p className="text-sm text-slate-500">
            {new Date(event.event_date).toLocaleDateString('fr-FR', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
            {event.start_time ? ` · ${event.start_time.slice(0, 5)}` : ''}
            {event.event_type ? ` · ${event.event_type}` : ''}
            {event.expected_attendees ? ` · ${event.expected_attendees} spect.` : ''}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge tone="neutral">
              Stocks {stats.spacesClosed}/{spacesTotal}
            </Badge>
            {providerStats.en_retard > 0 && (
              <Badge tone="danger">
                <AlertTriangle className="mr-1 inline h-3 w-3" />
                {providerStats.en_retard} retard
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge tone={status.tone}>{status.label}</Badge>
          <ChevronRight className="h-5 w-5 text-slate-400" />
        </div>
      </Link>
    </li>
  );
}
