/**
 * useBuvetteGroups — groupes de buvettes (Buvette 1 / Buvette 2) et leurs
 * membres (espaces buvettes). Réservé ROLE_STADE (RLS is_stade()).
 * Les buvettes ne sont déployées que sur les matchs.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface BuvetteMember {
  id: string;
  space_id: string;
  is_active: boolean;
  space: { space_name: string; access_code: string } | null;
}

export interface BuvetteGroup {
  id: string;
  group_name: string;
  group_code: string;
  responsable_name: string | null;
  description: string | null;
  color: string;
  is_active: boolean;
  members: BuvetteMember[];
}

export function useBuvetteGroups() {
  return useQuery({
    queryKey: ['buvetteGroups'],
    staleTime: 30_000,
    queryFn: async (): Promise<BuvetteGroup[]> => {
      const { data, error } = await supabase
        .from('buvette_groups')
        .select(
          'id, group_name, group_code, responsable_name, description, color, is_active, members:buvette_group_members(id, space_id, is_active, space:spaces(space_name, access_code))',
        )
        .order('group_code');
      if (error) throw error;
      return ((data ?? []) as unknown as BuvetteGroup[]).map((g) => ({
        ...g,
        members: [...(g.members ?? [])].sort((a, b) =>
          (a.space?.space_name ?? '').localeCompare(b.space?.space_name ?? ''),
        ),
      }));
    },
  });
}

/** Tous les espaces de type Buvette (pour la modale de gestion). */
export function useAllBuvettes() {
  return useQuery({
    queryKey: ['allBuvettes'],
    staleTime: 60_000,
    queryFn: async (): Promise<{ space_id: string; space_name: string; access_code: string }[]> => {
      const { data, error } = await supabase
        .from('spaces')
        .select('space_id, space_name, access_code')
        .eq('space_type', 'Buvette')
        .order('space_name');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useBuvetteGroupMutations() {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['buvetteGroups'] });

  const toggleMember = useMutation({
    mutationFn: async ({ memberId, isActive }: { memberId: string; isActive: boolean }) => {
      const { error } = await supabase.from('buvette_group_members').update({ is_active: isActive }).eq('id', memberId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const setMembership = useMutation({
    mutationFn: async ({ groupId, spaceId, member }: { groupId: string; spaceId: string; member: boolean }) => {
      if (member) {
        const { error } = await supabase
          .from('buvette_group_members')
          .upsert({ group_id: groupId, space_id: spaceId, is_active: true }, { onConflict: 'group_id,space_id' });
        if (error) throw error;
        await supabase.from('spaces').update({ buvette_group_id: groupId }).eq('space_id', spaceId);
      } else {
        const { error } = await supabase
          .from('buvette_group_members')
          .delete()
          .eq('group_id', groupId)
          .eq('space_id', spaceId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      invalidate();
      void qc.invalidateQueries({ queryKey: ['allBuvettes'] });
    },
  });

  const setResponsable = useMutation({
    mutationFn: async ({ groupId, name }: { groupId: string; name: string }) => {
      const { error } = await supabase.from('buvette_groups').update({ responsable_name: name }).eq('id', groupId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return {
    toggleMember: toggleMember.mutateAsync,
    setMembership: setMembership.mutateAsync,
    setResponsable: setResponsable.mutateAsync,
    busy: toggleMember.isPending || setMembership.isPending || setResponsable.isPending,
  };
}
