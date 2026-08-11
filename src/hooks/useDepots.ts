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
/* Synthèse dépôts (dashboard)                                         */
/* ------------------------------------------------------------------ */

export interface DepotSummary {
  id: string;
  name: string;
  total_qty: number;
  total_value_ht: number;
  product_lines: number;
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

      const byDepot = new Map<string, { qty: number; value: number; lines: number }>();
      for (const b of (balances ?? []) as {
        location_id: string;
        current_quantity: number;
        unit_value_ht: number | null;
      }[]) {
        const agg = byDepot.get(b.location_id) ?? { qty: 0, value: 0, lines: 0 };
        const qty = Number(b.current_quantity);
        agg.qty += qty;
        agg.value += qty * Number(b.unit_value_ht ?? 0);
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
        const agg = byDepot.get(d.id) ?? { qty: 0, value: 0, lines: 0 };
        return {
          id: d.id,
          name: d.name,
          total_qty: agg.qty,
          total_value_ht: agg.value,
          product_lines: agg.lines,
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
  unitPriceHt?: number | null;
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
 * Enregistre une livraison : INSERT header puis lignes. Le trigger base
 * crédite les soldes + journalise un mouvement `entrée_fournisseur` par ligne.
 */
export function useRecordDelivery() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: RecordDeliveryInput) => {
      const lines = input.lines.filter((l) => l.productId && l.qtyReceived > 0);
      if (lines.length === 0) throw new Error('Ajoutez au moins une ligne (quantité reçue > 0).');

      const { data: header, error: headErr } = await supabase
        .from('supplier_deliveries')
        .insert({
          delivery_date: input.deliveryDate,
          supplier_name: input.supplierName,
          location_id: input.depotId,
          invoice_ref: input.invoiceRef ?? null,
          received_by: input.receivedBy,
          status: 'reçu',
          notes: input.notes ?? null,
        })
        .select('id')
        .single();
      if (headErr) throw headErr;

      const rows = lines.map((l) => ({
        delivery_id: header.id as string,
        product_id: l.productId,
        qty_ordered: l.qtyOrdered ?? l.qtyReceived,
        qty_received: l.qtyReceived,
        unit_price_ht: l.unitPriceHt ?? null,
      }));
      const { error: linesErr } = await supabase.from('supplier_delivery_lines').insert(rows);
      if (linesErr) throw linesErr;
      return header.id as string;
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
