import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarDays, ChevronRight, Plus, FileText } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useEventsList } from '@/hooks/useEvents';
import { supabase } from '@/lib/supabase';
import { EVENT_STATUS_META } from '@/lib/labels';
import { EVENT_TYPE_META } from '@/lib/eventTypes';
import { CreateEventModal } from '@/components/events/CreateEventModal';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, Badge, Button, EmptyState, Spinner } from '@/components/ui';

/** Ensemble des event_id ayant au moins une feuille de route (résilient). */
function useEventsWithFeuilles() {
  return useQuery({
    queryKey: ['feuilleEvents'],
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from('event_attachments')
        .select('event_id')
        .eq('attachment_type', 'feuille_route_seminaire');
      if (error) return new Set(); // table pas encore provisionnée → silencieux
      return new Set((data ?? []).map((r: { event_id: string }) => r.event_id));
    },
  });
}

export default function EventsPage() {
  const { data: events, isLoading, error } = useEventsList();
  const { data: feuilleEvents } = useEventsWithFeuilles();
  const [showCreate, setShowCreate] = useState(false);
  const navigate = useNavigate();

  return (
    <div>
      <PageHeader
        title="Événements"
        description="Gestion des matchs, séminaires et réceptions."
        action={
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> Créer un événement
          </Button>
        }
      />

      {showCreate && (
        <CreateEventModal
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false);
            navigate(`/admin/events/${id}`);
          }}
        />
      )}

      {isLoading && <Spinner fullPage label="Chargement…" />}
      {error && <Alert variant="error">Impossible de charger les événements.</Alert>}

      {events && events.length === 0 && (
        <EmptyState
          icon={CalendarDays}
          title="Aucun événement"
          message="Créez votre premier événement pour commencer."
          action={
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" /> Créer un événement
            </Button>
          }
        />
      )}

      {events && events.length > 0 && (
        <ul className="space-y-2">
          {events.map((e) => {
            const status = EVENT_STATUS_META[e.status];
            const meta = e.event_type ? EVENT_TYPE_META[e.event_type] : null;
            const Icon = meta?.Icon ?? CalendarDays;
            const hasFeuilles = feuilleEvents?.has(e.event_id);
            return (
              <li key={e.event_id}>
                <Link
                  to={`/admin/events/${e.event_id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-pr-stone bg-white p-4 transition-colors hover:bg-pr-cream"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-pr-cream text-pr-black">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-pr-black">{e.event_name}</p>
                      <p className="text-sm text-pr-black-soft/60">
                        {new Date(e.event_date).toLocaleDateString('fr-FR', {
                          weekday: 'long',
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        })}
                        {e.start_time ? ` · ${e.start_time.slice(0, 5)}` : ''}
                        {meta ? ` · ${meta.label}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasFeuilles && (
                      <Badge tone="neutral">
                        <FileText className="mr-1 inline h-3 w-3" /> Feuilles jointes
                      </Badge>
                    )}
                    <Badge tone={status.tone}>{status.label}</Badge>
                    <ChevronRight className="h-5 w-5 text-pr-black-soft/40" />
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
