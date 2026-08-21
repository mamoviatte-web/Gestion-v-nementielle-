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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownToLine, ClipboardCheck, Info, PackageOpen, Warehouse } from 'lucide-react';
import { supabase } from '@/lib/supabase';

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
/* Modale « Inventaire espace » — recale le stock réel de l'espace      */
/* ------------------------------------------------------------------ */

interface InventoryLine {
  product: Product;
  spaceQty: number;
}

function InventoryModal({
  spaceId,
  spaceName,
  lines,
  defaultResponsable,
  onClose,
  onSaved,
}: {
  spaceId: string;
  spaceName: string;
  lines: InventoryLine[];
  defaultResponsable: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Valeur comptée par produit (pré-remplie avec la quantité espace actuelle).
  const [counts, setCounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.product.product_id, String(l.spaceQty)])),
  );
  const [responsable, setResponsable] = useState(defaultResponsable);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = lines.filter((l) => {
    const v = counts[l.product.product_id];
    return v !== undefined && v !== '' && Number.isFinite(Number(v)) && Number(v) !== l.spaceQty;
  });

  async function handleSave() {
    setError(null);
    if (responsable.trim().length < 2) {
      setError('Nom du responsable requis (min. 2 caractères) — RG-001.');
      return;
    }
    if (dirty.length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    for (const l of dirty) {
      const { data, error: rpcErr } = await supabase.rpc('record_area_inventory', {
        p_space: spaceId,
        p_product: l.product.product_id,
        p_count: Number(counts[l.product.product_id]),
        p_by: responsable.trim(),
      });
      const r = data as { success?: boolean; error?: string } | null;
      if (rpcErr || !r?.success) {
        setSaving(false);
        setError(r?.error ?? rpcErr?.message ?? 'Échec de l’inventaire.');
        return;
      }
    }
    setSaving(false);
    onSaved();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-pr-black/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-pr-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="flex items-center gap-2 font-display text-lg text-pr-black">
          <ClipboardCheck className="h-5 w-5 text-pr-olive" /> Inventaire espace — {spaceName}
        </h3>
        <p className="mt-1 text-sm text-pr-black-soft">
          Saisissez le stock réel compté sur place. La quantité de l’espace s’aligne sur le
          comptage (traçable et daté) et sert de stock d’ouverture au prochain match.
        </p>

        <div className="mt-3">
          <Input
            label="Responsable (RG-001)"
            value={responsable}
            placeholder="Nom du responsable"
            onChange={(e) => setResponsable(e.target.value)}
          />
        </div>

        <div className="mt-3 overflow-x-auto rounded-lg ring-1 ring-pr-stone/40">
          <Table>
            <THead>
              <TR>
                <TH className="text-left">Produit</TH>
                <TH className="text-right">Qté espace actuelle</TH>
                <TH className="text-right">Compté (réel)</TH>
              </TR>
            </THead>
            <TBody>
              {lines.map((l) => (
                <TR key={l.product.product_id}>
                  <TD className="font-medium text-pr-black">{l.product.product_name}</TD>
                  <TD className="text-right tabular-nums text-pr-stone">{l.spaceQty}</TD>
                  <TD className="text-right">
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      className="w-24 rounded-lg border-0 px-2 py-1 text-right tabular-nums ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-provence"
                      value={counts[l.product.product_id] ?? ''}
                      onChange={(e) =>
                        setCounts((c) => ({ ...c, [l.product.product_id]: e.target.value }))
                      }
                    />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>

        {error && (
          <Alert variant="error" className="mt-3">
            {error}
          </Alert>
        )}

        <div className="mt-5 flex items-center justify-between">
          <span className="text-xs text-pr-stone">
            {dirty.length} ligne{dirty.length > 1 ? 's' : ''} modifiée{dirty.length > 1 ? 's' : ''}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Annuler
            </Button>
            <Button loading={saving} disabled={dirty.length === 0} onClick={() => void handleSave()}>
              Enregistrer l’inventaire ({dirty.length})
            </Button>
          </div>
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
  const queryClient = useQueryClient();

  const { data: locations } = useStockLocations();
  const reserve = useReserveLocation();
  const { data: spaces } = useSpaces();
  const { products } = useCatalog();
  const { record, recording } = useRecordMovement();

  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [family, setFamily] = useState('all');
  const [status, setStatus] = useState('all');
  const [modal, setModal] = useState<ActiveModal | null>(null);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [showAllCatalog, setShowAllCatalog] = useState(false);

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

  // Assortiment de l'espace : produits réellement affectés à cet espace
  // (area_product_reference). Sert à n'afficher QUE les produits de l'espace,
  // pas tout le catalogue.
  const assortment = useQuery({
    queryKey: ['areaAssortment', spaceName ?? 'none'],
    enabled: !!spaceName,
    staleTime: 60_000,
    queryFn: async (): Promise<Set<string>> => {
      const { data } = await supabase
        .from('area_product_reference')
        .select('product_id')
        .ilike('area_name', (spaceName ?? '').trim())
        .not('product_id', 'is', null);
      return new Set((data ?? []).map((r) => (r as { product_id: string }).product_id));
    },
  });
  const assortmentIds = useMemo(() => assortment.data ?? new Set<string>(), [assortment.data]);
  const hasAssortment = assortmentIds.size > 0;

  // Produits filtrés : assortiment de l'espace (+ tout produit ayant du stock),
  // ou tout le catalogue si l'utilisateur le demande / si l'espace n'a pas d'assortiment.
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
        // Périmètre espace : n'afficher que l'assortiment de l'espace + ce qui a du stock espace.
        if (!showAllCatalog && hasAssortment
            && !assortmentIds.has(r.product.product_id) && r.spaceQty === 0) return false;
        return true;
      })
      .filter((r) => {
        if (status === 'alert') return r.critical;
        // « Dormant » : placeholder (aucun filtre spécifique pour l'instant).
        return true;
      });
  }, [products.data, family, status, reserveBalances.data, spaceBalances.data, showAllCatalog, hasAssortment, assortmentIds]);

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

  // Tous les stocks de l'espace à 0 → message d'attente d'inventaire physique.
  const allZero = rows.length > 0 && rows.every((r) => r.spaceQty === 0);

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

      {selectedLocationId && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-pr-black-soft/60">
            {hasAssortment && !showAllCatalog
              ? `Assortiment de l’espace (${rows.length} produit${rows.length > 1 ? 's' : ''})`
              : `Tout le catalogue (${rows.length})`}
          </div>
          <div className="flex items-center gap-2">
            {hasAssortment && (
              <label className="flex items-center gap-1.5 text-sm text-pr-black-soft">
                <input type="checkbox" checked={showAllCatalog} onChange={(e) => setShowAllCatalog(e.target.checked)} />
                Tout le catalogue
              </label>
            )}
            <Button
              variant="secondary"
              size="sm"
              disabled={!selectedLocation?.area_id || rows.length === 0}
              onClick={() => setInventoryOpen(true)}
            >
              <ClipboardCheck className="mr-1 h-4 w-4" />
              Inventaire espace
            </Button>
          </div>
        </div>
      )}

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
        <div className="space-y-4">
          {allZero && (
            <div className="flex items-center gap-3 rounded-xl border border-pr-stone/60 bg-pr-cream/60 p-4 text-sm text-pr-black-soft">
              <Info className="h-4 w-4 flex-shrink-0 text-pr-stone" />
              <span>
                Stocks espaces remis à zéro — en attente de l’inventaire physique.
                Les quantités seront mises à jour lors de la prochaine réception.
              </span>
            </div>
          )}
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

      {inventoryOpen && selectedLocation?.area_id && spaceName && (
        <InventoryModal
          spaceId={selectedLocation.area_id}
          spaceName={spaceName}
          lines={rows.map((r) => ({ product: r.product, spaceQty: r.spaceQty }))}
          defaultResponsable={user?.name ?? ''}
          onClose={() => setInventoryOpen(false)}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: ['stockBalances'] });
            void queryClient.invalidateQueries({ queryKey: ['stockLiveBalance'] });
            showToast('Inventaire enregistré — quantités espace recalées.', 'success');
            setInventoryOpen(false);
          }}
        />
      )}
    </div>
  );
}
