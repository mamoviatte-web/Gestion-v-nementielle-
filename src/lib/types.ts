/**
 * Types TypeScript — Stade Maurice David (CDC V1.1 — Provence Rugby)
 *
 * Source de vérité : CLAUDE.md (noms de tables/colonnes EXACTS).
 * Un type par table (10 tables métier + `users`), enums miroir des
 * contraintes CHECK, types d'état UI et réponses Supabase.
 */

/* ------------------------------------------------------------------ */
/* 1. ENUMS — valeurs CHECK de la base de données                      */
/* ------------------------------------------------------------------ */

/** Rôles applicatifs (lus depuis les metadata du compte Supabase). */
export type UserRole = 'ROLE_STADE' | 'ROLE_RESPONSABLE';

/** Type fonctionnel d'un espace. */
export type SpaceType = 'VIP' | 'Bar' | 'Buvette';

/** Catégories du catalogue produits (libellés au pluriel — CDC). */
export type ProductCategory =
  | 'Vins'
  | 'Bières'
  | 'Soft'
  | 'Sirops'
  | 'Spiritueux'
  | 'Matériel';

/** Type d'événement. */
export type EventType =
  | 'match'
  | 'séminaire'
  | 'cocktail'
  | 'réception_vip'
  | 'événement_partenaire'
  | 'réunion'
  | 'autre';

/** Cycle de vie d'un événement. */
export type EventStatus =
  | 'brouillon'
  | 'préparé'
  | 'en_cours'
  | 'clôture_en_attente'
  | 'clôturé'
  | 'archivé';

/** Statut d'une dotation runner. */
export type RunnerStatus =
  | 'à_préparer'
  | 'préparé'
  | 'monté'
  | 'contrôlé'
  | 'annulé';

/** État physique d'un produit (sur une ligne de stock). */
export type ProductState =
  | 'fermé'
  | 'ouvert'
  | 'cassé'
  | 'perdu'
  | 'périmé'
  | 'fût_vide'
  | 'fût_percuté';

/** Type de mouvement de stock (RG-002). */
export type MovementType =
  | 'entrée'
  | 'sortie'
  | 'réassort'
  | 'retour'
  | 'casse'
  | 'perte'
  | 'correction'
  | 'inventaire';

/** Type de prestataire (CDC §7). */
export type ProviderType =
  | 'traiteur'
  | 'sécurité'
  | 'nettoyage'
  | 'technique'
  | 'logistique'
  | 'animation'
  | 'autre';

/** Statut de présence d'un prestataire (RG-008). */
export type ProviderStatus =
  | 'prévu'
  | 'présent'
  | 'en_retard'
  | 'terminé'
  | 'absent'
  | 'annulé';

/** Phase de saisie de stock dans le cycle d'un événement (état UI uniquement). */
export type StockPhase = 'ouverture' | 'reassort' | 'cloture';

/* ------------------------------------------------------------------ */
/* 2. TABLES — un type par table (modèle de données)                   */
/* ------------------------------------------------------------------ */

/** Table `spaces` — les 16 espaces du stade. */
export interface Space {
  space_id: string;
  space_name: string;
  space_type: SpaceType;
  /** Code d'accès unique servant d'identifiant Responsable (ex: "SN2026"). */
  access_code: string;
  capacity: number | null;
  active: boolean;
  created_at: string;
  /** Capacité maximale de service (pax) — renseignée pour VIP/Bars. */
  max_pax?: number | null;
  /** Dimension de service pilotant les dotations : vip / bar / buvette. */
  service_type?: ServiceType | null;
}

/** Mode de service d'un espace (dotations match Grand Public / VIP). */
export type ServiceType = 'vip' | 'bar' | 'buvette';

/** Mode de service d'un espace sur un match donné (event_spaces). */
export type ServiceMode = 'vip' | 'bar' | 'buvette' | 'fermé' | 'auto';

/** Table `users` — registre applicatif des comptes. */
export interface User {
  user_id: string;
  name: string;
  email: string | null;
  role: UserRole;
  space_id: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
}

/** Table `products` — catalogue produits (enrichi CDC V2 §6). */
export interface Product {
  product_id: string;
  product_name: string;
  category: ProductCategory;
  /** Unité de comptage (ex: "btl", "fût", "u"). */
  unit: string;
  packaging: string | null;
  /** Prix unitaire HT. NULL = prix manquant (RG-003 / RG-005). */
  unit_price_ht: number | null;
  stock_min: number;
  active: boolean;
  // ── Enrichissements CDC V2 (stock_v2.sql) ──
  min_stock?: number | null;
  max_stock?: number | null;
  qr_code?: string | null;
  is_sensitive?: boolean | null;
  fournisseur?: string | null;
  packaging_qty?: number | null;
  packaging_unit?: string | null;
  photo_url?: string | null;
}

/** Variante de `products` sans le prix HT (RG-003, contexte Responsable). */
export type ProductPublic = Omit<Product, 'unit_price_ht'>;

/** Table `events` — événements. */
export interface Event {
  event_id: string;
  event_name: string;
  event_type: EventType | null;
  /** Date de l'événement (YYYY-MM-DD). */
  event_date: string;
  /** Heure de début (HH:MM[:SS]). */
  start_time: string | null;
  /** Heure de fin (HH:MM[:SS]). */
  end_time: string | null;
  expected_attendees: number | null;
  status: EventStatus;
  created_at: string;
  /** Notes internes admin (équipe stade). */
  notes?: string | null;
  // Module Runner (colonnes ajoutées par runner_module.sql)
  weather_type?: WeatherType | null;
  temperature?: number | null;
  consumption_trend?: ConsumptionTrend | null;
  reference_event_id?: string | null;
  // Chaînage des matchs (runner_/match_chaining.sql)
  previous_event_id?: string | null;
  sequence_number?: number | null;
  // Accès match par code unique (match_access.sql)
  match_access_code?: string | null;
  rh_access_code?: string | null;
  match_access_url?: string | null;
  // Régisseur assigné (colonnes régie)
  regisseur_name?: string | null;
  regisseur_space_id?: string | null;
}

/** Ligne de la vue stock_continuity_check (écart stock entre 2 matchs). */
export interface StockContinuityRow {
  event_id: string;
  space_id: string;
  space_name: string;
  product_id: string;
  product_name: string;
  current_initial_qty: number;
  previous_final_qty: number | null;
  stock_gap: number;
  continuity_status:
    | 'coherent'
    | 'aucune_donnee_precedente'
    | 'ecart_positif_a_justifier'
    | 'ecart_negatif_a_justifier';
}

/** Table `event_spaces` — espaces activés pour un événement. */
export interface EventSpace {
  id: string;
  event_id: string;
  space_id: string;
  /** Nom du responsable pré-rempli (le nom effectif est saisi via RG-001). */
  responsible_default_name: string | null;
  /** Mode de service pour ce match (VIP / bar / buvette / fermé / auto). */
  service_mode?: ServiceMode | null;
  /** Pax attendus dans cet espace pour ce match (VIP : peut être < max_pax). */
  expected_pax?: number | null;
  // ── Module séminaire : code d'accès par espace (accès sans compte) ──
  access_token?: string | null;
  token_expires_at?: string | null;
  space_responsible_name?: string | null;
  space_responsible_phone?: string | null;
  space_actual_arrival?: string | null;
  space_actual_departure?: string | null;
  feuille_route_url?: string | null;
  feuille_route_name?: string | null;
}

/** Table `runner_dotations` — fiches runner digitalisées (CDC §8). */
export interface RunnerDotation {
  dotation_id: string;
  event_id: string;
  space_id: string;
  product_id: string;
  planned_qty: number;
  office_qty: number;
  cartons_to_move: number;
  runner_status: RunnerStatus;
  runner_comment: string | null;
  updated_at: string;
}

/** Table `event_stock_lines` — état stock par espace/produit/événement (CDC §9). */
export interface EventStockLine {
  line_id: string;
  event_id: string;
  space_id: string;
  product_id: string;
  initial_qty: number;
  reassort_qty: number;
  /** Stock final (clôture), NULL tant que non saisi. */
  final_qty: number | null;
  product_state: ProductState | null;
  /** Commentaire obligatoire si consommation < 0 (RG-004). */
  anomaly_comment: string | null;
  /** Traçabilité nominative obligatoire (RG-001). */
  responsable_nom: string;
  submitted_at: string | null;
}

/** Table `stock_movements` — historique complet (RG-002 + CDC V2 §7). */
export interface StockMovement {
  movement_id: string;
  event_id: string;
  space_id: string;
  product_id: string;
  movement_type: MovementType;
  qty: number;
  responsable_nom: string;
  created_at: string;
  // ── Enrichissements CDC V2 : mouvements localisés ──
  from_location_id?: string | null;
  to_location_id?: string | null;
  unit_price_ht?: number | null;
  is_anomaly?: boolean | null;
}

/** Table `provider_presence` — présence des prestataires (CDC §7 / RG-008). */
export interface ProviderPresence {
  provider_presence_id: string;
  event_id: string;
  /** NULL = prestataire pour tout le stade. */
  space_id: string | null;
  provider_company: string;
  provider_type: ProviderType;
  provider_contact_name: string | null;
  provider_phone: string | null;
  planned_arrival_time: string | null;
  actual_arrival_time: string | null;
  planned_start_time: string | null;
  actual_start_time: string | null;
  planned_end_time: string | null;
  actual_end_time: string | null;
  actual_departure_time: string | null;
  status: ProviderStatus;
  responsable_nom: string | null;
  comment: string | null;
}

/** Table `schedules` — horaires staff par espace. */
export interface Schedule {
  schedule_id: string;
  event_id: string;
  space_id: string;
  staff_name: string;
  role: string | null;
  planned_arrival: string | null;
  planned_departure: string | null;
  actual_departure: string | null;
  confirmed_by_staff: boolean;
  confirmed_by_manager: boolean;
}

/** Table `debriefs` — formulaire post-événement (7 sections). */
export interface Debrief {
  debrief_id: string;
  event_id: string;
  space_id: string;
  responsable: string;
  // 1.1 Effectif
  nb_personnes: number | null;
  effectif_adapte: string | null;
  effectif_comment: string | null;
  efficacite: string | null;
  efficacite_comment: string | null;
  suggestion_effectif: string | null;
  // 1.2 Organisation
  amenagement: string | null;
  amenagement_comment: string | null;
  problemes_espace: string | null;
  // 1.3 Stocks
  stocks_suffisants: string | null;
  stocks_comment: string | null;
  suggestions_stocks: string | null;
  besoins_materiel: string | null;
  // 2.1 Communication interne
  consignes_claires: string | null;
  consignes_comment: string | null;
  problemes_coordination: string | null;
  // 2.2 Communication clients
  retours_clients: string | null;
  retours_clients_detail: string | null;
  // 3. Propreté
  espace_etat_bon: string | null;
  espace_etat_comment: string | null;
  problemes_dechets: string | null;
  suggestions_proprete: string | null;
  // 5. Suggestions
  suggestions_generales: string | null;
  besoins_specifiques: string | null;
  signature: boolean;
  submitted_at: string | null;
  created_at: string;
  /** Indique qu'un rapport photo est joint (module pièces jointes). */
  has_photo_report?: boolean;
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
  /** Consommation calculée (CDC §9) — peut être négative (anomalie RG-004). */
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

/* ------------------------------------------------------------------ */
/* 5. MODULE RUNNER AUTO-PLANNING (ROLE_STADE)                         */
/* ------------------------------------------------------------------ */

export type WeatherType =
  | 'normal'
  | 'chaleur'
  | 'forte_chaleur'
  | 'pluie'
  | 'froid'
  | 'tres_favorable';

export type ConsumptionTrend =
  | 'stable'
  | 'hausse'
  | 'forte_hausse'
  | 'baisse'
  | 'surdotation'
  | 'rupture';

export type RunnerValidationStatus =
  | 'brouillon'
  | 'en_attente_validation'
  | 'validé'
  | 'transmis_runners'
  | 'préparé'
  | 'livré'
  | 'retour_saisi'
  | 'clôturé';

export type AlertType = 'rupture' | 'surdotation' | 'suffisant' | null;

export interface RunnerAutoPlan {
  id: string;
  event_id: string;
  space_id: string;
  product_id: string;
  initial_area_stock: number;
  historical_avg_consumption: number | null;
  last_similar_event_consumption: number | null;
  consumption_reference: number | null;
  attendance_coefficient: number;
  weather_coefficient: number;
  event_type_coefficient: number;
  trend_coefficient: number;
  recommended_quantity: number | null;
  quantity_to_move: number | null;
  stock_sufficient: boolean;
  validated_quantity: number | null;
  stadium_manager_comment: string | null;
  validated_by: string | null;
  validated_at: string | null;
  picked_quantity: number | null;
  returned_quantity: number | null;
  real_consumption: number | null;
  estimated_cost_ht: number | null;
  responsible_name: string | null;
  validation_status: RunnerValidationStatus;
  alert_type: AlertType;
  terrain_token: string | null;
  // Jointures
  product?: Product;
  space?: Space;
}

export interface RunnerPlanWithDetails extends RunnerAutoPlan {
  product: Product;
  space: Space;
}

/** Paramètres de génération des fiches runner. */
export interface RunnerGenerationParams {
  event_id: string;
  space_ids: string[];
  weather_type: WeatherType;
  temperature: number;
  consumption_trend: ConsumptionTrend;
  reference_event_id?: string;
}

/** Coefficients appliqués à la consommation de référence. */
export interface RunnerCoefficients {
  attendance: number;
  weather: number;
  event_type: number;
  trend: number;
  total: number;
}

export interface AreaStock {
  id: string;
  area_id: string;
  product_id: string;
  current_qty: number;
  initial_qty: number;
  last_updated: string;
  product?: Product;
  space?: Space;
}

export interface EventConsumption {
  id: string;
  event_id: string;
  space_id: string;
  product_id: string;
  initial_stock: number;
  restock_qty: number;
  final_stock: number;
  consumed_qty: number;
  unit_price_ht: number | null;
  total_cost_ht: number | null;
  event_type: string;
  expected_attendance: number;
  weather_type: string;
}

/** Vue terrain publique (sans coût) lue par jeton. */
export interface RunnerTerrainRow {
  id: string;
  event_id: string;
  space_id: string;
  product_id: string;
  terrain_token: string;
  product_name: string;
  unit: string;
  quantity_to_move: number | null;
  validated_quantity: number | null;
  picked_quantity: number | null;
  returned_quantity: number | null;
  validation_status: RunnerValidationStatus;
  responsible_name: string | null;
}

/* ------------------------------------------------------------------ */
/* 6. PIÈCES JOINTES ÉVÉNEMENTS (feuilles de route, photos débrief)    */
/* ------------------------------------------------------------------ */

export type AttachmentType =
  | 'feuille_route_seminaire'
  | 'rapport_photo_debrief'
  | 'autre';

export interface EventAttachment {
  id: string;
  event_id: string;
  space_id: string | null;
  attachment_type: AttachmentType;
  file_name: string;
  /** Chemin de l'objet dans le bucket Storage `event-files`. */
  file_url: string;
  file_size_kb: number | null;
  mime_type: string | null;
  uploaded_by: string;
  uploaded_at: string;
  comment: string | null;
}

/* ------------------------------------------------------------------ */
/* 7. MODULE STOCK CDC V2 — emplacements, soldes, inventaires          */
/* ------------------------------------------------------------------ */

/** Type d'emplacement hiérarchique (CDC §12). */
export type LocationType =
  | 'reserve_centrale'
  | 'espace'
  | 'frigo'
  | 'bac'
  | 'palette'
  | 'zone_temporaire_evenement';

/** 7 types de mouvements localisés (CDC §7). Distinct de `MovementType` (RG-002). */
export type StockMovementTypeV2 =
  | 'entrée_fournisseur'
  | 'transfert_espace'
  | 'réassort_événement'
  | 'retour_réutilisable'
  | 'consommation'
  | 'perte_casse'
  | 'correction';

/** Table `stock_locations` — emplacements hiérarchiques. */
export interface StockLocation {
  id: string;
  name: string;
  location_type: LocationType;
  parent_location_id: string | null;
  /** Espace stade lié (si location_type = 'espace' / 'frigo' / 'bac'). */
  area_id: string | null;
  is_active: boolean;
  description: string | null;
  created_at: string;
}

/** Table `stock_balances` — solde courant par produit × emplacement. */
export interface StockBalance {
  id: string;
  product_id: string;
  location_id: string;
  current_quantity: number;
  reusable_quantity: number;
  opened_quantity: number;
  unit_value_ht: number | null;
  last_movement_at: string;
  updated_by: string | null;
}

/** Balance enrichie (jointures produit + emplacement) pour l'UI. */
export interface StockBalanceView extends StockBalance {
  product?: Product;
  location?: StockLocation;
}

/** Table `inventory_counts` — comptages physiques périodiques. */
export interface InventoryCount {
  id: string;
  location_id: string;
  product_id: string;
  theoretical_qty: number | null;
  real_qty: number | null;
  /** Colonne générée : real_qty - theoretical_qty. */
  variance: number | null;
  responsible_name: string;
  comment: string | null;
  counted_at: string;
  validated_by: string | null;
  validated_at: string | null;
  inventory_session_id: string | null;
}

/** Mouvement de stock enrichi (jointures) pour le journal. */
export interface StockMovementView extends StockMovement {
  product?: Product;
  from_location?: StockLocation | null;
  to_location?: StockLocation | null;
  event?: Pick<Event, 'event_id' | 'event_name'> | null;
}

/** Sévérité d'une alerte dashboard (CDC §10). */
export type AlertSeverity = 'error' | 'warning' | 'info';

/** Alerte de stock calculée (8 types — CDC §10). */
export interface StockAlert {
  type:
    | 'critique'
    | 'surdotation'
    | 'rupture'
    | 'perte_casse'
    | 'dormant'
    | 'ecart_inventaire'
    | 'hausse_consommation'
    | 'meteo_chaude';
  severity: AlertSeverity;
  message: string;
  action?: string;
}

/* ------------------------------------------------------------------ */
/* 8. MOTEUR D'ANALYSE ET D'APPRENTISSAGE (CDC Analytics)              */
/* ------------------------------------------------------------------ */

export type TrendDirection = 'forte_hausse' | 'hausse' | 'stable' | 'baisse' | 'forte_baisse';

/** Table `consumption_analytics` — mémoire intelligente (ratios calculés). */
export interface ConsumptionAnalytics {
  id: string;
  space_id: string;
  product_id: string;
  event_type: string;
  avg_qty_per_100_pax: number | null;
  avg_qty_per_event: number | null;
  median_consumption: number | null;
  std_deviation: number | null;
  coef_chaleur_observed: number | null;
  coef_pluie_observed: number | null;
  coef_froid_observed: number | null;
  coef_forte_affluence_observed: number | null;
  coef_faible_affluence_observed: number | null;
  trend_direction: TrendDirection | null;
  trend_pct_change: number | null;
  rupture_count: number;
  surdotation_count: number;
  return_rate_avg: number | null;
  loss_rate_avg: number | null;
  nb_events_analyzed: number;
  last_event_id: string | null;
  last_updated: string;
  confidence_score: number | null;
  // Jointures optionnelles pour l'UI
  product?: Product;
  space?: Space;
}

/** Table `event_context_log` — contexte réel d'un événement après clôture. */
export interface EventContextLog {
  id: string;
  event_id: string;
  event_type: string;
  expected_attendance: number | null;
  planned_weather: string | null;
  planned_temperature: number | null;
  real_attendance: number | null;
  real_weather: string | null;
  real_temperature: number | null;
  event_start_time: string | null;
  event_duration_hours: number | null;
  total_consumed_value_ht: number | null;
  avg_spend_per_pax: number | null;
  total_ruptures: number;
  total_surdotations: number;
  total_losses: number;
  global_return_rate: number | null;
  data_quality_score: number | null;
  is_anomaly: boolean;
  anomaly_reason: string | null;
  closed_at: string | null;
  closed_by: string | null;
}

/** Table `runner_recommendations` — recommandation tracée pour un événement. */
export interface RunnerRecommendation {
  id: string;
  event_id: string;
  space_id: string;
  product_id: string;
  analytics_nb_events: number | null;
  base_quantity: number | null;
  base_per_100_pax: number | null;
  coef_attendance: number | null;
  coef_weather: number | null;
  coef_event_type: number | null;
  coef_trend: number | null;
  coef_historical: number | null;
  total_coefficient: number | null;
  raw_recommended_qty: number | null;
  recommended_qty: number | null;
  area_initial_stock: number | null;
  qty_to_move: number | null;
  alert_type: string | null;
  alert_message: string | null;
  confidence_score: number | null;
  validated_qty: number | null;
  validation_delta_pct: number | null;
  generated_at: string;
}

/* ------------------------------------------------------------------ */
/* 9. MODULE ANALYSE RH — STAFF & HORAIRES                             */
/* ------------------------------------------------------------------ */

export interface StaffAnalytics {
  id: string;
  space_id: string | null;
  role_name: string;
  event_type: string;
  avg_planned_hours: number | null;
  avg_actual_hours: number | null;
  avg_overtime_hours: number | null;
  avg_agents_per_event: number | null;
  avg_agents_per_100pax: number | null;
  overtime_rate: number | null;
  overstaffing_rate: number | null;
  understaffing_rate: number | null;
  avg_hours_delta: number | null;
  nb_events_analyzed: number;
  confidence_score: number | null;
  space?: Space;
}

export type StaffIssue =
  | 'heures_sup_importantes'
  | 'depart_premature'
  | 'depart_non_saisi'
  | 'surstaffing_espace';

export interface StaffAlert {
  space: string;
  role: string;
  issue: StaffIssue;
  severity: 'info' | 'warning' | 'critical';
  detail: string;
}

export interface StaffEventSummary {
  id: string;
  event_id: string;
  event_type: string;
  real_attendance: number | null;
  total_agents: number;
  total_planned_hours: number;
  total_actual_hours: number;
  total_overtime_hours: number;
  total_overtime_agents: number;
  agents_per_100pax: number | null;
  hours_per_agent: number | null;
  efficiency_score: number | null;
  has_overstaffing: boolean;
  has_understaffing: boolean;
  has_significant_overtime: boolean;
  alert_details: StaffAlert[] | null;
  computed_at: string;
  event?: Pick<Event, 'event_id' | 'event_name' | 'event_date' | 'event_type'>;
}

/** Ligne de détail horaire (retour de la RPC compute_staff_hours). */
export interface StaffHoursDetail {
  schedule_id: string;
  staff_name: string;
  role_name: string;
  space_name: string;
  planned_hours: number | null;
  actual_hours: number | null;
  delta_hours: number | null;
  overtime_hours: number | null;
  is_overstaffed: boolean;
  alert_type: string | null;
}

/** Ligne schedules enrichie (jointures) pour les vues d'agrégation RH. */
export interface ScheduleRow extends Schedule {
  computed_hours?: number | null;
  mission_type?: string | null;
  is_external?: boolean | null;
  contract_type?: string | null;
  spaces?: Pick<Space, 'space_id' | 'space_name' | 'space_type'> | null;
  events?: Pick<Event, 'event_id' | 'event_name' | 'event_date' | 'event_type' | 'expected_attendees' | 'status'> | null;
}

/** Brouillon de création d'événement (parcours guidé 3 étapes). */
export interface EventCreationDraft {
  event_name: string;
  event_type: EventType;
  event_date: string;
  start_time: string;
  expected_attendees: number;
  /** Espaces sélectionnés (ignoré si match = tous les espaces). */
  selected_space_ids: string[];
  /** Pax attendus par espace (matchs VIP/Bar) — clé = space_id. */
  space_pax?: Record<string, number>;
  /** Match de simulation : exclu des calculs de coefficients (match uniquement). */
  is_simulation?: boolean;
}
