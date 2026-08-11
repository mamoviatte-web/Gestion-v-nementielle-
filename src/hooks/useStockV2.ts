/**
 * Hooks du module Stock CDC V2 — emplacements, soldes, mouvements localisés,
 * inventaires. Toute mutation de stock passe par `recordMovement` :
 * INSERT stock_movements AVANT UPDATE stock_balances (RG-002).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type {
  InventoryCount,
  Product,
  StockBalanceView,
  StockLocation,
  StockMovementTypeV2,
  StockMovementView,
} from '@/lib/types';

/* ------------------------------------------------------------------ */
/* Emplacements                                                        */
/* ------------------------------------------------------------------ */

export function useStockLocations() {
  return useQuery({
    queryKey: ['stockLocations'],
    staleTime: 60_000,
    queryFn: async (): Promise<StockLocation[]> => {
      const { data, error } = await supabase
        .from('stock_locations')
        .select('*')
        .eq('is_active', true)
        .order('location_type', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as StockLocation[];
    },
  });
}

/**
 * Réserve générale AUC — source des transferts vers les espaces et destination
 * des retours réutilisables. Il existe 2 dépôts `reserve_centrale` (AUC + Stock
 * EST — cave vins) : on cible explicitement AUC (préfixe du nom), avec repli sur
 * le premier dépôt central si le nommage change.
 */
export function pickAucReserve<T extends { name: string; location_type: string }>(
  locations: T[],
): T | null {
  const reserves = locations.filter((l) => l.location_type === 'reserve_centrale');
  return reserves.find((l) => /^AUC/i.test(l.name)) ?? reserves[0] ?? null;
}

export function useReserveLocation() {
  const { data: locations } = useStockLocations();
  return pickAucReserve(locations ?? []);
}

/* ------------------------------------------------------------------ */
/* Soldes (balances)                                                   */
/* ------------------------------------------------------------------ */

/** Tous les soldes, avec produit et emplacement joints. Filtrable par emplacement. */
export function useStockBalances(locationId?: string) {
  return useQuery({
    queryKey: ['stockBalances', locationId ?? 'all'],
    staleTime: 15_000,
    queryFn: async (): Promise<StockBalanceView[]> => {
      let q = supabase
        .from('stock_balances')
        .select('*, product:products(*), location:stock_locations(*)');
      if (locationId) q = q.eq('location_id', locationId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as StockBalanceView[];
    },
  });
}

/* ------------------------------------------------------------------ */
/* Journal des mouvements                                              */
/* ------------------------------------------------------------------ */

export interface MovementFilters {
  productId?: string;
  spaceId?: string;
  eventId?: string;
  movementType?: string;
  limit?: number;
}

export function useStockMovementsJournal(filters: MovementFilters = {}) {
  return useQuery({
    queryKey: ['stockMovementsJournal', filters],
    queryFn: async (): Promise<StockMovementView[]> => {
      let q = supabase
        .from('stock_movements')
        .select(
          '*, product:products(*), from_location:stock_locations!stock_movements_from_location_id_fkey(*), to_location:stock_locations!stock_movements_to_location_id_fkey(*), event:events(event_id, event_name)',
        )
        .order('created_at', { ascending: false })
        .limit(filters.limit ?? 200);
      if (filters.productId) q = q.eq('product_id', filters.productId);
      if (filters.spaceId) q = q.eq('space_id', filters.spaceId);
      if (filters.eventId) q = q.eq('event_id', filters.eventId);
      if (filters.movementType) q = q.eq('movement_type', filters.movementType);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as StockMovementView[];
    },
  });
}

/* ------------------------------------------------------------------ */
/* Enregistrement d'un mouvement (RG-002)                              */
/* ------------------------------------------------------------------ */

export interface RecordMovementInput {
  movementType: StockMovementTypeV2;
  productId: string;
  qty: number;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  responsableNom: string;
  eventId?: string | null;
  spaceId?: string | null;
  unitPriceHt?: number | null;
  isAnomaly?: boolean;
}

/** Ajuste (ou crée) le solde d'un produit à un emplacement, d'un delta. */
async function adjustBalance(
  productId: string,
  locationId: string,
  delta: number,
  updatedBy: string,
  unitPriceHt?: number | null,
) {
  const { data: existing } = await supabase
    .from('stock_balances')
    .select('id, current_quantity')
    .eq('product_id', productId)
    .eq('location_id', locationId)
    .maybeSingle();

  if (existing) {
    const next = Number(existing.current_quantity) + delta;
    const { error } = await supabase
      .from('stock_balances')
      .update({ current_quantity: next, last_movement_at: new Date().toISOString(), updated_by: updatedBy })
      .eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('stock_balances').insert({
      product_id: productId,
      location_id: locationId,
      current_quantity: Math.max(0, delta),
      unit_value_ht: unitPriceHt ?? null,
      updated_by: updatedBy,
    });
    if (error) throw error;
  }
}

/**
 * Enregistre un mouvement puis met à jour les soldes concernés.
 * Impact par type (CDC §7) :
 *  - entrée_fournisseur   : + to_location
 *  - transfert_espace     : − from / + to
 *  - réassort_événement   : − from / + to
 *  - retour_réutilisable  : + to (réutilisable)
 *  - consommation         : − from
 *  - perte_casse          : − from (anomalie)
 *  - correction           : ± selon signe de qty (from si négatif, to si positif)
 */
export async function recordMovement(input: RecordMovementInput): Promise<void> {
  const {
    movementType,
    productId,
    qty,
    fromLocationId,
    toLocationId,
    responsableNom,
    eventId,
    spaceId,
    unitPriceHt,
    isAnomaly,
  } = input;

  // 1) INSERT stock_movements (AVANT toute mise à jour de solde — RG-002).
  const { error: movErr } = await supabase.from('stock_movements').insert({
    event_id: eventId ?? null,
    space_id: spaceId ?? null,
    product_id: productId,
    movement_type: movementType,
    qty,
    responsable_nom: responsableNom,
    from_location_id: fromLocationId ?? null,
    to_location_id: toLocationId ?? null,
    unit_price_ht: unitPriceHt ?? null,
    is_anomaly: isAnomaly ?? movementType === 'perte_casse',
  });
  if (movErr) throw movErr;

  // 2) UPDATE stock_balances selon le type.
  const outTypes = new Set(['transfert_espace', 'réassort_événement', 'consommation', 'perte_casse']);
  const inTypes = new Set(['entrée_fournisseur', 'transfert_espace', 'réassort_événement', 'retour_réutilisable']);

  if (outTypes.has(movementType) && fromLocationId) {
    await adjustBalance(productId, fromLocationId, -Math.abs(qty), responsableNom, unitPriceHt);
  }
  if (inTypes.has(movementType) && toLocationId) {
    await adjustBalance(productId, toLocationId, Math.abs(qty), responsableNom, unitPriceHt);
  }
  if (movementType === 'correction') {
    // qty signée : positive → crédite to_location, négative → débite from_location.
    if (qty >= 0 && toLocationId) await adjustBalance(productId, toLocationId, qty, responsableNom, unitPriceHt);
    if (qty < 0 && fromLocationId) await adjustBalance(productId, fromLocationId, qty, responsableNom, unitPriceHt);
  }
}

export function useRecordMovement() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: recordMovement,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['stockBalances'] });
      void queryClient.invalidateQueries({ queryKey: ['stockMovementsJournal'] });
    },
  });
  return {
    record: (input: RecordMovementInput) => mutation.mutateAsync(input),
    recording: mutation.isPending,
  };
}

/* ------------------------------------------------------------------ */
/* Intégration workflow événementiel (CDC §4)                          */
/* ------------------------------------------------------------------ */

/** Résout la map space_id → id d'emplacement 'espace', + id réserve centrale. */
async function resolveLocationMap(): Promise<{ bySpace: Record<string, string>; reserveId: string | null }> {
  const { data } = await supabase
    .from('stock_locations')
    .select('id, name, area_id, location_type');
  const rows = (data ?? []) as { id: string; name: string; area_id: string | null; location_type: string }[];
  const bySpace: Record<string, string> = {};
  for (const l of rows) {
    if (l.location_type === 'espace' && l.area_id) bySpace[l.area_id] = l.id;
  }
  // Transferts/retours ciblent la réserve générale AUC (pas la cave EST).
  const reserveId = pickAucReserve(rows)?.id ?? null;
  return { bySpace, reserveId };
}

/** Vrai si des mouvements d'un type donné existent déjà pour l'événement (idempotence). */
async function hasMovements(eventId: string, types: string[]): Promise<boolean> {
  const { count } = await supabase
    .from('stock_movements')
    .select('movement_id', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .in('movement_type', types);
  return (count ?? 0) > 0;
}

/**
 * Étape 3 (CDC §4) — à la préparation, transfère la dotation runner de la
 * réserve vers chaque espace (mouvement `transfert_espace`). Idempotent.
 */
export async function applyRunnerTransfersToStock(eventId: string, responsableNom: string): Promise<void> {
  if (await hasMovements(eventId, ['transfert_espace'])) return;
  const { data: dotations } = await supabase
    .from('runner_dotations')
    .select('space_id, product_id, planned_qty')
    .eq('event_id', eventId);
  const rows = (dotations ?? []) as { space_id: string; product_id: string; planned_qty: number }[];
  if (rows.length === 0) return;
  const { bySpace, reserveId } = await resolveLocationMap();
  for (const r of rows) {
    if (r.planned_qty <= 0) continue;
    await recordMovement({
      movementType: 'transfert_espace',
      productId: r.product_id,
      qty: r.planned_qty,
      fromLocationId: reserveId,
      toLocationId: bySpace[r.space_id] ?? null,
      responsableNom,
      eventId,
      spaceId: r.space_id,
    });
  }
}

/**
 * Étapes 6 & 7 (CDC §4) — à la clôture, matérialise dans le registre de stock
 * la consommation, les retours réutilisables et les pertes/casses à partir des
 * inventaires de clôture (`event_stock_lines`). Idempotent.
 */
export async function applyClosureToStock(eventId: string): Promise<void> {
  if (await hasMovements(eventId, ['consommation', 'retour_réutilisable', 'perte_casse'])) return;
  const { data: lines } = await supabase
    .from('event_stock_lines')
    .select('space_id, product_id, initial_qty, reassort_qty, final_qty, product_state, responsable_nom')
    .eq('event_id', eventId);
  const rows = (lines ?? []) as {
    space_id: string;
    product_id: string;
    initial_qty: number;
    reassort_qty: number;
    final_qty: number | null;
    product_state: string | null;
    responsable_nom: string;
  }[];
  if (rows.length === 0) return;
  const { bySpace, reserveId } = await resolveLocationMap();

  for (const r of rows) {
    const spaceLoc = bySpace[r.space_id] ?? null;
    const responsable = r.responsable_nom || 'Clôture';
    const final = r.final_qty ?? 0;
    const consumed = r.initial_qty + r.reassort_qty - final;

    if (consumed > 0) {
      await recordMovement({
        movementType: 'consommation',
        productId: r.product_id,
        qty: consumed,
        fromLocationId: spaceLoc,
        responsableNom: responsable,
        eventId,
        spaceId: r.space_id,
      });
    }
    // Pertes / casses : l'invendu physique est perdu.
    if (final > 0 && (r.product_state === 'cassé' || r.product_state === 'perdu' || r.product_state === 'périmé')) {
      await recordMovement({
        movementType: 'perte_casse',
        productId: r.product_id,
        qty: final,
        fromLocationId: spaceLoc,
        responsableNom: responsable,
        eventId,
        spaceId: r.space_id,
        isAnomaly: true,
      });
    } else if (final > 0 && r.product_state === 'fermé') {
      // Retour réutilisable vers la réserve.
      await recordMovement({
        movementType: 'retour_réutilisable',
        productId: r.product_id,
        qty: final,
        fromLocationId: spaceLoc,
        toLocationId: reserveId,
        responsableNom: responsable,
        eventId,
        spaceId: r.space_id,
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Inventaires                                                         */
/* ------------------------------------------------------------------ */

export interface InventoryCountView extends InventoryCount {
  product?: Product;
  location?: StockLocation;
}

/** Sessions d'inventaire (groupées par inventory_session_id). */
export function useInventorySessions() {
  return useQuery({
    queryKey: ['inventorySessions'],
    queryFn: async (): Promise<InventoryCountView[]> => {
      const { data, error } = await supabase
        .from('inventory_counts')
        .select('*, product:products(*), location:stock_locations(*)')
        .order('counted_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as InventoryCountView[];
    },
  });
}

/** Nombre d'écarts d'inventaire non résolus (variance ≠ 0 et non validés). */
export function useUnresolvedVarianceCount() {
  return useQuery({
    queryKey: ['inventoryUnresolved'],
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase
        .from('inventory_counts')
        .select('id, variance, validated_at');
      if (error) return 0;
      return (data ?? []).filter(
        (r: { variance: number | null; validated_at: string | null }) =>
          r.variance !== null && Number(r.variance) !== 0 && !r.validated_at,
      ).length;
    },
  });
}

export interface InventoryLineInput {
  productId: string;
  theoreticalQty: number;
  realQty: number;
  comment?: string | null;
}

/** Enregistre une session d'inventaire + met à jour les soldes réels. */
export function useSaveInventory() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (vars: {
      locationId: string;
      responsibleName: string;
      lines: InventoryLineInput[];
    }) => {
      const sessionId = crypto.randomUUID();
      const rows = vars.lines.map((l) => ({
        location_id: vars.locationId,
        product_id: l.productId,
        theoretical_qty: l.theoreticalQty,
        real_qty: l.realQty,
        responsible_name: vars.responsibleName,
        comment: l.comment ?? null,
        inventory_session_id: sessionId,
      }));
      const { error } = await supabase.from('inventory_counts').insert(rows);
      if (error) throw error;

      // Aligner les soldes physiques sur le réel compté.
      for (const l of vars.lines) {
        await supabase
          .from('stock_balances')
          .upsert(
            {
              product_id: l.productId,
              location_id: vars.locationId,
              current_quantity: l.realQty,
              last_movement_at: new Date().toISOString(),
              updated_by: vars.responsibleName,
            },
            { onConflict: 'product_id,location_id' },
          );
      }
      return sessionId;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inventorySessions'] });
      void queryClient.invalidateQueries({ queryKey: ['inventoryUnresolved'] });
      void queryClient.invalidateQueries({ queryKey: ['stockBalances'] });
      // Le trigger trg_apply_inventory_count met à jour les soldes → recharger la
      // vue d'alertes/valorisation et le badge d'alertes critiques (BLOC 1).
      void queryClient.invalidateQueries({ queryKey: ['stockLiveBalance'] });
      void queryClient.invalidateQueries({ queryKey: ['depotsSummary'] });
      void queryClient.invalidateQueries({ queryKey: ['criticalStatus'] });
    },
  });
  return {
    saveInventory: mutation.mutateAsync,
    saving: mutation.isPending,
  };
}
