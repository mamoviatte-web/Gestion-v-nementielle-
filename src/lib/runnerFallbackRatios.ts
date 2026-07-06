/**
 * runnerFallbackRatios — plan B pour la fiche runner quand consumption_analytics
 * est vide. Ratios de base VIP calculés depuis les 5 matchs S-1 (Salon Nord,
 * quantité moyenne par match). Utilisés UNIQUEMENT si aucune référence analytics.
 */

export const FALLBACK_VIP: Record<string, number> = {
  'mumm blanc de blanc': 31,
  'perrier grande bouteille': 28,
  'vittel verre': 22,
  'pepsi bouteille': 18,
  'blanc galiniere': 15,
  'mumm cordon rouge': 15,
  'rosé miraval': 12,
  'get 27': 8,
  schweppes: 7,
  'jus de fruits': 6,
  'fût bud': 4,
  'whisky jameson': 4,
  'lillet blanc': 4,
  'fût leffe': 3,
  'ricard classique': 2,
};

export type RecommendationSource = 'analytics' | 'fallback' | 'none';

/**
 * Recommandation runner : priorité aux analytics réelles, repli sur les ratios
 * S-1 calibrés. Renvoie la source pour l'affichage (badge « estimé »).
 */
export function getRecommendation(
  productName: string,
  analyticsQty: number | null,
  weatherCoeff: number,
  trendCoeff: number,
): { qty: number; source: RecommendationSource } {
  const hasAnalytics = analyticsQty != null && analyticsQty > 0;
  const base = hasAnalytics ? analyticsQty : (FALLBACK_VIP[productName.trim().toLowerCase()] ?? 0);
  if (base === 0) return { qty: 0, source: 'none' };
  const qty = Math.ceil(base * weatherCoeff * trendCoeff);
  return { qty, source: hasAnalytics ? 'analytics' : 'fallback' };
}
