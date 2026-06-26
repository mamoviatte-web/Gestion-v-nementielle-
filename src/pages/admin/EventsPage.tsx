import { Link } from 'react-router-dom';
import { CalendarDays, ChevronRight } from 'lucide-react';
import { useEventsList } from '@/hooks/useEvents';
import { EVENT_STATUS_META } from '@/lib/labels';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, Badge, EmptyState, Spinner } from '@/components/ui';

export default function EventsPage() {
  const { data: events, isLoading, error } = useEventsList();

  return (
    <div>
      <PageHeader
        title="Événements"
        description="Gestion des matchs, séminaires et réceptions."
      />

      {isLoading && <Spinner fullPage label="Chargement…" />}
      {error && (
        <Alert variant="error">Impossible de charger les événements.</Alert>
      )}

      {events && events.length === 0 && (
        <EmptyState
          icon={CalendarDays}
          title="Aucun événement"
          message="Aucun événement n'a encore été créé."
        />
      )}

      {events && events.length > 0 && (
        <ul className="space-y-2">
          {events.map((e) => {
            const status = EVENT_STATUS_META[e.status];
            return (
              <li key={e.event_id}>
                <Link
                  to={`/admin/events/${e.event_id}`}
                  className="flex items-center justify-between gap-3 rounded-lg bg-white p-4 ring-1 ring-slate-200 transition-colors hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">
                      {e.event_name}
                    </p>
                    <p className="text-sm text-slate-500">
                      {new Date(e.event_date).toLocaleDateString('fr-FR', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                      {e.start_time ? ` · ${e.start_time.slice(0, 5)}` : ''}
                      {e.event_type ? ` · ${e.event_type}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone={status.tone}>{status.label}</Badge>
                    <ChevronRight className="h-5 w-5 text-slate-400" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
