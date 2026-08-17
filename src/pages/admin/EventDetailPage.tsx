import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { clsx } from 'clsx';
import { useEvent, useEventSpaces, useEventActions, useEventsList } from '@/hooks/useEvents';
import { useEventStats } from '@/hooks/useEventStats';
import { EVENT_STATUS_META } from '@/lib/labels';
import { StockDotationsTable } from '@/components/stock/StockDotationsTable';
import { ScheduleAdminPanel } from '@/components/schedule/ScheduleAdminPanel';
import { DebriefAdminPanel } from '@/components/debrief/DebriefAdminPanel';
import { UnifiedRunnerPanel } from '@/components/runner/UnifiedRunnerPanel';
import { genererRapportMatch, genererRapportSeminaire } from '@/lib/rapportExcel';
import { ConsumptionAnalysisTab } from '@/components/analytics/ConsumptionAnalysisTab';
import { MatchConsumptionReport } from '@/components/analytics/MatchConsumptionReport';
import { MatchAccessCode } from '@/components/events/MatchAccessCode';
import { EventEditPanel } from '@/components/events/EventEditPanel';
import { EventSpacesModal } from '@/components/events/EventSpacesModal';
import { MatchLiveStatusPanel } from '@/components/events/MatchLiveStatusPanel';
import { IntegrityBadge } from '@/components/events/IntegrityBadge';
import { SeminaireSpacesTab } from '@/components/seminaire/SeminaireSpacesTab';
import { SeminaireBilanTab } from '@/components/seminaire/SeminaireBilanTab';
import { StaffEventInsights } from '@/components/staff/StaffEventInsights';
import { DebriefScoresGrid } from '@/components/debrief/DebriefScoresGrid';
import { StadeDebriefView } from '@/components/debrief/StadeDebriefView';
import { RunnerGenerationModal } from '@/components/runner/RunnerGenerationModal';
import { RouteSheetPanel } from '@/components/events/RouteSheetPanel';
import { RoadmapEditor } from '@/components/admin/RoadmapEditor';
import { MatchClosedView } from '@/components/events/MatchClosedView';
import { DeleteEventButton } from '@/components/events/DeleteEventButton';
import { BuvetteGroupsTab } from '@/components/buvette/BuvetteGroupsTab';
import { RhOperationalBoard } from '@/components/rh/RhOperationalBoard';
import { OccasionalHoursPanel } from '@/components/rh/OccasionalHoursPanel';
import { VipPaxPanel } from '@/components/events/VipPaxPanel';
import { KegReconciliationPanel } from '@/components/events/KegReconciliationPanel';
import { SelectionGroupsPanel } from '@/components/events/SelectionGroupsPanel';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { RevenueMarginPanel } from '@/components/events/RevenueMarginPanel';
import { EventResetButton } from '@/components/events/EventResetButton';
import { SeminarReportEditor } from '@/components/seminar/SeminarReportEditor';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, Badge, Button, Select, Spinner } from '@/components/ui';
import { Zap, CheckCircle2, CalendarClock, Pencil, AlertTriangle } from 'lucide-react';
import { useToast } from '@/context/ToastContext';

type Tab =
  | 'stocks'
  | 'buvettes'
  | 'prestataires'
  | 'horaires'
  | 'debriefs'
  | 'route'
  | 'runner'
  | 'runner_buvettes'
  | 'rh'
  | 'recettes'
  | 'analyse'
  | 'gpvip'
  | 'espaces'
  | 'bilan'
  | 'rapport';

/** Onglets complets pour un match (dotations runner, horaires staff…). */
const MATCH_TABS: { key: Tab; label: string }[] = [
  { key: 'stocks', label: 'Stocks & Dotations' },
  { key: 'buvettes', label: '🍺 Buvettes' },
  { key: 'horaires', label: 'Horaires Staff' },
  { key: 'debriefs', label: 'Débriefs' },
  { key: 'route', label: '📄 Feuille de route' },
  { key: 'runner', label: '🚀 Fiches Runner' },
  { key: 'rh', label: '👥 RH opérationnel' },
  { key: 'recettes', label: '💶 Recettes & Marge' },
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

/** Résultat de event_closure_check — fiabilité des chiffres avant clôture. */
interface ClosureCheck {
  finals_manquants: number;
  unites_en_attente: number;
  anomalies_conso_negative: number;
  produits_sans_prix: number;
  pret_a_cloturer: boolean;
}

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const eventQuery = useEvent(id);
  const spacesQuery = useEventSpaces(id);
  const stats = useEventStats(id);
  const allEvents = useEventsList();
  const { setStatus, updating } = useEventActions(id);
  const { showToast } = useToast();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('stocks');
  const [spaceId, setSpaceId] = useState<string>('');
  const [showRunnerModal, setShowRunnerModal] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [showSpacesModal, setShowSpacesModal] = useState(false);
  // R1 : blocage de clôture tant que les données ne sont pas fiables.
  const [closureIssues, setClosureIssues] = useState<ClosureCheck | null>(null);

  // Clôture effective (une fois les données jugées fiables ou forcées).
  async function doClose(eventName: string) {
    try {
      await setStatus('clôturé');
      // Match : réconciliation fûts (idempotente) — vides à rentrer + retours
      // stockage. Non bloquant : un échec n'empêche pas la clôture.
      if (eventQuery.data?.event_type === 'match' && id) {
        const by = user?.name ?? user?.email ?? 'Stade';
        try {
          await supabase.rpc('apply_keg_reconciliation', { p_event: id, p_by: by });
        } catch (kegErr) {
          console.error('Réconciliation fûts:', kegErr);
        }
      }
      showToast(`Événement « ${eventName} » clôturé.`, 'success');
      // Recharge INTÉGRALE : tous les calculs (F&B, conso, marge, fûts) repartent
      // des données figées — évite les états partiels en cache.
      window.location.reload();
    } catch (err) {
      console.error('Erreur clôture:', err);
      showToast(`Impossible de clôturer : ${err instanceof Error ? err.message : 'erreur inconnue'}`, 'warning');
    }
  }

  async function handleCloseEvent(eventName: string) {
    if (!window.confirm(`Confirmer la clôture de « ${eventName} » ?\n\nLes coûts finaux seront calculés et l'événement sera clôturé.`)) return;
    setClosureIssues(null);
    // R1 : ne pas figer des chiffres faux. Contrôle complet avant clôture (match).
    if (eventQuery.data?.event_type === 'match' && id) {
      const { data: chk } = await supabase.rpc('event_closure_check', { p_event: id });
      const c = chk as ClosureCheck | null;
      if (c && !c.pret_a_cloturer) {
        setClosureIssues(c);
        showToast('Clôture bloquée : données incomplètes (voir le bandeau).', 'warning');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
    }
    await doClose(eventName);
  }

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

      {/* R1 — Bandeau bloquant de clôture : données incomplètes → chiffres faux */}
      {closureIssues && !closureIssues.pret_a_cloturer && (
        <div className="mb-4 rounded-2xl border border-rose-300 bg-rose-50 p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-rose-800">
            <AlertTriangle className="h-4 w-4" /> Clôture bloquée — données incomplètes (les chiffres seraient faux)
          </p>
          <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-rose-700 sm:grid-cols-4">
            <li>Finals manquants : <b>{closureIssues.finals_manquants}</b></li>
            <li>Unités en attente : <b>{closureIssues.unites_en_attente}</b></li>
            <li>Anomalies (conso &lt; 0) : <b>{closureIssues.anomalies_conso_negative}</b></li>
            <li>Produits sans prix : <b>{closureIssues.produits_sans_prix}</b></li>
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => { setTab('analyse'); setClosureIssues(null); window.scrollTo({ top: 400, behavior: 'smooth' }); }}>
              Corriger dans « Analyse conso »
            </Button>
            {closureIssues.produits_sans_prix > 0 && (
              <Link to="/admin/catalog" className="inline-flex items-center rounded-xl border border-rose-300 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100">
                Compléter les prix (Catalogue)
              </Link>
            )}
            <Button size="sm" variant="ghost" onClick={() => { setClosureIssues(null); void doClose(event.event_name); }}>
              Clôturer quand même (données incomplètes)
            </Button>
            <button onClick={() => setClosureIssues(null)} className="text-sm text-rose-500 underline">Ignorer</button>
          </div>
        </div>
      )}

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

      {/* Séminaire préparé : activation automatique nocturne (00:01) */}
      {event.event_type === 'séminaire' && event.status === 'préparé' && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
          <span className="text-xl">⏰</span>
          <div>
            <p className="text-sm font-semibold text-blue-800">Activation automatique prévue</p>
            <p className="mt-0.5 text-xs text-blue-600">
              Le {new Date(event.event_date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} à 00:01 — le séminaire passera automatiquement « En cours » (bouton manuel ci-dessous en secours).
            </p>
          </div>
        </div>
      )}

      {/* Compteurs + actions de statut */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge tone="neutral">
          Stocks soumis : {stats.spacesClosed}/{stats.spacesTotal}
        </Badge>
        <Badge tone="neutral">
          Débriefs : {stats.debriefsReceived}/{stats.spacesTotal}
        </Badge>
        <div className="ml-auto flex flex-wrap gap-2">
          {event.status !== 'clôturé' && event.status !== 'archivé' && (
            <>
              <Button size="sm" variant={editMode ? 'primary' : 'secondary'} onClick={() => setEditMode((v) => !v)}>
                <Pencil className="h-4 w-4" /> {editMode ? 'Fermer l’édition' : 'Modifier'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setShowSpacesModal(true)}>
                🏟️ Gérer les espaces ({spaces.length})
              </Button>
            </>
          )}
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
          <Link
            to={`/admin/events/${event.event_id}/planning`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            <CalendarClock className="h-4 w-4" /> Planning opérationnel
          </Link>
          {event.status !== 'clôturé' && event.status !== 'archivé' && (
            <Button
              size="sm"
              loading={updating}
              onClick={() => void handleCloseEvent(event.event_name)}
            >
              Clôturer l'événement
            </Button>
          )}
          {isMatch && (
            <EventResetButton
              eventId={event.event_id}
              eventName={event.event_name}
              onDone={() => window.location.reload()}
            />
          )}
          <DeleteEventButton event={{ event_id: event.event_id, event_name: event.event_name, event_type: event.event_type }} />
          {(event.status === 'clôturé' || event.status === 'archivé') && (
            <>
              {(event.event_type === 'match' || event.event_type === 'séminaire') && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    event.event_type === 'séminaire'
                      ? void genererRapportSeminaire(event.event_id)
                      : void genererRapportMatch(event.event_id)
                  }
                >
                  📊 Rapport Excel
                </Button>
              )}
              <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-100 px-3 py-2 text-sm font-semibold text-emerald-700">
                <CheckCircle2 className="h-4 w-4" /> Événement clôturé
              </span>
            </>
          )}
        </div>
      </div>

      {editMode && <EventEditPanel event={event} onClose={() => setEditMode(false)} />}

      {showSpacesModal && (
        <EventSpacesModal eventId={event.event_id} onClose={() => setShowSpacesModal(false)} />
      )}

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

      {/* Intégrité des liaisons de charges */}
      <IntegrityBadge eventId={event.event_id} />

      {/* Code d'accès match (responsables de zone) */}
      {isMatch && (
        <>
          <MatchAccessCode eventId={event.event_id} code={event.match_access_code ?? null} eventName={event.event_name} />
          {event.rh_access_code && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="mb-1 text-xs font-bold uppercase tracking-wide text-amber-700">Code accès Responsable RH</p>
                  <p className="font-display text-3xl font-black tracking-[0.25em] text-stone-900">{event.rh_access_code}</p>
                  <p className="mt-1 text-xs text-amber-600">À communiquer uniquement à la responsable RH · Valide pour ce match uniquement</p>
                </div>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(event.rh_access_code ?? '');
                    showToast('Code RH copié.', 'success');
                  }}
                  className="shrink-0 rounded-xl bg-amber-500 px-3 py-2 text-xs font-bold text-white"
                >
                  📋 Copier
                </button>
              </div>
            </div>
          )}
          {event.status === 'clôturé' || event.status === 'archivé' ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-2xl bg-stone-900 px-5 py-4">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-green-400" />
                <div>
                  <p className="font-bold text-white">Match clôturé</p>
                  <p className="text-xs text-white/50">Bilan post-match — remplace le suivi live</p>
                </div>
                <span className="ml-auto hidden text-xs text-white/30 sm:inline">{event.event_name}</span>
              </div>
              <MatchClosedView
                eventId={event.event_id}
                eventName={event.event_name}
                paxCount={event.expected_attendees ?? 0}
              />
            </div>
          ) : (
            <MatchLiveStatusPanel eventId={event.event_id} />
          )}
        </>
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

      {activeTab === 'stocks' && (
        <div className="space-y-6">
          {isMatch && <VipPaxPanel eventId={event.event_id} />}
          {isMatch && (
            <KegReconciliationPanel
              eventId={event.event_id}
              closed={event.status === 'clôturé' || event.status === 'archivé'}
            />
          )}
          {isMatch && selectedSpace && <SelectionGroupsPanel eventId={event.event_id} spaceId={selectedSpace} />}
          {selectedSpace ? (
            <StockDotationsTable eventId={event.event_id} spaceId={selectedSpace} />
          ) : (
            <Alert variant="info">Aucun espace activé pour cet événement.</Alert>
          )}
        </div>
      )}

      {activeTab === 'buvettes' && <BuvetteGroupsTab />}

      {activeTab === 'horaires' && (
        <div className="space-y-6">
          {selectedSpace ? (
            <ScheduleAdminPanel eventId={event.event_id} spaceId={selectedSpace} />
          ) : (
            <Alert variant="info">Aucun espace activé pour cet événement.</Alert>
          )}
          <OccasionalHoursPanel eventId={event.event_id} eventDate={event.event_date} />
          <StaffEventInsights event={event} />
        </div>
      )}
      {activeTab === 'debriefs' && (
        <div className="space-y-6">
          {!isMatch && (
            <section>
              <h2 className="mb-4 font-display text-lg font-bold text-pr-black">📸 Rapport photo &amp; terrain (retour régisseur)</h2>
              <StadeDebriefView eventId={event.event_id} />
            </section>
          )}
          <DebriefScoresGrid eventId={event.event_id} spaces={spaces} />
          <DebriefAdminPanel eventId={event.event_id} spaces={spaces} />
        </div>
      )}
      {activeTab === 'route' && (
        <div className="space-y-8">
          <section>
            <h2 className="mb-4 font-display text-lg font-bold text-pr-black">📋 Brief digital par espace</h2>
            <RoadmapEditor eventId={event.event_id} spaces={spaces} />
          </section>
          <section>
            <h2 className="mb-4 font-display text-lg font-bold text-pr-black">📎 Feuilles de route (fichiers)</h2>
            <RouteSheetPanel eventId={event.event_id} spaces={spaces} />
          </section>
        </div>
      )}
      {activeTab === 'runner' && (
        <UnifiedRunnerPanel
          eventId={event.event_id}
          matchNom={event.event_name}
          matchDate={new Date(event.event_date).toLocaleDateString('fr-FR')}
        />
      )}
      {activeTab === 'rh' && <RhOperationalBoard eventId={event.event_id} />}
      {activeTab === 'recettes' && (
        <RevenueMarginPanel
          eventId={event.event_id}
          spaces={spaces.map((s) => ({ space_id: s.space_id, space_name: s.spaces?.space_name ?? s.space_id }))}
        />
      )}
      {activeTab === 'analyse' && <ConsumptionAnalysisTab event={event} />}
      {activeTab === 'gpvip' && <MatchConsumptionReport eventId={event.event_id} />}
    </div>
  );
}
