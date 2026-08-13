/**
 * loadModule — import dynamique robuste face aux « chunks périmés ».
 *
 * Après un redéploiement (Vercel), un onglet resté ouvert sur l'ANCIENNE version
 * référence des chunks dont le hash a changé (ex. html2pdf-B1D20JFA.js). Le
 * navigateur échoue alors avec « Failed to fetch dynamically imported module ».
 *
 * Stratégie : un réessai (aléa réseau transitoire), puis — si le chunk est
 * réellement périmé — un rechargement UNIQUE de la page (garde anti-boucle de
 * 10 s) pour récupérer l'index à jour et ses nouveaux hashes. La fonction ne
 * résout jamais dans ce cas (la page se recharge), donc l'appelant n'affiche
 * pas de faux message d'erreur.
 */

const RELOAD_FLAG = 'stale-chunk-reloaded-at';

function isStaleChunkError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /dynamically imported module|module script failed|Failed to fetch|error loading dynamically|Load failed/i.test(msg);
}

export async function loadModule<T>(
  importer: () => Promise<T>,
  notify?: (message: string) => void,
): Promise<T> {
  try {
    return await importer();
  } catch (e) {
    if (!isStaleChunkError(e)) throw e;
    // 1) Réessai simple — couvre un aléa réseau ponctuel.
    try {
      return await importer();
    } catch (e2) {
      if (!isStaleChunkError(e2)) throw e2;
      // 2) Chunk périmé : recharger une seule fois pour récupérer les bons hashes.
      const last = Number(sessionStorage.getItem(RELOAD_FLAG) ?? 0);
      if (Date.now() - last > 10_000) {
        sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
        notify?.('Nouvelle version de l’application détectée — rechargement…');
        setTimeout(() => window.location.reload(), 900);
        // Ne jamais résoudre : la page va se recharger.
        await new Promise<never>(() => {});
      }
      throw e2;
    }
  }
}
