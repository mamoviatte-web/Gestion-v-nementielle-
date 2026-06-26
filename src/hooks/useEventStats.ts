/**
 * Hook useEventStats — agrégats d'un événement (Phase 6).
 * Coût total, taux de retour moyen, avancement stocks/débriefs, anomalies.
 * Réservé au ROLE_STADE (lit les prix).
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useProducts } from '@/hooks/useStock';
import { useEventSpaces } from '@/hooks/useEvents';
import { useDebriefsForEvent } from '@/hooks/useDebriefs';
import {
  computeConsumed,
  computeCost,
  computeReturnRate,
} from '@/lib/calculations';
import type { EventStockLine } from '@/lib/types';

export interface NegativeConsumption {
  space_id: string;
  product_id: string;
  consumed: number;
}

export interface EventStats {
  loading: boolean;
  spacesTotal: number;
  spacesClosed: number;
  debriefsReceived: number;
  totalCost: number;
  hasMissingCost: boolean;
  returnRate: number; // 0..1
  negatives: NegativeConsumption[];
}

function useEventStockLines(eventId: string | undefined) {
  return useQuery({
    queryKey: ['eventStockLines', eventId],
    enabled: !!eventId,
    queryFn: async (): Promise<EventStockLine[]> => {
      const { data, error } = await supabase
        .from('event_stock_lines')
        .select('*')
        .eq('event_id', eventId);
      if (error) throw error;
      return (data ?? []) as EventStockLine[];
    },
  });
}

export function useEventStats(eventId: string | undefined): EventStats {
  const linesQuery = useEventStockLines(eventId);
  const spacesQuery = useEventSpaces(eventId);
  const debriefsQuery = useDebriefsForEvent(eventId);
  const productsQuery = useProducts(true);

  return useMemo(() => {
    const lines = linesQuery.data ?? [];
    const spaces = spacesQuery.data ?? [];
    const debriefs = debriefsQuery.data ?? [];
    const priceOf = new Map(
      (productsQuery.data ?? []).map((p) => [p.product_id, p.unit_price_ht]),
    );

    const closedLines = lines.filter((l) => l.final_qty !== null);
    const closedSpaces = new Set(closedLines.map((l) => l.space_id));

    let totalCost = 0;
    let hasMissingCost = false;
    let rateSum = 0;
    let rateCount = 0;
    const negatives: NegativeConsumption[] = [];

    for (const l of closedLines) {
      const consumed = computeConsumed(l.initial_qty, l.reassort_qty, l.final_qty ?? 0);
      if (consumed < 0) {
        negatives.push({ space_id: l.space_id, product_id: l.product_id, consumed });
      }
      const price = priceOf.get(l.product_id) ?? null;
      const cost = computeCost(consumed, price);
      if (cost === null) hasMissingCost = true;
      else totalCost += cost;

      rateSum += computeReturnRate(l.final_qty ?? 0, l.initial_qty, l.reassort_qty);
      rateCount += 1;
    }

    return {
      loading:
        linesQuery.isLoading ||
        spacesQuery.isLoading ||
        debriefsQuery.isLoading ||
        productsQuery.isLoading,
      spacesTotal: spaces.length,
      spacesClosed: closedSpaces.size,
      debriefsReceived: debriefs.filter((d) => d.submitted_at).length,
      totalCost,
      hasMissingCost,
      returnRate: rateCount > 0 ? rateSum / rateCount : 0,
      negatives,
    };
  }, [
    linesQuery.data,
    linesQuery.isLoading,
    spacesQuery.data,
    spacesQuery.isLoading,
    debriefsQuery.data,
    debriefsQuery.isLoading,
    productsQuery.data,
    productsQuery.isLoading,
  ]);
}
