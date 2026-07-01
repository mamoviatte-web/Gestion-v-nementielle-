/**
 * Hooks du module Analyse RH (Staff & Horaires) — ROLE_STADE.
 * Lit staff_event_summary / staff_analytics / schedules et la RPC
 * compute_staff_hours pour le détail par agent.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type {
  ScheduleRow,
  StaffAnalytics,
  StaffEventSummary,
  StaffHoursDetail,
} from '@/lib/types';

/** Résumés RH par événement (jointure événement), triés par date. */
export function useStaffSummaries() {
  return useQuery({
    queryKey: ['staffSummaries'],
    queryFn: async (): Promise<StaffEventSummary[]> => {
      const { data, error } = await supabase
        .from('staff_event_summary')
        .select('*, event:events(event_id, event_name, event_date, event_type)')
        .order('computed_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as StaffEventSummary[];
    },
  });
}

/** Ratios historiques par rôle × espace pour un type d'événement. */
export function useStaffAnalyticsRows(eventType: string) {
  return useQuery({
    queryKey: ['staffAnalyticsRows', eventType],
    queryFn: async (): Promise<StaffAnalytics[]> => {
      const { data, error } = await supabase
        .from('staff_analytics')
        .select('*, space:spaces(*)')
        .eq('event_type', eventType);
      if (error) throw error;
      return (data ?? []) as StaffAnalytics[];
    },
  });
}

/**
 * Lignes schedules enrichies (espace + événement) pour les agrégations
 * « Par agent » / « Par espace ». Filtrables par type d'événement.
 */
export function useStaffSchedules(eventType?: string) {
  return useQuery({
    queryKey: ['staffSchedules', eventType ?? 'all'],
    queryFn: async (): Promise<ScheduleRow[]> => {
      const { data, error } = await supabase
        .from('schedules')
        .select(
          '*, spaces(space_id, space_name, space_type), events(event_id, event_name, event_date, event_type, expected_attendees, status)',
        );
      if (error) throw error;
      const rows = (data ?? []) as ScheduleRow[];
      return eventType ? rows.filter((r) => r.events?.event_type === eventType) : rows;
    },
  });
}

/** Détail horaire d'un événement (RPC compute_staff_hours). */
export function useEventStaffHours(eventId: string | undefined) {
  return useQuery({
    queryKey: ['eventStaffHours', eventId],
    enabled: !!eventId,
    queryFn: async (): Promise<StaffHoursDetail[]> => {
      const { data, error } = await supabase.rpc('compute_staff_hours', { p_event_id: eventId });
      if (error) throw error;
      return (data ?? []) as StaffHoursDetail[];
    },
  });
}

/** Résumé RH d'un seul événement (pour StaffEventInsights). */
export function useEventStaffSummary(eventId: string | undefined) {
  return useQuery({
    queryKey: ['eventStaffSummary', eventId],
    enabled: !!eventId,
    queryFn: async (): Promise<StaffEventSummary | null> => {
      const { data, error } = await supabase
        .from('staff_event_summary')
        .select('*, event:events(event_id, event_name, event_date, event_type)')
        .eq('event_id', eventId)
        .maybeSingle();
      if (error) return null;
      return (data as StaffEventSummary) ?? null;
    },
  });
}
