/**
 * Formules centrales du module Stock — CDC V2 §5.
 * Fonctions pures (aucun accès réseau), testables unitairement.
 */

/** Consommation réelle par espace/événement (CDC §9). */
export const computeConsumption = (
  initialStock: number,
  reassortQty: number,
  finalStock: number,
): number => initialStock + reassortQty - finalStock;

/** Coût de la consommation (null si prix HT manquant — RG-005). */
export const computeConsumptionCost = (
  consumption: number,
  unitPriceHT: number | null,
): number | null => (unitPriceHT !== null ? consumption * unitPriceHT : null);

/** Quantité à monter (évite de monter du stock déjà présent dans l'espace). */
export const computeQtyToMove = (
  validatedQty: number,
  initialSpaceStock: number,
): number => Math.max(0, validatedQty - initialSpaceStock);

/** Écart d'inventaire (réel - théorique). */
export const computeInventoryVariance = (
  realQty: number,
  theoreticalQty: number,
): number => realQty - theoreticalQty;

/** Taux de retour (indicateur de surdotation). */
export const computeReturnRate = (
  returnedQty: number,
  pickedQty: number,
): number | null => (pickedQty > 0 ? returnedQty / pickedQty : null);

/** Taux de perte/casse. */
export const computeLossRate = (
  lossQty: number,
  pickedQty: number,
): number | null => (pickedQty > 0 ? lossQty / pickedQty : null);

/** Stock disponible global (réserve + réutilisable en espace). */
export const computeGlobalAvailableStock = (
  reserveStock: number,
  reuseableSpaceStock: number,
): number => reserveStock + reuseableSpaceStock;

/** Besoin de commande fournisseur pour revenir au max. */
export const computeOrderNeed = (
  maxStock: number,
  availableStock: number,
): number => Math.max(0, maxStock - availableStock);

/** Stock critique (sous le seuil minimum). */
export const isStockCritical = (
  currentQty: number,
  minStock: number,
): boolean => currentQty < minStock;

/** Produit dormant (pas consommé depuis N jours, 90 par défaut). */
export const isDormantProduct = (
  lastConsumptionDate: Date | null,
  thresholdDays = 90,
): boolean => {
  if (!lastConsumptionDate) return true;
  const daysSince = (Date.now() - lastConsumptionDate.getTime()) / 86_400_000;
  return daysSince > thresholdDays;
};

/** Libellés français des 7 types de mouvements localisés (CDC §7). */
export const MOVEMENT_TYPE_V2_LABELS: Record<string, string> = {
  entrée_fournisseur: 'Entrée fournisseur',
  transfert_espace: 'Transfert espace',
  réassort_événement: 'Réassort événement',
  retour_réutilisable: 'Retour réutilisable',
  consommation: 'Consommation',
  perte_casse: 'Perte / casse',
  correction: 'Correction',
};

/** Signe du mouvement sur le stock global (+ entrée, − sortie, 0 transfert interne). */
export const MOVEMENT_TYPE_V2_SIGN: Record<string, '+' | '-' | '±'> = {
  entrée_fournisseur: '+',
  transfert_espace: '±',
  réassort_événement: '±',
  retour_réutilisable: '+',
  consommation: '-',
  perte_casse: '-',
  correction: '±',
};
