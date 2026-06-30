import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarDays, ChevronRight, Plus, FileText, Trash2, CheckSquare } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useEventsList } from '@/hooks/useEvents';
import { supabase } from '@/lib/supabase';
import { EVENT_STATUS_META } from '@/lib/labels';
import { EVENT_TYPE_META } from '@/lib/eventTypes';
import { CreateEventModal } from '@/components/events/CreateEventModal';
import { ConfirmDeleteModal, BulkDeleteModal } from '@/components/events/DeleteEventModals';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, Badge, Button, EmptyState, Spinner } from '@/components/ui';
import { clsx } from 'clsx';
import type { Event } from '@/lib/types';

function useEventsWithFeuilles() {
  return useQuery({
    queryKey: ['feuilleEvents'],
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from('event_attachments')
        .select('event_id')
        .eq('attachment_type', 'feuille_route_seminaire');
      if (error) return new Set();
      return new Set((data ?? []).map((r: { event_id: string }) => r.event_id));
    },
  });
}

export default function EventsPage() {
  const { data: events, isLoading, error } = useEventsList();
  const { data: feuilleEvents } = useEventsWithFeuilles();
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Event | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const navigate = useNavigate();

  const list = events ?? [];
  const selectedEvents = list.filter((e) => selected.has(e.event_id));

  function toggleSel(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function resetSelection() {
    setSelectionMode(false);
    setSelected(new Set());
  }

  return (
    <div>
      <PageHeader
        title="Événements"
        description="Gestion des matchs, séminaires et réceptions."
        action={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => (selectionMode ? resetSelection() : setSelectionMode(true))}
            >
              <CheckSquare className="h-4 w-4" /> {selectionMode ? 'Annuler' : 'Mode sélection'}
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" /> Créer un événement
            </Button>
          </div>
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
      {deleteTarget && (
        <ConfirmDeleteModal
          event={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => setDeleteTarget(null)}
        />
      )}
      {bulkOpen && (
        <BulkDeleteModal
          events={selectedEvents}
          onClose={() => setBulkOpen(false)}
          onDeleted={() => {
            setBulkOpen(false);
            resetSelection();
          }}
        />
      )}

      {/* Barre d'actions de sélection multiple */}
      {selectionMode && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-pr-black px-3 py-2 text-sm text-white">
          <span>{selected.size} événement(s) sélectionné(s)</span>
          <button
            className="rounded-md bg-white/10 px-2 py-1 hover:bg-white/20"
            onClick={() =>
              setSelected(new Set(list.filter((e) => e.status === 'brouillon').map((e) => e.event_id)))
            }
          >
            Sélectionner tous les brouillons
          </button>
          <div className="ml-auto">
            <button
              disabled={selected.size === 0}
              onClick={() => setBulkOpen(true)}
              className="inline-flex items-center gap-1 rounded-md bg-pr-rust px-3 py-1 font-semibold disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" /> Supprimer la sélection
            </button>
          </div>
        </div>
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

      {list.length > 0 && (
        <ul className="space-y-2">
          {list.map((e) => {
            const status = EVENT_STATUS_META[e.status];
            const meta = e.event_type ? EVENT_TYPE_META[e.event_type] : null;
            const Icon = meta?.Icon ?? CalendarDays;
            const hasFeuilles = feuilleEvents?.has(e.event_id);
            return (
              <li
                key={e.event_id}
                className={clsx(
                  'flex items-center gap-2 rounded-lg border bg-white p-2 pr-3 transition-colors',
                  selected.has(e.event_id) ? 'border-pr-olive ring-1 ring-pr-olive' : 'border-pr-stone',
                )}
              >
                {selectionMode && (
                  <input
                    type="checkbox"
                    className="ml-1 h-4 w-4 rounded border-pr-stone text-pr-olive focus:ring-pr-olive"
                    checked={selected.has(e.event_id)}
                    onChange={() => toggleSel(e.event_id)}
                  />
                )}
                <Link
                  to={`/admin/events/${e.event_id}`}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-2 hover:bg-pr-cream"
                >
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
                </Link>
                <div className="flex shrink-0 items-center gap-2">
                  {hasFeuilles && (
                    <Badge tone="neutral">
                      <FileText className="mr-1 inline h-3 w-3" /> Feuilles
                    </Badge>
                  )}
                  <Badge tone={status.tone}>{status.label}</Badge>
                  <button
                    onClick={() => setDeleteTarget(e)}
                    className="p-2 text-pr-black-soft/40 hover:text-pr-rust"
                    title="Supprimer cet événement"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <ChevronRight className="h-5 w-5 text-pr-black-soft/30" />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
