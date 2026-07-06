/**
 * eventUtils — discrimination match vs séminaire.
 * Le module « Rapport séminaire » ne s'active QUE pour les types séminaire ;
 * il est invisible pour les matchs (qui auront leur propre format).
 */

/** Types d'événements traités comme des séminaires (rapport client). */
export const SEMINAR_EVENT_TYPES = [
  'séminaire',
  'réunion',
  'cocktail',
  'réception_vip',
  'événement_partenaire',
] as const;

export function isSeminaire(eventType: string | null | undefined): boolean {
  return !!eventType && (SEMINAR_EVENT_TYPES as readonly string[]).includes(eventType);
}

export function isMatch(eventType: string | null | undefined): boolean {
  return eventType === 'match';
}
