import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { clsx } from 'clsx';
import { useEvent, useEventSpaces, useEventActions, useEventsList } from '@/hooks/useEvents';
import { useEventStats } from '@/hooks/useEventStats';
import { EVENT_STATUS_META } from '@/lib/labels';
import { StockDotationsTable } from '@/components/stock/StockDotationsTable';
import { ProvidersPanel } from '@/components/providers/ProvidersPanel';
import { ScheduleAdminPanel } from '@/components/schedule/ScheduleAdminPanel';
import { DebriefAdminPanel } from '@/components/debrief/DebriefAdminPanel';
import { RunnerPlanningTab } from '@/components/runner/RunnerPlanningTab';
import { ConsumptionAnalysisTab } from '@/components/analytics/ConsumptionAnalysisTab';
import { MatchConsumptionReport } from '@/components/analytics/MatchConsumptionReport';
import { SeminaireSpacesTab } from '@/components/seminaire/SeminaireSpacesTab';
import { SeminaireBilanTab } from '@/components/seminaire/SeminaireBilanTab';
import { StaffEventInsights } from '@/components/staff/StaffEventInsights';
import { DebriefScoresGrid } from '@/components/debrief/DebriefScoresGrid';
import { RunnerGenerationModal } from '@/components/runner/RunnerGenerationModal';
import { RouteSheetPanel } from '@/components/events/RouteSheetPanel';
import { BuvetteGroupsTab } from '@/components/buvette/BuvetteGroupsTab';
import { SeminarReportEditor } from '@/components/seminar/SeminarReportEditor';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, Badge, Button, Select, Spinner } from '@/components/ui';
import { Zap } from 'lucide-react';

type Tab =
  | 'stocks'
  | 'buvettes'
  | 'prestataires'
  | 'horaires'
  | 'debriefs'
  | 'route'
  | 'runner'
  | 'analyse'
  | 'gpvip'
  | 'espaces'
  | 'bilan'
  | 'rapport';

/** Onglets complets pour un match (dotations runner, horaires staff…). */
const MATCH_TABS: { key: Tab; label: string }[] = [
  { key: 'stocks', label: 'Stocks & Dotations' },
  { key: 'buvettes', label: '🍺 Buvettes' },
  { key: 'prestataires', label: 'Prestataires' },
  { key: 'horaires', label: 'Horaires Staff' },
  { key: 'debriefs', label: 'Débriefs' },
  { key: 'route', label: '📄 Feuille de route' },
  { key: 'runner', label: '🚀 Runner Auto' },
  { key: 'analyse', label: '📈 Analyse conso' },
  { key: 'gpvip', label: '⭐ GP / VIP' },
];

/** Onglets simplifiés pour un séminaire / événement hors match (sans Prestataires ni Runner). */
const SEMINAIRE_TABS: { key: Tab; label: string }[] = [
  { key: 'espaces', label: '📍 Espaces & codes' },
  { key: 'bilan', label: '📊 Bilan' },
  { key: 'debriefs', label: 'Débriefs' },
  { key: 'rapport', label: '📄 Rapport' },
];

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const eventQuery = useEvent(id);
  const spacesQuery = useEventSpaces(id);
  const stats = useEventStats(id);
  const allEvents = useEventsList();
  const { setStatus, updating } = useEventActions(id);
  const [tab, setTab] = useState<Tab>('stocks');
  const [spaceId, setSpaceId] = useState<string>('');
  const [showRunnerModal, setShowRunnerModal] = useState(false);

  if (eventQuery.isLoading) return <Spinner fullPage label="Chargement…" />;
  const event = eventQuery.data;
  if (!event) {
    return (
      <Alert variant="error" title="Événement introuvable">
        <Link to="/admin/events" className="underline">
          Retour à la liste des événements
        </Link>
      </Alert>
    );
  }

  const spaces = spacesQuery.data ?? [];
  const selectedSpace = spaceId || spaces[0]?.space_id || '';
  const status = EVENT_STATUS_META[event.status];

  // Adapter l'interface au type d'événement : un séminaire n'a pas besoin des
  // dotations runner ni des horaires staff — vue simplifiée (codes espaces + bilan).
  const isMatch = event.event_type === 'match';
  const TABS = isMatch ? MATCH_TABS : SEMINAIRE_TABS;
  const activeTab: Tab = TABS.some((t) => t.key === tab) ? tab : TABS[0].key;

  return (
    <div>
      <Link
        to="/admin/events"
        className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" /> Événements
      </Link>

      <PageHeader
        title={event.event_name}
        description={`${new Date(event.event_date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${event.start_time ? ` · ${event.start_time.slice(0, 5)}` : ''}${event.expected_attendees ? ` · ${event.expected_attendees} spectateurs` : ''}`}
        action={<Badge tone={status.tone}>{status.label}</Badge>}
      />

      {/* Fil d'Ariane de continuité (matchs) */}
      {event.event_type === 'match' &&
        (() => {
          const events = allEvents.data ?? [];
          const prev = events.find((e) => e.event_id === event.previous_event_id);
          const next = events.find((e) => e.previous_event_id === event.event_id);
          return (
            <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-pr-black-soft/70">
              {prev ? (
                <Link to={`/admin/events/${prev.event_id}`} className="hover:text-pr-olive hover:underline">
                  ← {prev.event_name}
                </Link>
              ) : (
                <span>← début de la série</span>
              )}
              <span className="text-pr-stone">•</span>
              <span className="font-display font-bold uppercase tracking-wide text-pr-black">
                {event.event_name}
                {event.sequence_number ? ` · Match n°${event.sequence_number}` : ''}
              </span>
              <span className="text-pr-stone">•</span>
              {next ? (
                <Link to={`/admin/events/${next.event_id}`} className="hover:text-pr-olive hover:underline">
                  Suivant : {next.event_name} →
                </Link>
              ) : (
                <span>Suivant : —</span>
              )}
            </div>
          );
        })()}

      {/* Compteurs + actions de statut */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge tone="neutral">
          Stocks soumis : {stats.spacesClosed}/{stats.spacesTotal}
        </Badge>
        <Badge tone="neutral">
          Débriefs : {stats.debriefsReceived}/{stats.spacesTotal}
        </Badge>
        <div className="ml-auto flex gap-2">
          {(event.status === 'brouillon' || event.status === 'préparé') && (
            <Button
              size="sm"
              variant="secondary"
              loading={updating}
              onClick={() => void setStatus('en_cours')}
            >
              Passer en cours
            </Button>
          )}
          {isMatch && (event.status === 'brouillon' || event.status === 'préparé') && (
            <Button size="sm" onClick={() => setShowRunnerModal(true)}>
              <Zap className="h-4 w-4" /> Générer les dotations runner
            </Button>
          )}
          {event.status !== 'clôturé' && event.status !== 'archivé' && (
            <Button
              size="sm"
              loading={updating}
              onClick={() => void setStatus('clôturé')}
            >
              Clôturer l'événement
            </Button>
          )}
        </div>
      </div>

      {showRunnerModal && (
        <RunnerGenerationModal
          eventId={event.event_id}
          spaces={spaces}
          onClose={() => setShowRunnerModal(false)}
          onGenerated={() => {
            setShowRunnerModal(false);
            setTab('runner');
          }}
        />
      )}

      {/* Onglets */}
      <div className="mb-5 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              activeTab === t.key
                ? 'border-provence text-provence'
                : 'border-transparent text-slate-500 hover:text-slate-700',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Sélecteur d'espace (onglets par espace uniquement) */}
      {spaces.length > 0 && (activeTab === 'stocks' || activeTab === 'horaires') && (
        <div className="mb-4 max-w-xs">
          <Select
            label="Espace"
            value={selectedSpace}
            onChange={(e) => setSpaceId(e.target.value)}
            options={spaces.map((s) => ({
              value: s.space_id,
              label: s.spaces?.space_name ?? s.space_id,
            }))}
          />
        </div>
      )}

      {/* Contenu */}
      {activeTab === 'espaces' && <SeminaireSpacesTab event={event} spaces={spaces} />}
      {activeTab === 'bilan' && <SeminaireBilanTab event={event} spaces={spaces} />}
      {activeTab === 'rapport' && <SeminarReportEditor event={event} />}

      {activeTab === 'stocks' &&
        (selectedSpace ? (
          <StockDotationsTable eventId={event.event_id} spaceId={selectedSpace} />
        ) : (
          <Alert variant="info">Aucun espace activé pour cet événement.</Alert>
        ))}

      {activeTab === 'buvettes' && <BuvetteGroupsTab />}

      {activeTab === 'prestataires' && (
        <ProvidersPanel eventId={event.event_id} spaces={spaces} />
      )}
      {activeTab === 'horaires' && (
        <div className="space-y-6">
          {selectedSpace ? (
            <ScheduleAdminPanel eventId={event.event_id} spaceId={selectedSpace} />
          ) : (
            <Alert variant="info">Aucun espace activé pour cet événement.</Alert>
          )}
          <StaffEventInsights event={event} />
        </div>
      )}
      {activeTab === 'debriefs' && (
        <div className="space-y-6">
          <DebriefScoresGrid eventId={event.event_id} spaces={spaces} />
          <DebriefAdminPanel eventId={event.event_id} spaces={spaces} />
        </div>
      )}
      {activeTab === 'route' && <RouteSheetPanel eventId={event.event_id} spaces={spaces} />}
      {activeTab === 'runner' && (
        <RunnerPlanningTab
          event={event}
          spaces={spaces}
          onOpenModal={() => setShowRunnerModal(true)}
        />
      )}
      {activeTab === 'analyse' && <ConsumptionAnalysisTab event={event} spaces={spaces} />}
      {activeTab === 'gpvip' && <MatchConsumptionReport eventId={event.event_id} />}
    </div>
  );
}
