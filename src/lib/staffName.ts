/**
 * staffName — garde-fou de saisie du nom (RH).
 *
 * Empêche d'enregistrer un responsable sous son CODE d'accès (ex. « 8F7D1A »,
 * « SN2026 ») au lieu de son nom : ces saisies polluaient la synthèse de paie
 * (personnes fantômes à re-fusionner après coup). On bloque les libellés qui
 * ressemblent à un code, tout en acceptant les vrais noms (y compris un prénom
 * seul, que le mécanisme d'alias RH sait rattacher).
 */

export interface NameCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Valide un nom de personnel saisi.
 * @param raw    Nom saisi.
 * @param token  (optionnel) Code d'accès en cours — un nom qui l'égale est rejeté.
 */
export function validateStaffName(raw: string, token?: string | null): NameCheck {
  const t = (raw ?? '').trim();
  if (t.length < 2) return { ok: false, reason: 'Indiquez votre nom (2 caractères minimum).' };
  if (!/[a-zA-ZÀ-ÿ]/.test(t)) return { ok: false, reason: 'Le nom doit contenir des lettres.' };
  if (token && t.toUpperCase() === token.trim().toUpperCase()) {
    return { ok: false, reason: 'Saisissez votre NOM (Nom Prénom), pas le code d’accès.' };
  }
  // Motif « code » : contient un chiffre ET aucun espace (8F7D1A, SN2026, BV12026…).
  if (/\d/.test(t) && !/\s/.test(t)) {
    return { ok: false, reason: 'Ce libellé ressemble à un code d’accès. Saisissez votre nom (Nom Prénom).' };
  }
  return { ok: true };
}

/** true si le nom est accepté par le garde-fou. */
export function isValidStaffName(raw: string, token?: string | null): boolean {
  return validateStaffName(raw, token).ok;
}
