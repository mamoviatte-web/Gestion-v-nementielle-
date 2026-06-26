/**
 * Hook useStock — module stocks (Phase 2, CDC §9).
 *
 * Couvre tout le cycle : ouverture → en cours (réassort) → clôture.
 * Règles appliquées :
 *  - RG-001 : responsable_nom obligatoire (>= 2 caractères) sur chaque saisie.
 *  - RG-002 : chaque mutation de stock insère une ligne dans stock_movements
 *             AVANT d'écrire dans event_stock_lines.
 *  - RG-003 : le contexte Responsable lit le catalogue via products_public
 *             (sans unit_price_ht). Jamais de prix côté provider.
 *  - RG-004 : clôture bloquée si consommation < 0 sans anomaly_comment.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { computeConsumed } from '@/lib/calculations';
import type {
  EventStockLine,
  Product,
  ProductState,
  RunnerDotation,
  RunnerStatus,
  StockPhase,
} from '@/lib/types';

/* ------------------------------------------------------------------ */
/* Validation RG-001                                                   */
/* ------------------------------------------------------------------ */

/** Vérifie le nom du responsable (RG-001). Lève une erreur si invalide. */
function assertResponsable(name: string | null | undefined): asserts name is string {
  if (!name || name.trim().length < 2) {
    throw new Error(
      'Nom du responsable obligatoire (au moins 2 caractères) — RG-001.',
    );
  }
}

/* ------------------------------------------------------------------ */
/* Requêtes de référence                                               */
/* ------------------------------------------------------------------ */

/**
 * Catalogue produits. `withPrices=false` (Responsable) lit la vue
 * products_public sans unit_price_ht (RG-003).
 */
export function useProducts(withPrices: boolean) {
  return useQuery({
    queryKey: ['products', withPrices],
    staleTime: 30_000,
    queryFn: async (): Promise<Product[]> => {
      const source = withPrices ? 'products' : 'products_public';
      const { data, error } = await supabase.from(source).select('*');
      if (error) throw error;
      // products_public ne renvoie pas unit_price_ht → on complète à null.
      return (data ?? []).map((p) => ({
        unit_price_ht: null,
        stock_min: 0,
        packaging: null,
        ...(p as Partial<Product>),
      })) as Product[];
    },
  });
}

export function useDotations(
  eventId: string | undefined,
  spaceId: string | undefined,
) {
  return useQuery({
    queryKey: ['dotations', eventId, spaceId],
    enabled: !!eventId && !!spaceId,
    queryFn: async (): Promise<RunnerDotation[]> => {
      const { data, error } = await supabase
        .from('runner_dotations')
        .select('*')
        .eq('event_id', eventId)
        .eq('space_id', spaceId);
      if (error) throw error;
      return (data ?? []) as RunnerDotation[];
    },
  });
}

export function useStockLines(
  eventId: string | undefined,
  spaceId: string | undefined,
) {
  return useQuery({
    queryKey: ['stockLines', eventId, spaceId],
    enabled: !!eventId && !!spaceId,
    queryFn: async (): Promise<EventStockLine[]> => {
      const { data, error } = await supabase
        .from('event_stock_lines')
        .select('*')
        .eq('event_id', eventId)
        .eq('space_id', spaceId);
      if (error) throw error;
      return (data ?? []) as EventStockLine[];
    },
  });
}

/* ------------------------------------------------------------------ */
/* Dérivation de la phase (à partir des données, pas d'état local)     */
/* ------------------------------------------------------------------ */

/**
 * Déduit la phase de saisie depuis les lignes de stock :
 *  - aucune ligne                → 'ouverture'
 *  - au moins une ligne clôturée → 'cloture' (terminé)
 *  - sinon                       → 'reassort' (en cours)
 */
export function derivePhase(lines: EventStockLine[]): StockPhase {
  if (lines.length === 0) return 'ouverture';
  if (lines.some((l) => l.final_qty !== null)) return 'cloture';
  return 'reassort';
}

/* ------------------------------------------------------------------ */
/* Payloads des mutations                                              */
/* ------------------------------------------------------------------ */

export interface OpeningLineInput {
  product_id: string;
  initial_qty: number;
}

export interface ReassortLineInput {
  product_id: string;
  /** Quantité ajoutée (delta strictement positif). */
  delta: number;
}

export interface ClosingLineInput {
  product_id: string;
  final_qty: number;
  product_state: ProductState;
  anomaly_comment?: string;
}

/* ------------------------------------------------------------------ */
/* Hook principal                                                      */
/* ------------------------------------------------------------------ */

export interface UseStockResult {
  products: UseQueryResult<Product[]>;
  dotations: UseQueryResult<RunnerDotation[]>;
  stockLines: UseQueryResult<EventStockLine[]>;
  /** Map produit pour jointures d'affichage. */
  productMap: Map<string, Product>;
  phase: StockPhase;
  loading: boolean;
  submitOpening: (lines: OpeningLineInput[], responsableNom: string) => Promise<void>;
  submitReassort: (lines: ReassortLineInput[], responsableNom: string) => Promise<void>;
  submitClosing: (lines: ClosingLineInput[], responsableNom: string) => Promise<void>;
  advanceRunnerStatus: (dotationId: string, newStatus: RunnerStatus) => Promise<void>;
  submitting: boolean;
}

export function useStock(
  eventId: string | undefined,
  spaceId: string | undefined,
  options: { withPrices: boolean },
): UseStockResult {
  const queryClient = useQueryClient();
  const products = useProducts(options.withPrices);
  const dotations = useDotations(eventId, spaceId);
  const stockLines = useStockLines(eventId, spaceId);

  const productMap = useMemo(() => {
    const map = new Map<string, Product>();
    (products.data ?? []).forEach((p) => map.set(p.product_id, p));
    return map;
  }, [products.data]);

  const phase = useMemo(
    () => derivePhase(stockLines.data ?? []),
    [stockLines.data],
  );

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['stockLines', eventId, spaceId] });
    void queryClient.invalidateQueries({ queryKey: ['dotations', eventId, spaceId] });
  }

  /** RG-002 : insère un mouvement de stock. */
  async function insertMovement(
    product_id: string,
    movement_type: string,
    qty: number,
    responsable_nom: string,
  ) {
    const { error } = await supabase.from('stock_movements').insert({
      event_id: eventId,
      space_id: spaceId,
      product_id,
      movement_type,
      qty,
      responsable_nom,
    });
    if (error) throw error;
  }

  // --- Ouverture : INSERT lignes + mouvements 'entrée' (RG-002) ---
  const openingMutation = useMutation({
    mutationFn: async (vars: { lines: OpeningLineInput[]; responsableNom: string }) => {
      assertResponsable(vars.responsableNom);
      if (!eventId || !spaceId) throw new Error('Événement ou espace manquant.');

      for (const line of vars.lines) {
        // RG-002 : mouvement AVANT la ligne de stock.
        if (line.initial_qty > 0) {
          await insertMovement(line.product_id, 'entrée', line.initial_qty, vars.responsableNom);
        }
        const { error } = await supabase.from('event_stock_lines').insert({
          event_id: eventId,
          space_id: spaceId,
          product_id: line.product_id,
          initial_qty: line.initial_qty,
          reassort_qty: 0,
          responsable_nom: vars.responsableNom,
        });
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
  });

  // --- Réassort : mouvement 'réassort' + UPDATE reassort_qty (RG-002) ---
  const reassortMutation = useMutation({
    mutationFn: async (vars: { lines: ReassortLineInput[]; responsableNom: string }) => {
      assertResponsable(vars.responsableNom);
      const current = stockLines.data ?? [];

      for (const line of vars.lines) {
        if (line.delta <= 0) continue;
        const existing = current.find((l) => l.product_id === line.product_id);
        if (!existing) {
          throw new Error('Ligne de stock introuvable pour le réassort.');
        }
        // RG-002 : mouvement AVANT la mise à jour.
        await insertMovement(line.product_id, 'réassort', line.delta, vars.responsableNom);
        const { error } = await supabase
          .from('event_stock_lines')
          .update({ reassort_qty: existing.reassort_qty + line.delta })
          .eq('line_id', existing.line_id);
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
  });

  // --- Clôture : RG-004 + mouvement 'inventaire' + UPDATE final_qty ---
  const closingMutation = useMutation({
    mutationFn: async (vars: { lines: ClosingLineInput[]; responsableNom: string }) => {
      assertResponsable(vars.responsableNom);
      const current = stockLines.data ?? [];

      // RG-004 : valider toutes les lignes AVANT toute écriture.
      for (const line of vars.lines) {
        const existing = current.find((l) => l.product_id === line.product_id);
        if (!existing) throw new Error('Ligne de stock introuvable pour la clôture.');
        const consumed = computeConsumed(
          existing.initial_qty,
          existing.reassort_qty,
          line.final_qty,
        );
        if (consumed < 0 && !(line.anomaly_comment && line.anomaly_comment.trim())) {
          throw new Error(
            `Consommation négative sur un produit (final > initial + réassort). ` +
              `Un commentaire d'anomalie est obligatoire — RG-004.`,
          );
        }
      }

      for (const line of vars.lines) {
        const existing = current.find((l) => l.product_id === line.product_id)!;
        // RG-002 : mouvement d'inventaire AVANT la mise à jour.
        await insertMovement(line.product_id, 'inventaire', line.final_qty, vars.responsableNom);
        const { error } = await supabase
          .from('event_stock_lines')
          .update({
            final_qty: line.final_qty,
            product_state: line.product_state,
            anomaly_comment: line.anomaly_comment?.trim() || null,
            responsable_nom: vars.responsableNom,
            submitted_at: new Date().toISOString(),
          })
          .eq('line_id', existing.line_id);
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
  });

  // --- Avancer le runner_status (admin) ---
  const runnerMutation = useMutation({
    mutationFn: async (vars: { dotationId: string; newStatus: RunnerStatus }) => {
      const { error } = await supabase
        .from('runner_dotations')
        .update({ runner_status: vars.newStatus })
        .eq('dotation_id', vars.dotationId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return {
    products,
    dotations,
    stockLines,
    productMap,
    phase,
    loading: products.isLoading || dotations.isLoading || stockLines.isLoading,
    submitOpening: (lines, responsableNom) =>
      openingMutation.mutateAsync({ lines, responsableNom }),
    submitReassort: (lines, responsableNom) =>
      reassortMutation.mutateAsync({ lines, responsableNom }),
    submitClosing: (lines, responsableNom) =>
      closingMutation.mutateAsync({ lines, responsableNom }),
    advanceRunnerStatus: (dotationId, newStatus) =>
      runnerMutation.mutateAsync({ dotationId, newStatus }),
    submitting:
      openingMutation.isPending ||
      reassortMutation.isPending ||
      closingMutation.isPending ||
      runnerMutation.isPending,
  };
}
