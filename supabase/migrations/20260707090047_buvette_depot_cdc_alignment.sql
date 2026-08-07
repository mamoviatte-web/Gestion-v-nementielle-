-- ═══════════════════════════════════════════════════════════════════════════
-- buvette_depot_cdc_alignment.sql — aligne les dépôts buvette (area_stocks) sur
-- la gamme CDC : fûts + softs 50cl + sirops + CO2, 0 produit VIP.
--
-- Contexte : les dépôts « Buvette 1 »/« Buvette 2 » avaient été semés avec un
-- gabarit générique VIP (Mumm, Rosé, Lillet, Whisky, GET 27, Bière en verre,
-- softs format bouteille 1L). Le runner reflétait ce dépôt. On réaligne le
-- dépôt sur area_product_reference (source de vérité CDC), génériquement pour
-- tout espace buvette possédant déjà un dépôt.
--
-- Corrige aussi la liaison catalogue de « Cristalline 50cl » (référentiel) →
-- « Cristaline 50cl » (catalogue), écart d'orthographe qui empêchait le filtre
-- runner d'inclure l'eau plate.
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Lier « Cristalline 50cl » (CDC) au produit catalogue « Cristaline 50cl ».
UPDATE area_product_reference apr
SET product_id = p.product_id
FROM products p
WHERE apr.product_name = 'Cristalline 50cl'
  AND apr.product_id IS NULL
  AND p.product_name = 'Cristaline 50cl'
  AND p.active = true;

-- 2) Retirer du dépôt buvette tout produit hors gamme CDC de l'espace.
DELETE FROM area_stocks ast
USING spaces s
WHERE ast.area_id = s.space_id
  AND s.service_type = 'buvette'
  AND NOT EXISTS (
    SELECT 1 FROM area_product_reference apr
    WHERE UPPER(TRIM(apr.area_name)) = UPPER(TRIM(s.space_name))
      AND apr.product_id = ast.product_id
  );

-- 3) Ajouter au dépôt les produits CDC manquants (qty 0), uniquement pour les
--    espaces buvette qui possèdent DÉJÀ un dépôt (ne crée pas de dépôt ex nihilo
--    pour B1-B9 non approvisionnés).
INSERT INTO area_stocks (area_id, product_id, current_qty, initial_qty)
SELECT s.space_id, apr.product_id, 0, 0
FROM spaces s
JOIN area_product_reference apr
  ON UPPER(TRIM(apr.area_name)) = UPPER(TRIM(s.space_name))
WHERE s.service_type = 'buvette'
  AND apr.product_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM area_stocks a2 WHERE a2.area_id = s.space_id)
  AND NOT EXISTS (
    SELECT 1 FROM area_stocks a3
    WHERE a3.area_id = s.space_id AND a3.product_id = apr.product_id
  );
