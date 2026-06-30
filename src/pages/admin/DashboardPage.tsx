import { Link } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronRight, CalendarDays, Trash2 } from 'lucide-react';
import { ConfirmDeleteModal } from '@/components/events/DeleteEventModals';
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
  const [deleteTarget, setDeleteTarget] = useState<Event | null>(null);

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

      {deleteTarget && (
        <ConfirmDeleteModal
          event={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => setDeleteTarget(null)}
        />
      )}

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
              <EventRow key={e.event_id} event={e} onDelete={setDeleteTarget} />
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
    <div className="rounded-xl border border-pr-stone border-t-[3px] border-t-pr-black bg-white p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-pr-olive-dark">
        {label}
      </p>
      <p className="mt-1 font-display text-3xl font-black text-pr-black">{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-pr-black-soft/50">{hint}</p>}
    </div>
  );
}

function EventRow({ event, onDelete }: { event: Event; onDelete: (e: Event) => void }) {
  const spacesQuery = useEventSpaces(event.event_id);
  const stats = useEventStats(event.event_id);
  const { stats: providerStats } = useProviders(event.event_id);
  const status = EVENT_STATUS_META[event.status];
  const spacesTotal = spacesQuery.data?.length ?? 0;

  return (
    <li className="flex items-center gap-2 rounded-lg border border-pr-stone bg-white p-2 pr-3 transition-colors">
      <Link
        to={`/admin/events/${event.event_id}`}
        className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg p-2 hover:bg-pr-cream"
      >
        <div className="min-w-0">
          <p className="truncate font-medium text-pr-black">{event.event_name}</p>
          <p className="text-sm text-pr-black-soft/60">
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
        <Badge tone={status.tone}>{status.label}</Badge>
      </Link>
      <button
        onClick={() => onDelete(event)}
        className="p-2 text-pr-black-soft/40 hover:text-pr-rust"
        title="Supprimer cet événement"
      >
        <Trash2 className="h-4 w-4" />
      </button>
      <ChevronRight className="h-5 w-5 shrink-0 text-pr-black-soft/30" />
    </li>
  );
}
