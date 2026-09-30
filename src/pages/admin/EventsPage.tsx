import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CalendarDays,
  ChevronRight,
  Plus,
  FileText,
  Trash2,
  CheckSquare,
  Download,
} from 'lucide-react';
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
import { Alert, Badge, Button, EmptyState, Input, Select, Spinner, StatTile } from '@/components/ui';
import { downloadAoaWorkbook, sumFormula, type AoaCell, type AoaSheetOut } from '@/lib/xlsxAoa';
import { INT, PCT, type ColumnStyle } from '@/lib/excelTheme';
import { clsx } from 'clsx';
import type { Event, EventStatus, EventType } from '@/lib/types';

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

/** Nombre d'espaces activés par événement (pour la synthèse + l'export). */
function useEventSpaceCounts() {
  return useQuery({
    queryKey: ['eventSpaceCounts'],
    staleTime: 30_000,
    queryFn: async (): Promise<Record<string, number>> => {
      const { data, error } = await supabase.from('event_spaces').select('event_id');
      if (error) return {};
      const counts: Record<string, number> = {};
      for (const r of (data ?? []) as { event_id: string }[]) {
        counts[r.event_id] = (counts[r.event_id] ?? 0) + 1;
      }
      return counts;
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

/* Styles de colonnes Excel (charte excelTheme) réutilisés par l'export. */
const colLeft: ColumnStyle = { align: 'left' };
const colCenter: ColumnStyle = { align: 'center' };
const colInt: ColumnStyle = { numFmt: INT, align: 'right' };
const colPart: ColumnStyle = { numFmt: PCT };

/** Libellé lisible d'un type d'événement (null → « Non défini »). */
function typeLabel(type: EventType | null): string {
  return type ? EVENT_TYPE_META[type].label : 'Non défini';
}

/** Date FR courte, sûre même si la date est absente/invalide. */
function frDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR');
}

export default function EventsPage() {
  const { data: events, isLoading, error } = useEventsList();
  const { data: feuilleEvents } = useEventsWithFeuilles();
  const { data: spaceCounts } = useEventSpaceCounts();
  const [exporting, setExporting] = useState(false);
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
  const counts_ = spaceCounts ?? {};

  /**
   * Synthèse globale (toute la liste, hors filtres) : compteurs par statut / type,
   * prochain événement à venir, pax cumulés. Base des KPIs et des mini-graphes.
   */
  const summary = useMemo(() => {
    const byStatus = new Map<EventStatus, number>();
    const byType = new Map<string, number>();
    let totalPax = 0;
    for (const e of list) {
      byStatus.set(e.status, (byStatus.get(e.status) ?? 0) + 1);
      const tl = typeLabel(e.event_type);
      byType.set(tl, (byType.get(tl) ?? 0) + 1);
      totalPax += e.expected_attendees ?? 0;
    }
    // Statuts dans l'ordre du cycle de vie (compteur toujours affiché, même à 0).
    const statusRows = (Object.keys(EVENT_STATUS_META) as EventStatus[]).map((s) => ({
      key: s,
      label: EVENT_STATUS_META[s].label,
      count: byStatus.get(s) ?? 0,
    }));
    const typeRows = [...byType.entries()]
      .map(([label, count]) => ({ key: label, label, count }))
      .sort((a, b) => b.count - a.count);
    const matchsCount = list.filter((e) => tabForEventType(e.event_type) === 'matchs').length;

    // Prochain événement à venir (date ≥ aujourd'hui, la plus proche).
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const upcoming = list
      .filter((e) => {
        const d = new Date(e.event_date);
        return !Number.isNaN(d.getTime()) && d >= today;
      })
      .sort((a, b) => a.event_date.localeCompare(b.event_date));

    return {
      total: list.length,
      totalPax,
      matchsCount,
      clotures: byStatus.get('clôturé') ?? 0,
      statusRows,
      typeRows,
      next: upcoming[0] ?? null,
    };
  }, [list]);

  /** Export Excel complet et habillé de la liste des événements (charte excelTheme). */
  async function exportExcel() {
    setExporting(true);
    try {
      // ── Feuille SYNTHÈSE : compteurs par statut / type + KPIs ──
      const total = summary.total;
      const synthAoa: AoaCell[][] = [
        ['Événements — Provence Rugby · Stade Maurice-David'],
        [],
        ['Indicateur', 'Valeur'],
        ['Total événements', total],
        ['Prochain événement', summary.next ? `${summary.next.event_name} (${frDate(summary.next.event_date)})` : '—'],
        ['Matchs', summary.matchsCount],
        ['Clôturés', summary.clotures],
        ['Pax attendus cumulés', summary.totalPax],
        [],
        ['Répartition par statut', 'Nombre', 'Part'],
        ...summary.statusRows.map((r): AoaCell[] => [r.label, r.count, total > 0 ? r.count / total : 0]),
        // « Nombre » additive → =SUM ; les statuts occupent les lignes 11..(10+S).
        // « Part » reste un ratio (non sommé, valeur statique).
        ['Total', sumFormula(1, 11, 10 + summary.statusRows.length), total > 0 ? 1 : 0],
        [],
        ['Répartition par type', 'Nombre', 'Part'],
        ...summary.typeRows.map((r): AoaCell[] => [r.label, r.count, total > 0 ? r.count / total : 0]),
        // « Nombre » additive → =SUM ; les types suivent le bloc statut : lignes
        // (14+S)..(13+S+T), avec S = nb statuts. « Part » reste un ratio statique.
        [
          'Total',
          sumFormula(1, 14 + summary.statusRows.length, 13 + summary.statusRows.length + summary.typeRows.length),
          total > 0 ? 1 : 0,
        ],
      ];

      // ── Feuille ÉVÉNEMENTS : toutes les colonnes + ligne TOTAL ──
      const header: AoaCell[] = [
        'Événement', 'Type', 'Date', 'Début', 'Fin', 'Pax attendus', 'Statut', 'Espaces', 'Saison',
      ];
      const rows: AoaCell[][] = [...list]
        .sort((a, b) => b.event_date.localeCompare(a.event_date))
        .map((e) => [
          e.event_name,
          typeLabel(e.event_type),
          frDate(e.event_date),
          e.start_time ? e.start_time.slice(0, 5) : '',
          e.end_time ? e.end_time.slice(0, 5) : '',
          e.expected_attendees ?? 0,
          EVENT_STATUS_META[e.status].label,
          counts_[e.event_id] ?? 0,
          seasonKey(e.event_date),
        ]);
      // « Pax attendus » (col 5) et « Espaces » (col 7) = colonnes additives →
      // totaux auto-vérifiants (=SUM sur 4..3+n). « Statut » (col 6) reste un
      // compteur d'événements (texte, non sommable) → valeur statique.
      const totalRow: AoaCell[] = [
        'Total', '', '', '', '',
        sumFormula(5, 4, 3 + rows.length),
        `${total} événement(s)`,
        sumFormula(7, 4, 3 + rows.length),
        '',
      ];

      const sheets: AoaSheetOut[] = [
        {
          name: 'Synthèse',
          aoa: synthAoa,
          widths: [34, 16, 12],
          columns: [colLeft, colInt, colPart],
        },
        {
          name: 'Événements',
          aoa: [['Liste des événements — Provence Rugby'], [], header, ...rows, totalRow],
          widths: [30, 18, 13, 8, 8, 13, 18, 9, 12],
          columns: [colLeft, colLeft, colCenter, colCenter, colCenter, colInt, colLeft, colInt, colCenter],
        },
      ];

      const dateStr = new Date().toISOString().slice(0, 10);
      await downloadAoaWorkbook(sheets, `Evenements_Provence-Rugby_${dateStr}.xlsx`);
    } finally {
      setExporting(false);
    }
  }

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
              disabled={list.length === 0 || exporting}
              onClick={() => void exportExcel()}
            >
              <Download className="h-4 w-4" /> {exporting ? 'Génération…' : 'Exporter Excel'}
            </Button>
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

      {/* Bande de synthèse (KPIs + mini-graphes) — vue d'ensemble globale. */}
      {!isLoading && list.length > 0 && (
        <div className="mb-5 space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile label="Total événements" value={summary.total} sub={`${summary.totalPax.toLocaleString('fr-FR')} pax attendus`} />
            <StatTile label="Matchs" value={summary.matchsCount} sub="saison(s) en cours" />
            <StatTile label="Clôturés" value={summary.clotures} tone="good" sub={`${summary.total - summary.clotures} en cours`} />
            <StatTile
              label="Prochain événement"
              value={summary.next ? <span className="block truncate text-sm">{summary.next.event_name}</span> : '—'}
              sub={summary.next ? frDate(summary.next.event_date) : 'aucun à venir'}
            />
            <StatTile
              label="Répartition"
              value={summary.typeRows.length}
              sub={`${summary.typeRows.length} type(s) · ${summary.statusRows.filter((s) => s.count > 0).length} statut(s)`}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <CountBreakdown title="Répartition par statut" items={summary.statusRows} total={summary.total} />
            <CountBreakdown title="Répartition par type" items={summary.typeRows} total={summary.total} />
          </div>
        </div>
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

/** Mini-graphe : barres horizontales de comptage (tri décroissant, zéros masqués). */
function CountBreakdown({
  title,
  items,
  total,
}: {
  title: string;
  items: { key: string; label: string; count: number }[];
  total: number;
}) {
  const visible = items.filter((i) => i.count > 0).sort((a, b) => b.count - a.count);
  const max = Math.max(1, ...visible.map((i) => i.count));
  return (
    <div className="overflow-hidden rounded-2xl border border-pr-stone bg-white">
      <div className="border-b border-pr-stone bg-pr-cream px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-pr-black-soft/50">
        {title}
      </div>
      {visible.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-pr-black-soft/40">Aucune donnée.</p>
      ) : (
        <div className="divide-y divide-pr-stone/50">
          {visible.map((r) => (
            <div key={r.key} className="px-4 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-pr-black-soft/80">{r.label}</span>
                <span className="shrink-0 text-sm font-bold tabular-nums text-pr-olive-dark">
                  {r.count}
                  <span className="ml-1 text-[11px] font-normal text-pr-black-soft/40">
                    {total > 0 ? `${Math.round((r.count / total) * 100)} %` : ''}
                  </span>
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-pr-stone/50">
                <div className="h-full rounded-full bg-pr-olive" style={{ width: `${(r.count / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
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
