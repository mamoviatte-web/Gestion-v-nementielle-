/**
 * scheduleCalculations — calcul horaire régisseur centralisé.
 * Gère le passage minuit (départ le lendemain) et le coût RH.
 */

/**
 * Durée en heures entre arrivée et départ (format HH:MM[:SS]).
 * Passage minuit : si départ < arrivée → +24h.
 * @example computeHours('07:00','01:00') → 18   computeHours('06:00','01:00') → 19
 */
export function computeHours(arrival: string | null, departure: string | null): number | null {
  if (!arrival || !departure) return null;
  const [aH, aM] = arrival.split(':').map(Number);
  const [dH, dM] = departure.split(':').map(Number);
  if ([aH, aM, dH, dM].some((n) => Number.isNaN(n))) return null;
  const arrivalMin = aH * 60 + aM;
  const departureMin = dH * 60 + dM;
  let diff = departureMin - arrivalMin;
  if (diff < 0) diff += 24 * 60; // départ le lendemain
  return diff / 60;
}

/** Heures supplémentaires = max(0, réelles − prévues). */
export function computeOvertimeHours(plannedHours: number | null, actualHours: number | null): number {
  if (plannedHours === null || actualHours === null) return 0;
  return Math.max(0, actualHours - plannedHours);
}

/** Coût RH = heures réelles × taux horaire. */
export function computeRHCost(actualHours: number | null, hourlyRate: number | null | undefined): number | null {
  if (actualHours === null || hourlyRate === null || hourlyRate === undefined) return null;
  return actualHours * hourlyRate;
}

/** Formate 18.5 → « 18h30 », 19 → « 19h ». */
export function formatHours(hours: number | null): string {
  if (hours === null) return '—';
  const h = Math.floor(Math.abs(hours));
  const m = Math.round((Math.abs(hours) - h) * 60);
  const sign = hours < 0 ? '-' : '';
  return `${sign}${h}h${m > 0 ? m.toString().padStart(2, '0') : ''}`;
}

/** Formate un écart : « +1h30 », « -0h30 », « Exact ». */
export function formatDelta(delta: number | null): string {
  if (delta === null) return '—';
  if (delta === 0) return 'Exact';
  const prefix = delta > 0 ? '+' : '';
  return `${prefix}${formatHours(delta)}`;
}

/** Vrai si la valeur ressemble à un code d'accès zone (6 caractères A-Z0-9). */
export function isAccessCode(value: string | null | undefined): boolean {
  return !!value && /^[A-Z0-9]{6}$/.test(value.trim());
}

/**
 * Nom d'affichage du régisseur : priorité au nom admin (staff_name),
 * puis nom saisi à la création, puis nom terrain — en écartant les codes d'accès.
 */
export function getResponsableName(
  staffName: string | null | undefined,
  regisseurName?: string | null,
  responsableNom?: string | null,
): string {
  const candidates = [staffName, regisseurName, responsableNom];
  for (const c of candidates) {
    if (c && c.trim() && !isAccessCode(c)) return c.trim();
  }
  return 'Nom non renseigné';
}
