/**
 * Moteur de recommandation — apprend de l'historique (consumption_analytics)
 * et applique des coefficients contextuels transparents (CDC Runner Auto §4).
 * Fonctions pures, testables. Aucune I/O réseau.
 */

import type { ConsumptionAnalytics, Event, Product } from './types';

/* ─── Coefficients contextuels ─────────────────────────────────────── */

/** Coefficient d'affluence (ratio attendu / moyenne historique observée). */
export function getAttendanceCoeff(
  expectedAttendance: number,
  historicalAvgAttendance: number,
): number {
  if (!historicalAvgAttendance) return 1.0;
  const ratio = expectedAttendance / historicalAvgAttendance;
  if (ratio < 0.7) return 0.8;
  if (ratio < 0.9) return 0.92;
  if (ratio <= 1.1) return 1.0;
  if (ratio <= 1.3) return 1.12;
  return 1.25;
}

/** Coefficient météo, différencié par catégorie produit. */
export function getWeatherCoeff(
  weather: string,
  _temperature: number,
  category: string,
): number {
  const isRefreshing = ['Bières', 'Soft'].includes(category);
  const isWarm = ['Bières', 'Soft'].includes(category);
  const isAlcohol = ['Spiritueux', 'Vins'].includes(category);
  const isMaterial = ['Matériel', 'Nettoyage'].includes(category);
  if (isMaterial) return 1.0;
  switch (weather) {
    case 'forte_chaleur':
      return isRefreshing ? 1.25 : isAlcohol ? 0.9 : 1.0;
    case 'chaleur':
      return isRefreshing ? 1.12 : 1.0;
    case 'pluie':
      return 0.88;
    case 'froid':
      return isRefreshing ? 0.85 : isAlcohol ? 1.08 : 1.0;
    case 'tres_favorable':
      return isWarm ? 1.1 : 1.02;
    default:
      return 1.0;
  }
}

/** Coefficient de tendance, pondéré par la force réelle de la tendance. */
export function getTrendCoeff(trendDirection: string, trendPctChange: number): number {
  const strength = Math.min(Math.abs(trendPctChange) / 100, 0.3);
  switch (trendDirection) {
    case 'forte_hausse':
      return 1.0 + Math.min(strength * 1.5, 0.25);
    case 'hausse':
      return 1.0 + Math.min(strength, 0.15);
    case 'forte_baisse':
      return 1.0 - Math.min(strength * 1.5, 0.25);
    case 'baisse':
      return 1.0 - Math.min(strength, 0.15);
    default:
      return 1.0;
  }
}

/** Pondération par la confiance historique (peu d'historique → prudent). */
export function getHistoricalConfidenceCoeff(confidenceScore: number): number {
  if (confidenceScore < 0.3) return 0.8;
  if (confidenceScore < 0.6) return 0.9;
  if (confidenceScore < 0.8) return 0.97;
  return 1.0;
}

/* ─── Génération d'une recommandation ──────────────────────────────── */

export interface RecommendationContext {
  event: Event;
  analytics: ConsumptionAnalytics | null;
  product: Product;
  areaInitialStock: number;
  /** Moyenne d'affluence des événements passés (depuis event_context_log). */
  historicalAvgAttendance?: number;
}

export interface RecommendationResult {
  recommendedQty: number;
  qtyToMove: number;
  coefficients: Record<string, number>;
  totalCoefficient: number;
  confidenceScore: number;
  baseQty: number;
  alertType: string | null;
  alertMessage: string | null;
}

export function computeRecommendation(ctx: RecommendationContext): RecommendationResult {
  const { event, analytics, product, areaInitialStock, historicalAvgAttendance } = ctx;

  // Aucun historique : recommandation prudente, saisie manuelle attendue.
  if (!analytics || analytics.nb_events_analyzed === 0) {
    return {
      recommendedQty: 0,
      qtyToMove: 0,
      coefficients: {},
      totalCoefficient: 1,
      confidenceScore: 0,
      baseQty: 0,
      alertType: 'premiere_fois',
      alertMessage:
        "Aucun historique pour ce produit dans cet espace. Renseignez manuellement la dotation.",
    };
  }

  // Base : médiane (robuste) dès 5 événements, sinon moyenne.
  const baseQty =
    analytics.nb_events_analyzed >= 5
      ? analytics.median_consumption ?? 0
      : analytics.avg_qty_per_event ?? 0;

  const coefAttendance = getAttendanceCoeff(
    event.expected_attendees ?? 8000,
    historicalAvgAttendance ?? event.expected_attendees ?? 8000,
  );
  const coefWeather = getWeatherCoeff(
    event.weather_type ?? 'normal',
    event.temperature ?? 20,
    product.category,
  );
  const coefTrend = getTrendCoeff(
    analytics.trend_direction ?? 'stable',
    analytics.trend_pct_change ?? 0,
  );
  const coefConfidence = getHistoricalConfidenceCoeff(analytics.confidence_score ?? 0);

  const totalCoefficient = coefAttendance * coefWeather * coefTrend * coefConfidence;
  const recommendedQty = Math.ceil(baseQty * totalCoefficient);
  const qtyToMove = Math.max(0, recommendedQty - areaInitialStock);
  const coefficients = { coefAttendance, coefWeather, coefTrend, coefConfidence };

  // ─── Alertes de lucidité ───────────────────────────────────────────
  // Risque de rupture récurrent → marge de sécurité +10 %.
  if (analytics.rupture_count >= 2) {
    const bumped = Math.ceil(recommendedQty * 1.1);
    return {
      recommendedQty: bumped,
      qtyToMove: Math.max(0, bumped - areaInitialStock),
      coefficients,
      totalCoefficient: totalCoefficient * 1.1,
      confidenceScore: analytics.confidence_score ?? 0,
      baseQty,
      alertType: 'risque_rupture',
      alertMessage: `Rupture observée ${analytics.rupture_count}× par le passé. Marge de sécurité intégrée.`,
    };
  }

  let alertType: string | null = null;
  let alertMessage: string | null = null;

  if (analytics.surdotation_count >= 3 && (analytics.return_rate_avg ?? 0) > 0.45) {
    alertType = 'surdotation_probable';
    alertMessage = `Surdotation constatée ${analytics.surdotation_count}× (taux de retour moyen ${Math.round(
      (analytics.return_rate_avg ?? 0) * 100,
    )}%). Recommandation ajustée.`;
  }

  if (analytics.trend_direction === 'forte_hausse') {
    alertType = alertType ?? 'tendance_hausse';
    alertMessage =
      alertMessage ??
      `Forte hausse sur les 3 derniers événements (+${Math.round(
        analytics.trend_pct_change ?? 0,
      )}%). Dotation augmentée.`;
  }

  return {
    recommendedQty,
    qtyToMove,
    coefficients,
    totalCoefficient,
    confidenceScore: analytics.confidence_score ?? 0,
    baseQty,
    alertType,
    alertMessage,
  };
}

/* ─── Aides d'affichage ────────────────────────────────────────────── */

export const TREND_META: Record<TrendDirectionKey, { label: string; arrow: string; tone: 'success' | 'danger' | 'neutral' | 'warning' }> = {
  forte_hausse: { label: 'Forte hausse', arrow: '↑↑', tone: 'success' },
  hausse: { label: 'Hausse', arrow: '↑', tone: 'success' },
  stable: { label: 'Stable', arrow: '↔', tone: 'neutral' },
  baisse: { label: 'Baisse', arrow: '↓', tone: 'warning' },
  forte_baisse: { label: 'Forte baisse', arrow: '↓↓', tone: 'danger' },
};

type TrendDirectionKey = 'forte_hausse' | 'hausse' | 'stable' | 'baisse' | 'forte_baisse';

/** Barème de fiabilité (0–1) → libellé + nombre de barres pleines sur 5. */
export function confidenceBars(score: number): { filled: number; label: string } {
  const filled = Math.round(Math.max(0, Math.min(1, score)) * 5);
  const label =
    score >= 0.8 ? 'Historique solide' : score >= 0.5 ? 'Fiable' : score >= 0.3 ? 'Indicatif' : 'Estimation';
  return { filled, label };
}
