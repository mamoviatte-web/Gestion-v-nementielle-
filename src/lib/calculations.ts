/**
 * Calculs métier — Stade Maurice David (CDC V1.1)
 *
 * Toutes les fonctions sont pures (aucun effet de bord) et défensives :
 * elles renvoient `null` lorsqu'une donnée indispensable manque, afin de
 * propager proprement les « valeurs non calculables » dans l'UI (RG-005).
 */

import type { ProviderPresence, ProviderStatus } from './types';

/* ------------------------------------------------------------------ */
/* Consommation & coûts                                                */
/* ------------------------------------------------------------------ */

/**
 * Consommation d'un produit sur un événement (formule centrale — CDC §9).
 *
 *   consommé = (initial + réassort) − final
 *
 * La valeur n'est volontairement PAS plafonnée à 0 : une consommation
 * négative est une anomalie qui doit être détectée et commentée (RG-004),
 * pas masquée.
 *
 * @param initial  Stock d'ouverture.
 * @param reassort Réassort cumulé pendant l'événement.
 * @param final    Stock de clôture.
 * @returns La quantité consommée (peut être négative — anomalie RG-004).
 */
export function computeConsumed(
  initial: number,
  reassort: number,
  final: number,
): number {
  return initial + reassort - final;
}

/**
 * Coût de la consommation (RG-005).
 *
 * Retourne `null` si le prix unitaire est manquant (`null`), afin de
 * distinguer « coût nul » de « coût inconnu ».
 *
 * @param consumed  Quantité consommée.
 * @param unitPrice Prix unitaire HT, ou `null` si non renseigné.
 * @returns Le coût HT, ou `null` si le prix est indisponible.
 */
export function computeCost(
  consumed: number,
  unitPrice: number | null,
): number | null {
  if (unitPrice === null || unitPrice === undefined) return null;
  return consumed * unitPrice;
}

/* ------------------------------------------------------------------ */
/* Durées (gestion du passage de minuit)                               */
/* ------------------------------------------------------------------ */

/**
 * Convertit une heure "HH:MM" en nombre de minutes depuis minuit.
 * @returns Minutes, ou `null` si le format est invalide.
 */
function parseTimeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Différence en minutes entre deux heures, en gérant le passage de minuit.
 * Si la fin est antérieure au début, on considère que la fin est le
 * lendemain (ajout de 24 h).
 *
 * @returns Minutes écoulées (≥ 0), ou `null` si une heure est invalide.
 */
function diffMinutes(
  start: string | null | undefined,
  end: string | null | undefined,
): number | null {
  const startMin = parseTimeToMinutes(start);
  const endMin = parseTimeToMinutes(end);
  if (startMin === null || endMin === null) return null;
  let delta = endMin - startMin;
  if (delta < 0) delta += 24 * 60; // passage minuit
  return delta;
}

/**
 * Durée travaillée en heures (gère le passage de minuit).
 *
 * @param arrival   Heure d'arrivée "HH:MM".
 * @param departure Heure de départ "HH:MM".
 * @returns Nombre d'heures décimal, ou `null` si une heure est invalide.
 */
export function computeHoursWorked(
  arrival: string,
  departure: string,
): number | null {
  const minutes = diffMinutes(arrival, departure);
  if (minutes === null) return null;
  return minutes / 60;
}

/**
 * Durée de présence en heures (gère le passage de minuit).
 * Alias sémantique de {@link computeHoursWorked} pour les prestataires.
 *
 * @returns Nombre d'heures décimal, ou `null` si une heure est invalide.
 */
export function computePresenceDuration(
  arrival: string,
  departure: string,
): number | null {
  return computeHoursWorked(arrival, departure);
}

/**
 * Retard d'un prestataire en minutes (RG-008).
 *
 * @param planned Heure prévue "HH:MM".
 * @param actual  Heure réelle d'arrivée "HH:MM".
 * @returns Retard en minutes (positif = en retard, négatif = en avance),
 *          ou `null` si une heure est invalide.
 */
export function computeProviderDelay(
  planned: string,
  actual: string,
): number | null {
  const plannedMin = parseTimeToMinutes(planned);
  const actualMin = parseTimeToMinutes(actual);
  if (plannedMin === null || actualMin === null) return null;
  return actualMin - plannedMin;
}

/* ------------------------------------------------------------------ */
/* Statut prestataire (RG-008)                                         */
/* ------------------------------------------------------------------ */

/** Seuil de tolérance (minutes) au-delà duquel un prestataire est "en retard" (RG-008). */
export const DELAY_TOLERANCE_MINUTES = 15;

/**
 * Calcule le statut réel d'un prestataire à partir de ses données (RG-008) :
 *
 *   if (actual_departure_time)        → 'terminé'
 *   if (!actual_arrival_time)         → 'prévu'
 *   if (delay_minutes > 15)           → 'en_retard'
 *   else                              → 'présent'
 *
 * Les statuts non déductibles des horaires (`annulé`, `absent`) renseignés
 * manuellement sont conservés.
 *
 * @param provider Enregistrement de présence prestataire.
 * @returns Le statut calculé.
 */
export function computeProviderStatus(
  provider: ProviderPresence,
): ProviderStatus {
  if (provider.status === 'annulé') return 'annulé';

  if (provider.actual_departure_time) return 'terminé';

  if (!provider.actual_arrival_time) {
    return provider.status === 'absent' ? 'absent' : 'prévu';
  }

  if (provider.planned_arrival_time) {
    const delay = computeProviderDelay(
      provider.planned_arrival_time,
      provider.actual_arrival_time,
    );
    if (delay !== null && delay > DELAY_TOLERANCE_MINUTES) {
      return 'en_retard';
    }
  }
  return 'présent';
}

/* ------------------------------------------------------------------ */
/* KPIs                                                                */
/* ------------------------------------------------------------------ */

/**
 * Taux de retour = part du stock disponible non consommée.
 *
 *   taux = final / (initial + réassort)
 *
 * @returns Ratio entre 0 et 1, ou 0 si aucun stock disponible.
 */
export function computeReturnRate(
  final: number,
  initial: number,
  reassort: number,
): number {
  const available = initial + reassort;
  if (available <= 0) return 0;
  const rate = final / available;
  if (rate < 0) return 0;
  if (rate > 1) return 1;
  return rate;
}

/* ------------------------------------------------------------------ */
/* Formatage                                                           */
/* ------------------------------------------------------------------ */

/**
 * Formate une durée décimale en heures vers "XhYY".
 * Ex : 2.5 → "2h30", 1 → "1h00", 0.25 → "0h15".
 *
 * @param decimal Durée en heures (décimale).
 * @returns Chaîne "XhYY", ou "—" si la valeur n'est pas finie.
 */
export function formatHours(decimal: number): string {
  if (!Number.isFinite(decimal)) return '—';
  const sign = decimal < 0 ? '-' : '';
  const abs = Math.abs(decimal);
  const hours = Math.floor(abs);
  const minutes = Math.round((abs - hours) * 60);
  // Arrondi qui ferait passer à 60 minutes
  if (minutes === 60) {
    return `${sign}${hours + 1}h00`;
  }
  return `${sign}${hours}h${String(minutes).padStart(2, '0')}`;
}

/**
 * Formate une valeur monétaire HT (convention CDC : `toFixed(2) + ' € HT'`).
 * Ex : 23.96 → "23.96 € HT". `null` → "—" (prix manquant, RG-005).
 *
 * @param value Montant, ou `null` si indisponible.
 * @returns Chaîne formatée, ou "—".
 */
export function formatEuro(value: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  return `${value.toFixed(2)} € HT`;
}
