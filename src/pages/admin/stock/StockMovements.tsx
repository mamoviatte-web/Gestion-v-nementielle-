import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeftRight, Plus, X } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Input,
  Select,
  Spinner,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Textarea,
  type SelectOption,
} from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';
import {
  useRecordMovement,
  useStockLocations,
  useStockMovementsJournal,
} from '@/hooks/useStockV2';
import { useSpaces } from '@/hooks/useSpaces';
import { useCatalog } from '@/hooks/useCatalog';
import { useEventsList } from '@/hooks/useEvents';
import {
  MOVEMENT_TYPE_V2_LABELS,
  MOVEMENT_TYPE_V2_SIGN,
} from '@/lib/stockCalculations';
import type {
  StatusTone,
  StockMovementTypeV2,
  StockMovementView,
} from '@/lib/types';

/** Les 7 types de mouvement V2 dans l'ordre d'affichage. */
const V2_TYPES: StockMovementTypeV2[] = [
  'entrée_fournisseur',
  'transfert_espace',
  'réassort_événement',
  'retour_réutilisable',
  'consommation',
  'perte_casse',
  'correction',
];

/** Tonalité de badge selon le type de mouvement. */
function movementTone(type: string): StatusTone {
  if (type === 'consommation' || type === 'perte_casse') return 'danger';
  if (type === 'entrée_fournisseur' || type === 'retour_réutilisable')
    return 'success';
  return 'neutral';
}

const LIMIT_OPTIONS: SelectOption[] = [
  { value: '50', label: '50 derniers' },
  { value: '100', label: '100 derniers' },
  { value: '200', label: '200 derniers' },
];

/** Overlay modal réutilisable. */
function Shell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-pr-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-pr-black">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-lg p-1 text-pr-black-soft hover:bg-pr-stone/60"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Journal chronologique des mouvements de stock + modale de saisie. */
export default function StockMovements() {
  const { user } = useAuth();

  const [movementType, setMovementType] = useState('');
  const [spaceId, setSpaceId] = useState('');
  const [productId, setProductId] = useState('');
  const [limit, setLimit] = useState('100');
  const [modalOpen, setModalOpen] = useState(false);

  const spacesQuery = useSpaces();
  const { products } = useCatalog();

  const journal = useStockMovementsJournal({
    movementType: movementType || undefined,
    spaceId: spaceId || undefined,
    productId: productId || undefined,
    limit: Number(limit),
  });

  const typeOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: 'Tous les types' },
      ...V2_TYPES.map((t) => ({ value: t, label: MOVEMENT_TYPE_V2_LABELS[t] ?? t })),
    ],
    [],
  );

  const spaceOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: 'Tous les espaces' },
      ...(spacesQuery.data ?? []).map((s) => ({
        value: s.space_id,
        label: s.space_name,
      })),
    ],
    [spacesQuery.data],
  );

  const productOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: 'Tous les produits' },
      ...(products.data ?? []).map((p) => ({
        value: p.product_id,
        label: p.product_name,
      })),
    ],
    [products.data],
  );

  const rows: StockMovementView[] = journal.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            label="Type de mouvement"
            options={typeOptions}
            value={movementType}
            onChange={(e) => setMovementType(e.target.value)}
          />
          <Select
            label="Espace"
            options={spaceOptions}
            value={spaceId}
            onChange={(e) => setSpaceId(e.target.value)}
          />
          <Select
            label="Produit"
            options={productOptions}
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
          />
          <Select
            label="Affichage"
            options={LIMIT_OPTIONS}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
        </div>
        <Button onClick={() => setModalOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          Nouveau mouvement
        </Button>
      </div>

      {journal.isLoading ? (
        <Spinner label="Chargement du journal…" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ArrowLeftRight}
          title="Aucun mouvement"
          message="Aucun mouvement ne correspond aux filtres sélectionnés."
          action={
            <Button variant="secondary" onClick={() => setModalOpen(true)}>
              Enregistrer un mouvement
            </Button>
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Date</TH>
              <TH>Produit</TH>
              <TH>Mouvement</TH>
              <TH className="text-right">Qté</TH>
              <TH>De →</TH>
              <TH>Vers</TH>
              <TH>Resp.</TH>
              <TH>Événement</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={row.movement_id}>
                <TD className="whitespace-nowrap text-slate-500">
                  {new Date(row.created_at).toLocaleString('fr-FR', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </TD>
                <TD>{row.product?.product_name ?? '—'}</TD>
                <TD>
                  <Badge tone={movementTone(row.movement_type)}>
                    {MOVEMENT_TYPE_V2_LABELS[row.movement_type] ?? row.movement_type}
                  </Badge>
                </TD>
                <TD className="whitespace-nowrap text-right font-medium">
                  {(MOVEMENT_TYPE_V2_SIGN[row.movement_type] ?? '') + row.qty}
                </TD>
                <TD>{row.from_location?.name ?? '—'}</TD>
                <TD>{row.to_location?.name ?? '—'}</TD>
                <TD>{row.responsable_nom}</TD>
                <TD>{row.event?.event_name ?? '—'}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {modalOpen && (
        <MovementModal
          onClose={() => setModalOpen(false)}
          defaultResponsable={user?.name ?? ''}
        />
      )}
    </div>
  );
}

/** Modale de création d'un nouveau mouvement de stock. */
function MovementModal({
  onClose,
  defaultResponsable,
}: {
  onClose: () => void;
  defaultResponsable: string;
}) {
  const { showToast } = useToast();
  const { record, recording } = useRecordMovement();

  const { products } = useCatalog();
  const locationsQuery = useStockLocations();
  const eventsQuery = useEventsList();

  const [type, setType] = useState<StockMovementTypeV2>('entrée_fournisseur');
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('');
  const [fromLocationId, setFromLocationId] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [responsable, setResponsable] = useState(defaultResponsable);
  const [eventId, setEventId] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  const typeOptions = useMemo<SelectOption[]>(
    () => V2_TYPES.map((t) => ({ value: t, label: MOVEMENT_TYPE_V2_LABELS[t] ?? t })),
    [],
  );
  const productOptions = useMemo<SelectOption[]>(
    () =>
      (products.data ?? []).map((p) => ({
        value: p.product_id,
        label: p.product_name,
      })),
    [products.data],
  );
  const locationOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: 'Aucun' },
      ...(locationsQuery.data ?? []).map((l) => ({ value: l.id, label: l.name })),
    ],
    [locationsQuery.data],
  );
  const eventOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: 'Aucun' },
      ...(eventsQuery.data ?? []).map((e) => ({
        value: e.event_id,
        label: e.event_name,
      })),
    ],
    [eventsQuery.data],
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const qtyNum = Number(qty);
    if (!productId) {
      setError('Sélectionnez un produit.');
      return;
    }
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setError('La quantité doit être un nombre supérieur à 0.');
      return;
    }
    if (responsable.trim().length < 2) {
      setError('Le nom du responsable est obligatoire (min. 2 caractères).');
      return;
    }
    if (type === 'correction' && comment.trim().length < 2) {
      setError('Un commentaire est obligatoire pour une correction (RG-004).');
      return;
    }

    try {
      await record({
        movementType: type,
        productId,
        qty: qtyNum,
        fromLocationId: fromLocationId || null,
        toLocationId: toLocationId || null,
        responsableNom: responsable.trim(),
        eventId: eventId || null,
        unitPriceHt: undefined,
        isAnomaly: type === 'correction' || type === 'perte_casse',
      });
      showToast('Mouvement enregistré.', 'success');
      onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Échec de l'enregistrement.";
      showToast(message, 'warning');
    }
  }

  return (
    <Shell title="Nouveau mouvement" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <Alert variant="warning">{error}</Alert>}

        <Select
          label="Type de mouvement"
          options={typeOptions}
          value={type}
          onChange={(e) => setType(e.target.value as StockMovementTypeV2)}
        />
        <Select
          label="Produit"
          placeholder="Sélectionner un produit"
          options={productOptions}
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
        />
        <Input
          label="Quantité"
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label="De (source)"
            options={locationOptions}
            value={fromLocationId}
            onChange={(e) => setFromLocationId(e.target.value)}
          />
          <Select
            label="Vers (destination)"
            options={locationOptions}
            value={toLocationId}
            onChange={(e) => setToLocationId(e.target.value)}
          />
        </div>
        <Input
          label="Responsable"
          value={responsable}
          onChange={(e) => setResponsable(e.target.value)}
          hint="Traçabilité nominative obligatoire (RG-001)."
        />
        <Select
          label="Événement (optionnel)"
          options={eventOptions}
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
        />
        <Textarea
          label={
            type === 'correction' ? 'Commentaire (obligatoire)' : 'Commentaire (optionnel)'
          }
          rows={2}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" loading={recording}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Shell>
  );
}
