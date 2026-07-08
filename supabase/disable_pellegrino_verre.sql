-- ═══════════════════════════════════════════════════════════════════════════
-- disable_pellegrino_verre.sql — Le San Pellegrino n'est servi qu'en bouteille.
-- On désactive le format « verre » : active=false → exclu automatiquement de
-- toutes les feuilles de stock (filtre WHERE active = true dans get_zone_stock /
-- get_zone_buvette_stock / FamilyStockForm). Données historiques CONSERVÉES.
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE products
   SET active = false
 WHERE product_name ILIKE '%pellegrino%'
   AND (product_name ILIKE '%verre%' OR unit = 'verre');

-- Audit (informatif) : autres boissons en format « verre » encore actives,
-- à valider avec l'équipe (ex. « Vittel verre »).
-- SELECT product_name, unit, category FROM products WHERE unit = 'verre' AND active = true;
