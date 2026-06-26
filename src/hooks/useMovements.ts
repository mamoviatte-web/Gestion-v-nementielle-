/**
 * Hook useMovements — historique paginé des mouvements de stock (RG-002).
 * Pagination 50 lignes/page (toujours filtré par event_id — perf).
 */

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { StockMovement } from '@/lib/types';

export const MOVEMENTS_PAGE_SIZE = 50;

export interface MovementsPage {
  rows: StockMovement[];
  total: number;
}

export function useMovements(
  eventId: string | undefined,
  spaceId: string | undefined,
  page: number,
) {
  return useQuery({
    queryKey: ['movements', eventId, spaceId, page],
    enabled: !!eventId && !!spaceId,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<MovementsPage> => {
      const from = page * MOVEMENTS_PAGE_SIZE;
      const to = from + MOVEMENTS_PAGE_SIZE - 1;
      const { data, error, count } = await supabase
        .from('stock_movements')
        .select('*', { count: 'exact' })
        .eq('event_id', eventId)
        .eq('space_id', spaceId)
        .order('created_at', { ascending: false })
        .range(from, to);
      if (error) throw error;
      return { rows: (data ?? []) as StockMovement[], total: count ?? 0 };
    },
  });
}
