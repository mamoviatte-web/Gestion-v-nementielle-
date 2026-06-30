/** Métadonnées des types d'événement (libellés + icônes lucide). */

import {
  Trophy,
  Presentation,
  Wine,
  Star,
  Briefcase,
  Users,
  CalendarDays,
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
  cocktail: { label: 'Cocktail', Icon: Wine, featured: false },
  réception_vip: { label: 'Réception VIP', Icon: Star, featured: false },
  événement_partenaire: { label: 'Événement partenaire', Icon: Briefcase, featured: false },
  réunion: { label: 'Réunion', Icon: Users, featured: false },
  autre: { label: 'Autre', Icon: CalendarDays, featured: false },
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
