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
  Select,
  Textarea,
  Alert,
  Badge,
  Spinner,
} from '@/components/ui';
import type { SelectOption } from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import {
  getZoneState,
  submitDebrief,
  submitFinalStock,
  submitInitialStock,
  submitSchedule,
  uploadZonePhoto,
  validateZoneToken,
  type ZoneInfo,
  type ZoneState,
} from '@/lib/zoneApi';

/** États produit possibles (RG-004 / clôture). */
const STATE_OPTIONS: SelectOption[] = [
  { value: 'fermé', label: 'Fermé' },
  { value: 'ouvert', label: 'Ouvert' },
  { value: 'cassé', label: 'Cassé' },
  { value: 'perdu', label: 'Perdu' },
  { value: 'périmé', label: 'Périmé' },
  { value: 'fût_vide', label: 'Fût vide' },
  { value: 'fût_percuté', label: 'Fût percuté' },
];

const RATINGS = ['Très bien', 'Bien', 'Moyen', 'Difficile'] as const;

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
      const lines = state.products
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
                <Select
                  options={STATE_OPTIONS}
                  value={initial[p.product_id]?.state ?? 'fermé'}
                  onChange={(e) =>
                    setInitial((prev) => ({
                      ...prev,
                      [p.product_id]: {
                        ...(prev[p.product_id] ?? { qty: '', state: 'fermé' }),
                        state: e.target.value,
                      },
                    }))
                  }
                  className="min-h-[44px]"
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
        ) : (
          <>
            <div className="space-y-3">
              {state.products.map((p) => (
                <div
                  key={p.product_id}
                  className="space-y-2 rounded-lg bg-pr-cream/60 p-3"
                >
                  <div className="text-sm font-medium text-pr-black">
                    {p.product_name}
                    <span className="ml-1 text-xs text-pr-black-soft">({p.unit})</span>
                  </div>
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
                      className="min-h-[44px] w-32"
                    />
                    <Select
                      options={STATE_OPTIONS}
                      value={final[p.product_id]?.state ?? 'fermé'}
                      onChange={(e) =>
                        setFinal((prev) => ({
                          ...prev,
                          [p.product_id]: {
                            ...(prev[p.product_id] ?? {
                              qty: '',
                              state: 'fermé',
                              anomaly: '',
                            }),
                            state: e.target.value,
                          },
                        }))
                      }
                      className="min-h-[44px]"
                    />
                  </div>
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
              ))}
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
  const [arrival, setArrival] = useState('');
  const [departure, setDeparture] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setArrival(state.arrival ? state.arrival.slice(0, 5) : '');
    setDeparture(state.departure ? state.departure.slice(0, 5) : '');
  }, [state.arrival, state.departure]);

  async function save() {
    setSaving(true);
    try {
      await submitSchedule(token, name, arrival || null, departure || null);
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
        disabled={!confirmed}
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

interface DebriefSectionProps {
  token: string;
  name: string;
  state: ZoneState;
  onDone: () => void;
  showToast: ShowToast;
}

function DebriefSection({ token, name, state, onDone, showToast }: DebriefSectionProps) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState('');
  const [stocksOk, setStocksOk] = useState('');
  const [missing, setMissing] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const d = state.debrief;
    if (d && d.submitted_at) {
      setRating(d.efficacite ?? '');
      setStocksOk(d.stocks_suffisants ?? '');
      setMissing(d.besoins_materiel ?? '');
      setNotes(d.suggestions_generales ?? '');
      setPhotos(d.photo_urls ?? []);
    }
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
    if (!rating) {
      showToast('Veuillez indiquer votre appréciation.', 'warning');
      return;
    }
    const stocksOkValue = stocksOk === 'Non' && missing.trim() ? `Non — manque : ${missing.trim()}` : stocksOk;
    setSaving(true);
    try {
      await submitDebrief(token, name, rating, stocksOkValue, notes, photos);
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
          <div className="space-y-2">
            <p className="text-sm font-medium text-pr-black">Comment s’est passé l’événement ?</p>
            <div className="flex flex-wrap gap-2">
              {RATINGS.map((r) => (
                <Button
                  key={r}
                  variant={rating === r ? 'primary' : 'secondary'}
                  onClick={() => setRating(r)}
                  className="min-h-[44px]"
                >
                  {r}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-pr-black">Stocks suffisants ?</p>
            <div className="flex gap-2">
              <Button
                variant={stocksOk === 'Oui' ? 'primary' : 'secondary'}
                onClick={() => setStocksOk('Oui')}
                className="min-h-[44px]"
              >
                Oui
              </Button>
              <Button
                variant={stocksOk === 'Non' ? 'danger' : 'secondary'}
                onClick={() => setStocksOk('Non')}
                className="min-h-[44px]"
              >
                Non
              </Button>
            </div>
            {stocksOk === 'Non' && (
              <Input
                value={missing}
                onChange={(e) => setMissing(e.target.value)}
                placeholder="manque : "
                className="min-h-[44px]"
              />
            )}
          </div>

          <Textarea
            label="Observations"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Vos remarques et suggestions…"
          />

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
