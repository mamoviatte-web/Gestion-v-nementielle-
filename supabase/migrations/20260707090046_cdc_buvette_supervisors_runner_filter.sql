-- ═══════════════════════════════════════════════════════════════════════════
-- cdc_buvette_supervisors_runner_filter.sql
--
-- Bug : la fiche « Runner — Buvette 2 » affichait des produits VIP (Mumm, Rosé,
-- Lillet, Whisky, Bière en verre). Cause : la génération runner
-- (useRunnerPlanning) prend TOUS les produits présents dans area_stocks /
-- event_consumptions de l'espace, sans filtre gamme/CDC. Les espaces
-- superviseurs « Buvette 1 »/« Buvette 2 » n'avaient en plus AUCUNE entrée dans
-- area_product_reference → impossible de filtrer par CDC.
--
-- Ce correctif :
--   1) Ajoute la gamme CDC de base (fûts + softs + sirops + CO2) pour les
--      espaces superviseurs « Buvette 1 » et « Buvette 2 ». cdc_version distinct
--      'V3-super' → inject_cdc_v3() (qui purge WHERE cdc_version='V3') ne les
--      supprime pas. Idempotent (ON CONFLICT DO NOTHING).
--   2) Purge les lignes runner_auto_planning déjà générées pour des espaces
--      buvette dont le produit n'appartient PAS au CDC de l'espace (retire les
--      vins/champagnes/spiritueux/bière en verre infiltrés).
--
-- Le filtre CDC est appliqué en amont côté client (useRunnerPlanning) pour que
-- toute future génération reste propre.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO area_product_reference
  (area_name, area_group, product_name, product_family, association_level, cdc_version)
VALUES
  ('Buvette 1','Buvettes','Fût Bud','Bière / Fûts','S','V3-super'),
  ('Buvette 1','Buvettes','Fût Goose Island IPA','Bière / Fûts','S','V3-super'),
  ('Buvette 1','Buvettes','Fût Hoegaarden Blanche','Bière / Fûts','S','V3-super'),
  ('Buvette 1','Buvettes','Fût Leffe','Bière / Fûts','S','V3-super'),
  ('Buvette 1','Buvettes','Cristalline 50cl','Softs / Eau / Sirops','S','V3-super'),
  ('Buvette 1','Buvettes','Ice Tea 50cl','Softs / Eau / Sirops','S','V3-super'),
  ('Buvette 1','Buvettes','Orangina 50cl','Softs / Eau / Sirops','S','V3-super'),
  ('Buvette 1','Buvettes','Pepsi 50cl','Softs / Eau / Sirops','S','V3-super'),
  ('Buvette 1','Buvettes','San Pellegrino 50cl','Softs / Eau / Sirops','S','V3-super'),
  ('Buvette 1','Buvettes','Sirop de pêche','Softs / Eau / Sirops','S','V3-super'),
  ('Buvette 1','Buvettes','Sirop de grenadine','Softs / Eau / Sirops','R','V3-super'),
  ('Buvette 1','Buvettes','Sirop de menthe','Softs / Eau / Sirops','P','V3-super'),
  ('Buvette 1','Buvettes','Sirop de citron','Softs / Eau / Sirops','P','V3-super'),
  ('Buvette 1','Buvettes','CO2','Gaz / Technique','P','V3-super'),
  ('Buvette 2','Buvettes','Fût Bud','Bière / Fûts','S','V3-super'),
  ('Buvette 2','Buvettes','Fût Goose Island IPA','Bière / Fûts','S','V3-super'),
  ('Buvette 2','Buvettes','Fût Hoegaarden Blanche','Bière / Fûts','S','V3-super'),
  ('Buvette 2','Buvettes','Fût Leffe','Bière / Fûts','S','V3-super'),
  ('Buvette 2','Buvettes','Cristalline 50cl','Softs / Eau / Sirops','S','V3-super'),
  ('Buvette 2','Buvettes','Ice Tea 50cl','Softs / Eau / Sirops','S','V3-super'),
  ('Buvette 2','Buvettes','Orangina 50cl','Softs / Eau / Sirops','S','V3-super'),
  ('Buvette 2','Buvettes','Pepsi 50cl','Softs / Eau / Sirops','S','V3-super'),
  ('Buvette 2','Buvettes','San Pellegrino 50cl','Softs / Eau / Sirops','S','V3-super'),
  ('Buvette 2','Buvettes','Sirop de pêche','Softs / Eau / Sirops','S','V3-super'),
  ('Buvette 2','Buvettes','Sirop de grenadine','Softs / Eau / Sirops','R','V3-super'),
  ('Buvette 2','Buvettes','Sirop de menthe','Softs / Eau / Sirops','P','V3-super'),
  ('Buvette 2','Buvettes','Sirop de citron','Softs / Eau / Sirops','P','V3-super'),
  ('Buvette 2','Buvettes','CO2','Gaz / Technique','P','V3-super')
ON CONFLICT (area_name, product_name) DO NOTHING;

-- Lier les product_id du catalogue (mêmes règles que inject_cdc_v3).
UPDATE area_product_reference apr
SET product_id = p.product_id
FROM products p
WHERE apr.cdc_version = 'V3-super'
  AND apr.product_id IS NULL
  AND UPPER(TRIM(p.product_name)) = UPPER(TRIM(apr.product_name))
  AND p.active = true;

-- Purge des lignes runner déjà générées hors CDC pour les espaces buvette.
DELETE FROM runner_auto_planning rap
USING spaces s
WHERE rap.space_id = s.space_id
  AND s.service_type = 'buvette'
  AND NOT EXISTS (
    SELECT 1 FROM area_product_reference apr
    WHERE UPPER(TRIM(apr.area_name)) = UPPER(TRIM(s.space_name))
      AND apr.product_id = rap.product_id
  );
