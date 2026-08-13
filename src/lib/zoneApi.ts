/**
 * API zone responsable — accès par code (token), sans compte Supabase.
 * Toutes les écritures passent par des RPC SECURITY DEFINER côté base ;
 * les fichiers (feuille de route, photos) vont dans le bucket public `zone-files`.
 */

import { supabase } from '@/lib/supabase';

export interface ZoneInfo {
  valid: boolean;
  event_id?: string;
  event_name?: string;
  event_date?: string;
  event_type?: string;
  start_time?: string | null;
  space_id?: string;
  space_name?: string;
  feuille_route_url?: string | null;
  feuille_route_name?: string | null;
  responsible_name?: string | null;
}

export interface ZoneProduct {
  product_id: string;
  product_name: string;
  unit: string;
  category: string;
}

export interface ZoneStockLine {
  product_id: string;
  initial_qty: number | null;
  reassort_qty: number | null;
  final_qty: number | null;
  product_state: string | null;
}

export interface ZoneDebrief {
  efficacite: string | null;
  stocks_suffisants: string | null;
  besoins_materiel: string | null;
  suggestions_generales: string | null;
  photo_urls: string[] | null;
  submitted_at: string | null;
  // Débrief enrichi (scores ménage / technique / signalement)
  overall_rating: string | null;
  service_score: number | null;
  cleaning_score: number | null;
  cleaning_before_ok: boolean | null;
  cleaning_after_ok: boolean | null;
  cleaning_issues: string[] | null;
  cleaning_comment: string | null;
  technical_score: number | null;
  tech_fridge_ok: boolean | null;
  tech_equipment_ok: boolean | null;
  tech_lighting_ok: boolean | null;
  tech_plumbing_ok: boolean | null;
  tech_hvac_ok: boolean | null;
  tech_issues: string[] | null;
  technical_comment: string | null;
  has_urgent_issue: boolean | null;
  urgent_issue_detail: string | null;
}

export interface ZoneStatus {
  initial: boolean;
  final: boolean;
  schedule: boolean;
  debrief: boolean;
}

export interface ZoneState {
  valid: boolean;
  products: ZoneProduct[];
  stock_lines: ZoneStockLine[];
  arrival: string | null;
  departure: string | null;
  staff_name: string | null;
  planned_start: string | null;
  debrief: ZoneDebrief | null;
  status: ZoneStatus;
}

/** Charge utile du débrief enrichi (envoyée en JSONB à la RPC). */
export interface DebriefPayload {
  overall_rating?: string | null;
  service_score?: number | null;
  cleaning_score?: number | null;
  cleaning_before_ok?: boolean | null;
  cleaning_after_ok?: boolean | null;
  cleaning_issues?: string[];
  cleaning_comment?: string | null;
  technical_score?: number | null;
  tech_fridge_ok?: boolean | null;
  tech_equipment_ok?: boolean | null;
  tech_lighting_ok?: boolean | null;
  tech_plumbing_ok?: boolean | null;
  tech_hvac_ok?: boolean | null;
  tech_issues?: string[];
  technical_comment?: string | null;
  has_urgent_issue?: boolean;
  urgent_issue_detail?: string | null;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export function validateZoneToken(token: string): Promise<ZoneInfo> {
  return rpc<ZoneInfo>('validate_zone_token', { p_token: token });
}

export function getZoneState(token: string): Promise<ZoneState> {
  return rpc<ZoneState>('get_zone_state', { p_token: token });
}

export async function startZoneSession(token: string, name: string): Promise<void> {
  const r = await rpc<{ success: boolean; error?: string }>('start_zone_session', {
    p_token: token,
    p_name: name,
  });
  if (!r.success) throw new Error(r.error ?? 'Erreur de session.');
}

export interface InitialLineInput {
  product_id: string;
  qty: number;
  state?: string | null;
}

export async function submitInitialStock(
  token: string,
  name: string,
  lines: InitialLineInput[],
): Promise<void> {
  const r = await rpc<{ success: boolean; error?: string }>('submit_zone_initial_stock', {
    p_token: token,
    p_responsible_name: name,
    p_stock_lines: lines,
  });
  if (!r.success) throw new Error(r.error ?? 'Erreur lors de la saisie du stock initial.');
}

/**
 * Correction du stock INITIAL déjà validé, sans réinitialiser la suite du
 * process : edit_zone_initial_stock upsert les quantités/états initiaux et
 * préserve reassort_qty / final_qty. Renvoie les lignes à jour pour un
 * rafraîchissement ciblé de la seule section stock. Refuse si l'événement est
 * clôturé/archivé (event_closed).
 */
export async function editInitialStock(
  token: string,
  name: string,
  lines: InitialLineInput[],
): Promise<{ stock_lines: ZoneStockLine[]; lignes_maj: number }> {
  const r = await rpc<{ success: boolean; error?: string; stock_lines?: ZoneStockLine[]; lignes_maj?: number }>(
    'edit_zone_initial_stock',
    { p_token: token, p_responsible_name: name, p_stock_lines: lines },
  );
  if (!r.success) {
    throw new Error(
      r.error === 'event_closed'
        ? 'Événement clôturé — modification impossible.'
        : r.error === 'token_invalid'
          ? 'Session invalide — reconnectez-vous.'
          : (r.error ?? 'Modification refusée.'),
    );
  }
  return { stock_lines: r.stock_lines ?? [], lignes_maj: r.lignes_maj ?? 0 };
}

export interface FinalLineInput {
  product_id: string;
  final_qty: number;
  state?: string | null;
  anomaly?: string | null;
}

export async function submitFinalStock(
  token: string,
  name: string,
  lines: FinalLineInput[],
): Promise<void> {
  const r = await rpc<{ success: boolean; error?: string }>('submit_zone_final_stock', {
    p_token: token,
    p_responsible_name: name,
    p_stock_lines: lines,
  });
  if (!r.success) throw new Error(r.error ?? 'Erreur lors de la saisie du stock final.');
}

export async function submitSchedule(
  token: string,
  name: string,
  arrival: string | null,
  departure: string | null,
  staffName?: string | null,
): Promise<void> {
  const r = await rpc<{ success: boolean; error?: string }>('submit_zone_schedule', {
    p_token: token,
    p_responsible_name: name,
    p_arrival: arrival,
    p_departure: departure,
    p_staff_name: staffName ?? null,
  });
  if (!r.success) throw new Error(r.error ?? 'Erreur lors de la saisie des horaires.');
}

export async function submitDebrief(
  token: string,
  name: string,
  rating: string,
  stocksOk: string,
  notes: string,
  photoUrls: string[],
  payload: DebriefPayload = {},
): Promise<void> {
  const r = await rpc<{ success: boolean; error?: string }>('submit_zone_debrief', {
    p_token: token,
    p_responsible_name: name,
    p_rating: rating,
    p_stocks_ok: stocksOk,
    p_notes: notes,
    p_photo_urls: photoUrls,
    p_payload: payload,
  });
  if (!r.success) throw new Error(r.error ?? 'Erreur lors de la soumission du débrief.');
}

/** Upload d'une photo de débrief (zone publique). Renvoie l'URL publique. */
export async function uploadZonePhoto(token: string, file: File): Promise<string> {
  const ext = file.name.split('.').pop() ?? 'jpg';
  const path = `debrief/${token}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('zone-files').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;
  return supabase.storage.from('zone-files').getPublicUrl(path).data.publicUrl;
}

/** Upload d'une feuille de route (admin). Renvoie l'URL publique. */
export async function uploadFeuilleRoute(
  eventId: string,
  spaceId: string,
  file: File,
): Promise<string> {
  const ext = file.name.split('.').pop() ?? 'pdf';
  const path = `feuille/${eventId}/${spaceId}-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('zone-files').upload(path, file, {
    cacheControl: '3600',
    upsert: true,
  });
  if (error) throw error;
  return supabase.storage.from('zone-files').getPublicUrl(path).data.publicUrl;
}

/**
 * Régénère un code d'accès zone (admin) : nouveau token + expiration robuste
 * (max de date_événement + 2 j et maintenant + 30 j). Renvoie le nouveau token.
 */
export async function regenerateZoneToken(
  eventId: string,
  spaceId: string,
  eventDate: string,
): Promise<string> {
  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
  const expiry = new Date(
    Math.max(new Date(eventDate).getTime() + 2 * 86_400_000, Date.now() + 30 * 86_400_000),
  ).toISOString();
  const { error } = await supabase
    .from('event_spaces')
    .update({ access_token: token, token_expires_at: expiry })
    .eq('event_id', eventId)
    .eq('space_id', spaceId);
  if (error) throw error;
  return token;
}

/** Enregistre l'URL de la feuille de route sur l'event_space (admin). */
export async function saveFeuilleRoute(
  eventId: string,
  spaceId: string,
  url: string,
  fileName: string,
): Promise<void> {
  const { error } = await supabase
    .from('event_spaces')
    .update({ feuille_route_url: url, feuille_route_name: fileName })
    .eq('event_id', eventId)
    .eq('space_id', spaceId);
  if (error) throw error;
}
