/**
 * Logique métier du module Runner Auto-Planning (CDC V1.1 — Module Runner).
 *
 * Formule centrale :
 *   dotation_recommandée = consommation_référence
 *     × coeff_affluence × coeff_météo × coeff_type_événement × coeff_tendance
 */

import type {
  ConsumptionTrend,
  RunnerCoefficients,
  WeatherType,
} from './types';

/** Capacité de référence du stade (spectateurs). */
export const STADIUM_CAPACITY = 8500;

/* ─── Coefficients ─────────────────────────────────────────────────── */

/** Coefficient d'affluence (ratio attendu / capacité). */
export function getAttendanceCoeff(expected: number, capacity = STADIUM_CAPACITY): number {
  const ratio = capacity > 0 ? expected / capacity : 0;
  if (ratio < 0.4) return 0.85;
  if (ratio < 0.7) return 1.0;
  if (ratio < 0.9) return 1.15;
  return 1.3;
}

/** Coefficient météo, différencié par catégorie produit. */
export function getWeatherCoeff(weather: WeatherType, category: string): number {
  const isRefreshing = ['Soft', 'Bières'].includes(category);
  const isWarm = ['Soft', 'Bières'].includes(category);
  const isHot = category === 'Boissons chaudes';
  switch (weather) {
    case 'forte_chaleur':
      return isRefreshing ? 1.2 : 1.0;
    case 'pluie':
      return 0.9;
    case 'froid':
      return isHot ? 1.1 : 0.95;
    case 'tres_favorable':
      return isWarm ? 1.1 : 1.0;
    case 'chaleur':
      return isRefreshing ? 1.1 : 1.0;
    default:
      return 1.0;
  }
}

/* ------------------------------------------------------------------ */
/* Calibrage buvettes (5 matchs historiques : Angoulême, Barrage,      */
/* Colomiers, Mont-de-Marsan, Vannes)                                  */
/* ------------------------------------------------------------------ */

export interface BuvetteRatio {
  per100: number;
  type: 'soft_50cl' | 'fut';
}

/** Ratios de référence par 100 spectateurs du match (répartis sur ~9 buvettes). */
export const BUVETTE_REFERENCE_RATIOS: Record<string, BuvetteRatio> = {
  'Cristaline 50cl': { per100: 1.42, type: 'soft_50cl' },
  'Pepsi 50cl': { per100: 1.1, type: 'soft_50cl' },
  'Ice Tea 50cl': { per100: 0.92, type: 'soft_50cl' },
  'San Pellegrino 50cl': { per100: 0.73, type: 'soft_50cl' },
  'Orangina 50cl': { per100: 0.67, type: 'soft_50cl' },
  'Fût BUD': { per100: 0.22, type: 'fut' },
  'Fût LEFFE': { per100: 0.13, type: 'fut' },
  'Fût Goose Island IPA': { per100: 0.13, type: 'fut' },
  'Fût Hoegaarden Blanche': { per100: 0.11, type: 'fut' },
};

/** Coefficient météo calibré buvettes — softs 50cl très sensibles à la chaleur. */
export function getBuvetteWeatherCoeff(weather: WeatherType, productType: string): number {
  if (productType !== 'soft_50cl') return getWeatherCoeff(weather, 'Soft');
  switch (weather) {
    case 'forte_chaleur':
      return 1.4;
    case 'chaleur':
      return 1.2;
    case 'pluie':
      return 0.85;
    case 'froid':
      return 0.9;
    default:
      return 1.0;
  }
}

/**
 * Tendance haussière constatée sur les 5 matchs (softs +223 % Pepsi, +250 %
 * Cristaline). Par défaut, majorer légèrement les dotations buvettes.
 */
export const BUVETTE_TREND_COEFF = 1.15;

/** Coefficient type d'événement. */
export function getEventTypeCoeff(eventType: string): number {
  const coeffs: Record<string, number> = {
    séminaire: 0.8,
    séminaire_journee: 1.0,
    cocktail: 1.1,
    réception_vip: 1.2,
    match: 1.0,
    match_enjeu: 1.15,
    événement_partenaire: 1.1,
    réunion: 0.8,
    autre: 1.0,
  };
  return coeffs[eventType] ?? 1.0;
}

/** Coefficient de tendance de consommation. */
export function getTrendCoeff(trend: ConsumptionTrend): number {
  const coeffs: Record<ConsumptionTrend, number> = {
    stable: 1.0,
    hausse: 1.1,
    forte_hausse: 1.2,
    baisse: 0.9,
    surdotation: 0.85,
    rupture: 1.2,
  };
  return coeffs[trend];
}

/** Assemble les coefficients et leur produit. */
export function buildCoefficients(args: {
  expected: number;
  weather: WeatherType;
  category: string;
  eventType: string;
  trend: ConsumptionTrend;
}): RunnerCoefficients {
  const attendance = getAttendanceCoeff(args.expected);
  const weather = getWeatherCoeff(args.weather, args.category);
  const event_type = getEventTypeCoeff(args.eventType);
  const trend = getTrendCoeff(args.trend);
  return {
    attendance,
    weather,
    event_type,
    trend,
    total: attendance * weather * event_type * trend,
  };
}

/* ─── Formule principale ───────────────────────────────────────────── */

/** Dotation recommandée (toujours arrondie au-dessus). */
export function computeRecommendedQty(
  consumptionReference: number,
  coefficients: RunnerCoefficients,
): number {
  const raw =
    consumptionReference *
    coefficients.attendance *
    coefficients.weather *
    coefficients.event_type *
    coefficients.trend;
  return Math.ceil(raw);
}

/** Quantité à monter = recommandée − stock espace (plancher 0). */
export function computeQtyToMove(
  recommended: number,
  areaStock: number,
): { qty: number; sufficient: boolean } {
  return {
    qty: Math.max(0, recommended - areaStock),
    sufficient: areaStock >= recommended,
  };
}

/** Consommation de référence = moyenne(historique, dernier similaire). */
export function computeConsumptionReference(
  historicalAvg: number | null,
  lastSimilar: number | null,
): number {
  if (historicalAvg === null && lastSimilar === null) return 0;
  if (historicalAvg === null) return lastSimilar!;
  if (lastSimilar === null) return historicalAvg;
  return (historicalAvg + lastSimilar) / 2;
}

/** Type d'alerte d'une ligne. */
export function detectAlertType(
  recommended: number,
  historicalAvg: number | null,
  sufficient: boolean,
): 'rupture' | 'surdotation' | 'suffisant' | null {
  if (sufficient) return 'suffisant';
  if (historicalAvg && recommended > historicalAvg * 1.25) return 'surdotation';
  return null;
}

/* ─── Affichage ────────────────────────────────────────────────────── */

export type RunnerRowColor = 'green' | 'orange' | 'red' | 'blue' | 'gray';

/** Couleur de ligne selon stock/alerte/historique. */
export function getRunnerRowColor(plan: {
  stock_sufficient: boolean;
  alert_type: string | null;
  historical_avg_consumption: number | null;
  recommended_quantity: number | null;
}): RunnerRowColor {
  if (plan.stock_sufficient) return 'green';
  if (plan.alert_type === 'surdotation') return 'orange';
  if (plan.alert_type === 'rupture') return 'red';
  if ((plan.recommended_quantity ?? 0) === 0) return 'gray';
  if (plan.historical_avg_consumption === null) return 'blue';
  return 'blue';
}

/** Classes Tailwind par couleur de ligne. */
export const RUNNER_ROW_CLASSES: Record<RunnerRowColor, string> = {
  green: 'bg-emerald-50',
  orange: 'bg-amber-50',
  red: 'bg-red-50',
  blue: 'bg-blue-50',
  gray: 'bg-slate-50 text-slate-400',
};

/** Libellés des statuts de validation runner. */
export const RUNNER_STATUS_LABELS: Record<string, string> = {
  brouillon: 'Brouillon automatique',
  en_attente_validation: 'En attente validation',
  validé: 'Validé',
  transmis_runners: 'Transmis aux runners',
  préparé: 'Préparé',
  livré: 'Livré',
  retour_saisi: 'Retour saisi',
  clôturé: 'Clôturé',
};

/** Libellés des tendances de consommation. */
export const TREND_LABELS: Record<ConsumptionTrend, string> = {
  stable: 'Consommation stable (×1.00)',
  hausse: 'En hausse (×1.10)',
  forte_hausse: 'En forte hausse (×1.20)',
  baisse: 'En baisse (×0.90)',
  surdotation: 'Surdotation constatée (×0.85)',
  rupture: 'Rupture constatée (×1.20)',
};

/** Libellés météo. */
export const WEATHER_LABELS: Record<WeatherType, string> = {
  normal: 'Normal',
  chaleur: 'Chaleur',
  forte_chaleur: 'Forte chaleur',
  pluie: 'Pluie',
  froid: 'Froid',
  tres_favorable: 'Très favorable',
};
