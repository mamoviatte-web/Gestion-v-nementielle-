import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarDays, ChevronRight, Plus, FileText, Trash2, CheckSquare } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useEventsList } from '@/hooks/useEvents';
import { useEventsRiskMap } from '@/hooks/useEventDeletion';
import { supabase } from '@/lib/supabase';
import { EVENT_STATUS_META } from '@/lib/labels';
import {
  EVENT_TYPE_META,
  EVENT_TAB_META,
  tabForEventType,
  type EventTabKey,
} from '@/lib/eventTypes';
import {
  getAvailableSeasons,
  groupByMonth,
  matchesSearch,
  seasonKey,
} from '@/lib/eventFiltering';
import { CreateEventModal } from '@/components/events/CreateEventModal';
import { ConfirmDeleteModal, BulkDeleteModal } from '@/components/events/DeleteEventModals';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, Badge, Button, EmptyState, Input, Select, Spinner } from '@/components/ui';
import { clsx } from 'clsx';
import type { Event, EventStatus } from '@/lib/types';

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

const STATUS_OPTIONS = [
  { value: 'all', label: 'Tous les statuts' },
  ...(Object.keys(EVENT_STATUS_META) as EventStatus[]).map((value) => ({
    value,
    label: EVENT_STATUS_META[value].label,
  })),
];

export default function EventsPage() {
  const { data: events, isLoading, error } = useEventsList();
  const { data: feuilleEvents } = useEventsWithFeuilles();
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Event | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<EventTabKey>('matchs');
  const [search, setSearch] = useState('');
  const [season, setSeason] = useState('all');
  const [status, setStatus] = useState('all');
  const navigate = useNavigate();

  const list = useMemo(() => events ?? [], [events]);
  const riskMapQuery = useEventsRiskMap(list.map((e) => e.event_id));
  const riskMap = riskMapQuery.data ?? {};

  const seasons = useMemo(() => getAvailableSeasons(list), [list]);
  const seasonOptions = [
    { value: 'all', label: 'Toutes les saisons' },
    ...seasons.map((s) => ({ value: s, label: `Saison ${s}` })),
  ];

  /** Filtres secondaires (recherche / saison / statut), hors onglet. */
  const secondaryFiltered = useMemo(
    () =>
      list.filter(
        (e) =>
          matchesSearch(e, search) &&
          (season === 'all' || seasonKey(e.event_date) === season) &&
          (status === 'all' || e.status === status),
      ),
    [list, search, season, status],
  );

  const counts = useMemo(() => {
    const c: Record<EventTabKey, number> = { matchs: 0, seminaires: 0, autres: 0 };
    for (const e of secondaryFiltered) c[tabForEventType(e.event_type)] += 1;
    return c;
  }, [secondaryFiltered]);

  const tabEvents = useMemo(
    () => secondaryFiltered.filter((e) => tabForEventType(e.event_type) === activeTab),
    [secondaryFiltered, activeTab],
  );

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

  function selectAllSafe() {
    setSelected(new Set(list.filter((e) => riskMap[e.event_id] === 'safe').map((e) => e.event_id)));
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
            onClick={selectAllSafe}
          >
            Sélectionner les événements vides (sans données)
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

      {/* Onglets Matchs / Séminaires / Autres */}
      <EventTabs active={activeTab} onChange={setActiveTab} counts={counts} />

      {/* Filtres secondaires */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <Input
            placeholder="Rechercher un événement…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-44">
          <Select
            options={seasonOptions}
            value={season}
            onChange={(e) => setSeason(e.target.value)}
          />
        </div>
        <div className="w-44">
          <Select
            options={STATUS_OPTIONS}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          />
        </div>
      </div>

      {isLoading && <Spinner fullPage label="Chargement…" />}
      {error && <Alert variant="error">Impossible de charger les événements.</Alert>}

      {!isLoading && list.length === 0 && (
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

      {!isLoading && list.length > 0 && tabEvents.length === 0 && (
        <EmptyState icon={CalendarDays} title="Aucun événement dans cette catégorie" />
      )}

      {/* Onglet Matchs : liste simple chronologique (faible volume) */}
      {activeTab === 'matchs' && tabEvents.length > 0 && (
        <ul className="space-y-2">
          {tabEvents.map((e) => (
            <EventRow
              key={e.event_id}
              event={e}
              feuille={feuilleEvents?.has(e.event_id) ?? false}
              selectionMode={selectionMode}
              checked={selected.has(e.event_id)}
              onToggle={() => toggleSel(e.event_id)}
              onDelete={() => setDeleteTarget(e)}
            />
          ))}
        </ul>
      )}

      {/* Onglets Séminaires / Autres : regroupement par mois (fort volume) */}
      {activeTab !== 'matchs' &&
        tabEvents.length > 0 &&
        groupByMonth(tabEvents).map(([monthLabel, monthEvents]) => (
          <div key={monthLabel} className="mb-6">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-pr-black-soft/40">
              {monthLabel}
            </h3>
            <ul className="space-y-2">
              {monthEvents.map((e) => (
                <EventRow
                  key={e.event_id}
                  event={e}
                  feuille={feuilleEvents?.has(e.event_id) ?? false}
                  selectionMode={selectionMode}
                  checked={selected.has(e.event_id)}
                  onToggle={() => toggleSel(e.event_id)}
                  onDelete={() => setDeleteTarget(e)}
                />
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}

function EventTabs({
  active,
  onChange,
  counts,
}: {
  active: EventTabKey;
  onChange: (tab: EventTabKey) => void;
  counts: Record<EventTabKey, number>;
}) {
  return (
    <div className="mb-4 flex gap-1 border-b border-pr-stone">
      {EVENT_TAB_META.map((t) => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={clsx(
              'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              isActive
                ? 'border-pr-black text-pr-black'
                : 'border-transparent text-pr-black-soft/50 hover:text-pr-black',
            )}
          >
            <t.Icon className="h-4 w-4" /> {t.label}
            <span
              className={clsx(
                'rounded-full px-1.5 py-0.5 text-xs',
                isActive ? 'bg-pr-black text-white' : 'bg-pr-stone text-pr-black-soft/70',
              )}
            >
              {counts[t.key]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function EventRow({
  event,
  feuille,
  selectionMode,
  checked,
  onToggle,
  onDelete,
}: {
  event: Event;
  feuille: boolean;
  selectionMode: boolean;
  checked: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const statusMeta = EVENT_STATUS_META[event.status];
  const meta = event.event_type ? EVENT_TYPE_META[event.event_type] : null;
  const Icon = meta?.Icon ?? CalendarDays;

  return (
    <li
      className={clsx(
        'flex items-center gap-2 rounded-lg border bg-white p-2 pr-3 transition-colors',
        checked ? 'border-pr-olive ring-1 ring-pr-olive' : 'border-pr-stone',
      )}
    >
      {selectionMode && (
        <input
          type="checkbox"
          className="ml-1 h-4 w-4 rounded border-pr-stone text-pr-olive focus:ring-pr-olive"
          checked={checked}
          onChange={onToggle}
        />
      )}
      <Link
        to={`/admin/events/${event.event_id}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-2 hover:bg-pr-cream"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-pr-cream text-pr-black">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-medium text-pr-black">{event.event_name}</p>
          <p className="text-sm text-pr-black-soft/60">
            {new Date(event.event_date).toLocaleDateString('fr-FR', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
            {event.start_time ? ` · ${event.start_time.slice(0, 5)}` : ''}
            {meta ? ` · ${meta.label}` : ''}
          </p>
        </div>
      </Link>
      <div className="flex shrink-0 items-center gap-2">
        {feuille && (
          <Badge tone="neutral">
            <FileText className="mr-1 inline h-3 w-3" /> Feuilles
          </Badge>
        )}
        <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
        <button
          onClick={onDelete}
          className="p-2 text-pr-black-soft/40 hover:text-pr-rust"
          title="Supprimer cet événement"
        >
          <Trash2 className="h-4 w-4" />
        </button>
        <ChevronRight className="h-5 w-5 text-pr-black-soft/30" />
      </div>
    </li>
  );
}
