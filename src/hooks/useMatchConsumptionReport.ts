/**
 * useMatchConsumptionReport — lignes de consommation d'un match, catégorisées
 * Grand Public / VIP / Bar (vue SQL match_consumption_report). Réservé ROLE_STADE.
 * Résilient : si la vue n'est pas encore provisionnée, renvoie provisioned=false.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface MatchConsumptionLine {
  event_id: string;
  consumption_category: 'Grand Public' | 'VIP' | 'Bar';
  space_id: string;
  space_name: string;
  service_type: 'vip' | 'bar' | 'buvette' | null;
  max_pax: number | null;
  expected_pax: number | null;
  product_id: string;
  product_name: string;
  category: string;
  unit: string;
  unit_price_ht: number | null;
  initial_qty: number;
  reassort_qty: number;
  final_qty: number | null;
  consumed_qty: number;
  cost_ht: number | null;
  qty_per_100pax: number | null;
}

export function useMatchConsumptionReport(eventId: string | undefined) {
  return useQuery({
    queryKey: ['matchConsumptionReport', eventId],
    enabled: !!eventId,
    staleTime: 30_000,
    queryFn: async (): Promise<{ lines: MatchConsumptionLine[]; provisioned: boolean }> => {
      const { data, error } = await supabase
        .from('match_consumption_report')
        .select('*')
        .eq('event_id', eventId);
      if (error) return { lines: [], provisioned: false };
      return { lines: (data ?? []) as MatchConsumptionLine[], provisioned: true };
    },
  });
}
