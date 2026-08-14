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

/**
 * Profil d'espace — miroir client de la fonction SQL space_profile(space_name).
 * Doit rester synchronisé avec supabase/product_space_mapping.sql.
 */
export type SpaceProfile =
  | 'salon' | 'loge' | 'wine_bar' | 'club' | 'bodega'
  | 'bar_pub' | 'pmr' | 'terrasse' | 'buvette';

export function spaceProfile(name: string): SpaceProfile {
  const n = name.trim();
  if (/^Salon/i.test(n)) return 'salon';
  if (/^Loge/i.test(n)) return 'loge';
  if (/^Wine ?bar/i.test(n)) return 'wine_bar';
  if (/^Club/i.test(n)) return 'club';
  if (/^Bodega/i.test(n)) return 'bodega';
  if (/^(Le Pub|Bistrot|Comptoir)/i.test(n)) return 'bar_pub';
  if (/^PMR/i.test(n)) return 'pmr';
  if (/^(Terrasse|Garden|Grandes Tabl|Tente)/i.test(n)) return 'terrasse';
  // Buvettes : anciens codes B1–B9, préfixe « Buvette », ou noms physiques
  // (points cardinaux, éventuellement préfixés « Virage ») — ex. « Nord OUEST »,
  // « EST NORD », « Virage SUD OUEST ». Les Salon/Loge/Wine bar/Club « … Nord »
  // sont déjà captés plus haut, donc pas de faux positif ici.
  if (
    /^B\d+$/.test(n) ||
    /^Buvette/i.test(n) ||
    /^(Virage\s+)?(Nord|Sud|Est|Ouest)(\s+(Nord|Sud|Est|Ouest))?$/i.test(n)
  )
    return 'buvette';
  return 'bar_pub';
}

/** Espaces premium intérieurs : séminaires + suivi dashboard. */
export const PREMIUM_INDOOR_PROFILES: readonly SpaceProfile[] = [
  'salon', 'loge', 'bar_pub', 'wine_bar', 'club',
];

export function isPremiumIndoor(name: string): boolean {
  return PREMIUM_INDOOR_PROFILES.includes(spaceProfile(name));
}
