/**
 * useDepots — dépôts centraux (reserve_centrale) : AUC (réserve générale, point
 * d'entrée des livraisons fournisseurs et source du dispatch vers les 16 espaces)
 * et Stock EST (cave vins & spiritueux).
 *
 * Fournit : la liste des dépôts (AUC en tête), les soldes par dépôt, les
 * livraisons fournisseurs (avec lignes), la vue dispatch, la synthèse pour le
 * dashboard, et la mutation d'enregistrement d'une livraison.
 *
 * Une livraison est purement déclarative côté client : l'INSERT des lignes
 * déclenche le trigger `trg_delivery_update_balance` qui crédite les soldes et
 * journalise un mouvement `entrée_fournisseur` (RG-002). Réservé à ROLE_STADE
 * (RLS `is_stade()` + prix visibles, hors périmètre RG-003).
 */

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { pickAucReserve } from '@/hooks/useStockV2';
import type { StockLocation } from '@/lib/types';

/* ------------------------------------------------------------------ */
/* Dépôts                                                              */
/* ------------------------------------------------------------------ */

/** Les 2 dépôts centraux actifs, AUC en tête puis Stock EST. */
export function useDepots() {
  return useQuery({
    queryKey: ['depots'],
    staleTime: 60_000,
    queryFn: async (): Promise<StockLocation[]> => {
      const { data, error } = await supabase
        .from('stock_locations')
        .select('*')
        .eq('location_type', 'reserve_centrale')
        .eq('is_active', true)
        .order('name', { ascending: true });
      if (error) throw error;
      const depots = (data ?? []) as StockLocation[];
      const auc = pickAucReserve(depots);
      // AUC en premier, le reste (EST…) ensuite par nom.
      return [
        ...depots.filter((d) => d.id === auc?.id),
        ...depots.filter((d) => d.id !== auc?.id),
      ];
    },
  });
}

/* ------------------------------------------------------------------ */
/* Soldes d'un dépôt                                                   */
/* ------------------------------------------------------------------ */

export interface DepotBalanceRow {
  product_id: string;
  product_name: string;
  category: string;
  unit: string;
  current_quantity: number;
  unit_value_ht: number | null;
}

/** Soldes courants d'un dépôt, enrichis du produit, triés par famille. */
export function useDepotBalances(depotId: string | undefined) {
  return useQuery({
    queryKey: ['depotBalances', depotId ?? 'none'],
    enabled: !!depotId,
    staleTime: 15_000,
    queryFn: async (): Promise<DepotBalanceRow[]> => {
      const { data, error } = await supabase
        .from('stock_balances')
        .select('product_id, current_quantity, unit_value_ht, product:products(product_name, category, unit, active)')
        .eq('location_id', depotId as string);
      if (error) throw error;
      type Row = {
        product_id: string;
        current_quantity: number;
        unit_value_ht: number | null;
        product: { product_name: string; category: string; unit: string; active: boolean } | null;
      };
      return ((data ?? []) as unknown as Row[])
        .filter((r) => r.product?.active)
        .map((r) => ({
          product_id: r.product_id,
          product_name: r.product?.product_name ?? '—',
          category: r.product?.category ?? '—',
          unit: r.product?.unit ?? '',
          current_quantity: Number(r.current_quantity),
          unit_value_ht: r.unit_value_ht == null ? null : Number(r.unit_value_ht),
        }))
        .sort(
          (a, b) =>
            a.category.localeCompare(b.category) || a.product_name.localeCompare(b.product_name),
        );
    },
  });
}

/* ------------------------------------------------------------------ */
/* Livraisons fournisseurs                                             */
/* ------------------------------------------------------------------ */

export interface DeliveryLine {
  id: string;
  product_id: string;
  qty_ordered: number | null;
  qty_received: number;
  qty_refused: number | null;
  unit_price_ht: number | null;
  product: { product_name: string; category: string; unit: string } | null;
}

export interface Delivery {
  id: string;
  delivery_date: string;
  supplier_name: string;
  location_id: string;
  invoice_ref: string | null;
  received_by: string | null;
  status: string | null;
  notes: string | null;
  created_at: string;
  lines: DeliveryLine[];
}

/** Livraisons d'un dépôt (ou toutes), les plus récentes d'abord, avec lignes. */
export function useDepotDeliveries(depotId: string | undefined) {
  return useQuery({
    queryKey: ['depotDeliveries', depotId ?? 'all'],
    enabled: !!depotId,
    staleTime: 15_000,
    queryFn: async (): Promise<Delivery[]> => {
      const { data, error } = await supabase
        .from('supplier_deliveries')
        .select(
          '*, lines:supplier_delivery_lines(id, product_id, qty_ordered, qty_received, qty_refused, unit_price_ht, product:products(product_name, category, unit))',
        )
        .eq('location_id', depotId as string)
        .order('delivery_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Delivery[];
    },
  });
}

/* ------------------------------------------------------------------ */
/* Registre des factures (vue supplier_delivery_registry)              */
/* ------------------------------------------------------------------ */

export interface InvoiceRegistryRow {
  id: string;
  delivery_date: string | null;
  invoice_date: string | null;
  supplier_name: string;
  invoice_ref: string | null;
  status: string | null;
  received_by: string | null;
  depot: string | null;
  invoice_pdf_url: string | null;
  a_pdf: boolean;
  nb_lignes: number;
  total_recu: number;
  total_refuse: number;
  total_calcule_ht: number | null;
  invoice_amount_ht: number | null;
  ecart_facture_vs_lignes: number | null;
  notes: string | null;
}

/** Registre des factures — une ligne par livraison, avec contrôle d'écart. */
export function useInvoiceRegistry() {
  return useQuery({
    queryKey: ['invoiceRegistry'],
    staleTime: 15_000,
    queryFn: async (): Promise<InvoiceRegistryRow[]> => {
      const { data, error } = await supabase
        .from('supplier_delivery_registry')
        .select('*')
        .order('invoice_date', { ascending: false, nullsFirst: false })
        .order('delivery_date', { ascending: false });
      if (error) throw error;
      return (data ?? []) as InvoiceRegistryRow[];
    },
  });
}

/* ------------------------------------------------------------------ */
/* Dispatch dépôt → espaces (vue)                                      */
/* ------------------------------------------------------------------ */

export interface DispatchSpaceDetail {
  space_name: string;
  qty: number;
  date: string;
}

export interface DispatchRow {
  depot_id: string;
  depot_name: string;
  product_id: string;
  product_name: string;
  category: string;
  unit: string;
  qty_in_depot: number;
  total_dispatched: number;
  spaces_detail: DispatchSpaceDetail[] | null;
}

/** Vue dispatch (`depot_dispatch_view`) filtrée sur un dépôt. */
export function useDepotDispatch(depotId: string | undefined) {
  return useQuery({
    queryKey: ['depotDispatch', depotId ?? 'none'],
    enabled: !!depotId,
    staleTime: 15_000,
    queryFn: async (): Promise<DispatchRow[]> => {
      const { data, error } = await supabase
        .from('depot_dispatch_view')
        .select('*')
        .eq('depot_id', depotId as string);
      if (error) throw error;
      return ((data ?? []) as DispatchRow[]).map((r) => ({
        ...r,
        qty_in_depot: Number(r.qty_in_depot),
        total_dispatched: Number(r.total_dispatched),
      }));
    },
  });
}

/* ------------------------------------------------------------------ */
/* Registre des mouvements d'un dépôt (entrées / sorties / retours)    */
/* ------------------------------------------------------------------ */

export interface DepotMovement {
  movement_id: string;
  created_at: string;
  movement_type: string;
  qty: number;
  product_name: string;
  space_name: string | null;
  direction: 'in' | 'out'; // in = crédite le dépôt, out = débite le dépôt
}

/** Derniers mouvements touchant un dépôt (source ou destination), récents d'abord. */
export function useDepotMovements(depotId: string | undefined, limit = 40) {
  return useQuery({
    queryKey: ['depotMovements', depotId ?? 'none', limit],
    enabled: !!depotId,
    staleTime: 15_000,
    queryFn: async (): Promise<DepotMovement[]> => {
      const { data, error } = await supabase
        .from('stock_movements')
        .select(
          'movement_id, created_at, movement_type, qty, from_location_id, to_location_id, product:products(product_name), space:spaces(space_name)',
        )
        .or(`from_location_id.eq.${depotId},to_location_id.eq.${depotId}`)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      type Row = {
        movement_id: string;
        created_at: string;
        movement_type: string;
        qty: number;
        from_location_id: string | null;
        to_location_id: string | null;
        product: { product_name: string } | null;
        space: { space_name: string } | null;
      };
      return ((data ?? []) as unknown as Row[]).map((r) => ({
        movement_id: r.movement_id,
        created_at: r.created_at,
        movement_type: r.movement_type,
        qty: Number(r.qty),
        product_name: r.product?.product_name ?? '—',
        space_name: r.space?.space_name ?? null,
        direction: r.to_location_id === depotId ? 'in' : 'out',
      }));
    },
  });
}

/* ------------------------------------------------------------------ */
/* Synthèse dépôts (dashboard)                                         */
/* ------------------------------------------------------------------ */

export interface DepotSummary {
  id: string;
  name: string;
  total_qty: number;
  total_value_ht: number;
  product_lines: number; // références avec du stock (qty > 0)
  total_refs: number; // références de l'assortiment (toutes lignes de solde)
  last_delivery_date: string | null;
}

/** Synthèse légère des 2 dépôts pour le tableau de bord. */
export function useDepotsSummary() {
  return useQuery({
    queryKey: ['depotsSummary'],
    staleTime: 30_000,
    refetchInterval: 90_000,
    queryFn: async (): Promise<DepotSummary[]> => {
      const { data: locs } = await supabase
        .from('stock_locations')
        .select('id, name, location_type')
        .eq('location_type', 'reserve_centrale')
        .eq('is_active', true);
      const depots = (locs ?? []) as { id: string; name: string; location_type: string }[];
      if (depots.length === 0) return [];
      const ids = depots.map((d) => d.id);

      const [{ data: balances }, { data: deliveries }] = await Promise.all([
        supabase
          .from('stock_balances')
          .select('location_id, current_quantity, unit_value_ht')
          .in('location_id', ids),
        supabase.from('supplier_deliveries').select('location_id, delivery_date').in('location_id', ids),
      ]);

      const byDepot = new Map<string, { qty: number; value: number; lines: number; refs: number }>();
      for (const b of (balances ?? []) as {
        location_id: string;
        current_quantity: number;
        unit_value_ht: number | null;
      }[]) {
        const agg = byDepot.get(b.location_id) ?? { qty: 0, value: 0, lines: 0, refs: 0 };
        const qty = Number(b.current_quantity);
        agg.qty += qty;
        agg.value += qty * Number(b.unit_value_ht ?? 0);
        agg.refs += 1;
        if (qty > 0) agg.lines += 1;
        byDepot.set(b.location_id, agg);
      }

      const lastDelivery = new Map<string, string>();
      for (const d of (deliveries ?? []) as { location_id: string; delivery_date: string }[]) {
        const cur = lastDelivery.get(d.location_id);
        if (!cur || d.delivery_date > cur) lastDelivery.set(d.location_id, d.delivery_date);
      }

      const auc = pickAucReserve(depots);
      const ordered = [
        ...depots.filter((d) => d.id === auc?.id),
        ...depots.filter((d) => d.id !== auc?.id),
      ];
      return ordered.map((d) => {
        const agg = byDepot.get(d.id) ?? { qty: 0, value: 0, lines: 0, refs: 0 };
        return {
          id: d.id,
          name: d.name,
          total_qty: agg.qty,
          total_value_ht: agg.value,
          product_lines: agg.lines,
          total_refs: agg.refs,
          last_delivery_date: lastDelivery.get(d.id) ?? null,
        };
      });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Enregistrement d'une livraison                                      */
/* ------------------------------------------------------------------ */

export interface DeliveryLineInput {
  productId: string;
  qtyReceived: number;
  qtyOrdered?: number | null;
  qtyRefused?: number | null;
  unitPriceHt?: number | null;
  lotNumber?: string | null;
  expiryDate?: string | null;
  note?: string | null;
}

export interface RecordDeliveryResult {
  delivery_id: string;
  nb_lignes: number;
  total_ht: number;
}

export interface RecordDeliveryInput {
  depotId: string;
  supplierName: string;
  deliveryDate: string;
  invoiceRef?: string | null;
  receivedBy: string;
  notes?: string | null;
  lines: DeliveryLineInput[];
}

/**
 * Enregistre une livraison multi-produits en une seule transaction via la RPC
 * register_delivery (tout-ou-rien : pas d'en-tête orphelin). Le trigger base
 * crédite les soldes + journalise un mouvement `entrée_fournisseur` par ligne.
 * Les lignes sans produit ou à quantité ≤ 0 sont ignorées côté serveur.
 */
export function useRecordDelivery() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: RecordDeliveryInput): Promise<RecordDeliveryResult> => {
      const lines = input.lines
        .filter((l) => l.productId && l.qtyReceived > 0)
        .map((l) => ({
          product_id: l.productId,
          qty_received: l.qtyReceived,
          unit_price_ht: l.unitPriceHt ?? null,
          qty_ordered: l.qtyOrdered ?? null,
          qty_refused: l.qtyRefused ?? null,
          lot_number: l.lotNumber ?? null,
          expiry_date: l.expiryDate ?? null,
          notes: l.note ?? null,
        }));
      if (lines.length === 0) throw new Error('Ajoutez au moins une ligne (quantité reçue > 0).');

      const { data, error } = await supabase.rpc('register_delivery', {
        p_supplier: input.supplierName,
        p_date: input.deliveryDate,
        p_location: input.depotId,
        p_received_by: input.receivedBy,
        p_invoice: input.invoiceRef ?? null,
        p_notes: input.notes ?? null,
        p_lines: lines,
      });
      const res = data as (RecordDeliveryResult & { success?: boolean; error?: string }) | null;
      if (error || !res?.success) {
        throw new Error(res?.error ?? error?.message ?? "Erreur lors de l'enregistrement de la livraison.");
      }
      return { delivery_id: res.delivery_id, nb_lignes: res.nb_lignes, total_ht: res.total_ht };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['depotBalances'] });
      void queryClient.invalidateQueries({ queryKey: ['depotDeliveries'] });
      void queryClient.invalidateQueries({ queryKey: ['depotDispatch'] });
      void queryClient.invalidateQueries({ queryKey: ['depotsSummary'] });
      void queryClient.invalidateQueries({ queryKey: ['stockBalances'] });
      void queryClient.invalidateQueries({ queryKey: ['stockMovementsJournal'] });
      void queryClient.invalidateQueries({ queryKey: ['criticalStatus'] });
      // Le trigger trg_delivery_update_balance crédite le solde → recharger la
      // vue d'alertes/valorisation (BLOC 1).
      void queryClient.invalidateQueries({ queryKey: ['stockLiveBalance'] });
      void queryClient.invalidateQueries({ queryKey: ['stockAlerts'] });
    },
  });
  return {
    recordDelivery: mutation.mutateAsync,
    recording: mutation.isPending,
  };
}

/* ------------------------------------------------------------------ */
/* Balance temps réel (vue stock_live_balance)                         */
/* ------------------------------------------------------------------ */

export interface LiveBalanceRow {
  product_id: string;
  product_name: string;
  category: string;
  unit: string;
  unit_price_ht: number | null;
  min_stock: number | null;
  qty_auc: number | null;
  qty_est: number | null;
  qty_futs: number | null;
  qty_total_depot: number;
  qty_in_event: number;
  valeur_depot_ht: number;
  alert_status: 'rupture' | 'critique' | 'ok';
  source_depot: string | null;
}

/** Balance temps réel par produit (dépôts + en espace). */
export function useStockLiveBalance() {
  return useQuery({
    queryKey: ['stockLiveBalance'],
    staleTime: 15_000,
    queryFn: async (): Promise<LiveBalanceRow[]> => {
      const { data, error } = await supabase.from('stock_live_balance').select('*');
      if (error) throw error;
      return ((data ?? []) as LiveBalanceRow[]).map((r) => ({
        ...r,
        qty_total_depot: Number(r.qty_total_depot ?? 0),
        qty_in_event: Number(r.qty_in_event ?? 0),
        valeur_depot_ht: Number(r.valeur_depot_ht ?? 0),
        unit_price_ht: r.unit_price_ht == null ? null : Number(r.unit_price_ht),
      }));
    },
  });
}

/** Carte product_id → balance temps réel (pour lookups rapides). */
export function useLiveBalanceMap() {
  const q = useStockLiveBalance();
  const map = useMemo(() => {
    const m = new Map<string, LiveBalanceRow>();
    for (const r of q.data ?? []) m.set(r.product_id, r);
    return m;
  }, [q.data]);
  return { map, isLoading: q.isLoading };
}

/** Utilitaire : familles de produits éligibles à un dépôt donné (par son nom). */
export function useDepotProductScope(depotName: string | undefined) {
  return useMemo(() => {
    // La cave « Stock EST » ne stocke que vins & spiritueux ; AUC = tout.
    if (depotName && /EST/i.test(depotName)) return ['Vins', 'Spiritueux'];
    return null; // null = toutes familles
  }, [depotName]);
}
