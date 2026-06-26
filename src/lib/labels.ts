/**
 * Libellés (français) et tonalités de couleur pour les enums du domaine.
 * Centralisé ici pour cohérence entre badges, tableaux et formulaires.
 */

import type {
  EventStatus,
  ProductState,
  ProviderStatus,
  RunnerStatus,
  StatusTone,
} from './types';

export interface EnumMeta {
  label: string;
  tone: StatusTone;
}

/** Statut de dotation runner. */
export const RUNNER_STATUS_META: Record<RunnerStatus, EnumMeta> = {
  à_préparer: { label: 'À préparer', tone: 'neutral' },
  préparé: { label: 'Préparé', tone: 'info' },
  monté: { label: 'Monté', tone: 'warning' },
  contrôlé: { label: 'Contrôlé', tone: 'success' },
  annulé: { label: 'Annulé', tone: 'danger' },
};

/** Ordre du cycle de vie runner (pour « avancer au statut suivant »). */
export const RUNNER_STATUS_FLOW: RunnerStatus[] = [
  'à_préparer',
  'préparé',
  'monté',
  'contrôlé',
];

/** Statut d'un événement. */
export const EVENT_STATUS_META: Record<EventStatus, EnumMeta> = {
  brouillon: { label: 'Brouillon', tone: 'neutral' },
  préparé: { label: 'Préparé', tone: 'info' },
  en_cours: { label: 'En cours', tone: 'warning' },
  clôture_en_attente: { label: 'Clôture en attente', tone: 'warning' },
  clôturé: { label: 'Clôturé', tone: 'success' },
  archivé: { label: 'Archivé', tone: 'neutral' },
};

/** Statut de présence prestataire. */
export const PROVIDER_STATUS_META: Record<ProviderStatus, EnumMeta> = {
  prévu: { label: 'Prévu', tone: 'neutral' },
  présent: { label: 'Présent', tone: 'success' },
  en_retard: { label: 'En retard', tone: 'danger' },
  terminé: { label: 'Terminé', tone: 'info' },
  absent: { label: 'Absent', tone: 'danger' },
  annulé: { label: 'Annulé', tone: 'neutral' },
};

/** État physique d'un produit (clôture). */
export const PRODUCT_STATE_META: Record<ProductState, EnumMeta> = {
  fermé: { label: 'Fermé', tone: 'neutral' },
  ouvert: { label: 'Ouvert', tone: 'info' },
  cassé: { label: 'Cassé', tone: 'danger' },
  perdu: { label: 'Perdu', tone: 'danger' },
  périmé: { label: 'Périmé', tone: 'danger' },
  fût_vide: { label: 'Fût vide', tone: 'warning' },
  fût_percuté: { label: 'Fût percuté', tone: 'warning' },
};

/** Liste d'options <Select> pour l'état produit. */
export const PRODUCT_STATE_OPTIONS = (
  Object.keys(PRODUCT_STATE_META) as ProductState[]
).map((value) => ({ value, label: PRODUCT_STATE_META[value].label }));
