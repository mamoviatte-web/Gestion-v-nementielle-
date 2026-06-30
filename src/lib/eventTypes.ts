/** Métadonnées des types d'événement (libellés + icônes lucide). */

import {
  Trophy,
  Presentation,
  GlassWater,
  Star,
  Handshake,
  Users,
  Calendar,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import type { EventType } from './types';

export interface EventTypeMeta {
  label: string;
  Icon: LucideIcon;
  /** Mis en avant (cards plus grandes) à l'étape 1 du wizard. */
  featured: boolean;
}

export const EVENT_TYPE_META: Record<EventType, EventTypeMeta> = {
  match: { label: 'Match', Icon: Trophy, featured: true },
  séminaire: { label: 'Séminaire', Icon: Presentation, featured: true },
  cocktail: { label: 'Cocktail', Icon: GlassWater, featured: false },
  réception_vip: { label: 'Réception VIP', Icon: Star, featured: false },
  événement_partenaire: { label: 'Événement partenaire', Icon: Handshake, featured: false },
  réunion: { label: 'Réunion', Icon: Users, featured: false },
  autre: { label: 'Autre', Icon: Calendar, featured: false },
};

/** Icône lucide par type d'événement (raccourci direct). */
export const EVENT_TYPE_ICONS: Record<EventType, LucideIcon> = {
  match: Trophy,
  séminaire: Presentation,
  réunion: Users,
  cocktail: GlassWater,
  réception_vip: Star,
  événement_partenaire: Handshake,
  autre: Calendar,
};

export const EVENT_TYPES: EventType[] = [
  'match',
  'séminaire',
  'cocktail',
  'réception_vip',
  'événement_partenaire',
  'réunion',
  'autre',
];

/**
 * Regroupement en 3 onglets pour la liste des événements (lisibilité à
 * l'échelle réelle : ~15 matchs/saison vs ~250 événements hors match).
 */
export const EVENT_TYPE_GROUPS = {
  matchs: ['match'],
  seminaires: ['séminaire', 'réunion'],
  autres: ['cocktail', 'réception_vip', 'événement_partenaire', 'autre'],
} as const;

export type EventTabKey = keyof typeof EVENT_TYPE_GROUPS;

export const EVENT_TAB_META: { key: EventTabKey; label: string; Icon: LucideIcon }[] = [
  { key: 'matchs', label: 'Matchs', Icon: Trophy },
  { key: 'seminaires', label: 'Séminaires & réunions', Icon: Presentation },
  { key: 'autres', label: 'Autres événements', Icon: Sparkles },
];

/** Onglet auquel appartient un type d'événement (null par défaut → « autres »). */
export function tabForEventType(type: EventType | null): EventTabKey {
  if (!type) return 'autres';
  for (const key of Object.keys(EVENT_TYPE_GROUPS) as EventTabKey[]) {
    if ((EVENT_TYPE_GROUPS[key] as readonly EventType[]).includes(type)) return key;
  }
  return 'autres';
}
