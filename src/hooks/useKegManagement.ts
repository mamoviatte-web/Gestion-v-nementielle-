/**
 * useKegManagement — gestion du dépôt « Stockage Fûts » : fûts pleins,
 * dispatchés en espace, vides à retourner, retournés au fournisseur.
 * S'appuie sur keg_inventory / keg_summary / keg_volume_standards.
 * Réservé ROLE_STADE (RLS is_stade()).
 *
 * Un dispatch réutilise recordMovement (transfert_espace) : INSERT
 * stock_movements AVANT ajustement des soldes (RG-002), et met à jour
 * keg_inventory (plein → en_espace).
 */

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { recordMovement } from '@/hooks/useStockV2';

/* ------------------------------------------------------------------ */
/* Résumé pleins / vides                                               */
/* ------------------------------------------------------------------ */

export interface KegSummaryRow {
  product_id: string;
  product_name: string;
  unit: string;
  unit_price_ht: number | null;
  volume_unit: number | null;
  pleins: number;
  en_espace: number;
  vides: number;
  retournes: number;
  litres_disponibles: number;
}

export interface KegSummary {
  kegs: KegSummaryRow[];
  totalPleins: number;
  totalEnEspace: number;
  totalVides: number;
  totalLitres: number;
  totalValue: number;
}

export function useKegSummary() {
  return useQuery({
    queryKey: ['kegSummary'],
    staleTime: 15_000,
    queryFn: async (): Promise<KegSummary> => {
      const { data, error } = await supabase.from('keg_summary').select('*');
      if (error) throw error;
      const kegs = ((data ?? []) as KegSummaryRow[]).map((k) => ({
        ...k,
        unit_price_ht: k.unit_price_ht == null ? null : Number(k.unit_price_ht),
        volume_unit: k.volume_unit == null ? null : Number(k.volume_unit),
        pleins: Number(k.pleins),
        en_espace: Number(k.en_espace),
        vides: Number(k.vides),
        retournes: Number(k.retournes),
        litres_disponibles: Number(k.litres_disponibles),
      }));
      return {
        kegs,
        totalPleins: kegs.reduce((s, k) => s + k.pleins, 0),
        totalEnEspace: kegs.reduce((s, k) => s + k.en_espace, 0),
        totalVides: kegs.reduce((s, k) => s + k.vides, 0),
        totalLitres: kegs.reduce((s, k) => s + k.litres_disponibles, 0),
        totalValue: kegs.reduce((s, k) => s + k.pleins * (k.unit_price_ht ?? 0), 0),
      };
    },
  });
}

/* ------------------------------------------------------------------ */
/* Fûts vides                                                          */
/* ------------------------------------------------------------------ */

export interface EmptyKegLine {
  id: string;
  product_id: string;
  product_name: string;
  qty: number;
  volume_liters: number | null;
  event_name: string | null;
  space_name: string | null;
  returned_empty_at: string | null;
}

export interface EmptyKegs {
  lines: EmptyKegLine[];
  total: number;
  totalVolume: number;
}

export function useEmptyKegs() {
  return useQuery({
    queryKey: ['emptyKegs'],
    staleTime: 15_000,
    queryFn: async (): Promise<EmptyKegs> => {
      const { data, error } = await supabase
        .from('keg_inventory')
        .select(
          'id, product_id, qty, volume_liters, returned_empty_at, product:products(product_name), event:events(event_name), space:spaces(space_name)',
        )
        .eq('status', 'vide')
        .order('returned_empty_at', { ascending: false });
      if (error) throw error;
      type Row = {
        id: string;
        product_id: string;
        qty: number;
        volume_liters: number | null;
        returned_empty_at: string | null;
        product: { product_name: string } | null;
        event: { event_name: string } | null;
        space: { space_name: string } | null;
      };
      const lines = ((data ?? []) as unknown as Row[]).map((r) => ({
        id: r.id,
        product_id: r.product_id,
        product_name: r.product?.product_name ?? '—',
        qty: Number(r.qty),
        volume_liters: r.volume_liters == null ? null : Number(r.volume_liters),
        event_name: r.event?.event_name ?? null,
        space_name: r.space?.space_name ?? null,
        returned_empty_at: r.returned_empty_at,
      }));
      return {
        lines,
        total: lines.reduce((s, l) => s + l.qty, 0),
        totalVolume: lines.reduce((s, l) => s + l.qty * (l.volume_liters ?? 0), 0),
      };
    },
  });
}

/** Historique des retours fournisseur. */
export interface ReturnHistoryRow {
  id: string;
  product_name: string;
  qty: number;
  returned_to_supplier_at: string | null;
}

export function useKegReturnHistory() {
  return useQuery({
    queryKey: ['kegReturnHistory'],
    staleTime: 30_000,
    queryFn: async (): Promise<ReturnHistoryRow[]> => {
      const { data, error } = await supabase
        .from('keg_inventory')
        .select('id, qty, returned_to_supplier_at, product:products(product_name)')
        .eq('status', 'retourné')
        .order('returned_to_supplier_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      type Row = { id: string; qty: number; returned_to_supplier_at: string | null; product: { product_name: string } | null };
      return ((data ?? []) as unknown as Row[]).map((r) => ({
        id: r.id,
        product_name: r.product?.product_name ?? '—',
        qty: Number(r.qty),
        returned_to_supplier_at: r.returned_to_supplier_at,
      }));
    },
  });
}

/* ------------------------------------------------------------------ */
/* Événements ouverts (pour le dispatch)                               */
/* ------------------------------------------------------------------ */

export interface DispatchEventOption {
  event_id: string;
  event_name: string;
  spaces: { space_id: string; space_name: string }[];
}

export function useOpenEventsForDispatch() {
  return useQuery({
    queryKey: ['kegDispatchEvents'],
    staleTime: 30_000,
    queryFn: async (): Promise<DispatchEventOption[]> => {
      const { data: events, error } = await supabase
        .from('events')
        .select('event_id, event_name, status, event_date')
        .in('status', ['brouillon', 'préparé', 'en_cours'])
        .order('event_date', { ascending: false });
      if (error) throw error;
      const evs = (events ?? []) as { event_id: string; event_name: string }[];
      if (evs.length === 0) return [];
      const ids = evs.map((e) => e.event_id);
      const { data: es } = await supabase
        .from('event_spaces')
        .select('event_id, space_id, space:spaces(space_name)')
        .in('event_id', ids);
      type ESRow = { event_id: string; space_id: string; space: { space_name: string } | null };
      const byEvent = new Map<string, { space_id: string; space_name: string }[]>();
      for (const row of ((es ?? []) as unknown as ESRow[])) {
        const arr = byEvent.get(row.event_id) ?? [];
        arr.push({ space_id: row.space_id, space_name: row.space?.space_name ?? row.space_id });
        byEvent.set(row.event_id, arr);
      }
      return evs.map((e) => ({ ...e, spaces: byEvent.get(e.event_id) ?? [] }));
    },
  });
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

async function getFutsDepotId(): Promise<string | null> {
  const { data } = await supabase
    .from('stock_locations')
    .select('id')
    .ilike('name', 'Stockage Fûts')
    .maybeSingle();
  return data?.id ?? null;
}

/** Réduit `qty` unités de fûts pleins d'un produit (FIFO sur les lignes 'plein'). */
async function reducePlein(productId: string, qty: number): Promise<void> {
  const { data: rows } = await supabase
    .from('keg_inventory')
    .select('id, qty')
    .eq('product_id', productId)
    .eq('status', 'plein')
    .order('received_at', { ascending: true });
  let remaining = qty;
  for (const r of (rows ?? []) as { id: string; qty: number }[]) {
    if (remaining <= 0) break;
    const take = Math.min(r.qty, remaining);
    const next = r.qty - take;
    if (next <= 0) {
      await supabase.from('keg_inventory').delete().eq('id', r.id);
    } else {
      await supabase.from('keg_inventory').update({ qty: next }).eq('id', r.id);
    }
    remaining -= take;
  }
}

export interface DispatchInput {
  productId: string;
  qty: number;
  eventId: string;
  spaceId: string;
  responsable: string;
  unitPriceHt?: number | null;
}

export function useKegMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    ['kegSummary', 'emptyKegs', 'kegReturnHistory', 'depotBalances', 'stockBalances', 'stockMovementsJournal'].forEach(
      (k) => void queryClient.invalidateQueries({ queryKey: [k] }),
    );
  };

  const dispatch = useMutation({
    mutationFn: async (input: DispatchInput) => {
      if (input.qty <= 0) throw new Error('Quantité invalide.');
      if (input.responsable.trim().length < 2) throw new Error('Responsable requis (RG-001).');
      const futsId = await getFutsDepotId();
      if (!futsId) throw new Error('Dépôt Stockage Fûts introuvable.');

      // Emplacement opérationnel de l'espace (si présent) pour créditer le solde.
      const { data: loc } = await supabase
        .from('stock_locations')
        .select('id')
        .eq('area_id', input.spaceId)
        .eq('location_type', 'espace')
        .maybeSingle();

      // Mouvement transfert_espace (RG-002 : mouvement avant soldes).
      await recordMovement({
        movementType: 'transfert_espace',
        productId: input.productId,
        qty: input.qty,
        fromLocationId: futsId,
        toLocationId: loc?.id ?? null,
        responsableNom: input.responsable.trim(),
        eventId: input.eventId,
        spaceId: input.spaceId,
        unitPriceHt: input.unitPriceHt ?? null,
      });

      // keg_inventory : plein → en_espace.
      await reducePlein(input.productId, input.qty);
      const { data: vol } = await supabase
        .from('keg_volume_standards')
        .select('volume_liters')
        .eq('product_id', input.productId)
        .maybeSingle();
      const { error } = await supabase.from('keg_inventory').insert({
        product_id: input.productId,
        status: 'en_espace',
        qty: input.qty,
        volume_liters: vol?.volume_liters ?? null,
        event_id: input.eventId,
        space_id: input.spaceId,
        dispatched_at: new Date().toISOString(),
        responsable_nom: input.responsable.trim(),
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const markReturned = useMutation({
    mutationFn: async (kegIds: string[]) => {
      if (kegIds.length === 0) return;
      const { data: kegs } = await supabase
        .from('keg_inventory')
        .select('id, product_id, qty')
        .in('id', kegIds);
      const futsId = await getFutsDepotId();
      // Journalise un mouvement retour_fournisseur par fût vide.
      for (const k of (kegs ?? []) as { id: string; product_id: string; qty: number }[]) {
        await supabase.from('stock_movements').insert({
          product_id: k.product_id,
          movement_type: 'retour_fournisseur',
          qty: k.qty,
          from_location_id: futsId,
          responsable_nom: 'Retour fournisseur',
        });
      }
      const { error } = await supabase
        .from('keg_inventory')
        .update({ status: 'retourné', returned_to_supplier_at: new Date().toISOString() })
        .in('id', kegIds);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const receiveDelivery = useMutation({
    mutationFn: async (lines: { productId: string; qty: number; unitPriceHt?: number | null }[]) => {
      const valid = lines.filter((l) => l.productId && l.qty > 0);
      if (valid.length === 0) throw new Error('Ajoutez au moins un fût (quantité > 0).');
      const futsId = await getFutsDepotId();
      if (!futsId) throw new Error('Dépôt Stockage Fûts introuvable.');

      for (const l of valid) {
        const { data: vol } = await supabase
          .from('keg_volume_standards')
          .select('volume_liters')
          .eq('product_id', l.productId)
          .maybeSingle();
        await supabase.from('keg_inventory').insert({
          product_id: l.productId,
          status: 'plein',
          qty: l.qty,
          volume_liters: vol?.volume_liters ?? 30,
          received_at: new Date().toISOString(),
          responsable_nom: 'Réception Fûts',
        });
        await recordMovement({
          movementType: 'entrée_fournisseur',
          productId: l.productId,
          qty: l.qty,
          toLocationId: futsId,
          responsableNom: 'Réception Fûts',
          unitPriceHt: l.unitPriceHt ?? null,
        });
      }
    },
    onSuccess: invalidate,
  });

  return {
    dispatchKegs: dispatch.mutateAsync,
    dispatching: dispatch.isPending,
    markReturnedToSupplier: markReturned.mutateAsync,
    marking: markReturned.isPending,
    receiveFutDelivery: receiveDelivery.mutateAsync,
    receiving: receiveDelivery.isPending,
  };
}

/** Utilitaire d'affichage : fûts pleins ayant du stock (pour le dispatch). */
export function useDispatchableKegs() {
  const summary = useKegSummary();
  return useMemo(() => (summary.data?.kegs ?? []).filter((k) => k.pleins > 0), [summary.data]);
}
