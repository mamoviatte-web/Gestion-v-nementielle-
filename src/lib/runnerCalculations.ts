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

/* ─── Dotation par type de service (Grand Public / VIP / Bar) ───────────── */

/**
 * Ratios de base VIP par produit (unités / 100 pax de l'espace).
 * Utilisés en repli quand l'historique consumption_analytics est absent.
 */
export const VIP_BASE_RATIOS: Record<string, number> = {
  'MUMM CORDON ROUGE': 2.5,
  'Mumm Cordon Rouge': 2.5,
  'Mumm Blanc de Blanc': 1.5,
  'Rosé Miraval': 3.5,
  'Rosé Réal': 3.0,
  'Whisky Jameson': 1.0,
  'Lillet Blanc': 1.5,
  'Lillet Rosé': 1.0,
  'Ricard classique': 1.2,
  'Pepsi bouteille': 4.0,
  Schweppes: 2.5,
  'Jus de fruits': 3.0,
  'Sirop de pêche': 0.8,
  'Sirop de grenadine': 0.6,
};

export function getVIPBaseRatio(productName: string): number {
  return VIP_BASE_RATIOS[productName] ?? 0;
}

/** Ratio de base bar (repli) — moitié du ratio VIP par défaut. */
export function getBarBaseRatio(productName: string): number {
  return getVIPBaseRatio(productName) * 0.7;
}

export interface SpaceDotationInput {
  serviceType: 'vip' | 'bar' | 'buvette';
  productName: string;
  productCategory: string;
  /** Affluence totale du match (spectateurs). */
  eventPax: number;
  /** Pax attendus dans cet espace (VIP/Bar) — null pour buvettes. */
  expectedSpacePax: number | null;
  /** max_pax de l'espace (repli si expectedSpacePax null). */
  spaceMaxPax: number | null;
  /** Ratio historique /100 pax (consumption_analytics) si disponible. */
  historicalRatio: number | null;
  weather: WeatherType;
  trend: ConsumptionTrend;
}

export interface SpaceDotationResult {
  qty: number;
  source: 'ratio_grand_public' | 'ratio_vip_capacite' | 'ratio_bar';
}

/**
 * Calcule la dotation d'un produit pour un espace selon son type de service.
 *  - buvette : ratio /100 pax du stade × affluence totale (Grand Public)
 *  - vip     : ratio /100 pax × pax attendus de l'espace (capacité fixe)
 *  - bar     : hybride, basé sur les pax de l'espace
 */
export function computeSpaceDotation(input: SpaceDotationInput): SpaceDotationResult {
  const pax = input.expectedSpacePax ?? input.spaceMaxPax ?? 100;

  if (input.serviceType === 'buvette') {
    const ref = BUVETTE_REFERENCE_RATIOS[input.productName];
    const base = input.historicalRatio ?? ref?.per100 ?? 0;
    const coefWeather = getBuvetteWeatherCoeff(input.weather, ref?.type ?? 'fut');
    const coefTrend = getTrendCoeff(input.trend);
    const qty = Math.ceil((input.eventPax / 100) * base * coefWeather * coefTrend);
    return { qty, source: 'ratio_grand_public' };
  }

  if (input.serviceType === 'vip') {
    const base = input.historicalRatio ?? getVIPBaseRatio(input.productName);
    const coefWeather = getWeatherCoeff(input.weather, input.productCategory);
    const qty = Math.ceil((pax / 100) * base * coefWeather);
    return { qty, source: 'ratio_vip_capacite' };
  }

  const base = input.historicalRatio ?? getBarBaseRatio(input.productName);
  const qty = Math.ceil((pax / 100) * base);
  return { qty, source: 'ratio_bar' };
}

/* ─── Recommandation runner : historique réel → fallback calibré ────────── */

/**
 * Ratios de base VIP Salon Nord (unités / 100 pax de l'espace), calibrés sur
 * la moyenne des 5 matchs réels. Repli quand consumption_analytics est vide.
 */
export const VIP_BASE_RATIOS_SALON_NORD: Record<string, number> = {
  'Mumm Cordon Rouge': 3.13,
  'Mumm Blanc de Blanc': 7.75,
  'Rosé Miraval': 2.8,
  'Rosé Réal': 1.0,
  'Rouge Les Alexandrins': 1.55,
  'Rouge Grand Boise': 1.3,
  'Blanc Galiniere': 3.55,
  'Blanc du Seuil': 0.8,
  'Blanc Montaurone': 2.5,
  'Fût BUD': 0.8,
  'Fût LEFFE': 0.6,
  'Pepsi bouteille': 4.5,
  'Pepsi Max bouteille': 1.15,
  'Perrier grande bouteille': 6.88,
  Schweppes: 1.6,
  'Jus de fruits': 1.5,
  'Whisky Jameson': 0.85,
  'GET 27': 2.0,
  'Lillet Blanc': 1.18,
  'Lillet Rosé': 0.42,
  'Ricard classique': 0.5,
  'Sirop de pêche': 0.25,
};

/** Ratios génériques par type de service (repli global, /100 pax). */
export const SERVICE_TYPE_BASE_RATIOS: Record<'vip' | 'bar' | 'buvette', Record<string, number>> = {
  vip: { Vins: 3.5, Spiritueux: 1.0, Bières: 0.8, Soft: 5.0, Sirops: 0.3 },
  bar: { Vins: 2.0, Spiritueux: 0.5, Bières: 1.5, Soft: 6.0, Sirops: 0.5 },
  buvette: { Soft: 20.0, Bières: 4.0, Sirops: 1.0 },
};

export interface RunnerRecommendationInput {
  productName: string;
  productCategory: string;
  serviceType: 'vip' | 'bar' | 'buvette';
  expectedPax: number;
  historicalRatioPer100: number | null;
  historicalNbEvents: number | null;
  historicalConfidence: number | null;
  weatherCoeff: number;
  trendCoeff: number;
}

export interface RunnerRecommendationResult {
  qty: number;
  source: string;
  confidence: string;
}

/**
 * Recommandation runner : priorité aux données historiques réelles, repli sur
 * les ratios VIP calibrés (Salon Nord), puis sur les ratios génériques par type.
 * Garantit une reco ≥ 0 non triviale dès qu'un ratio est disponible.
 */
export function computeRunnerRecommendation(input: RunnerRecommendationInput): RunnerRecommendationResult {
  let base: number;
  let source: string;

  if (input.historicalRatioPer100 != null && input.historicalRatioPer100 > 0) {
    base = input.historicalRatioPer100;
    const n = input.historicalNbEvents ?? 0;
    source = `Historique (${n} match${n > 1 ? 's' : ''})`;
  } else if (input.serviceType === 'vip' && VIP_BASE_RATIOS_SALON_NORD[input.productName]) {
    base = VIP_BASE_RATIOS_SALON_NORD[input.productName];
    source = 'Ratio base VIP calibré';
  } else {
    base = SERVICE_TYPE_BASE_RATIOS[input.serviceType]?.[input.productCategory] ?? 0;
    source = 'Ratio générique';
  }

  const raw = (input.expectedPax / 100) * base * input.weatherCoeff * input.trendCoeff;
  const qty = Math.max(0, Math.ceil(raw));
  const confidence =
    input.historicalConfidence != null ? `${Math.round(input.historicalConfidence * 100)}%` : '—';
  return { qty, source, confidence };
}
