/**
 * Client Supabase — Stade Maurice David (CDC V1.1)
 *
 * Le client est instancié à partir des variables d'environnement Vite.
 * Le rôle applicatif et l'espace rattaché sont lus depuis les
 * `user_metadata` du compte (renseignés à la création du compte côté Stade).
 */

import { createClient } from '@supabase/supabase-js';
import type { UserRole } from './types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Avertissement explicite plutôt qu'un échec silencieux au runtime.
  console.warn(
    '[supabase] VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY manquant. ' +
      'Copier .env.example vers .env et renseigner les valeurs.',
  );
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

/** Utilisateur applicatif normalisé, dérivé de la session Supabase. */
export interface SupabaseUser {
  id: string;
  role: UserRole;
  /** Espace rattaché (ROLE_RESPONSABLE uniquement). */
  spaceId?: string;
  /** Code d'accès espace (ROLE_RESPONSABLE), ex: "SN2026". */
  spaceCode?: string;
  /** Libellé affiché. */
  name: string;
  /** Email du compte. */
  email: string;
}

/**
 * Lit l'utilisateur courant depuis la session Supabase et normalise ses
 * metadata applicatives (rôle, espace).
 *
 * @returns L'utilisateur normalisé, ou `null` si non connecté.
 */
export const getCurrentUser = async (): Promise<SupabaseUser | null> => {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const user = data.user;
  const meta = user.user_metadata ?? {};

  // Rôle : metadata explicite, sinon déduit de la forme de l'email.
  const role: UserRole =
    (meta.role as UserRole | undefined) ??
    (user.email?.endsWith('@stade.fr') ? 'ROLE_RESPONSABLE' : 'ROLE_STADE');

  return {
    id: user.id,
    role,
    spaceId: (meta.space_id as string | undefined) ?? undefined,
    spaceCode: (meta.space_code as string | undefined) ?? undefined,
    name:
      (meta.name as string | undefined) ??
      (meta.space_code as string | undefined) ??
      user.email ??
      'Utilisateur',
    email: user.email ?? '',
  };
};
