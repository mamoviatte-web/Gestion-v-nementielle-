/** Hook useSpaces — liste des 16 espaces (admin). */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Space } from '@/lib/types';

export function useSpaces() {
  return useQuery({
    queryKey: ['spaces'],
    staleTime: 60_000,
    queryFn: async (): Promise<Space[]> => {
      const { data, error } = await supabase
        .from('spaces')
        .select('*')
        .order('space_name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Space[];
    },
  });
}
