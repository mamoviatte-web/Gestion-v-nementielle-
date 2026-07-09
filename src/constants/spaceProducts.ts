/**
 * FAMILIES_BY_SPACE — ordre et libellés des familles d'accordéons de saisie
 * stock, adaptés au profil de l'espace (salon, loge, bar_pub, wine_bar, club,
 * pmr, bodega, terrasse, buvette).
 *
 * ⚠ Les clés correspondent aux catégories RÉELLES des produits
 * (Vins, Bières, Soft, Sirops, Spiritueux, Matériel). Les champagnes Mumm sont
 * en catégorie « Vins » → pas de famille « Champagnes » séparée.
 * Le profil est renvoyé par les RPC get_zone_stock / get_zone_buvette_stock
 * (champ `space_profile`).
 */

export interface SpaceFamily {
  key: string;
  label: string;
  emoji: string;
}

export const FAMILIES_BY_SPACE: Record<string, SpaceFamily[]> = {
  // SALON — gamme premium
  salon: [
    { key: 'Vins', label: 'Vins & Champagnes', emoji: '🍷' },
    { key: 'Spiritueux', label: 'Spiritueux & Lillet', emoji: '🥃' },
    { key: 'Bières', label: 'Bières & Fûts', emoji: '🍺' },
    { key: 'Soft', label: 'Softs & Eaux VIP', emoji: '💧' },
    { key: 'Sirops', label: 'Sirops & Mixers', emoji: '🫙' },
    { key: 'Matériel', label: 'Matériel (CO2…)', emoji: '📦' },
  ],
  // LOGE — bière en verre en premier
  loge: [
    { key: 'Bières', label: '🌟 Bière en verre', emoji: '🍺' },
    { key: 'Vins', label: 'Vins & Champagnes', emoji: '🍷' },
    { key: 'Spiritueux', label: 'Whisky & Ricard', emoji: '🥃' },
    { key: 'Soft', label: 'Softs & Eaux', emoji: '💧' },
  ],
  // BAR / PUB — fûts en premier
  bar_pub: [
    { key: 'Bières', label: 'Fûts & Bières', emoji: '🍺' },
    { key: 'Spiritueux', label: 'Spiritueux & Lillet', emoji: '🥃' },
    { key: 'Vins', label: 'Vins & Champagnes', emoji: '🍷' },
    { key: 'Soft', label: 'Softs & Eaux', emoji: '💧' },
    { key: 'Sirops', label: 'Sirops & Mixers', emoji: '🫙' },
    { key: 'Matériel', label: 'Matériel (CO2…)', emoji: '📦' },
  ],
  // WINE BAR — vins en premier
  wine_bar: [
    { key: 'Vins', label: 'Vins & Champagnes', emoji: '🍷' },
    { key: 'Bières', label: 'Bière en verre', emoji: '🍺' },
    { key: 'Spiritueux', label: 'Spiritueux', emoji: '🥃' },
    { key: 'Soft', label: 'Softs & Eaux', emoji: '💧' },
  ],
  // CLUB 70 — festif, sirops mis en avant
  club: [
    { key: 'Vins', label: 'Vins & Champagnes', emoji: '🍷' },
    { key: 'Bières', label: 'Fûts BUD', emoji: '🍺' },
    { key: 'Sirops', label: 'Sirops (cocktails)', emoji: '🫙' },
    { key: 'Soft', label: 'Softs & Eaux', emoji: '💧' },
    { key: 'Spiritueux', label: 'Spiritueux', emoji: '🥃' },
  ],
  // PMR — bouteilles uniquement (FADA BTL), même gamme que Terrasses
  pmr: [
    { key: 'Bières', label: '🍺 Bières en bouteille (FADA BTL)', emoji: '🍺' },
    { key: 'Vins', label: 'Vins', emoji: '🍷' },
    { key: 'Soft', label: 'Softs & Eaux', emoji: '💧' },
    { key: 'Sirops', label: 'Sirops', emoji: '🫙' },
  ],
  // BODEGA — fûts FADA en premier
  bodega: [
    { key: 'Bières', label: 'Fûts FADA', emoji: '🍺' },
    { key: 'Vins', label: 'Vins NAIS + Champagne', emoji: '🍷' },
    { key: 'Spiritueux', label: 'GET & Ricard', emoji: '🥃' },
    { key: 'Soft', label: 'Softs (50cl & bouteille)', emoji: '🥤' },
    { key: 'Sirops', label: 'Sirops', emoji: '🫙' },
  ],
  // TERRASSE — bouteilles uniquement (pas de fûts ni de CO2)
  terrasse: [
    { key: 'Bières', label: '🍺 Bières en bouteille', emoji: '🍺' },
    { key: 'Vins', label: 'Vins', emoji: '🍷' },
    { key: 'Soft', label: 'Softs & Eaux', emoji: '💧' },
    { key: 'Sirops', label: 'Sirops', emoji: '🫙' },
  ],
  // BUVETTE — 3 familles
  buvette: [
    { key: 'Bières', label: 'Fûts', emoji: '🍺' },
    { key: 'Soft', label: 'Softs 50cl', emoji: '🥤' },
    { key: 'Sirops', label: 'Sirops', emoji: '🫙' },
  ],
};
