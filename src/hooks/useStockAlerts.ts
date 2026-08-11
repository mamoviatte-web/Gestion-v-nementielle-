/**
 * useStockAlerts — calcule les 8 alertes de stock du CDC V2 §10.
 * Chaque catégorie dégrade proprement (tableau vide) si la donnée est absente,
 * de sorte que le module reste fonctionnel avant que l'historique se remplisse.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { isDormantProduct } from '@/lib/stockCalculations';
import type { Product, StockAlert } from '@/lib/types';

/** Ligne de la vue stock_live_balance (source unique des alertes rupture/critique). */
export interface LiveBalanceRow {
  product_id: string;
  product_name: string;
  unit: string;
  qty_total_depot: number | null;
  min_stock: number | null;
  alert_status: string;
}

interface AlertsInput {
  /**
   * Soldes de réserve centrale (vue stock_live_balance) : source unique des
   * alertes rupture/critique. La vue reflète l'inventaire (trigger) et respecte
   * le drapeau track_central_stock (produits exclus absents de la liste). Un
   * inventaire de la réserve met donc à jour les alertes automatiquement.
   */
  live: LiveBalanceRow[];
  /** Catalogue actif (pour l'alerte « produit dormant »). */
  products: Product[];
  /** Date de dernière consommation par product_id (null si jamais consommé). */
  lastConsumption: Record<string, string | null>;
  /** product_id ayant subi une perte/casse récente → message. */
  losses: { productId: string; qty: number }[];
  unresolvedVariance: number;
  /** Type météo du prochain événement, si connu. */
  nextWeather?: string | null;
}

export function computeStockAlerts(input: AlertsInput): StockAlert[] {
  const { live, products, lastConsumption, losses, unresolvedVariance, nextWeather } = input;
  const alerts: StockAlert[] = [];
  const byId = new Map(products.map((p) => [p.product_id, p]));

  // 1/2. Rupture & critique depuis la réserve centrale (stock_live_balance).
  for (const r of live) {
    const qty = Number(r.qty_total_depot) || 0;
    const min = r.min_stock ?? 0;
    if (r.alert_status === 'rupture') {
      alerts.push({
        type: 'rupture',
        severity: 'error',
        message: `${r.product_name} — rupture (0 ${r.unit})`,
        action: 'Commander en urgence',
      });
    } else if (r.alert_status === 'critique') {
      alerts.push({
        type: 'critique',
        severity: 'error',
        message: `${r.product_name} — ${qty} ${r.unit} (min: ${min})`,
        action: 'Commander',
      });
    }
  }

  // 5. Produit dormant (uniquement s'il a un historique de conso).
  for (const p of products) {
    const last = lastConsumption[p.product_id];
    if (last !== undefined && isDormantProduct(last ? new Date(last) : null) && last) {
      alerts.push({
        type: 'dormant',
        severity: 'info',
        message: `${p.product_name} — aucune consommation depuis plus de 90 jours`,
      });
    }
  }

  // 4. Perte / casse
  for (const l of losses) {
    const p = byId.get(l.productId);
    if (p) {
      alerts.push({
        type: 'perte_casse',
        severity: 'warning',
        message: `${p.product_name} — ${l.qty} ${p.unit} en perte/casse`,
        action: 'Vérifier l’anomalie',
      });
    }
  }

  // 6. Écarts d'inventaire non résolus
  if (unresolvedVariance > 0) {
    alerts.push({
      type: 'ecart_inventaire',
      severity: 'warning',
      message: `${unresolvedVariance} écart(s) d'inventaire non résolu(s)`,
      action: 'Valider l’inventaire',
    });
  }

  // 8. Météo chaude sur le prochain événement
  if (nextWeather === 'forte_chaleur' || nextWeather === 'chaleur') {
    alerts.push({
      type: 'meteo_chaude',
      severity: 'info',
      message: 'Prochaine météo chaude → +20 % eau / softs / bière recommandé',
      action: 'Augmenter la dotation',
    });
  }

  return alerts;
}

/** Hook : agrège les données et renvoie les alertes de stock. */
export function useStockAlerts() {
  return useQuery({
    queryKey: ['stockAlerts'],
    staleTime: 15_000,
    queryFn: async (): Promise<StockAlert[]> => {
      const [{ data: live }, { data: products }, { data: losses }, { data: consumptions }, { data: variances }] =
        await Promise.all([
          // Source unique des ruptures/critiques : la réserve centrale (reflète
          // l'inventaire, respecte track_central_stock).
          supabase.from('stock_live_balance').select('product_id, product_name, unit, qty_total_depot, min_stock, alert_status'),
          supabase.from('products').select('*').eq('active', true),
          supabase
            .from('stock_movements')
            .select('product_id, qty')
            .eq('movement_type', 'perte_casse')
            .order('created_at', { ascending: false })
            .limit(20),
          supabase
            .from('stock_movements')
            .select('product_id, created_at')
            .eq('movement_type', 'consommation')
            .order('created_at', { ascending: false })
            .limit(500),
          supabase.from('inventory_counts').select('variance, validated_at'),
        ]);

      const lastConsumption: Record<string, string | null> = {};
      for (const c of (consumptions ?? []) as { product_id: string; created_at: string }[]) {
        if (!(c.product_id in lastConsumption)) lastConsumption[c.product_id] = c.created_at;
      }

      const unresolvedVariance = ((variances ?? []) as { variance: number | null; validated_at: string | null }[]).filter(
        (v) => v.variance !== null && Number(v.variance) !== 0 && !v.validated_at,
      ).length;

      return computeStockAlerts({
        live: (live ?? []) as LiveBalanceRow[],
        products: (products ?? []) as Product[],
        lastConsumption,
        losses: ((losses ?? []) as { product_id: string; qty: number }[]).map((l) => ({
          productId: l.product_id,
          qty: l.qty,
        })),
        unresolvedVariance,
        nextWeather: null,
      });
    },
  });
}
