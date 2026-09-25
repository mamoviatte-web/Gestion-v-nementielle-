import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { clsx } from 'clsx';
import { useEvent, useEventSpaces, useEventActions, useEventsList } from '@/hooks/useEvents';
import { useEventStats } from '@/hooks/useEventStats';
import { EVENT_STATUS_META } from '@/lib/labels';
import { StockDotationsTable } from '@/components/stock/StockDotationsTable';
import { PetitMaterielPanel } from '@/components/stock/PetitMaterielPanel';
import { PETIT_MATERIEL_ENABLED } from '@/lib/featureFlags';
import { KegClosureAudit } from '@/components/stock/KegClosureAudit';
import { KegBlockModal, type KegDefaut } from '@/components/stock/KegBlockModal';
import { ScheduleAdminPanel } from '@/components/schedule/ScheduleAdminPanel';
import { DebriefAdminPanel } from '@/components/debrief/DebriefAdminPanel';
import { UnifiedRunnerPanel } from '@/components/runner/UnifiedRunnerPanel';
import { ExpertDotationPanel } from '@/components/runner/ExpertDotationPanel';
import { ReserveProcurementPanel } from '@/components/runner/ReserveProcurementPanel';
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
import { Alert, Badge, Button, Spinner, StatTile } from '@/components/ui';
import { Zap, CalendarClock, Pencil, AlertTriangle, RefreshCw, Building2, FileSpreadsheet, Copy, Lock, ChevronRight } from 'lucide-react';
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
  | 'gpvip'
  | 'petit_materiel'; // Préparation (drapeau PETIT_MATERIEL_ENABLED)

/** Sous-onglets par phase : la même donnée montée au même endroit qu'avant. */
const MATCH_PHASES: { key: Phase; label: string; subs: { key: MatchSub; label: string }[] }[] = [
  {
    key: 'prep',
    label: '① Préparation',
    subs: [
      { key: 'pax', label: '📍 Espaces & pax' },
      { key: 'dotations', label: '📦 Dotations & runner' },
      { key: 'route', label: '📄 Feuille de route' },
      { key: 'buvettes', label: '🍺 Buvettes' },
    ],
  },
  {
    key: 'jourj',
    label: '② Jour J',
    subs: [
      { key: 'saisie', label: '✍️ Saisie stock' },
      { key: 'rh', label: '⏱ Horaires / RH' },
    ],
  },
  {
    key: 'cloture',
    label: '③ Clôture',
    subs: [
      // Fûts déplacés dans un volet interne repliable (voir onglet) — la clôture
      // se concentre sur l'essentiel : sécuriser le stock final.
      { key: 'final', label: '📦 Stock final' },
      { key: 'debriefs', label: '📝 Débriefs' },
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
const SPACE_SUBS: MatchSub[] = ['pax', 'dotations', 'saisie', 'rh', 'final', 'petit_materiel'];

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
  const navigate = useNavigate();
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
  const [recaling, setRecaling] = useState(false);
  const [kegBlock, setKegBlock] = useState<{ eventName: string; defauts: KegDefaut[]; ancrage: boolean } | null>(null);
  // R1 : blocage de clôture tant que les données ne sont pas fiables.
  const [closureIssues, setClosureIssues] = useState<ClosureCheck | null>(null);

  // Clôture effective (une fois les données jugées fiables ou forcées).
  // force=true : passe outre l'avertissement fûts (l'utilisateur a confirmé).
  async function doClose(eventName: string, force = false) {
    try {
      let kegNotice = force ? ' — défauts fûts forcés' : '';
      // ── Opérateur de contrôle des fûts — AVANT de figer la clôture ──
      // Défauts bloquants → modale d'avertissement forte (stoppe la clôture).
      // Non bloquant / ancrage périmé → simple notice au toast.
      if (!force && eventQuery.data?.event_type === 'match' && id) {
        try {
          const { data: aud } = await supabase.rpc('audit_keg_closure', { p_event_id: id });
          const a = aud as { nb_defauts?: number; ancrage_perime?: boolean; defauts?: KegDefaut[] } | null;
          if (a) {
            const bloquants = (a.defauts ?? []).filter((d) => d.gravite === 'bloquant');
            if (bloquants.length > 0) {
              setKegBlock({ eventName, defauts: a.defauts ?? [], ancrage: !!a.ancrage_perime });
              return; // la modale prend le relais (Annuler / Clôturer quand même)
            }
            if ((a.nb_defauts ?? 0) > 0 || a.ancrage_perime) {
              kegNotice = a.ancrage_perime ? ' — comptage fûts à refaire' : ` — ${a.nb_defauts} point(s) de vigilance fûts`;
            }
          }
        } catch (auditErr) {
          console.error('Contrôle fûts:', auditErr);
        }
      }

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
      showToast(`Événement « ${eventName} » clôturé${kegNotice}.`, kegNotice ? 'warning' : 'success');
      // Recharge INTÉGRALE : tous les calculs (F&B, conso, marge, fûts) repartent
      // des données figées — évite les états partiels en cache.
      window.location.reload();
    } catch (err) {
      console.error('Erreur clôture:', err);
      showToast(`Impossible de clôturer : ${err instanceof Error ? err.message : 'erreur inconnue'}`, 'warning');
    }
  }

  // Recale le solde des espaces « à stock conservé » sur le restant réel de la
  // clôture (idempotent). Utile après correction d'un stock final : les fiches
  // runner du match suivant reflètent alors le stock déjà sur place.
  async function handleRecalerEspaces() {
    if (!id) return;
    setRecaling(true);
    const { data, error } = await supabase.rpc('finalize_event_espace_stocks', { p_event_id: id });
    const r = data as { success?: boolean; error?: string; espaces_recales?: number; lignes_recalees?: number } | null;
    setRecaling(false);
    if (error || !r?.success) {
      showToast(`Échec du recalage : ${r?.error ?? error?.message ?? 'erreur inconnue'}`, 'warning');
      return;
    }
    showToast(`Stocks espaces recalés : ${r.espaces_recales ?? 0} espace(s), ${r.lignes_recalees ?? 0} ligne(s). Les fiches runner reflètent le stock restant.`, 'success');
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
  // Onglet « Petit matériel » (Préparation) — visible uniquement si le drapeau est
  // activé ; sinon phaseSubs reste strictement identique à l'existant.
  const phaseSubs =
    PETIT_MATERIEL_ENABLED && activePhaseDef.key === 'prep'
      ? [...activePhaseDef.subs, { key: 'petit_materiel' as MatchSub, label: '🧰 Petit matériel' }]
      : activePhaseDef.subs;
  const activeSub: MatchSub = phaseSubs.some((s) => s.key === sub) ? sub : phaseSubs[0].key;
  // Séminaires : onglets simples inchangés.
  const activeTab: Tab = SEMINAIRE_TABS.some((t) => t.key === tab) ? tab : SEMINAIRE_TABS[0].key;

  const isClosed = event.status === 'clôturé' || event.status === 'archivé';
  const isStarted = event.status !== 'brouillon' && event.status !== 'préparé';
  // Avancement du protocole (matchs) : une phase est « terminée » quand son
  // étape opérationnelle a franchi son jalon. Sert au stepper de navigation.
  const phaseDone: Record<Phase, boolean> = {
    prep: isStarted,
    jourj: isClosed || stats.spacesClosed > 0,
    cloture: isClosed,
    resultats: false, // les résultats sont l'aboutissement, jamais « terminés »
  };
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
                    <Building2 className="h-4 w-4" /> Espaces ({spaces.length})
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
              <Button size="sm" variant="secondary" onClick={() => navigate(`/admin/events/${event.event_id}/planning`)}>
                <CalendarClock className="h-4 w-4" /> Planning
              </Button>
              {!isClosed && (
                <Button size="sm" loading={updating} onClick={() => void handleCloseEvent(event.event_name)}>
                  Clôturer
                </Button>
              )}
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
                  <FileSpreadsheet className="h-4 w-4" /> Rapport Excel
                </Button>
              )}
              {isClosed && isMatch && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={recaling}
                  onClick={() => void handleRecalerEspaces()}
                  title="Recale le solde des espaces sur le stock restant de la clôture (à relancer après correction d'un stock final)"
                >
                  <RefreshCw className="h-4 w-4" /> Recaler les stocks espaces
                </Button>
              )}
              {/* Actions destructives — regroupées et séparées visuellement */}
              <span className="mx-0.5 hidden h-6 w-px self-center bg-pr-stone sm:block" aria-hidden />
              {isMatch && (
                <EventResetButton eventId={event.event_id} eventName={event.event_name} onDone={() => window.location.reload()} />
              )}
              <DeleteEventButton event={{ event_id: event.event_id, event_name: event.event_name, event_type: event.event_type }} />
            </div>
          </div>

          {/* Ligne 2 — compteurs clés + intégrité */}
          <div className="mt-4 flex flex-wrap items-stretch gap-2">
            <StatTile
              label="Stocks soumis"
              value={`${stats.spacesClosed}/${stats.spacesTotal}`}
              tone={stats.spacesClosed >= stats.spacesTotal && stats.spacesTotal > 0 ? 'good' : 'default'}
            />
            <StatTile label="Débriefs" value={`${stats.debriefsReceived}/${stats.spacesTotal}`} />
            <div className="flex min-w-[220px] flex-1 items-center">
              <IntegrityBadge eventId={event.event_id} />
            </div>
          </div>

          {/* Codes d'accès — repliés par défaut (on déplie au moment de partager
              les codes) pour garder le haut de fiche concentré. */}
          {isMatch && (
            <details className="group mt-3 rounded-xl border border-pr-stone bg-white">
              <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3 font-display text-sm font-bold text-pr-black [&::-webkit-details-marker]:hidden">
                <Lock size={16} className="text-pr-black-soft/50" />
                Codes d'accès match
                <span className="text-xs font-medium text-pr-black-soft/40">· responsables de zone &amp; RH</span>
                <ChevronRight size={16} className="ml-auto text-pr-black-soft/40 transition-transform group-open:rotate-90" />
              </summary>
              <div className="space-y-4 border-t border-pr-stone/70 p-4">
                <MatchAccessCode eventId={event.event_id} code={event.match_access_code ?? null} eventName={event.event_name} />
                {event.rh_access_code && (
                  <div className="rounded-xl border border-pr-gold/40 bg-pr-gold/10 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-pr-black-soft/60">Code accès Responsable RH</p>
                        <p className="font-display text-3xl font-black tracking-[0.25em] text-pr-black">{event.rh_access_code}</p>
                        <p className="mt-1 text-xs text-pr-black-soft/50">À communiquer uniquement à la responsable RH · Valide pour ce match uniquement</p>
                      </div>
                      <button
                        onClick={() => {
                          void navigator.clipboard.writeText(event.rh_access_code ?? '');
                          showToast('Code RH copié.', 'success');
                        }}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-pr-black px-3 py-2 text-xs font-bold text-pr-cream transition-colors hover:bg-pr-black-soft"
                      >
                        <Copy size={13} /> Copier
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

      {/* Protocole en 4 étapes (matchs) : Préparation → Jour J → Clôture → Résultats */}
      {isMatch && (
        <nav aria-label="Protocole du match" className="mb-4">
          <ol className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-0">
            {MATCH_PHASES.map((p, i) => {
              const active = phase === p.key;
              const done = phaseDone[p.key];
              const label = p.label.replace(/^[①②③④]\s*/, '');
              const state = active ? 'En cours' : done ? 'Terminé' : 'À venir';
              return (
                <li key={p.key} className="flex flex-1 items-center">
                  <button
                    onClick={() => selectPhase(p.key)}
                    aria-current={active ? 'step' : undefined}
                    className={clsx(
                      'group flex flex-1 items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors',
                      active ? 'bg-pr-black' : 'hover:bg-pr-stone/50',
                    )}
                  >
                    <span
                      className={clsx(
                        'grid h-7 w-7 shrink-0 place-items-center rounded-full font-display text-xs font-black transition-colors',
                        active
                          ? 'bg-pr-gold text-pr-black'
                          : done
                            ? 'bg-pr-olive text-white'
                            : 'border border-pr-stone bg-white text-pr-black-soft/50',
                      )}
                    >
                      {done && !active ? '✓' : i + 1}
                    </span>
                    <span className="min-w-0">
                      <span
                        className={clsx(
                          'block truncate font-display text-sm font-bold leading-tight',
                          active ? 'text-pr-cream' : 'text-pr-black',
                        )}
                      >
                        {label}
                      </span>
                      <span
                        className={clsx(
                          'block text-[11px] font-medium leading-tight',
                          active ? 'text-pr-gold' : done ? 'text-pr-olive' : 'text-pr-black-soft/40',
                        )}
                      >
                        {state}
                      </span>
                    </span>
                  </button>
                  {i < MATCH_PHASES.length - 1 && (
                    <span
                      aria-hidden
                      className={clsx(
                        'mx-1 hidden h-px flex-1 sm:block',
                        done ? 'bg-pr-olive' : 'bg-pr-stone',
                      )}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      )}

      {/* Bilan post-match (clôturé) ou suivi live (en cours) — sous le protocole */}
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

      {/* Sous-onglets : phase active (matchs) ou onglets séminaire — barre segmentée + sélecteur d'espace inline */}
      {(() => {
        const showSpaceSelect = isMatch && spaces.length > 0 && SPACE_SUBS.includes(activeSub);
        return (
          <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-pr-stone bg-white p-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="flex flex-wrap items-center gap-1">
              {(isMatch
                ? phaseSubs.map((s) => ({ key: s.key as string, label: s.label, active: activeSub === s.key, on: () => setSub(s.key) }))
                : SEMINAIRE_TABS.map((t) => ({ key: t.key as string, label: t.label, active: activeTab === t.key, on: () => setTab(t.key) }))
              ).map((t) => (
                <button
                  key={t.key}
                  onClick={t.on}
                  aria-current={t.active ? 'page' : undefined}
                  className={clsx(
                    'rounded-xl px-3 py-2 text-sm font-semibold transition-colors',
                    t.active
                      ? 'bg-pr-black text-pr-cream shadow-sm'
                      : 'text-pr-black-soft/55 hover:bg-pr-stone/50 hover:text-pr-black',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Sélecteur d'espace (sous-onglets par espace) — inline dans la barre */}
            {showSpaceSelect && (
              <div className="flex shrink-0 items-center gap-2 border-t border-pr-stone/70 px-1.5 pt-2 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
                <span className="flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold uppercase tracking-wider text-pr-black-soft/45">
                  <Building2 size={13} /> Espace
                </span>
                <div className="relative">
                  <select
                    value={selectedSpace}
                    onChange={(e) => setSpaceId(e.target.value)}
                    className="w-full cursor-pointer appearance-none rounded-xl border border-pr-stone bg-pr-cream/60 py-2 pl-3 pr-9 text-sm font-medium text-pr-black transition-colors hover:border-pr-black-soft/30 focus:border-pr-olive focus:outline-none focus:ring-2 focus:ring-pr-olive/20 sm:min-w-[180px]"
                  >
                    {spaces.map((s) => (
                      <option key={s.space_id} value={s.space_id}>
                        {s.spaces?.space_name ?? s.space_id}
                      </option>
                    ))}
                  </select>
                  <ChevronRight size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rotate-90 text-pr-black-soft/40" />
                </div>
              </div>
            )}
          </div>
        );
      })()}

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
          <ExpertDotationPanel eventId={event.event_id} />
          <ReserveProcurementPanel eventId={event.event_id} />
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
      {isMatch && PETIT_MATERIEL_ENABLED && activeSub === 'petit_materiel' && (
        <div className="space-y-6">
          {selectedSpace ? (
            <PetitMaterielPanel eventId={event.event_id} spaceId={selectedSpace} />
          ) : (
            <Alert variant="info">Aucun espace activé pour cet événement.</Alert>
          )}
        </div>
      )}

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
      {/* Priorité à l'ESSENTIEL : sécuriser les stocks finaux (conso/coûts en
          découlent). La logistique fûts (mouvements, consignes brasseur) est
          conservée mais REPLIÉE dans une « cachette » interne — elle reste
          disponible sans alourdir la clôture ni masquer les chiffres. Le
          garde-fou fûts continue de s'exécuter au clic « Clôturer » (KegBlockModal),
          indépendamment de l'ouverture de ce volet. */}
      {isMatch && activeSub === 'final' && (
        <div className="space-y-6">
          {selectedSpace ? (
            <StockDotationsTable eventId={event.event_id} spaceId={selectedSpace} />
          ) : (
            <Alert variant="info">Aucun espace activé pour cet événement.</Alert>
          )}

          <details className="group overflow-hidden rounded-2xl border border-pr-stone bg-white">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-semibold text-pr-black-soft/70 transition-colors hover:bg-pr-cream/40">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-base">🍺</span>
                Logistique fûts — interne
                <span className="rounded-full bg-pr-stone/60 px-2 py-0.5 text-[11px] font-medium text-pr-black-soft/60">
                  contrôle &amp; réconciliation
                </span>
              </span>
              <span className="shrink-0 text-xs text-pr-black-soft/40 transition-transform group-open:rotate-180">▼</span>
            </summary>
            <div className="space-y-6 border-t border-pr-stone px-4 py-5 sm:px-5">
              <p className="text-xs text-pr-black-soft/50">
                Suivi des mouvements de fûts (vides à rentrer, pleins retournés / gardés). Usage
                logistique interne — sans effet sur les chiffres de consommation et de coûts.
              </p>
              <KegClosureAudit eventId={event.event_id} />
              <KegReconciliationPanel
                eventId={event.event_id}
                closed={event.status === 'clôturé' || event.status === 'archivé'}
              />
            </div>
          </details>
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

      {kegBlock && (
        <KegBlockModal
          eventName={kegBlock.eventName}
          defauts={kegBlock.defauts}
          ancragePerime={kegBlock.ancrage}
          onCancel={() => {
            const n = kegBlock.defauts.filter((d) => d.gravite === 'bloquant').length;
            setKegBlock(null);
            showToast(`Clôture annulée — corrigez les ${n} défaut(s) fûts signalé(s), puis relancez.`, 'warning');
          }}
          onForce={() => {
            const nm = kegBlock.eventName;
            setKegBlock(null);
            void doClose(nm, true);
          }}
        />
      )}
    </div>
  );
}
