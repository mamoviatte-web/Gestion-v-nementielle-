/**
 * Onglet « Par espace » du module Stock (CDC V2).
 *
 * Vue croisée réserve centrale × espace : pour chaque produit du catalogue,
 * affiche la quantité en réserve, la quantité dans l'espace sélectionné,
 * l'état (critique / OK) et le dernier mouvement. Trois actions localisées
 * (transfert vers l'espace, retour réutilisable, perte/casse) passent par
 * `recordMovement` (RG-002 : INSERT stock_movements avant UPDATE balances).
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownToLine, PackageOpen, Warehouse } from 'lucide-react';

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
} from '@/components/ui';
import type { SelectOption } from '@/components/ui/Select';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useCatalog } from '@/hooks/useCatalog';
import { useSpaces } from '@/hooks/useSpaces';
import {
  useRecordMovement,
  useReserveLocation,
  useStockBalances,
  useStockLocations,
} from '@/hooks/useStockV2';
import { formatEuro } from '@/lib/calculations';
import { isStockCritical } from '@/lib/stockCalculations';
import type {
  Product,
  ProductCategory,
  StockBalanceView,
  StockLocation,
  StockMovementTypeV2,
} from '@/lib/types';

/* ------------------------------------------------------------------ */
/* Constantes & options de filtre                                      */
/* ------------------------------------------------------------------ */

const CATEGORIES: ProductCategory[] = [
  'Vins',
  'Bières',
  'Soft',
  'Sirops',
  'Spiritueux',
  'Matériel',
];

const FAMILY_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'Toutes les familles' },
  ...CATEGORIES.map((c) => ({ value: c, label: c })),
];

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'Tous les statuts' },
  { value: 'alert', label: 'En alerte' },
  { value: 'dormant', label: 'Dormant' },
];

/** Actions de mouvement disponibles depuis une ligne. */
type ActionKind = 'transfert' | 'retour' | 'perte';

interface ActionConfig {
  title: string;
  movementType: StockMovementTypeV2;
  submitLabel: string;
  requiresComment: boolean;
}

const ACTION_CONFIG: Record<ActionKind, ActionConfig> = {
  transfert: {
    title: 'Transférer vers l’espace',
    movementType: 'transfert_espace',
    submitLabel: 'Transférer',
    requiresComment: false,
  },
  retour: {
    title: 'Saisir un retour réutilisable',
    movementType: 'retour_réutilisable',
    submitLabel: 'Enregistrer le retour',
    requiresComment: false,
  },
  perte: {
    title: 'Déclarer une perte / casse',
    movementType: 'perte_casse',
    submitLabel: 'Déclarer',
    requiresComment: true,
  },
};

/** Solde d'un produit dans une liste de soldes (par emplacement). */
function findBalance(
  balances: StockBalanceView[] | undefined,
  productId: string,
): StockBalanceView | undefined {
  return balances?.find((b) => b.product_id === productId);
}

/* ------------------------------------------------------------------ */
/* Modale de mouvement (réutilisable pour les 3 actions)               */
/* ------------------------------------------------------------------ */

interface MovementModalProps {
  kind: ActionKind;
  product: Product;
  reserveId: string | null;
  spaceLocationId: string;
  spaceId: string | null;
  defaultResponsable: string;
  recording: boolean;
  onClose: () => void;
  onSubmit: (params: {
    kind: ActionKind;
    product: Product;
    qty: number;
    responsableNom: string;
    comment: string;
  }) => Promise<void>;
}

function MovementModal({
  kind,
  product,
  defaultResponsable,
  recording,
  onClose,
  onSubmit,
}: MovementModalProps) {
  const config = ACTION_CONFIG[kind];
  const [qty, setQty] = useState('');
  const [responsableNom, setResponsableNom] = useState(defaultResponsable);
  const [comment, setComment] = useState('');
  const [touched, setTouched] = useState(false);

  const qtyNum = Number(qty);
  const qtyError =
    touched && (!Number.isFinite(qtyNum) || qtyNum <= 0)
      ? 'Quantité obligatoire (> 0).'
      : null;
  const nameError =
    touched && responsableNom.trim().length < 2
      ? 'Nom du responsable requis (min. 2 caractères) — RG-001.'
      : null;
  const commentError =
    config.requiresComment && touched && comment.trim().length === 0
      ? 'Motif obligatoire pour une perte/casse — RG-004.'
      : null;

  const canSubmit =
    qtyNum > 0 &&
    responsableNom.trim().length >= 2 &&
    (!config.requiresComment || comment.trim().length > 0);

  const handleSubmit = async () => {
    setTouched(true);
    if (!canSubmit) return;
    await onSubmit({
      kind,
      product,
      qty: qtyNum,
      responsableNom: responsableNom.trim(),
      comment: comment.trim(),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-pr-black/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-pr-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-lg text-pr-black">{config.title}</h3>
        <p className="mt-1 text-sm text-pr-black-soft">
          {product.product_name}{' '}
          <span className="text-pr-stone">({product.unit})</span>
        </p>

        <div className="mt-4 space-y-3">
          <Input
            label="Quantité"
            type="number"
            min={1}
            inputMode="numeric"
            value={qty}
            error={qtyError}
            onChange={(e) => setQty(e.target.value)}
          />
          <Input
            label="Responsable (RG-001)"
            value={responsableNom}
            error={nameError}
            placeholder="Nom du responsable"
            onChange={(e) => setResponsableNom(e.target.value)}
          />
          {config.requiresComment && (
            <Textarea
              label="Motif (obligatoire)"
              value={comment}
              placeholder="Décrire la perte ou la casse…"
              onChange={(e) => setComment(e.target.value)}
            />
          )}
          {commentError && <Alert variant="warning">{commentError}</Alert>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={recording}>
            Annuler
          </Button>
          <Button
            variant={kind === 'perte' ? 'danger' : 'primary'}
            loading={recording}
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
          >
            {config.submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Onglet principal                                                    */
/* ------------------------------------------------------------------ */

interface ActiveModal {
  kind: ActionKind;
  product: Product;
}

export default function StockBySpace() {
  const { user } = useAuth();
  const { showToast } = useToast();

  const { data: locations } = useStockLocations();
  const reserve = useReserveLocation();
  const { data: spaces } = useSpaces();
  const { products } = useCatalog();
  const { record, recording } = useRecordMovement();

  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [family, setFamily] = useState('all');
  const [status, setStatus] = useState('all');
  const [modal, setModal] = useState<ActiveModal | null>(null);

  // Emplacements de type « espace » uniquement.
  const spaceLocations = useMemo<StockLocation[]>(
    () => (locations ?? []).filter((l) => l.location_type === 'espace'),
    [locations],
  );

  const spaceOptions = useMemo<SelectOption[]>(
    () => spaceLocations.map((l) => ({ value: l.id, label: l.name })),
    [spaceLocations],
  );

  const selectedLocation = spaceLocations.find((l) => l.id === selectedLocationId) ?? null;
  const reserveId = reserve?.id ?? null;

  const reserveBalances = useStockBalances(reserveId ?? undefined);
  const spaceBalances = useStockBalances(selectedLocationId || undefined);

  const spaceName = useMemo(() => {
    if (!selectedLocation) return null;
    const match = (spaces ?? []).find((s) => s.space_id === selectedLocation.area_id);
    return match?.space_name ?? selectedLocation.name;
  }, [selectedLocation, spaces]);

  // Produits actifs, filtrés par famille + statut.
  const rows = useMemo(() => {
    const activeProducts = (products.data ?? []).filter((p) => p.active);
    return activeProducts
      .filter((p) => (family === 'all' ? true : p.category === family))
      .map((product) => {
        const reserveBal = findBalance(reserveBalances.data, product.product_id);
        const spaceBal = findBalance(spaceBalances.data, product.product_id);
        const reserveQty = reserveBal?.current_quantity ?? 0;
        const spaceQty = spaceBal?.current_quantity ?? 0;
        const minStock = product.min_stock ?? product.stock_min;
        const critical = isStockCritical(spaceQty, minStock);
        const lastMovement = spaceBal?.last_movement_at ?? null;
        return { product, reserveQty, spaceQty, minStock, critical, lastMovement };
      })
      .filter((r) => {
        if (status === 'alert') return r.critical;
        // « Dormant » : placeholder (aucun filtre spécifique pour l'instant).
        return true;
      });
  }, [products.data, family, status, reserveBalances.data, spaceBalances.data]);

  const handleMovementSubmit = async (params: {
    kind: ActionKind;
    product: Product;
    qty: number;
    responsableNom: string;
    comment: string;
  }) => {
    if (!selectedLocationId) return;
    const config = ACTION_CONFIG[params.kind];

    let fromLocationId: string | null = null;
    let toLocationId: string | null = null;
    if (params.kind === 'transfert') {
      fromLocationId = reserveId;
      toLocationId = selectedLocationId;
    } else if (params.kind === 'retour') {
      fromLocationId = selectedLocationId;
      toLocationId = reserveId;
    } else {
      // perte / casse : sortie de l'espace, anomalie.
      fromLocationId = selectedLocationId;
      toLocationId = null;
    }

    await record({
      movementType: config.movementType,
      productId: params.product.product_id,
      qty: params.qty,
      fromLocationId,
      toLocationId,
      responsableNom: params.responsableNom,
      spaceId: selectedLocation?.area_id ?? null,
      unitPriceHt: params.product.unit_price_ht,
      isAnomaly: params.kind === 'perte',
    });

    showToast(
      params.kind === 'transfert'
        ? 'Transfert enregistré.'
        : params.kind === 'retour'
          ? 'Retour enregistré.'
          : 'Perte / casse déclarée.',
      params.kind === 'perte' ? 'warning' : 'success',
    );
    setModal(null);
  };

  const balancesLoading =
    !!selectedLocationId && (reserveBalances.isLoading || spaceBalances.isLoading);

  return (
    <div className="space-y-4">
      {/* Filtres */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Select
          label="Espace"
          placeholder="Sélectionner un espace"
          options={spaceOptions}
          value={selectedLocationId}
          onChange={(e) => setSelectedLocationId(e.target.value)}
        />
        <Select
          label="Famille de produits"
          options={FAMILY_OPTIONS}
          value={family}
          onChange={(e) => setFamily(e.target.value)}
        />
        <Select
          label="Statut"
          options={STATUS_OPTIONS}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        />
      </div>

      {!reserveId && (
        <Alert variant="warning" title="Réserve centrale introuvable">
          Aucun emplacement « réserve centrale » n’est configuré : les transferts
          et retours sont indisponibles.
        </Alert>
      )}

      {!selectedLocationId ? (
        <EmptyState
          icon={Warehouse}
          title="Sélectionnez un espace"
          message="Choisissez un espace pour visualiser ses stocks et déclencher des mouvements."
        />
      ) : balancesLoading ? (
        <Spinner label="Chargement des soldes…" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={PackageOpen}
          title="Aucun produit"
          message="Aucun produit ne correspond aux filtres sélectionnés."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg ring-1 ring-pr-stone/40">
          <Table>
            <THead>
              <TR>
                <TH className="text-left">Produit</TH>
                <TH className="text-left">Famille</TH>
                <TH className="text-right">Qté réserve</TH>
                <TH className="text-right">Qté espace</TH>
                <TH className="text-left">État</TH>
                <TH className="text-left">Dernier mouvement</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => (
                <TR key={row.product.product_id}>
                  <TD className="font-medium text-pr-black">
                    {row.product.product_name}
                    {row.product.unit_price_ht !== null && (
                      <span className="ml-2 text-xs text-pr-stone">
                        {formatEuro(row.product.unit_price_ht)}
                      </span>
                    )}
                  </TD>
                  <TD>{row.product.category}</TD>
                  <TD className="text-right tabular-nums">{row.reserveQty}</TD>
                  <TD className="text-right tabular-nums">{row.spaceQty}</TD>
                  <TD>
                    {row.critical ? (
                      <Badge tone="danger">
                        🔴 CRITIQUE (min : {row.minStock})
                      </Badge>
                    ) : (
                      <Badge tone="success">OK</Badge>
                    )}
                  </TD>
                  <TD>
                    {row.lastMovement
                      ? new Date(row.lastMovement).toLocaleDateString('fr-FR')
                      : '—'}
                  </TD>
                  <TD className="text-right">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!reserveId}
                        onClick={() =>
                          setModal({ kind: 'transfert', product: row.product })
                        }
                      >
                        <ArrowDownToLine className="mr-1 h-3.5 w-3.5" />
                        Transférer
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!reserveId}
                        onClick={() =>
                          setModal({ kind: 'retour', product: row.product })
                        }
                      >
                        Retour
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() =>
                          setModal({ kind: 'perte', product: row.product })
                        }
                      >
                        <AlertTriangle className="mr-1 h-3.5 w-3.5" />
                        Perte
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}

      {selectedLocationId && spaceName && (
        <p className="text-xs text-pr-stone">
          Espace sélectionné : {spaceName} · {rows.length} produit
          {rows.length > 1 ? 's' : ''} affiché{rows.length > 1 ? 's' : ''}
        </p>
      )}

      {modal && selectedLocationId && (
        <MovementModal
          kind={modal.kind}
          product={modal.product}
          reserveId={reserveId}
          spaceLocationId={selectedLocationId}
          spaceId={selectedLocation?.area_id ?? null}
          defaultResponsable={user?.name ?? ''}
          recording={recording}
          onClose={() => setModal(null)}
          onSubmit={handleMovementSubmit}
        />
      )}
    </div>
  );
}
