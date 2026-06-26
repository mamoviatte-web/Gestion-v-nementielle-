/**
 * Hook useCatalog — gestion du catalogue produits (admin, Phase 6).
 * RG-009 : pas de DELETE, désactivation via active=false (historique conservé).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Product, ProductCategory } from '@/lib/types';

export interface NewProduct {
  product_name: string;
  category: ProductCategory;
  unit: string;
  packaging?: string | null;
  unit_price_ht?: number | null;
  stock_min?: number;
}

export function useCatalog() {
  const queryClient = useQueryClient();

  const products = useQuery({
    queryKey: ['catalog'],
    staleTime: 30_000,
    queryFn: async (): Promise<Product[]> => {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('category', { ascending: true })
        .order('product_name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Product[];
    },
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['catalog'] });
    void queryClient.invalidateQueries({ queryKey: ['products', true] });
  }

  const addMutation = useMutation({
    mutationFn: async (data: NewProduct) => {
      if (!data.product_name.trim()) throw new Error('Nom du produit obligatoire.');
      const { error } = await supabase.from('products').insert({
        product_name: data.product_name.trim(),
        category: data.category,
        unit: data.unit || 'u',
        packaging: data.packaging || null,
        unit_price_ht: data.unit_price_ht ?? null,
        stock_min: data.stock_min ?? 0,
        active: true,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const setActiveMutation = useMutation({
    mutationFn: async (vars: { id: string; active: boolean }) => {
      const { error } = await supabase
        .from('products')
        .update({ active: vars.active })
        .eq('product_id', vars.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return {
    products,
    addProduct: (data: NewProduct) => addMutation.mutateAsync(data),
    setActive: (id: string, active: boolean) =>
      setActiveMutation.mutateAsync({ id, active }),
    submitting: addMutation.isPending || setActiveMutation.isPending,
  };
}
