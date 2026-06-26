/**
 * Hook useSchedules — horaires staff par espace (Phase 5).
 * Les heures travaillées sont calculées de planned_arrival à actual_departure
 * (gestion du passage minuit via computeHoursWorked).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Schedule } from '@/lib/types';

export interface NewSchedule {
  staff_name: string;
  role?: string | null;
  planned_arrival?: string | null;
  planned_departure?: string | null;
}

export function useSchedules(
  eventId: string | undefined,
  spaceId: string | undefined,
) {
  const queryClient = useQueryClient();

  const schedules = useQuery({
    queryKey: ['schedules', eventId, spaceId],
    enabled: !!eventId && !!spaceId,
    queryFn: async (): Promise<Schedule[]> => {
      const { data, error } = await supabase
        .from('schedules')
        .select('*')
        .eq('event_id', eventId)
        .eq('space_id', spaceId)
        .order('staff_name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Schedule[];
    },
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['schedules', eventId, spaceId] });
  }

  const addMutation = useMutation({
    mutationFn: async (data: NewSchedule) => {
      if (!eventId || !spaceId) throw new Error('Événement ou espace manquant.');
      if (!data.staff_name.trim()) throw new Error('Nom de l\'agent obligatoire.');
      const { error } = await supabase.from('schedules').insert({
        event_id: eventId,
        space_id: spaceId,
        staff_name: data.staff_name.trim(),
        role: data.role || null,
        planned_arrival: data.planned_arrival || null,
        planned_departure: data.planned_departure || null,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const updateMutation = useMutation({
    mutationFn: async (vars: { id: string; fields: Partial<Schedule> }) => {
      const { error } = await supabase
        .from('schedules')
        .update(vars.fields)
        .eq('schedule_id', vars.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return {
    schedules,
    addSchedule: (data: NewSchedule) => addMutation.mutateAsync(data),
    updateDeparture: (id: string, actual_departure: string) =>
      updateMutation.mutateAsync({ id, fields: { actual_departure } }),
    setConfirm: (
      id: string,
      fields: Pick<Schedule, 'confirmed_by_staff'> | Pick<Schedule, 'confirmed_by_manager'>,
    ) => updateMutation.mutateAsync({ id, fields }),
    submitting: addMutation.isPending || updateMutation.isPending,
  };
}
