-- ═══════════════════════════════════════════════════════════════════
-- Import catalogue — source : Stocks_VIERGE.xlsx (données de référence).
-- Appliqué le 2026-07-02 via session authentifiée ROLE_STADE (REST/PostgREST)
-- car le MCP Supabase / service_role n'était pas disponible (DML uniquement).
--
-- Matching insensible casse/accents/apostrophes + alias :
--   « Bière BUD verre »  ≡ produit existant « Bière en verre »
--   « Cristalline 50cl » ≡ produit existant « Cristaline 50cl »
-- Lillet Blanc/Rosé conservés en catégorie Spiritueux (existant), prix seul mis à jour.
-- ═══════════════════════════════════════════════════════════════════

-- ── Corrections de prix (produits déjà présents) ────────────────────
UPDATE products SET unit_price_ht = 8.50  WHERE product_name = 'Rosé Miraval';
UPDATE products SET unit_price_ht = 12.28 WHERE product_name = 'Lillet Rosé';
UPDATE products SET unit_price_ht = 5.01  WHERE product_name = 'Sirop de menthe';
UPDATE products SET unit_price_ht = 5.01  WHERE product_name = 'Sirop de citron';

-- ── Produits ajoutés (32) — insérés uniquement si absents (pas de contrainte
--    UNIQUE sur product_name → vérification d'existence côté applicatif). ──
-- Vins : Rosé NAIS 6.12 · Rouge Les Alexandrins 8.50 · Rouge Grand Boise 7.58 ·
--        Rouge NAIS 4.74 · Rouge Gigondas 11.00 · Blanc du Seuil 6.30 ·
--        Blanc Galiniere 6.50 · Blanc Montaurone 5.20 · Blanc NAIS 3.64
-- Bières fûts : Hoegaarden Blanche 76.58 · Goose Island IPA 81.68 ·
--        FADA Blonde 98.28 · FADA Blanche 76.58 · FADA IPA 81.68 · FADA Abricot 75.42 · CO2 31.59
-- Bières btl : FADA Blonde 1.45 · FADA Blanche 1.67 · FADA IPA 1.74 · FADA Abricot 1.74 ·
--        Corona 1.63 · Corona sans alcool 1.72
-- Soft : Pepsi 50cl 1.09 · Orangina 50cl 1.22 · Ice Tea 50cl 1.26 · San Pellegrino 50cl 0.69 ·
--        Pepsi Max bouteille 2.56 · Perrier grande bouteille 1.04 · San Pellegrino verre 0.94 · Vittel verre 0.83
-- Spiritueux : Ricard aux Herbes 17.25   ·   Sirops : Sirop Orgeat 6.40
--
-- NB catégories : les fûts/bouteilles bières restent en catégorie 'Bières' (le
-- schéma n'a pas de catégorie 'Fûts') ; CO2 rangé en 'Bières' (consommable bar).
--
-- ── Ignoré volontairement ───────────────────────────────────────────
--   « Rouge PARADIS / CHATEAU PARADIS » : prix 0/manquant dans le fichier
--   (nom ambigu) → non inséré, à confirmer manuellement.
--
-- ── runner_templates reconstruits (DELETE ALL puis INSERT) ──────────
--   VIP (5 espaces × 36) = 180 · Bar (7 × 29) = 203 · Bodega (1 × 25) = 25 ·
--   Buvette (3 × 16) = 48 · PMR/Terrasses (+21) → 477 lignes, 16 espaces couverts.
--
-- Résultat : 57 produits actifs · 53 avec prix HT · 4 sans prix (Matériel, RG-005).
