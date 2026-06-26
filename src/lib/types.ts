/**
 * Types TypeScript — Stade Maurice David (CDC V1.1 — Provence Rugby)
 *
 * Ce fichier décrit :
 *  1. Les enums correspondant aux contraintes CHECK de la base PostgreSQL
 *  2. Un type par table (les 10 tables du modèle de données)
 *  3. Les types d'état de l'UI
 *  4. Les types utilitaires de réponse Supabase
 *
 * Convention : noms de propriétés en anglais (snake_case côté DB,
 * conservé tel quel pour coller aux colonnes Supabase).
 */

/* ------------------------------------------------------------------ */
/* 1. ENUMS — valeurs CHECK de la base de données                      */
/* ------------------------------------------------------------------ */

/** Rôles applicatifs (lus depuis les metadata du compte Supabase). */
export type UserRole = 'ROLE_STADE' | 'ROLE_RESPONSABLE';

/** Type fonctionnel d'un espace. */
export type SpaceType = 'VIP' | 'Bar' | 'Buvette';

/** Catégories du catalogue produits. */
export type ProductCategory =
  | 'Vin'
  | 'Bière'
  | 'Soft'
  | 'Sirop'
  | 'Spiritueux'
  | 'Matériel';

/** Cycle de vie d'un événement. */
export type EventStatus =
  | 'brouillon'
  | 'préparé'
  | 'en_cours'
  | 'clôture_en_attente'
  | 'clôturé'
  | 'archivé';

/** Type d'événement. */
export type EventType = 'match' | 'séminaire' | 'privatisation' | 'autre';

/** Statut d'une dotation runner (préparation logistique d'un espace). */
export type RunnerStatus =
  | 'à_préparer'
  | 'préparé'
  | 'monté'
  | 'contrôlé'
  | 'annulé';

/** État physique d'un produit lors d'un mouvement de stock. */
export type ProductState =
  | 'fermé'
  | 'ouvert'
  | 'cassé'
  | 'perdu'
  | 'périmé'
  | 'fût_vide'
  | 'fût_percuté';

/** Statut de présence d'un prestataire (RG-008). */
export type ProviderStatus =
  | 'prévu'
  | 'présent'
  | 'en_retard'
  | 'terminé'
  | 'absent'
  | 'annulé';

/** Phase de saisie de stock dans le cycle d'un événement. */
export type StockPhase = 'ouverture' | 'reassort' | 'cloture';

/* ------------------------------------------------------------------ */
/* 2. TABLES — un type par table (modèle de données)                   */
/* ------------------------------------------------------------------ */

/** Table `spaces` — les 16 espaces du stade. */
export interface Space {
  id: string;
  /** Libellé affiché (ex: "Salon Nord"). */
  name: string;
  /** Code d'accès unique servant d'identifiant Responsable (ex: "SN2026"). */
  code: string;
  type: SpaceType;
  /** Capacité indicative (optionnelle). */
  capacity: number | null;
  created_at: string;
}

/** Table `products` — catalogue produits. */
export interface Product {
  id: string;
  name: string;
  category: ProductCategory;
  /** Unité de comptage (ex: "bouteille", "fût", "verre", "pièce"). */
  unit: string;
  /**
   * Prix unitaire HT. NULL = prix manquant (RG-003 / RG-005).
   * Le matériel n'a pas de prix HT.
   */
  unit_price_ht: number | null;
  /** Conditionnement (ex: "75cl", "30L"), optionnel. */
  packaging: string | null;
  /** Produit actif dans le catalogue. */
  active: boolean;
  created_at: string;
}

/** Table `events` — événements. */
export interface Event {
  id: string;
  name: string;
  type: EventType;
  /** Date de l'événement (YYYY-MM-DD). */
  date: string;
  /** Heure de début (HH:MM). */
  start_time: string;
  /** Affluence attendue. */
  expected_attendees: number | null;
  status: EventStatus;
  created_at: string;
  updated_at: string;
}

/** Table `event_spaces` — espaces ouverts pour un événement. */
export interface EventSpace {
  id: string;
  event_id: string;
  space_id: string;
  /** Nom du responsable saisi à la connexion (RG-001), optionnel. */
  responsable_name: string | null;
  created_at: string;
}

/** Table `runner_dotations` — dotations logistiques préparées par le Stade. */
export interface RunnerDotation {
  id: string;
  event_id: string;
  space_id: string;
  product_id: string;
  /** Quantité dotée. */
  quantity: number;
  status: RunnerStatus;
  created_at: string;
  updated_at: string;
}

/** Table `event_stock_lines` — lignes de stock par espace/produit/événement. */
export interface EventStockLine {
  id: string;
  event_id: string;
  space_id: string;
  product_id: string;
  /** Stock initial (ouverture). */
  initial_qty: number;
  /** Réassort cumulé en cours d'événement. */
  reassort_qty: number;
  /** Stock final (clôture), NULL tant que non saisi. */
  final_qty: number | null;
  /**
   * Prix unitaire HT figé pour cette ligne (snapshot du catalogue).
   * Colonne INTERDITE au ROLE_RESPONSABLE (RG-003).
   */
  unit_price_ht: number | null;
  phase: StockPhase;
  created_at: string;
  updated_at: string;
}

/** Table `stock_movements` — journal des mouvements de stock. */
export interface StockMovement {
  id: string;
  event_id: string;
  space_id: string;
  product_id: string;
  /** Quantité du mouvement (positive). */
  quantity: number;
  /** État physique du produit concerné. */
  state: ProductState;
  phase: StockPhase;
  /** Auteur du mouvement (nom responsable ou compte stade). */
  created_by: string | null;
  created_at: string;
}

/** Table `provider_presence` — présence des prestataires (RG-008). */
export interface ProviderPresence {
  id: string;
  event_id: string;
  assigned_space_id: string;
  /** Nom du prestataire. */
  name: string;
  /** Rôle / fonction (optionnel). */
  role: string | null;
  /** Heure d'arrivée prévue (HH:MM). */
  planned_arrival: string | null;
  /** Heure de départ prévue (HH:MM). */
  planned_departure: string | null;
  /** Heure d'arrivée réelle (HH:MM). */
  actual_arrival: string | null;
  /** Heure de départ réel (HH:MM). */
  actual_departure: string | null;
  status: ProviderStatus;
  created_at: string;
  updated_at: string;
}

/** Table `schedules` — horaires du personnel par espace. */
export interface Schedule {
  id: string;
  event_id: string;
  space_id: string;
  /** Nom de la personne planifiée. */
  staff_name: string;
  role: string | null;
  /** Heure d'arrivée (HH:MM). */
  arrival: string;
  /** Heure de départ (HH:MM). */
  departure: string;
  created_at: string;
  updated_at: string;
}

/** Table `debriefs` — débriefs de fin d'événement par espace. */
export interface Debrief {
  id: string;
  event_id: string;
  space_id: string;
  /** Contenu libre du débrief. */
  content: string;
  /** Note de satisfaction 1–5 (optionnelle). */
  rating: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/* ------------------------------------------------------------------ */
/* 3. TYPES D'ÉTAT DE L'UI                                             */
/* ------------------------------------------------------------------ */

/** Variantes de couleur de statut (Badge). */
export type StatusTone =
  | 'neutral'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger';

/** Onglet actif côté Responsable. */
export type ProviderTab = 'stock' | 'schedule' | 'debrief';

/** Ligne de saisie de stock enrichie (jointure produit) pour l'UI. */
export interface StockLineView extends EventStockLine {
  product: Product;
  /** Consommation calculée (CDC §9). */
  consumed: number;
  /** Coût calculé, null si prix manquant (RG-005). */
  cost: number | null;
}

/* ------------------------------------------------------------------ */
/* 4. TYPES DE RÉPONSE SUPABASE                                        */
/* ------------------------------------------------------------------ */

/** Réponse générique d'une requête Supabase renvoyant une liste. */
export interface SupabaseListResponse<T> {
  data: T[] | null;
  error: SupabaseError | null;
}

/** Réponse générique d'une requête Supabase renvoyant un seul enregistrement. */
export interface SupabaseSingleResponse<T> {
  data: T | null;
  error: SupabaseError | null;
}

/** Forme minimale d'une erreur Supabase / PostgREST. */
export interface SupabaseError {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string;
}
