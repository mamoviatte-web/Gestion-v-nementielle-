/**
 * useStockAlerts — calcule les 8 alertes de stock du CDC V2 §10.
 * Chaque catégorie dégrade proprement (tableau vide) si la donnée est absente,
 * de sorte que le module reste fonctionnel avant que l'historique se remplisse.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { isDormantProduct } from '@/lib/stockCalculations';
import type { Product, StockAlert } from '@/lib/types';

interface AlertsInput {
  products: Product[];
  /**
   * Solde opérationnel courant par product_id, agrégé sur les emplacements
   * NON-réserve (espaces). Les dépôts centraux (reserve_centrale) en sont
   * exclus : ÉTAPE 8 — une alerte rupture ne concerne que le stock déployé sur
   * un espace. Un produit absent de cette map n'est pas déployé → aucune alerte
   * (évite les fausses ruptures sur le catalogue non encore mis en place).
   */
  operationalQty: Record<string, number>;
  /** Date de dernière consommation par product_id (null si jamais consommé). */
  lastConsumption: Record<string, string | null>;
  /** product_id ayant subi une perte/casse récente → message. */
  losses: { productId: string; qty: number }[];
  unresolvedVariance: number;
  /** Type météo du prochain événement, si connu. */
  nextWeather?: string | null;
}

export function computeStockAlerts(input: AlertsInput): StockAlert[] {
  const { products, operationalQty, lastConsumption, losses, unresolvedVariance, nextWeather } = input;
  const alerts: StockAlert[] = [];
  const byId = new Map(products.map((p) => [p.product_id, p]));

  for (const p of products) {
    // ÉTAPE 8 : un produit sans solde opérationnel (aucune ligne sur un espace)
    // n'est pas déployé → on ne lève ni rupture ni critique.
    const isDeployed = p.product_id in operationalQty;
    const qty = operationalQty[p.product_id] ?? 0;
    const min = p.min_stock ?? p.stock_min ?? 0;
    if (isDeployed && qty <= 0) {
      // 1. Rupture (prioritaire sur critique)
      alerts.push({
        type: 'rupture',
        severity: 'error',
        message: `${p.product_name} — rupture (0 ${p.unit})`,
        action: 'Commander en urgence',
      });
    } else if (isDeployed && min > 0 && qty < min) {
      // 2. Stock critique
      alerts.push({
        type: 'critique',
        severity: 'error',
        message: `${p.product_name} — ${qty} ${p.unit} (min: ${min})`,
        action: 'Commander',
      });
    }
    // 5. Produit dormant (uniquement s'il a un historique de conso)
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
      // ÉTAPE 8 : identifier les dépôts centraux (il en existe désormais 2 —
      // AUC + Stock EST) pour les EXCLURE des alertes opérationnelles.
      const { data: reserveLocs } = await supabase
        .from('stock_locations')
        .select('id')
        .eq('location_type', 'reserve_centrale');
      const reserveIds = new Set(((reserveLocs ?? []) as { id: string }[]).map((r) => r.id));

      const [{ data: products }, { data: balances }, { data: losses }, { data: consumptions }, { data: variances }] =
        await Promise.all([
          supabase.from('products').select('*').eq('active', true),
          supabase.from('stock_balances').select('product_id, location_id, current_quantity'),
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

      // Agrège les soldes des emplacements opérationnels (hors dépôts centraux).
      const operationalQty: Record<string, number> = {};
      for (const b of (balances ?? []) as {
        product_id: string;
        location_id: string;
        current_quantity: number;
      }[]) {
        if (reserveIds.has(b.location_id)) continue;
        operationalQty[b.product_id] = (operationalQty[b.product_id] ?? 0) + Number(b.current_quantity);
      }

      const lastConsumption: Record<string, string | null> = {};
      for (const c of (consumptions ?? []) as { product_id: string; created_at: string }[]) {
        if (!(c.product_id in lastConsumption)) lastConsumption[c.product_id] = c.created_at;
      }

      const unresolvedVariance = ((variances ?? []) as { variance: number | null; validated_at: string | null }[]).filter(
        (v) => v.variance !== null && Number(v.variance) !== 0 && !v.validated_at,
      ).length;

      return computeStockAlerts({
        products: (products ?? []) as Product[],
        operationalQty,
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
