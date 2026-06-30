/**
 * Utilitaires Supabase Storage — nettoyage des fichiers d'un événement.
 * Le `ON DELETE CASCADE` SQL ne supprime que les métadonnées : les binaires
 * dans le bucket doivent être retirés explicitement avant la suppression.
 */

import { supabase } from './supabase';

const BUCKET = 'event-files';

/** Liste récursivement tous les objets sous un préfixe (dossiers inclus). */
async function listAllFilesRecursive(prefix: string): Promise<string[]> {
  const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error || !data) return [];
  const paths: string[] = [];
  for (const item of data) {
    const full = prefix ? `${prefix}/${item.name}` : item.name;
    // Un "dossier" n'a pas d'id ; un fichier en a un.
    if ((item as { id: string | null }).id === null) {
      paths.push(...(await listAllFilesRecursive(full)));
    } else {
      paths.push(full);
    }
  }
  return paths;
}

/** Supprime tous les fichiers Storage liés à un événement (préfixe {eventId}/). */
export async function deleteEventFiles(eventId: string): Promise<void> {
  try {
    const paths = await listAllFilesRecursive(eventId);
    if (paths.length > 0) {
      await supabase.storage.from(BUCKET).remove(paths);
    }
  } catch {
    // Bucket absent ou Storage indisponible — ignoré (best effort).
  }
}
