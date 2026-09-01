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
import { SeminaireRhTab } from '@/components/seminaire/SeminaireRhTab';
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
import { Alert, Badge, Button, Select, Spinner } from '@/components/ui';
import { Zap, CalendarClock, Pencil, AlertTriangle } from 'lucide-react';
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

/**
 * Refonte navigation (V2) : 4 phases (Préparation → Jour J → Clôture → Résultats)
 * au lieu de 10 onglets. On NE réécrit PAS les écrans : chaque sous-onglet REMONTE
 * les composants existants (mêmes RPC/vues → une seule source par donnée, aucune
 * divergence entre phases). Les sous-onglets re-répartissent finement le contenu
 * de l'ex-onglet « Stocks & Dotations » : pax/config → Préparation, saisie →
 * Jour J, stock final + fûts → Clôture.
 */
type Phase = 'prep' | 'jourj' | 'cloture' | 'resultats';
type MatchSub =
  | 'pax' // Préparation
  | 'dotations'
  | 'route'
  | 'buvettes'
  | 'saisie' // Jour J
  | 'rh'
  | 'final' // Clôture
  | 'debriefs'
  | 'recettes' // Résultats
  | 'analyse'
  | 'gpvip';

/** Sous-onglets par phase : la même donnée montée au même endroit qu'avant. */
const MATCH_PHASES: { key: Phase; label: string; subs: { key: MatchSub; label: string }[] }[] = [
  {
    key: 'prep',
    label: '① Préparation',
    subs: [
      { key: 'pax', label: 'Espaces & pax' },
      { key: 'dotations', label: 'Dotations & fiches runner' },
      { key: 'route', label: '📄 Feuille de route' },
      { key: 'buvettes', label: '🍺 Buvettes' },
    ],
  },
  {
    key: 'jourj',
    label: '② Jour J',
    subs: [
      { key: 'saisie', label: '📦 Saisie stock' },
      { key: 'rh', label: '⏱ Horaires / RH staff' },
    ],
  },
  {
    key: 'cloture',
    label: '③ Clôture',
    subs: [
      { key: 'final', label: '🍺 Stock final & fûts' },
      { key: 'debriefs', label: 'Débriefs' },
    ],
  },
  {
    key: 'resultats',
    label: '④ Résultats',
    subs: [
      { key: 'recettes', label: '💶 Recettes & marge' },
      { key: 'analyse', label: '📈 Analyse conso' },
      { key: 'gpvip', label: '⭐ GP / VIP' },
    ],
  },
];

/** Sous-onglets nécessitant le sélecteur d'espace (composant par espace). */
const SPACE_SUBS: MatchSub[] = ['pax', 'dotations', 'saisie', 'rh', 'final'];

/** Onglets simplifiés pour un séminaire / événement hors match (sans Prestataires ni Runner). */
const SEMINAIRE_TABS: { key: Tab; label: string }[] = [
  { key: 'espaces', label: '📍 Espaces & codes' },
  { key: 'rh', label: '🧑‍🍳 RH & horaires' },
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
  const [tab, setTab] = useState<Tab>('espaces'); // onglets séminaire uniquement
  const [phase, setPhase] = useState<Phase>('prep'); // phase active (matchs)
  const [sub, setSub] = useState<MatchSub>('pax'); // sous-onglet actif (matchs)
  const [spaceId, setSpaceId] = useState<string>('');

  /** Change de phase et positionne sur le 1er sous-onglet de la phase. */
  function selectPhase(p: Phase) {
    setPhase(p);
    const first = MATCH_PHASES.find((x) => x.key === p)?.subs[0]?.key;
    if (first) setSub(first);
  }
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
  // Matchs : sous-onglet actif = celui de la phase courante.
  const activePhaseDef = MATCH_PHASES.find((p) => p.key === phase) ?? MATCH_PHASES[0];
  const phaseSubs = activePhaseDef.subs;
  const activeSub: MatchSub = phaseSubs.some((s) => s.key === sub) ? sub : phaseSubs[0].key;
  // Séminaires : onglets simples inchangés.
  const activeTab: Tab = SEMINAIRE_TABS.some((t) => t.key === tab) ? tab : SEMINAIRE_TABS[0].key;

  const isClosed = event.status === 'clôturé' || event.status === 'archivé';
  // Fil d'Ariane : match précédent / suivant (continuité de série).
  const seriesEvents = allEvents.data ?? [];
  const prevEvent = seriesEvents.find((e) => e.event_id === event.previous_event_id);
  const nextEvent = seriesEvents.find((e) => e.previous_event_id === event.event_id);

  return (
    <div>
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
            <Button size="sm" onClick={() => { setPhase('resultats'); setSub('analyse'); setClosureIssues(null); window.scrollTo({ top: 400, behavior: 'smooth' }); }}>
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

      {/* ═══ Barre de commande (fiche compacte) ═══ */}
      <div className="mb-5 overflow-hidden rounded-2xl border border-pr-stone bg-pr-cream/70">
        <div className="p-4 sm:p-5">
          <Link
            to="/admin/events"
            className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-pr-black-soft/50 transition-colors hover:text-pr-black"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Événements
          </Link>

          {/* Ligne 1 — identité + actions */}
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="font-display text-2xl font-black tracking-tight text-pr-black">{event.event_name}</h1>
                <Badge tone={status.tone}>{status.label}</Badge>
                {isMatch && event.sequence_number ? (
                  <span className="text-xs font-semibold uppercase tracking-wide text-pr-black-soft/45">Match n°{event.sequence_number}</span>
                ) : null}
              </div>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-pr-black-soft/60">
                <span>
                  {new Date(event.event_date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
                  {event.start_time ? ` · ${event.start_time.slice(0, 5)}` : ''}
                  {event.expected_attendees ? ` · ${event.expected_attendees} spectateurs` : ''}
                </span>
                {isMatch && (prevEvent || nextEvent) && (
                  <span className="flex items-center gap-2 text-pr-black-soft/45">
                    <span className="text-pr-stone">•</span>
                    {prevEvent && (
                      <Link to={`/admin/events/${prevEvent.event_id}`} className="hover:text-pr-olive hover:underline">← {prevEvent.event_name}</Link>
                    )}
                    {nextEvent && (
                      <Link to={`/admin/events/${nextEvent.event_id}`} className="hover:text-pr-olive hover:underline">{nextEvent.event_name} →</Link>
                    )}
                  </span>
                )}
              </p>
            </div>

            {/* Barre d'outils — mêmes actions, regroupées */}
            <div className="flex flex-wrap items-center gap-2">
              {!isClosed && (
                <>
                  <Button size="sm" variant={editMode ? 'primary' : 'secondary'} onClick={() => setEditMode((v) => !v)}>
                    <Pencil className="h-4 w-4" /> {editMode ? 'Fermer l’édition' : 'Modifier'}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setShowSpacesModal(true)}>
                    🏟️ Espaces ({spaces.length})
                  </Button>
                </>
              )}
              {(event.status === 'brouillon' || event.status === 'préparé') && (
                <Button size="sm" variant="secondary" loading={updating} onClick={() => void setStatus('en_cours')}>
                  Passer en cours
                </Button>
              )}
              {isMatch && (event.status === 'brouillon' || event.status === 'préparé') && (
                <Button size="sm" onClick={() => setShowRunnerModal(true)}>
                  <Zap className="h-4 w-4" /> Dotations runner
                </Button>
              )}
              <Link
                to={`/admin/events/${event.event_id}/planning`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-pr-stone bg-white px-3 py-2 text-sm font-medium text-pr-black-soft/70 transition-colors hover:bg-pr-cream"
              >
                <CalendarClock className="h-4 w-4" /> Planning
              </Link>
              {!isClosed && (
                <Button size="sm" loading={updating} onClick={() => void handleCloseEvent(event.event_name)}>
                  Clôturer
                </Button>
              )}
              {isMatch && (
                <EventResetButton eventId={event.event_id} eventName={event.event_name} onDone={() => window.location.reload()} />
              )}
              <DeleteEventButton event={{ event_id: event.event_id, event_name: event.event_name, event_type: event.event_type }} />
              {isClosed && (event.event_type === 'match' || event.event_type === 'séminaire') && (
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
            </div>
          </div>

          {/* Ligne 2 — compteurs clés + intégrité */}
          <div className="mt-4 flex flex-wrap items-stretch gap-2">
            <div className="rounded-xl border border-pr-stone bg-white px-3.5 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-pr-black-soft/45">Stocks soumis</p>
              <p className={clsx('font-display text-lg font-black tabular-nums', stats.spacesClosed >= stats.spacesTotal && stats.spacesTotal > 0 ? 'text-pr-olive-dark' : 'text-pr-black')}>
                {stats.spacesClosed}/{stats.spacesTotal}
              </p>
            </div>
            <div className="rounded-xl border border-pr-stone bg-white px-3.5 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-pr-black-soft/45">Débriefs</p>
              <p className="font-display text-lg font-black tabular-nums text-pr-black">
                {stats.debriefsReceived}/{stats.spacesTotal}
              </p>
            </div>
            <div className="flex min-w-[220px] flex-1 items-center">
              <IntegrityBadge eventId={event.event_id} />
            </div>
          </div>

          {/* Codes d'accès — repliés (ouverts tant que le match n'est pas clôturé) */}
          {isMatch && (
            <details className="group mt-3 rounded-xl border border-pr-stone bg-white" open={!isClosed}>
              <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3 font-display text-sm font-bold text-pr-black [&::-webkit-details-marker]:hidden">
                <svg className="h-4 w-4 text-pr-black-soft/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                Codes d'accès match
                <span className="text-xs font-medium text-pr-black-soft/40">· responsables de zone &amp; RH</span>
                <svg className="ml-auto h-4 w-4 text-pr-black-soft/40 transition-transform group-open:rotate-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg>
              </summary>
              <div className="space-y-4 border-t border-pr-stone/70 p-4">
                <MatchAccessCode eventId={event.event_id} code={event.match_access_code ?? null} eventName={event.event_name} />
                {event.rh_access_code && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
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
              </div>
            </details>
          )}
        </div>
      </div>

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
            setPhase('prep');
            setSub('dotations');
          }}
        />
      )}

      {/* Bilan post-match (clôturé) ou suivi live (en cours) */}
      {isMatch && (
        <div className="mb-5">
          {isClosed ? (
            <MatchClosedView
              eventId={event.event_id}
              eventName={event.event_name}
              paxCount={event.expected_attendees ?? 0}
            />
          ) : (
            <MatchLiveStatusPanel eventId={event.event_id} />
          )}
        </div>
      )}

      {/* Navigation en 4 phases (matchs) : Préparation → Jour J → Clôture → Résultats */}
      {isMatch && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {MATCH_PHASES.map((p) => (
            <button
              key={p.key}
              onClick={() => selectPhase(p.key)}
              className={clsx(
                'rounded-xl px-4 py-2 text-sm font-semibold transition-colors',
                phase === p.key
                  ? 'bg-provence text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Sous-onglets : phase active (matchs) ou onglets séminaire */}
      <div className="mb-5 flex flex-wrap gap-1 border-b border-slate-200">
        {(isMatch
          ? phaseSubs.map((s) => ({ key: s.key as string, label: s.label, active: activeSub === s.key, on: () => setSub(s.key) }))
          : SEMINAIRE_TABS.map((t) => ({ key: t.key as string, label: t.label, active: activeTab === t.key, on: () => setTab(t.key) }))
        ).map((t) => (
          <button
            key={t.key}
            onClick={t.on}
            className={clsx(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              t.active
                ? 'border-provence text-provence'
                : 'border-transparent text-slate-500 hover:text-slate-700',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Sélecteur d'espace (sous-onglets par espace) */}
      {isMatch && spaces.length > 0 && SPACE_SUBS.includes(activeSub) && (
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

      {/* ───────── Contenu séminaire ───────── */}
      {!isMatch && activeTab === 'espaces' && <SeminaireSpacesTab event={event} spaces={spaces} />}
      {!isMatch && activeTab === 'rh' && <SeminaireRhTab event={event} spaces={spaces} />}
      {!isMatch && activeTab === 'bilan' && <SeminaireBilanTab event={event} spaces={spaces} />}
      {!isMatch && activeTab === 'rapport' && <SeminarReportEditor event={event} />}
      {!isMatch && activeTab === 'debriefs' && (
        <div className="space-y-6">
          <section>
            <h2 className="mb-4 font-display text-lg font-bold text-pr-black">📸 Rapport photo &amp; terrain (retour régisseur)</h2>
            <StadeDebriefView eventId={event.event_id} />
          </section>
          <DebriefScoresGrid eventId={event.event_id} spaces={spaces} />
          <DebriefAdminPanel eventId={event.event_id} spaces={spaces} />
        </div>
      )}

      {/* ───────── Match · ① Préparation ───────── */}
      {isMatch && activeSub === 'pax' && (
        <div className="space-y-6">
          <VipPaxPanel eventId={event.event_id} />
          {selectedSpace && <SelectionGroupsPanel eventId={event.event_id} spaceId={selectedSpace} />}
        </div>
      )}
      {isMatch && activeSub === 'dotations' && (
        <div className="space-y-6">
          {selectedSpace ? (
            <StockDotationsTable eventId={event.event_id} spaceId={selectedSpace} />
          ) : (
            <Alert variant="info">Aucun espace activé pour cet événement.</Alert>
          )}
          <UnifiedRunnerPanel
            eventId={event.event_id}
            matchNom={event.event_name}
            matchDate={new Date(event.event_date).toLocaleDateString('fr-FR')}
          />
        </div>
      )}
      {isMatch && activeSub === 'route' && (
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
      {isMatch && activeSub === 'buvettes' && <BuvetteGroupsTab />}

      {/* ───────── Match · ② Jour J ───────── */}
      {isMatch && activeSub === 'saisie' && (
        <div className="space-y-6">
          {selectedSpace ? (
            <StockDotationsTable eventId={event.event_id} spaceId={selectedSpace} />
          ) : (
            <Alert variant="info">Aucun espace activé pour cet événement.</Alert>
          )}
        </div>
      )}
      {isMatch && activeSub === 'rh' && (
        <div className="space-y-6">
          {selectedSpace ? (
            <ScheduleAdminPanel eventId={event.event_id} spaceId={selectedSpace} />
          ) : (
            <Alert variant="info">Aucun espace activé pour cet événement.</Alert>
          )}
          <OccasionalHoursPanel eventId={event.event_id} eventDate={event.event_date} />
          <RhOperationalBoard eventId={event.event_id} />
          <StaffEventInsights event={event} />
        </div>
      )}

      {/* ───────── Match · ③ Clôture ───────── */}
      {isMatch && activeSub === 'final' && (
        <div className="space-y-6">
          <KegReconciliationPanel
            eventId={event.event_id}
            closed={event.status === 'clôturé' || event.status === 'archivé'}
          />
          {selectedSpace ? (
            <StockDotationsTable eventId={event.event_id} spaceId={selectedSpace} />
          ) : (
            <Alert variant="info">Aucun espace activé pour cet événement.</Alert>
          )}
        </div>
      )}
      {isMatch && activeSub === 'debriefs' && (
        <div className="space-y-6">
          <DebriefScoresGrid eventId={event.event_id} spaces={spaces} />
          <DebriefAdminPanel eventId={event.event_id} spaces={spaces} />
        </div>
      )}

      {/* ───────── Match · ④ Résultats ───────── */}
      {isMatch && activeSub === 'recettes' && (
        <RevenueMarginPanel
          eventId={event.event_id}
          spaces={spaces.map((s) => ({ space_id: s.space_id, space_name: s.spaces?.space_name ?? s.space_id }))}
        />
      )}
      {isMatch && activeSub === 'analyse' && <ConsumptionAnalysisTab event={event} />}
      {isMatch && activeSub === 'gpvip' && <MatchConsumptionReport eventId={event.event_id} />}
    </div>
  );
}
