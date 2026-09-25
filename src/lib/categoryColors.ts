/**
 * Palette catégorielle F&B — SOURCE UNIQUE (app + graphiques).
 * Validée dataviz (6 teintes distinctes CVD + « Matériel » en gris neutre =
 * emplacement « Autre » sans prix ; toujours accompagnée du libellé de catégorie
 * comme encodage secondaire, jamais la couleur seule).
 *
 * Ordre catégoriel FIXE (jamais recyclé) : la couleur suit l'entité, pas le rang.
 */
export const CATEGORY_ORDER = ['Bières', 'Soft', 'Vins', 'Spiritueux', 'Sirops', 'Champagne', 'Matériel'] as const;

export const CAT_COLOR: Record<string, string> = {
  Bières: '#C2751A',
  Soft: '#2F6FED',
  Vins: '#8B2E5A',
  Spiritueux: '#6B4CD6',
  Sirops: '#1FA37A',
  Champagne: '#B8860B',
  Matériel: '#64748B',
};

/** Couleur d'une catégorie (repli gris neutre pour l'inconnu / « Autre »). */
export const catColor = (c: string | null | undefined): string => CAT_COLOR[c ?? ''] ?? '#64748B';

/** Rang d'affichage d'une catégorie (ordre fixe, inconnus en fin). */
export const catRank = (c: string): number => {
  const i = (CATEGORY_ORDER as readonly string[]).indexOf(c);
  return i === -1 ? CATEGORY_ORDER.length : i;
};
