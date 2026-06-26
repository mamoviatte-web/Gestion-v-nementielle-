/**
 * Hook useEventExportData — collecte toutes les données d'un événement pour
 * l'export Excel (admin / ROLE_STADE, prix inclus). Phase 7.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useEvent, useEventSpaces, type EventSpaceWithSpace } from '@/hooks/useEvents';
import { useProducts } from '@/hooks/useStock';
import type {
  Event,
  EventStockLine,
  Product,
  ProviderPresence,
  RunnerDotation,
  Schedule,
} from '@/lib/types';

export interface EventExportData {
  event: Event;
  spaces: EventSpaceWithSpace[];
  products: Product[];
  stockLines: EventStockLine[];
  dotations: RunnerDotation[];
  schedules: Schedule[];
  providers: ProviderPresence[];
}

function useEventCollection<T>(
  table: string,
  eventId: string | undefined,
): { data: T[]; isLoading: boolean } {
  const query = useQuery({
    queryKey: ['export', table, eventId],
    enabled: !!eventId,
    queryFn: async (): Promise<T[]> => {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .eq('event_id', eventId);
      if (error) throw error;
      return (data ?? []) as T[];
    },
  });
  return { data: query.data ?? [], isLoading: query.isLoading };
}

export function useEventExportData(eventId: string | undefined): {
  data: EventExportData | null;
  loading: boolean;
} {
  const eventQuery = useEvent(eventId);
  const spacesQuery = useEventSpaces(eventId);
  const productsQuery = useProducts(true);
  const stockLines = useEventCollection<EventStockLine>('event_stock_lines', eventId);
  const dotations = useEventCollection<RunnerDotation>('runner_dotations', eventId);
  const schedules = useEventCollection<Schedule>('schedules', eventId);
  const providers = useEventCollection<ProviderPresence>('provider_presence', eventId);

  const loading =
    eventQuery.isLoading ||
    spacesQuery.isLoading ||
    productsQuery.isLoading ||
    stockLines.isLoading ||
    dotations.isLoading ||
    schedules.isLoading ||
    providers.isLoading;

  if (!eventQuery.data) return { data: null, loading };

  return {
    loading,
    data: {
      event: eventQuery.data,
      spaces: spacesQuery.data ?? [],
      products: productsQuery.data ?? [],
      stockLines: stockLines.data,
      dotations: dotations.data,
      schedules: schedules.data,
      providers: providers.data,
    },
  };
}
