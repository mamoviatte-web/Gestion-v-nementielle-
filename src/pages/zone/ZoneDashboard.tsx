import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Logo,
  Button,
  Input,
  Textarea,
  Alert,
  Badge,
  Spinner,
} from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import {
  getZoneState,
  submitDebrief,
  submitFinalStock,
  submitInitialStock,
  submitSchedule,
  uploadZonePhoto,
  validateZoneToken,
  type DebriefPayload,
  type ZoneInfo,
  type ZoneState,
} from '@/lib/zoneApi';

interface InitialForm {
  qty: string;
  state: string;
}
interface FinalForm {
  qty: string;
  state: string;
  anomaly: string;
}

/** Tableau de bord public « zone responsable » (stock, horaires, débrief). */
export default function ZoneDashboard() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const name = token ? localStorage.getItem(`zone:${token}:name`) : null;

  useEffect(() => {
    if (token && !name) navigate(`/zone/${token}`);
  }, [token, name, navigate]);

  const infoQuery = useQuery({
    queryKey: ['zoneValidate', token],
    queryFn: () => validateZoneToken(token!),
    enabled: Boolean(token),
  });

  const stateQuery = useQuery({
    queryKey: ['zoneState', token],
    queryFn: () => getZoneState(token!),
    enabled: Boolean(token),
  });

  if (!name) return null;

  if (infoQuery.isLoading || stateQuery.isLoading) {
    return <Spinner fullPage label="Chargement de votre espace…" />;
  }

  const info = infoQuery.data;
  const state = stateQuery.data;

  if (!info?.valid || !state?.valid) {
    return (
      <div className="mx-auto max-w-md p-4">
        <Alert variant="error" title="Code invalide ou expiré">
          Contactez l’équipe stade.
        </Alert>
      </div>
    );
  }

  const formattedDate = info.event_date
    ? new Date(info.event_date).toLocaleDateString('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '';

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['zoneState', token] });

  return (
    <div className="min-h-screen bg-pr-cream pb-16">
      <header className="sticky top-0 z-20 border-b border-pr-stone bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <Logo variant="mark" size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold capitalize text-pr-black">
              {info.space_name} · {info.event_name} · {formattedDate}
            </p>
            <p className="text-xs text-pr-black-soft">Bonjour {name}</p>
          </div>
        </div>
        <div className="mx-auto mt-2 flex max-w-2xl flex-wrap gap-2">
          <Badge tone={state.status.initial ? 'success' : 'warning'}>
            📦 Ouverture {state.status.initial ? '✅' : '⏳'}
          </Badge>
          <Badge tone={state.status.final ? 'success' : 'warning'}>
            📦 Clôture {state.status.final ? '✅' : '⏳'}
          </Badge>
          <Badge tone={state.status.debrief ? 'success' : 'warning'}>
            📋 Débrief {state.status.debrief ? '✅' : '⏳'}
          </Badge>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 p-4">
        <FeuilleRouteSection info={info} />
        <StockSection
          token={token!}
          name={name}
          state={state}
          onDone={invalidate}
          showToast={showToast}
        />
        <ScheduleSection
          token={token!}
          name={name}
          state={state}
          onDone={invalidate}
          showToast={showToast}
        />
        <DebriefSection
          token={token!}
          name={name}
          state={state}
          onDone={invalidate}
          showToast={showToast}
        />
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Section générique (carte pliable)                                   */
/* ------------------------------------------------------------------ */

interface SectionProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

function Section({ title, open, onToggle, children }: SectionProps) {
  return (
    <section className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-pr-stone">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-h-[44px] w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-pr-black"
      >
        <span>{title}</span>
        <span className="text-pr-black-soft">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="space-y-4 border-t border-pr-stone px-4 py-4">{children}</div>}
    </section>
  );
}

type ShowToast = (message: string, tone?: 'info' | 'success' | 'warning') => void;

/* ------------------------------------------------------------------ */
/* 1. Feuille de route                                                 */
/* ------------------------------------------------------------------ */

function FeuilleRouteSection({ info }: { info: ZoneInfo }) {
  const [open, setOpen] = useState(true);
  return (
    <Section title="📄 Feuille de route" open={open} onToggle={() => setOpen((v) => !v)}>
      {info.feuille_route_url ? (
        <div className="space-y-3">
          <p className="text-sm text-pr-black">
            {info.feuille_route_name ?? 'Document'}
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={info.feuille_route_url}
              download
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-pr-black px-4 py-2 text-sm font-medium text-pr-white"
            >
              Télécharger
            </a>
            <a
              href={info.feuille_route_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-pr-black ring-1 ring-inset ring-pr-stone"
            >
              Ouvrir
            </a>
          </div>
        </div>
      ) : (
        <p className="text-sm text-pr-black-soft">Aucune feuille de route jointe.</p>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Stocks                                                           */
/* ------------------------------------------------------------------ */

interface StockSectionProps {
  token: string;
  name: string;
  state: ZoneState;
  onDone: () => void;
  showToast: ShowToast;
}

function StockSection({ token, name, state, onDone, showToast }: StockSectionProps) {
  const [open, setOpen] = useState(true);
  const [initial, setInitial] = useState<Record<string, InitialForm>>({});
  const [final, setFinal] = useState<Record<string, FinalForm>>({});
  const [savingInitial, setSavingInitial] = useState(false);
  const [savingFinal, setSavingFinal] = useState(false);

  const linesById = useMemo(() => {
    const map: Record<string, ZoneState['stock_lines'][number]> = {};
    for (const l of state.stock_lines) map[l.product_id] = l;
    return map;
  }, [state.stock_lines]);

  // Amélioration 1 : le stock final ne concerne que les produits déclarés à
  // l'ouverture (initial_qty > 0 OU reassort_qty > 0), calculé depuis la base
  // pour persister au rechargement.
  const finalProducts = useMemo(
    () =>
      state.products.filter((p) => {
        const l = linesById[p.product_id];
        return l != null && ((l.initial_qty ?? 0) > 0 || (l.reassort_qty ?? 0) > 0);
      }),
    [state.products, linesById],
  );

  useEffect(() => {
    const nextInitial: Record<string, InitialForm> = {};
    const nextFinal: Record<string, FinalForm> = {};
    for (const p of state.products) {
      const l = linesById[p.product_id];
      nextInitial[p.product_id] = {
        qty: l && l.initial_qty != null ? String(l.initial_qty) : '',
        state: l?.product_state ?? 'fermé',
      };
      nextFinal[p.product_id] = {
        qty: l && l.final_qty != null ? String(l.final_qty) : '',
        state: l?.product_state ?? 'fermé',
        anomaly: '',
      };
    }
    setInitial(nextInitial);
    setFinal(nextFinal);
  }, [state.products, linesById]);

  async function saveInitial() {
    setSavingInitial(true);
    try {
      const lines = state.products
        .map((p) => {
          const f = initial[p.product_id];
          const qty = f?.qty.trim() === '' ? NaN : Number(f?.qty);
          return { product_id: p.product_id, qty, state: f?.state ?? null };
        })
        .filter((l) => !Number.isNaN(l.qty));
      await submitInitialStock(token, name, lines);
      showToast('Ouverture validée.', 'success');
      onDone();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur à l’enregistrement.', 'warning');
    } finally {
      setSavingInitial(false);
    }
  }

  async function saveFinal() {
    setSavingFinal(true);
    try {
      const lines = finalProducts
        .map((p) => {
          const f = final[p.product_id];
          const qty = f?.qty.trim() === '' ? NaN : Number(f?.qty);
          return {
            product_id: p.product_id,
            final_qty: qty,
            state: f?.state ?? null,
            anomaly: f?.anomaly.trim() ? f.anomaly.trim() : null,
          };
        })
        .filter((l) => !Number.isNaN(l.final_qty));
      await submitFinalStock(token, name, lines);
      showToast('Clôture validée.', 'success');
      onDone();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur à l’enregistrement.', 'warning');
    } finally {
      setSavingFinal(false);
    }
  }

  return (
    <Section title="📦 Stocks" open={open} onToggle={() => setOpen((v) => !v)}>
      {/* Stock initial */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-pr-black">Stock initial</h3>
        <div className="space-y-3">
          {state.products.map((p) => (
            <div
              key={p.product_id}
              className="grid grid-cols-1 gap-2 rounded-lg bg-pr-cream/60 p-3 sm:grid-cols-[1fr_auto]"
            >
              <div className="text-sm font-medium text-pr-black">
                {p.product_name}
                <span className="ml-1 text-xs text-pr-black-soft">({p.unit})</span>
              </div>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={0}
                  value={initial[p.product_id]?.qty ?? ''}
                  onChange={(e) =>
                    setInitial((prev) => ({
                      ...prev,
                      [p.product_id]: {
                        ...(prev[p.product_id] ?? { qty: '', state: 'fermé' }),
                        qty: e.target.value,
                      },
                    }))
                  }
                  placeholder="Qté"
                  className="min-h-[44px] w-24"
                />
              </div>
            </div>
          ))}
        </div>
        <Button
          variant="primary"
          fullWidth
          loading={savingInitial}
          onClick={saveInitial}
          className="min-h-[44px]"
        >
          Valider l’ouverture ✓
        </Button>
      </div>

      {/* Stock final */}
      <div className="space-y-3 border-t border-pr-stone pt-4">
        <h3 className="text-sm font-semibold text-pr-black">Stock final</h3>
        {!state.status.initial ? (
          <p className="text-sm text-pr-black-soft">
            Disponible après validation de l’ouverture.
          </p>
        ) : finalProducts.length === 0 ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            ⚠️ Aucun stock initial saisi. Revenez à l’étape précédente pour déclarer
            vos stocks d’ouverture avant de clôturer.
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm text-stone-500">
              {finalProducts.length} produit(s) à renseigner — uniquement ceux
              déclarés à l’ouverture.
            </p>
            <div className="space-y-3">
              {finalProducts.map((p) => {
                const line = linesById[p.product_id];
                const initialQty = line?.initial_qty ?? 0;
                const reassortQty = line?.reassort_qty ?? 0;
                const available = initialQty + reassortQty;
                const rawQty = final[p.product_id]?.qty ?? '';
                const finalQty =
                  rawQty.trim() === '' ? null : Number(rawQty);
                const overStock =
                  finalQty != null && !Number.isNaN(finalQty) && finalQty > available;
                return (
                  <div
                    key={p.product_id}
                    className="space-y-2 rounded-lg bg-pr-cream/60 p-3"
                  >
                    <div className="text-sm font-medium text-pr-black">
                      {p.product_name}
                      <span className="ml-1 text-xs text-pr-black-soft">({p.unit})</span>
                    </div>
                    <p className="text-xs text-stone-400">
                      Initial déclaré : {initialQty} {p.unit}
                      {reassortQty > 0 ? ` + ${reassortQty} réassort` : ''}
                    </p>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        min={0}
                        value={final[p.product_id]?.qty ?? ''}
                        onChange={(e) =>
                          setFinal((prev) => ({
                            ...prev,
                            [p.product_id]: {
                              ...(prev[p.product_id] ?? {
                                qty: '',
                                state: 'fermé',
                                anomaly: '',
                              }),
                              qty: e.target.value,
                            },
                          }))
                        }
                        placeholder="Qté restante"
                        className={
                          overStock ? 'min-h-[44px] w-32 border-red-400' : 'min-h-[44px] w-32'
                        }
                      />
                    </div>
                    {overStock && (
                      <p className="mt-1 text-xs text-red-600">
                        ⚠️ Stock final supérieur au stock initial — vérifiez la saisie
                        ou ajoutez un commentaire explicatif.
                      </p>
                    )}
                    <Input
                      value={final[p.product_id]?.anomaly ?? ''}
                      onChange={(e) =>
                        setFinal((prev) => ({
                          ...prev,
                          [p.product_id]: {
                            ...(prev[p.product_id] ?? {
                              qty: '',
                              state: 'fermé',
                              anomaly: '',
                            }),
                            anomaly: e.target.value,
                          },
                        }))
                      }
                      placeholder="Commentaire / anomalie (facultatif)"
                      className="min-h-[44px]"
                    />
                  </div>
                );
              })}
            </div>
            <Button
              variant="primary"
              fullWidth
              loading={savingFinal}
              onClick={saveFinal}
              className="min-h-[44px]"
            >
              Valider la clôture
            </Button>
          </>
        )}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Horaires                                                         */
/* ------------------------------------------------------------------ */

interface ScheduleSectionProps {
  token: string;
  name: string;
  state: ZoneState;
  onDone: () => void;
  showToast: ShowToast;
}

function ScheduleSection({ token, name, state, onDone, showToast }: ScheduleSectionProps) {
  const [open, setOpen] = useState(false);
  const [staffName, setStaffName] = useState(
    (state.staff_name ?? name).toUpperCase(),
  );
  const [arrival, setArrival] = useState('');
  const [departure, setDeparture] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStaffName((state.staff_name ?? name).toUpperCase());
  }, [state.staff_name, name]);

  useEffect(() => {
    setArrival(state.arrival ? state.arrival.slice(0, 5) : '');
    setDeparture(state.departure ? state.departure.slice(0, 5) : '');
  }, [state.arrival, state.departure]);

  async function save() {
    setSaving(true);
    try {
      await submitSchedule(token, name, arrival || null, departure || null, staffName);
      showToast('Horaires enregistrés.', 'success');
      onDone();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur à l’enregistrement.', 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="🕐 Horaires" open={open} onToggle={() => setOpen((v) => !v)}>
      <div>
        <Input
          label="Votre nom et prénom *"
          value={staffName}
          onChange={(e) => setStaffName(e.target.value.toUpperCase())}
          placeholder="NOM PRÉNOM"
          className="min-h-[44px] uppercase tracking-wide"
        />
        <p className="mt-1 text-xs text-stone-400">
          Ce nom apparaîtra dans les rapports horaires mensuels.
        </p>
      </div>
      <p className="text-sm text-pr-black-soft">
        Arrivée prévue : {state.planned_start ? state.planned_start.slice(0, 5) : '—'}
      </p>
      <Input
        label="Mon arrivée réelle"
        type="time"
        value={arrival}
        onChange={(e) => setArrival(e.target.value)}
        className="min-h-[44px]"
      />
      <Input
        label="Mon départ réel"
        type="time"
        value={departure}
        onChange={(e) => setDeparture(e.target.value)}
        className="min-h-[44px]"
      />
      <label className="flex min-h-[44px] items-center gap-2 text-sm text-pr-black">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="h-5 w-5 rounded border-pr-stone"
        />
        Je confirme mes horaires
      </label>
      <Button
        variant="primary"
        fullWidth
        loading={saving}
        disabled={!confirmed || staffName.trim().length < 2}
        onClick={save}
        className="min-h-[44px]"
      >
        Valider
      </Button>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* 4. Débrief & photos                                                 */
/* ------------------------------------------------------------------ */

/* --- Sous-composants du débrief enrichi --- */

const SCORE_LABELS = ['', 'Insuffisant', 'Passable', 'Correct', 'Bien', 'Excellent'];

interface StarRatingProps {
  value: number;
  onChange: (v: number) => void;
}
function StarRating({ value, onChange }: StarRatingProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-label={`${n} étoile(s)`}
            className="min-h-[44px] min-w-[44px] text-2xl leading-none"
          >
            <span className={n <= value ? 'text-amber-400' : 'text-stone-300'}>★</span>
          </button>
        ))}
      </div>
      <span className="text-xs text-stone-500">{SCORE_LABELS[value] ?? ''}</span>
    </div>
  );
}

interface CheckboxGroupProps {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}
function CheckboxGroup({ options, value, onChange }: CheckboxGroupProps) {
  const toggle = (opt: string) =>
    onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);
  return (
    <div className="space-y-1">
      {options.map((opt) => (
        <label
          key={opt}
          className="flex min-h-[44px] items-center gap-2 text-sm text-pr-black"
        >
          <input
            type="checkbox"
            checked={value.includes(opt)}
            onChange={() => toggle(opt)}
            className="h-5 w-5 rounded border-pr-stone"
          />
          {opt}
        </label>
      ))}
    </div>
  );
}

interface CheckItemProps {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}
function CheckItem({ label, value, onChange }: CheckItemProps) {
  return (
    <label className="flex min-h-[44px] items-center gap-2 text-sm text-pr-black">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 rounded border-pr-stone"
      />
      {label}
    </label>
  );
}

interface YesNoButtonsProps {
  value: boolean | null;
  onChange: (v: boolean) => void;
}
function YesNoButtons({ value, onChange }: YesNoButtonsProps) {
  return (
    <div className="flex gap-2">
      <Button
        variant={value === true ? 'primary' : 'secondary'}
        onClick={() => onChange(true)}
        className="min-h-[44px]"
      >
        Oui
      </Button>
      <Button
        variant={value === false ? 'danger' : 'secondary'}
        onClick={() => onChange(false)}
        className="min-h-[44px]"
      >
        Non
      </Button>
    </div>
  );
}

interface BlockProps {
  title: string;
  accent?: 'red';
  defaultOpen?: boolean;
  children: ReactNode;
}
function Block({ title, accent, defaultOpen, children }: BlockProps) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div
      className={
        accent === 'red'
          ? 'overflow-hidden rounded-lg border border-red-300'
          : 'overflow-hidden rounded-lg border border-pr-stone'
      }
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[44px] w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold text-pr-black"
      >
        <span>{title}</span>
        <span className="text-pr-black-soft">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="space-y-3 border-t border-pr-stone px-3 py-3">{children}</div>}
    </div>
  );
}

const OVERALL_OPTIONS: { value: string; label: string; active: string }[] = [
  { value: 'très_bien', label: 'Très bien', active: 'border-green-500 bg-green-50 text-green-700' },
  { value: 'bien', label: 'Bien', active: 'border-teal-500 bg-teal-50 text-teal-700' },
  { value: 'moyen', label: 'Moyen', active: 'border-amber-500 bg-amber-50 text-amber-700' },
  { value: 'difficile', label: 'Difficile', active: 'border-red-500 bg-red-50 text-red-700' },
];

const CLEANING_ISSUE_OPTIONS = [
  'Sol non nettoyé à l’ouverture',
  'Poubelles non vidées',
  'Tables non nettoyées',
  'Toilettes insuffisamment propres',
  'Matériel non rangé',
  'Déchets laissés par le prestataire précédent',
  'Ménage de fin non réalisé',
];

const TECH_ISSUE_OPTIONS = [
  'Frigo en panne ou insuffisant',
  'Éclairage défaillant',
  'Fuite d’eau / plomberie',
  'Climatisation hors service',
  'Équipement bar cassé / manquant',
  'Prise électrique défaillante',
  'Porte / accès défaillant',
  'Sono / audio défaillant',
];

interface DebriefSectionProps {
  token: string;
  name: string;
  state: ZoneState;
  onDone: () => void;
  showToast: ShowToast;
}

function DebriefSection({ token, name, state, onDone, showToast }: DebriefSectionProps) {
  const [open, setOpen] = useState(false);
  // 1. Bilan général
  const [overallRating, setOverallRating] = useState('');
  const [serviceScore, setServiceScore] = useState(0);
  const [stocksOk, setStocksOk] = useState<boolean | null>(null);
  const [missing, setMissing] = useState('');
  const [notes, setNotes] = useState('');
  // 2. Ménage & propreté
  const [cleaningScore, setCleaningScore] = useState(0);
  const [cleaningBeforeOk, setCleaningBeforeOk] = useState(false);
  const [cleaningAfterOk, setCleaningAfterOk] = useState(false);
  const [cleaningIssues, setCleaningIssues] = useState<string[]>([]);
  const [cleaningComment, setCleaningComment] = useState('');
  // 3. État technique
  const [technicalScore, setTechnicalScore] = useState(0);
  const [techFridgeOk, setTechFridgeOk] = useState(false);
  const [techEquipmentOk, setTechEquipmentOk] = useState(false);
  const [techLightingOk, setTechLightingOk] = useState(false);
  const [techPlumbingOk, setTechPlumbingOk] = useState(false);
  const [techHvacOk, setTechHvacOk] = useState(false);
  const [techIssues, setTechIssues] = useState<string[]>([]);
  const [technicalComment, setTechnicalComment] = useState('');
  // 4. Signalement urgent
  const [hasUrgentIssue, setHasUrgentIssue] = useState<boolean | null>(null);
  const [urgentIssueDetail, setUrgentIssueDetail] = useState('');
  // 5. Photos
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const d = state.debrief;
    if (!d) return;
    setOverallRating(d.overall_rating ?? '');
    setServiceScore(d.service_score ?? 0);
    setStocksOk(d.stocks_suffisants === 'Oui' ? true : d.stocks_suffisants === 'Non' ? false : null);
    setNotes(d.suggestions_generales ?? '');
    setCleaningScore(d.cleaning_score ?? 0);
    setCleaningBeforeOk(d.cleaning_before_ok ?? false);
    setCleaningAfterOk(d.cleaning_after_ok ?? false);
    setCleaningIssues(d.cleaning_issues ?? []);
    setCleaningComment(d.cleaning_comment ?? '');
    setTechnicalScore(d.technical_score ?? 0);
    setTechFridgeOk(d.tech_fridge_ok ?? false);
    setTechEquipmentOk(d.tech_equipment_ok ?? false);
    setTechLightingOk(d.tech_lighting_ok ?? false);
    setTechPlumbingOk(d.tech_plumbing_ok ?? false);
    setTechHvacOk(d.tech_hvac_ok ?? false);
    setTechIssues(d.tech_issues ?? []);
    setTechnicalComment(d.technical_comment ?? '');
    setHasUrgentIssue(d.has_urgent_issue ?? null);
    setUrgentIssueDetail(d.urgent_issue_detail ?? '');
    setPhotos(d.photo_urls ?? []);
  }, [state.debrief]);

  const unlocked = state.status.initial;

  async function handleFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const remaining = 6 - photos.length;
      const toUpload = Array.from(files).slice(0, remaining);
      const urls: string[] = [];
      for (const file of toUpload) {
        urls.push(await uploadZonePhoto(token, file));
      }
      setPhotos((prev) => [...prev, ...urls]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Échec de l’envoi de la photo.', 'warning');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function save() {
    if (!overallRating) {
      showToast('Veuillez indiquer votre bilan général.', 'warning');
      return;
    }
    const stocksOkString =
      stocksOk === true
        ? 'Oui'
        : stocksOk === false
          ? missing.trim()
            ? `Non — manque : ${missing.trim()}`
            : 'Non'
          : '';
    const payload: DebriefPayload = {
      overall_rating: overallRating || null,
      service_score: serviceScore || null,
      cleaning_score: cleaningScore || null,
      cleaning_before_ok: cleaningBeforeOk,
      cleaning_after_ok: cleaningAfterOk,
      cleaning_issues: cleaningIssues,
      cleaning_comment: cleaningComment || null,
      technical_score: technicalScore || null,
      tech_fridge_ok: techFridgeOk,
      tech_equipment_ok: techEquipmentOk,
      tech_lighting_ok: techLightingOk,
      tech_plumbing_ok: techPlumbingOk,
      tech_hvac_ok: techHvacOk,
      tech_issues: techIssues,
      technical_comment: technicalComment || null,
      has_urgent_issue: hasUrgentIssue ?? false,
      urgent_issue_detail: urgentIssueDetail || null,
    };
    setSaving(true);
    try {
      await submitDebrief(token, name, overallRating || '', stocksOkString, notes, photos, payload);
      showToast('Débrief soumis. Merci !', 'success');
      onDone();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur à la soumission.', 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="📋 Débrief & photos" open={open} onToggle={() => setOpen((v) => !v)}>
      {!unlocked ? (
        <p className="text-sm text-pr-black-soft">
          Disponible après validation de l’ouverture.
        </p>
      ) : (
        <>
          <Block title="🎯 Bilan général" defaultOpen>
            <div className="space-y-2">
              <p className="text-sm font-medium text-pr-black">
                Comment s’est passé l’événement ?
              </p>
              <div className="flex flex-wrap gap-2">
                {OVERALL_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setOverallRating(o.value)}
                    className={`min-h-[44px] rounded-lg border px-4 py-2 text-sm font-medium ${
                      overallRating === o.value
                        ? o.active
                        : 'border-pr-stone bg-white text-pr-black'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-pr-black">Qualité du service</p>
              <StarRating value={serviceScore} onChange={setServiceScore} />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-pr-black">Stocks suffisants ?</p>
              <YesNoButtons value={stocksOk} onChange={setStocksOk} />
              {stocksOk === false && (
                <Textarea
                  label="Produits manquants"
                  value={missing}
                  onChange={(e) => setMissing(e.target.value)}
                  placeholder="Précisez les produits manquants…"
                />
              )}
            </div>

            <Textarea
              label="Observations"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Vos remarques et suggestions…"
            />
          </Block>

          <Block title="🧹 Ménage & propreté">
            <div className="space-y-2">
              <p className="text-sm font-medium text-pr-black">Note de propreté</p>
              <StarRating value={cleaningScore} onChange={setCleaningScore} />
            </div>
            <div className="space-y-1">
              <CheckItem
                label="Espace propre à l’ouverture"
                value={cleaningBeforeOk}
                onChange={setCleaningBeforeOk}
              />
              <CheckItem
                label="Espace propre à la fermeture"
                value={cleaningAfterOk}
                onChange={setCleaningAfterOk}
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-pr-black">Problèmes constatés</p>
              <CheckboxGroup
                options={CLEANING_ISSUE_OPTIONS}
                value={cleaningIssues}
                onChange={setCleaningIssues}
              />
            </div>
            <Textarea
              label="Commentaire propreté"
              value={cleaningComment}
              onChange={(e) => setCleaningComment(e.target.value)}
              placeholder="Précisions éventuelles…"
            />
          </Block>

          <Block title="🔧 État technique">
            <div className="space-y-2">
              <p className="text-sm font-medium text-pr-black">Note technique</p>
              <StarRating value={technicalScore} onChange={setTechnicalScore} />
            </div>
            <div className="space-y-1">
              <CheckItem
                label="Réfrigération / frigos OK"
                value={techFridgeOk}
                onChange={setTechFridgeOk}
              />
              <CheckItem
                label="Équipements bar / service OK"
                value={techEquipmentOk}
                onChange={setTechEquipmentOk}
              />
              <CheckItem
                label="Éclairage OK"
                value={techLightingOk}
                onChange={setTechLightingOk}
              />
              <CheckItem
                label="Plomberie / éviers OK"
                value={techPlumbingOk}
                onChange={setTechPlumbingOk}
              />
              <CheckItem
                label="Climatisation / chauffage OK"
                value={techHvacOk}
                onChange={setTechHvacOk}
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-pr-black">Problèmes constatés</p>
              <CheckboxGroup
                options={TECH_ISSUE_OPTIONS}
                value={techIssues}
                onChange={setTechIssues}
              />
            </div>
            <Textarea
              label="Commentaire technique"
              value={technicalComment}
              onChange={(e) => setTechnicalComment(e.target.value)}
              placeholder="Précisions éventuelles…"
            />
          </Block>

          <Block title="🚨 Signalement urgent" accent="red">
            <div className="space-y-2">
              <p className="text-sm font-medium text-pr-black">
                Un problème urgent doit-il être signalé ?
              </p>
              <YesNoButtons value={hasUrgentIssue} onChange={setHasUrgentIssue} />
              {hasUrgentIssue === true && (
                <Textarea
                  label="Détail du problème urgent"
                  value={urgentIssueDetail}
                  onChange={(e) => setUrgentIssueDetail(e.target.value)}
                  placeholder="Décrivez le problème urgent…"
                  className="border-red-400"
                />
              )}
            </div>
          </Block>

          <Block title="📷 Photos">
            <div className="space-y-2">
              <p className="text-sm font-medium text-pr-black">Photos (max 6)</p>
              {photos.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {photos.map((url) => (
                    <img
                      key={url}
                      src={url}
                      alt="Photo débrief"
                      className="h-16 w-16 rounded object-cover ring-1 ring-pr-stone"
                    />
                  ))}
                </div>
              )}
              <label
                className={
                  photos.length >= 6
                    ? 'inline-flex min-h-[44px] cursor-not-allowed items-center rounded-lg bg-pr-stone/60 px-4 py-2 text-sm text-pr-black-soft'
                    : 'inline-flex min-h-[44px] cursor-pointer items-center rounded-lg bg-white px-4 py-2 text-sm font-medium text-pr-black ring-1 ring-inset ring-pr-stone'
                }
              >
                {uploading ? 'Envoi…' : photos.length >= 6 ? 'Limite atteinte' : 'Ajouter des photos'}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={photos.length >= 6 || uploading}
                  onChange={handleFiles}
                  className="hidden"
                />
              </label>
            </div>
          </Block>

          <Button
            variant="primary"
            fullWidth
            loading={saving}
            onClick={save}
            className="min-h-[44px]"
          >
            ✅ Soumettre mon débrief
          </Button>
        </>
      )}
    </Section>
  );
}
