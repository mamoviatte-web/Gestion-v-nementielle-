-- ═══════════════════════════════════════════════════════════════════════════
-- cdc_v3_area_product_reference.sql — Cahier des Charges Produits par Espace V3.
--   • Référentiel permanent produit × espace (indépendant des événements).
--   • Niveaux d'association CDC : S (socle/défaut) · R (récurrent) · P (ponctuel)
--     · C (à confirmer, conservé, jamais supprimé).
--   • RPC fiche runner par espace, filtrable par niveau. Aucun coût ici.
--
-- ⚠ ADAPTATIONS AU SCHÉMA RÉEL :
--   • BLOC 2 du prompt (renommage buvettes → B1-B9 + spaces.legacy_area_name)
--     NON repris : les espaces buvette sont DÉJÀ nommés B1..B9, et la table
--     spaces n'a pas de colonne legacy_area_name (l'UPDATE échouerait). Les
--     libellés historiques sont portés par area_product_reference.legacy_area_name.
--   • RLS via is_stade() (convention du projet) au lieu du chemin JWT brut.
--   • 'Buvette Virage Toinou' reste hors référentiel CDC (non validé).
-- ═══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════
-- BLOC 1 — TABLE area_product_reference
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS area_product_reference (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area_name        TEXT NOT NULL,
  area_group       TEXT NOT NULL,
  legacy_area_name TEXT,
  product_name     TEXT NOT NULL,
  product_family   TEXT NOT NULL CHECK (product_family IN (
    'Bière / Fûts','Vins','Champagne','Softs / Eau / Sirops',
    'Spiritueux / Apéritifs','Gaz / Technique','Autres'
  )),
  association_level TEXT NOT NULL CHECK (association_level IN ('S','R','P','C')),
  is_default        BOOLEAN GENERATED ALWAYS AS (association_level = 'S') STORED,
  product_id       UUID REFERENCES products(product_id) ON DELETE SET NULL,
  cdc_version      TEXT DEFAULT 'V3',
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (area_name, product_name)
);

ALTER TABLE area_product_reference ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stade_all_apr" ON area_product_reference;
CREATE POLICY "stade_all_apr" ON area_product_reference
  FOR ALL TO authenticated
  USING (is_stade()) WITH CHECK (is_stade());

CREATE INDEX IF NOT EXISTS idx_apr_area       ON area_product_reference(area_name);
CREATE INDEX IF NOT EXISTS idx_apr_group      ON area_product_reference(area_group);
CREATE INDEX IF NOT EXISTS idx_apr_level      ON area_product_reference(association_level);
CREATE INDEX IF NOT EXISTS idx_apr_default    ON area_product_reference(is_default) WHERE is_default = true;
CREATE INDEX IF NOT EXISTS idx_apr_product_id ON area_product_reference(product_id);

-- ══════════════════════════════════════════════════════════════════════════
-- BLOC 3 — INJECTION RÉFÉRENTIEL CDC V3
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION inject_cdc_v3()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_count INT := 0;
BEGIN
  DELETE FROM area_product_reference WHERE cdc_version = 'V3';

  INSERT INTO area_product_reference
    (area_name, area_group, legacy_area_name, product_name, product_family, association_level)
  VALUES
  -- ── BODEGA ──
  ('Bodega','Bodega',NULL,'Fût Fada Blanche','Bière / Fûts','S'),
  ('Bodega','Bodega',NULL,'Fût Fada Blonde','Bière / Fûts','S'),
  ('Bodega','Bodega',NULL,'Fût Fada IPA','Bière / Fûts','S'),
  ('Bodega','Bodega',NULL,'Fût VP Fada','Bière / Fûts','S'),
  ('Bodega','Bodega',NULL,'Fût VIP Groupe','Bière / Fûts','P'),
  ('Bodega','Bodega',NULL,'Fût Fada Abricot','Bière / Fûts','C'),
  ('Bodega','Bodega',NULL,'Blanc Montaurone','Vins','S'),
  ('Bodega','Bodega',NULL,'Rosé NAIS','Vins','S'),
  ('Bodega','Bodega',NULL,'Rouge NAIS','Vins','S'),
  ('Bodega','Bodega',NULL,'Blanc Montaurone / Touloubre','Vins','C'),
  ('Bodega','Bodega',NULL,'Rosé Pey Blanc','Vins','C'),
  ('Bodega','Bodega',NULL,'Rosé Réal','Vins','C'),
  ('Bodega','Bodega',NULL,'Mumm Cordon Rouge','Champagne','S'),
  ('Bodega','Bodega',NULL,'Cristalline 50cl','Softs / Eau / Sirops','S'),
  ('Bodega','Bodega',NULL,'Ice Tea 50cl','Softs / Eau / Sirops','S'),
  ('Bodega','Bodega',NULL,'Jus de fruits','Softs / Eau / Sirops','S'),
  ('Bodega','Bodega',NULL,'Orangina 50cl','Softs / Eau / Sirops','S'),
  ('Bodega','Bodega',NULL,'Pepsi 50cl','Softs / Eau / Sirops','S'),
  ('Bodega','Bodega',NULL,'Pepsi bouteille','Softs / Eau / Sirops','S'),
  ('Bodega','Bodega',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','S'),
  ('Bodega','Bodega',NULL,'San Pellegrino 50cl','Softs / Eau / Sirops','S'),
  ('Bodega','Bodega',NULL,'Sirop de pêche','Softs / Eau / Sirops','S'),
  ('Bodega','Bodega',NULL,'Sirop de grenadine','Softs / Eau / Sirops','R'),
  ('Bodega','Bodega',NULL,'Sirop de menthe','Softs / Eau / Sirops','R'),
  ('Bodega','Bodega',NULL,'Pepsi Max bouteille','Softs / Eau / Sirops','C'),
  ('Bodega','Bodega',NULL,'Sirop de citron','Softs / Eau / Sirops','C'),
  ('Bodega','Bodega',NULL,'Get Bodega','Spiritueux / Apéritifs','S'),
  ('Bodega','Bodega',NULL,'Ricard classique VP','Spiritueux / Apéritifs','S'),
  ('Bodega','Bodega',NULL,'CO2','Gaz / Technique','P'),
  -- ── B1 ──
  ('B1','Buvettes','Buvette Nord Ouest','Fût Bud','Bière / Fûts','S'),
  ('B1','Buvettes','Buvette Nord Ouest','Fût Goose Island IPA','Bière / Fûts','S'),
  ('B1','Buvettes','Buvette Nord Ouest','Fût Hoegaarden Blanche','Bière / Fûts','S'),
  ('B1','Buvettes','Buvette Nord Ouest','Fût Leffe','Bière / Fûts','S'),
  ('B1','Buvettes','Buvette Nord Ouest','Cristalline 50cl','Softs / Eau / Sirops','S'),
  ('B1','Buvettes','Buvette Nord Ouest','Ice Tea 50cl','Softs / Eau / Sirops','S'),
  ('B1','Buvettes','Buvette Nord Ouest','Orangina 50cl','Softs / Eau / Sirops','S'),
  ('B1','Buvettes','Buvette Nord Ouest','Pepsi 50cl','Softs / Eau / Sirops','S'),
  ('B1','Buvettes','Buvette Nord Ouest','San Pellegrino 50cl','Softs / Eau / Sirops','S'),
  ('B1','Buvettes','Buvette Nord Ouest','Sirop de grenadine','Softs / Eau / Sirops','S'),
  ('B1','Buvettes','Buvette Nord Ouest','Sirop de pêche','Softs / Eau / Sirops','S'),
  ('B1','Buvettes','Buvette Nord Ouest','Sirop de citron','Softs / Eau / Sirops','P'),
  ('B1','Buvettes','Buvette Nord Ouest','Sirop de menthe','Softs / Eau / Sirops','C'),
  ('B1','Buvettes','Buvette Nord Ouest','CO2','Gaz / Technique','P'),
  -- ── B2 ──
  ('B2','Buvettes','Buvette Nord Est','Fût Bud','Bière / Fûts','S'),
  ('B2','Buvettes','Buvette Nord Est','Fût Goose Island IPA','Bière / Fûts','S'),
  ('B2','Buvettes','Buvette Nord Est','Fût Hoegaarden Blanche','Bière / Fûts','S'),
  ('B2','Buvettes','Buvette Nord Est','Fût Leffe','Bière / Fûts','S'),
  ('B2','Buvettes','Buvette Nord Est','Cristalline 50cl','Softs / Eau / Sirops','S'),
  ('B2','Buvettes','Buvette Nord Est','Ice Tea 50cl','Softs / Eau / Sirops','S'),
  ('B2','Buvettes','Buvette Nord Est','Orangina 50cl','Softs / Eau / Sirops','S'),
  ('B2','Buvettes','Buvette Nord Est','Pepsi 50cl','Softs / Eau / Sirops','S'),
  ('B2','Buvettes','Buvette Nord Est','San Pellegrino 50cl','Softs / Eau / Sirops','S'),
  ('B2','Buvettes','Buvette Nord Est','Sirop de pêche','Softs / Eau / Sirops','S'),
  ('B2','Buvettes','Buvette Nord Est','Sirop de grenadine','Softs / Eau / Sirops','P'),
  ('B2','Buvettes','Buvette Nord Est','Sirop de menthe','Softs / Eau / Sirops','P'),
  ('B2','Buvettes','Buvette Nord Est','Sirop de citron','Softs / Eau / Sirops','C'),
  ('B2','Buvettes','Buvette Nord Est','CO2','Gaz / Technique','C'),
  -- ── B3 ──
  ('B3','Buvettes','Buvette Est Galice','Fût Bud','Bière / Fûts','S'),
  ('B3','Buvettes','Buvette Est Galice','Fût Goose Island IPA','Bière / Fûts','S'),
  ('B3','Buvettes','Buvette Est Galice','Fût Hoegaarden Blanche','Bière / Fûts','S'),
  ('B3','Buvettes','Buvette Est Galice','Fût Leffe','Bière / Fûts','S'),
  ('B3','Buvettes','Buvette Est Galice','Cristalline 50cl','Softs / Eau / Sirops','S'),
  ('B3','Buvettes','Buvette Est Galice','Ice Tea 50cl','Softs / Eau / Sirops','S'),
  ('B3','Buvettes','Buvette Est Galice','Orangina 50cl','Softs / Eau / Sirops','S'),
  ('B3','Buvettes','Buvette Est Galice','Pepsi 50cl','Softs / Eau / Sirops','S'),
  ('B3','Buvettes','Buvette Est Galice','San Pellegrino 50cl','Softs / Eau / Sirops','S'),
  ('B3','Buvettes','Buvette Est Galice','Sirop de pêche','Softs / Eau / Sirops','S'),
  ('B3','Buvettes','Buvette Est Galice','Sirop de grenadine','Softs / Eau / Sirops','R'),
  ('B3','Buvettes','Buvette Est Galice','Sirop de citron','Softs / Eau / Sirops','C'),
  ('B3','Buvettes','Buvette Est Galice','Sirop de menthe','Softs / Eau / Sirops','C'),
  ('B3','Buvettes','Buvette Est Galice','CO2','Gaz / Technique','C'),
  -- ── B4 ──
  ('B4','Buvettes','Buvette Est Pagnol','Fût Bud','Bière / Fûts','S'),
  ('B4','Buvettes','Buvette Est Pagnol','Fût Goose Island IPA','Bière / Fûts','S'),
  ('B4','Buvettes','Buvette Est Pagnol','Fût Hoegaarden Blanche','Bière / Fûts','S'),
  ('B4','Buvettes','Buvette Est Pagnol','Fût Leffe','Bière / Fûts','S'),
  ('B4','Buvettes','Buvette Est Pagnol','Cristalline 50cl','Softs / Eau / Sirops','S'),
  ('B4','Buvettes','Buvette Est Pagnol','Ice Tea 50cl','Softs / Eau / Sirops','S'),
  ('B4','Buvettes','Buvette Est Pagnol','Orangina 50cl','Softs / Eau / Sirops','S'),
  ('B4','Buvettes','Buvette Est Pagnol','Pepsi 50cl','Softs / Eau / Sirops','S'),
  ('B4','Buvettes','Buvette Est Pagnol','San Pellegrino 50cl','Softs / Eau / Sirops','S'),
  ('B4','Buvettes','Buvette Est Pagnol','Sirop de grenadine','Softs / Eau / Sirops','S'),
  ('B4','Buvettes','Buvette Est Pagnol','Sirop de pêche','Softs / Eau / Sirops','S'),
  ('B4','Buvettes','Buvette Est Pagnol','Sirop de citron','Softs / Eau / Sirops','C'),
  ('B4','Buvettes','Buvette Est Pagnol','Sirop de menthe','Softs / Eau / Sirops','C'),
  ('B4','Buvettes','Buvette Est Pagnol','CO2','Gaz / Technique','P'),
  -- ── B5 ──
  ('B5','Buvettes','Buvette Virage Sud Est','Fût Bud','Bière / Fûts','S'),
  ('B5','Buvettes','Buvette Virage Sud Est','Fût Leffe','Bière / Fûts','S'),
  ('B5','Buvettes','Buvette Virage Sud Est','Fût Goose Island IPA','Bière / Fûts','C'),
  ('B5','Buvettes','Buvette Virage Sud Est','Fût Hoegaarden Blanche','Bière / Fûts','C'),
  ('B5','Buvettes','Buvette Virage Sud Est','Sirop de pêche','Softs / Eau / Sirops','S'),
  ('B5','Buvettes','Buvette Virage Sud Est','Cristalline 50cl','Softs / Eau / Sirops','C'),
  ('B5','Buvettes','Buvette Virage Sud Est','Ice Tea 50cl','Softs / Eau / Sirops','C'),
  ('B5','Buvettes','Buvette Virage Sud Est','Orangina 50cl','Softs / Eau / Sirops','C'),
  ('B5','Buvettes','Buvette Virage Sud Est','Pepsi 50cl','Softs / Eau / Sirops','C'),
  ('B5','Buvettes','Buvette Virage Sud Est','San Pellegrino 50cl','Softs / Eau / Sirops','C'),
  ('B5','Buvettes','Buvette Virage Sud Est','Sirop de citron','Softs / Eau / Sirops','C'),
  ('B5','Buvettes','Buvette Virage Sud Est','Sirop de grenadine','Softs / Eau / Sirops','C'),
  ('B5','Buvettes','Buvette Virage Sud Est','Sirop de menthe','Softs / Eau / Sirops','C'),
  ('B5','Buvettes','Buvette Virage Sud Est','CO2','Gaz / Technique','P'),
  -- ── B6 ──
  ('B6','Buvettes','Buvette Sud Est','Fût Bud','Bière / Fûts','S'),
  ('B6','Buvettes','Buvette Sud Est','Fût Goose Island IPA','Bière / Fûts','S'),
  ('B6','Buvettes','Buvette Sud Est','Fût Hoegaarden Blanche','Bière / Fûts','S'),
  ('B6','Buvettes','Buvette Sud Est','Fût Leffe','Bière / Fûts','S'),
  ('B6','Buvettes','Buvette Sud Est','Cristalline 50cl','Softs / Eau / Sirops','S'),
  ('B6','Buvettes','Buvette Sud Est','Ice Tea 50cl','Softs / Eau / Sirops','S'),
  ('B6','Buvettes','Buvette Sud Est','Orangina 50cl','Softs / Eau / Sirops','S'),
  ('B6','Buvettes','Buvette Sud Est','Pepsi 50cl','Softs / Eau / Sirops','S'),
  ('B6','Buvettes','Buvette Sud Est','San Pellegrino 50cl','Softs / Eau / Sirops','S'),
  ('B6','Buvettes','Buvette Sud Est','Sirop de pêche','Softs / Eau / Sirops','S'),
  ('B6','Buvettes','Buvette Sud Est','Sirop de grenadine','Softs / Eau / Sirops','R'),
  ('B6','Buvettes','Buvette Sud Est','Sirop de citron','Softs / Eau / Sirops','C'),
  ('B6','Buvettes','Buvette Sud Est','Sirop de menthe','Softs / Eau / Sirops','C'),
  ('B6','Buvettes','Buvette Sud Est','CO2','Gaz / Technique','R'),
  -- ── B7 ──
  ('B7','Buvettes','Buvette Sud Ouest','Fût Bud','Bière / Fûts','S'),
  ('B7','Buvettes','Buvette Sud Ouest','Fût Goose Island IPA','Bière / Fûts','S'),
  ('B7','Buvettes','Buvette Sud Ouest','Fût Hoegaarden Blanche','Bière / Fûts','S'),
  ('B7','Buvettes','Buvette Sud Ouest','Fût Leffe','Bière / Fûts','S'),
  ('B7','Buvettes','Buvette Sud Ouest','Cristalline 50cl','Softs / Eau / Sirops','S'),
  ('B7','Buvettes','Buvette Sud Ouest','Ice Tea 50cl','Softs / Eau / Sirops','S'),
  ('B7','Buvettes','Buvette Sud Ouest','Orangina 50cl','Softs / Eau / Sirops','S'),
  ('B7','Buvettes','Buvette Sud Ouest','Pepsi 50cl','Softs / Eau / Sirops','S'),
  ('B7','Buvettes','Buvette Sud Ouest','San Pellegrino 50cl','Softs / Eau / Sirops','S'),
  ('B7','Buvettes','Buvette Sud Ouest','Sirop de grenadine','Softs / Eau / Sirops','S'),
  ('B7','Buvettes','Buvette Sud Ouest','Sirop de pêche','Softs / Eau / Sirops','S'),
  ('B7','Buvettes','Buvette Sud Ouest','Sirop de citron','Softs / Eau / Sirops','C'),
  ('B7','Buvettes','Buvette Sud Ouest','Sirop de menthe','Softs / Eau / Sirops','C'),
  ('B7','Buvettes','Buvette Sud Ouest','CO2','Gaz / Technique','P'),
  -- ── B8 (Lillet + Tonic) ──
  ('B8','Buvettes','Buvette Virage Sud Ouest','Fût Bud','Bière / Fûts','S'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','Fût Leffe','Bière / Fûts','S'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','Fût Fada Blanche','Bière / Fûts','C'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','Fût Fada IPA','Bière / Fûts','C'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','Lillet Blanc','Vins','R'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','Lillet Rosé','Vins','C'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','Cristalline 50cl','Softs / Eau / Sirops','S'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','Ice Tea 50cl','Softs / Eau / Sirops','S'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','Orangina 50cl','Softs / Eau / Sirops','S'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','Pepsi 50cl','Softs / Eau / Sirops','S'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','San Pellegrino 50cl','Softs / Eau / Sirops','S'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','Sirop de pêche','Softs / Eau / Sirops','R'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','Sirop de grenadine','Softs / Eau / Sirops','P'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','Sirop de citron','Softs / Eau / Sirops','P'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','Sirop de menthe','Softs / Eau / Sirops','C'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','CO2','Gaz / Technique','C'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','Tonic','Autres','S'),
  -- ── B9 ──
  ('B9','Buvettes','Buvette Virage Ouest','Fût Bud','Bière / Fûts','S'),
  ('B9','Buvettes','Buvette Virage Ouest','Fût Goose Island IPA','Bière / Fûts','S'),
  ('B9','Buvettes','Buvette Virage Ouest','Fût Hoegaarden Blanche','Bière / Fûts','S'),
  ('B9','Buvettes','Buvette Virage Ouest','Fût Leffe','Bière / Fûts','S'),
  ('B9','Buvettes','Buvette Virage Ouest','Cristalline 50cl','Softs / Eau / Sirops','S'),
  ('B9','Buvettes','Buvette Virage Ouest','Ice Tea 50cl','Softs / Eau / Sirops','S'),
  ('B9','Buvettes','Buvette Virage Ouest','Pepsi 50cl','Softs / Eau / Sirops','S'),
  ('B9','Buvettes','Buvette Virage Ouest','Orangina 50cl','Softs / Eau / Sirops','R'),
  ('B9','Buvettes','Buvette Virage Ouest','San Pellegrino 50cl','Softs / Eau / Sirops','R'),
  ('B9','Buvettes','Buvette Virage Ouest','Sirop de grenadine','Softs / Eau / Sirops','R'),
  ('B9','Buvettes','Buvette Virage Ouest','Sirop de pêche','Softs / Eau / Sirops','R'),
  ('B9','Buvettes','Buvette Virage Ouest','Perrier grande bouteille','Softs / Eau / Sirops','P'),
  ('B9','Buvettes','Buvette Virage Ouest','Sirop de citron','Softs / Eau / Sirops','C'),
  ('B9','Buvettes','Buvette Virage Ouest','Sirop de menthe','Softs / Eau / Sirops','C'),
  ('B9','Buvettes','Buvette Virage Ouest','CO2','Gaz / Technique','P'),
  -- ── Garden Party ──
  ('Garden Party','Terrasses',NULL,'Fût Leffe','Bière / Fûts','R'),
  ('Garden Party','Terrasses',NULL,'Bière en verre','Bière / Fûts','C'),
  ('Garden Party','Terrasses',NULL,'Fût Bud','Bière / Fûts','C'),
  ('Garden Party','Terrasses',NULL,'Mumm Cordon Rouge','Champagne','C'),
  ('Garden Party','Terrasses',NULL,'Cristalline 50cl','Softs / Eau / Sirops','R'),
  ('Garden Party','Terrasses',NULL,'Jus de fruits','Softs / Eau / Sirops','R'),
  ('Garden Party','Terrasses',NULL,'Pepsi bouteille','Softs / Eau / Sirops','R'),
  ('Garden Party','Terrasses',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','R'),
  ('Garden Party','Terrasses',NULL,'Pepsi Max bouteille','Softs / Eau / Sirops','C'),
  ('Garden Party','Terrasses',NULL,'Sirop Orgeat','Softs / Eau / Sirops','C'),
  ('Garden Party','Terrasses',NULL,'Sirop de citron','Softs / Eau / Sirops','C'),
  ('Garden Party','Terrasses',NULL,'Sirop de grenadine','Softs / Eau / Sirops','C'),
  ('Garden Party','Terrasses',NULL,'Sirop de menthe','Softs / Eau / Sirops','C'),
  ('Garden Party','Terrasses',NULL,'Sirop de pêche','Softs / Eau / Sirops','C'),
  ('Garden Party','Terrasses',NULL,'Ricard classique VP','Spiritueux / Apéritifs','C'),
  ('Garden Party','Terrasses',NULL,'CO2','Gaz / Technique','R'),
  ('Garden Party','Terrasses',NULL,'Schweppes','Autres','C'),
  ('Garden Party','Terrasses',NULL,'Whisky Jameson','Autres','C'),
  -- ── Parvis Nord ──
  ('Parvis Nord','Terrasses',NULL,'Fût Bud','Bière / Fûts','R'),
  ('Parvis Nord','Terrasses',NULL,'Fût Leffe','Bière / Fûts','R'),
  ('Parvis Nord','Terrasses',NULL,'Fût Fada Abricot','Bière / Fûts','C'),
  ('Parvis Nord','Terrasses',NULL,'Fût Fada Blanche','Bière / Fûts','C'),
  ('Parvis Nord','Terrasses',NULL,'Fût Fada Blonde','Bière / Fûts','C'),
  ('Parvis Nord','Terrasses',NULL,'Fût Fada IPA','Bière / Fûts','C'),
  ('Parvis Nord','Terrasses',NULL,'Blanc Montaurone / Touloubre','Vins','C'),
  ('Parvis Nord','Terrasses',NULL,'Rosé Pey Blanc','Vins','C'),
  ('Parvis Nord','Terrasses',NULL,'Get Bodega','Spiritueux / Apéritifs','C'),
  ('Parvis Nord','Terrasses',NULL,'Ricard classique VP','Spiritueux / Apéritifs','C'),
  ('Parvis Nord','Terrasses',NULL,'CO2','Gaz / Technique','R'),
  -- ── Bistrot ──
  ('Bistrot','VIP',NULL,'Fût Bud','Bière / Fûts','S'),
  ('Bistrot','VIP',NULL,'Fût Leffe','Bière / Fûts','S'),
  ('Bistrot','VIP',NULL,'Bière en verre','Bière / Fûts','C'),
  ('Bistrot','VIP',NULL,'Fût Fada Blonde','Bière / Fûts','C'),
  ('Bistrot','VIP',NULL,'Mumm Cordon Rouge','Champagne','C'),
  ('Bistrot','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','S'),
  ('Bistrot','VIP',NULL,'Pepsi Max bouteille','Softs / Eau / Sirops','S'),
  ('Bistrot','VIP',NULL,'Pepsi bouteille','Softs / Eau / Sirops','S'),
  ('Bistrot','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','S'),
  ('Bistrot','VIP',NULL,'Sirop de grenadine','Softs / Eau / Sirops','S'),
  ('Bistrot','VIP',NULL,'Sirop de pêche','Softs / Eau / Sirops','S'),
  ('Bistrot','VIP',NULL,'Cristalline 50cl','Softs / Eau / Sirops','R'),
  ('Bistrot','VIP',NULL,'Sirop Orgeat','Softs / Eau / Sirops','R'),
  ('Bistrot','VIP',NULL,'Sirop de citron','Softs / Eau / Sirops','R'),
  ('Bistrot','VIP',NULL,'Sirop de menthe','Softs / Eau / Sirops','C'),
  ('Bistrot','VIP',NULL,'Ricard classique VP','Spiritueux / Apéritifs','S'),
  ('Bistrot','VIP',NULL,'CO2','Gaz / Technique','C'),
  ('Bistrot','VIP',NULL,'Corona','Autres','S'),
  ('Bistrot','VIP',NULL,'Corona 0° SS ALCOOL','Autres','S'),
  ('Bistrot','VIP',NULL,'Fada Abricot','Autres','S'),
  ('Bistrot','VIP',NULL,'Fada IPA','Autres','S'),
  ('Bistrot','VIP',NULL,'Schweppes','Autres','S'),
  ('Bistrot','VIP',NULL,'Whisky Jameson','Autres','S'),
  -- ── Club 70 Nord ──
  ('Club 70 Nord','VIP',NULL,'Fût Bud','Bière / Fûts','S'),
  ('Club 70 Nord','VIP',NULL,'Bière en verre','Bière / Fûts','C'),
  ('Club 70 Nord','VIP',NULL,'Fût Leffe','Bière / Fûts','C'),
  ('Club 70 Nord','VIP',NULL,'Mumm Cordon Rouge','Champagne','S'),
  ('Club 70 Nord','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','S'),
  ('Club 70 Nord','VIP',NULL,'Pepsi Max bouteille','Softs / Eau / Sirops','S'),
  ('Club 70 Nord','VIP',NULL,'Pepsi bouteille','Softs / Eau / Sirops','S'),
  ('Club 70 Nord','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','S'),
  ('Club 70 Nord','VIP',NULL,'Cristalline 50cl','Softs / Eau / Sirops','R'),
  ('Club 70 Nord','VIP',NULL,'Sirop Orgeat','Softs / Eau / Sirops','R'),
  ('Club 70 Nord','VIP',NULL,'Sirop de citron','Softs / Eau / Sirops','R'),
  ('Club 70 Nord','VIP',NULL,'Sirop de grenadine','Softs / Eau / Sirops','R'),
  ('Club 70 Nord','VIP',NULL,'Sirop de pêche','Softs / Eau / Sirops','R'),
  ('Club 70 Nord','VIP',NULL,'Sirop de menthe','Softs / Eau / Sirops','C'),
  ('Club 70 Nord','VIP',NULL,'Ricard classique VP','Spiritueux / Apéritifs','R'),
  ('Club 70 Nord','VIP',NULL,'CO2','Gaz / Technique','R'),
  ('Club 70 Nord','VIP',NULL,'Schweppes','Autres','C'),
  ('Club 70 Nord','VIP',NULL,'Whisky Jameson','Autres','C'),
  -- ── Comptoir ──
  ('Comptoir','VIP',NULL,'Fût Bud','Bière / Fûts','S'),
  ('Comptoir','VIP',NULL,'Bière en verre','Bière / Fûts','C'),
  ('Comptoir','VIP',NULL,'Fût Leffe','Bière / Fûts','C'),
  ('Comptoir','VIP',NULL,'Mumm Cordon Rouge','Champagne','C'),
  ('Comptoir','VIP',NULL,'Ricard classique VP','Spiritueux / Apéritifs','R'),
  ('Comptoir','VIP',NULL,'CO2','Gaz / Technique','P'),
  ('Comptoir','VIP',NULL,'Pastis','Autres','R'),
  ('Comptoir','VIP',NULL,'Schweppes','Autres','R'),
  ('Comptoir','VIP',NULL,'Whisky Jameson','Autres','R'),
  ('Comptoir','VIP',NULL,'San Pellegrino verre','Autres','C'),
  ('Comptoir','VIP',NULL,'Vittel verre','Autres','C'),
  -- ── Le Pub ──
  ('Le Pub','VIP',NULL,'Fût Bud','Bière / Fûts','S'),
  ('Le Pub','VIP',NULL,'Fût Leffe','Bière / Fûts','S'),
  ('Le Pub','VIP',NULL,'Bière en verre','Bière / Fûts','C'),
  ('Le Pub','VIP',NULL,'Mumm Cordon Rouge','Champagne','S'),
  ('Le Pub','VIP',NULL,'Cristalline 50cl','Softs / Eau / Sirops','S'),
  ('Le Pub','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','S'),
  ('Le Pub','VIP',NULL,'Pepsi Max bouteille','Softs / Eau / Sirops','S'),
  ('Le Pub','VIP',NULL,'Pepsi bouteille','Softs / Eau / Sirops','S'),
  ('Le Pub','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','S'),
  ('Le Pub','VIP',NULL,'Ricard classique VP','Spiritueux / Apéritifs','S'),
  ('Le Pub','VIP',NULL,'CO2','Gaz / Technique','R'),
  ('Le Pub','VIP',NULL,'Schweppes','Autres','S'),
  ('Le Pub','VIP',NULL,'Whisky Jameson','Autres','S'),
  -- ── Loges Est ──
  ('Loges Est','VIP',NULL,'Bière en verre','Bière / Fûts','S'),
  ('Loges Est','VIP',NULL,'Fût Bud','Bière / Fûts','C'),
  ('Loges Est','VIP',NULL,'Fût Leffe','Bière / Fûts','C'),
  ('Loges Est','VIP',NULL,'Mumm Cordon Rouge','Champagne','S'),
  ('Loges Est','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','S'),
  ('Loges Est','VIP',NULL,'Cristalline 50cl','Softs / Eau / Sirops','R'),
  ('Loges Est','VIP',NULL,'Pepsi bouteille','Softs / Eau / Sirops','R'),
  ('Loges Est','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','R'),
  ('Loges Est','VIP',NULL,'Pepsi Max bouteille','Softs / Eau / Sirops','C'),
  ('Loges Est','VIP',NULL,'Ricard classique VP','Spiritueux / Apéritifs','R'),
  ('Loges Est','VIP',NULL,'CO2','Gaz / Technique','C'),
  ('Loges Est','VIP',NULL,'Whisky Jameson','Autres','S'),
  ('Loges Est','VIP',NULL,'Schweppes','Autres','C'),
  -- ── Loges Ouest Nord ──
  ('Loges Ouest Nord','VIP',NULL,'Bière en verre','Bière / Fûts','S'),
  ('Loges Ouest Nord','VIP',NULL,'Fût Bud','Bière / Fûts','C'),
  ('Loges Ouest Nord','VIP',NULL,'Fût Leffe','Bière / Fûts','C'),
  ('Loges Ouest Nord','VIP',NULL,'Mumm Cordon Rouge','Champagne','S'),
  ('Loges Ouest Nord','VIP',NULL,'Cristalline 50cl','Softs / Eau / Sirops','S'),
  ('Loges Ouest Nord','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','S'),
  ('Loges Ouest Nord','VIP',NULL,'Pepsi bouteille','Softs / Eau / Sirops','S'),
  ('Loges Ouest Nord','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','S'),
  ('Loges Ouest Nord','VIP',NULL,'Ricard classique VP','Spiritueux / Apéritifs','R'),
  ('Loges Ouest Nord','VIP',NULL,'CO2','Gaz / Technique','C'),
  ('Loges Ouest Nord','VIP',NULL,'Whisky Jameson','Autres','R'),
  ('Loges Ouest Nord','VIP',NULL,'Schweppes','Autres','C'),
  -- ── Loges Ouest Sud ──
  ('Loges Ouest Sud','VIP',NULL,'Bière en verre','Bière / Fûts','R'),
  ('Loges Ouest Sud','VIP',NULL,'Fût Bud','Bière / Fûts','C'),
  ('Loges Ouest Sud','VIP',NULL,'Fût Leffe','Bière / Fûts','C'),
  ('Loges Ouest Sud','VIP',NULL,'Mumm Cordon Rouge','Champagne','R'),
  ('Loges Ouest Sud','VIP',NULL,'Cristalline 50cl','Softs / Eau / Sirops','R'),
  ('Loges Ouest Sud','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','R'),
  ('Loges Ouest Sud','VIP',NULL,'Pepsi bouteille','Softs / Eau / Sirops','R'),
  ('Loges Ouest Sud','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','R'),
  ('Loges Ouest Sud','VIP',NULL,'Ricard classique VP','Spiritueux / Apéritifs','R'),
  ('Loges Ouest Sud','VIP',NULL,'CO2','Gaz / Technique','C'),
  ('Loges Ouest Sud','VIP',NULL,'Whisky Jameson','Autres','R'),
  ('Loges Ouest Sud','VIP',NULL,'Schweppes','Autres','C'),
  -- ── PMR ──
  ('PMR','VIP',NULL,'Fût Fada Blonde','Bière / Fûts','S'),
  ('PMR','VIP',NULL,'Bière en verre','Bière / Fûts','R'),
  ('PMR','VIP',NULL,'Fût Bud','Bière / Fûts','C'),
  ('PMR','VIP',NULL,'Fût Leffe','Bière / Fûts','C'),
  ('PMR','VIP',NULL,'Mumm Cordon Rouge','Champagne','C'),
  ('PMR','VIP',NULL,'Cristalline 50cl','Softs / Eau / Sirops','S'),
  ('PMR','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','S'),
  ('PMR','VIP',NULL,'Pepsi bouteille','Softs / Eau / Sirops','S'),
  ('PMR','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','S'),
  ('PMR','VIP',NULL,'Ricard classique VP','Spiritueux / Apéritifs','C'),
  ('PMR','VIP',NULL,'CO2','Gaz / Technique','C'),
  ('PMR','VIP',NULL,'FADA ABRICOT BTL','Autres','S'),
  ('PMR','VIP',NULL,'FADA IPA BTL','Autres','C'),
  ('PMR','VIP',NULL,'Schweppes','Autres','C'),
  ('PMR','VIP',NULL,'Vin Autre','Autres','C'),
  ('PMR','VIP',NULL,'Whisky Jameson','Autres','C'),
  -- ── Salon Nord ──
  ('Salon Nord','VIP',NULL,'Fût Bud','Bière / Fûts','S'),
  ('Salon Nord','VIP',NULL,'Fût Leffe','Bière / Fûts','S'),
  ('Salon Nord','VIP',NULL,'Bière en verre','Bière / Fûts','C'),
  ('Salon Nord','VIP',NULL,'Mumm Blanc de Blanc','Champagne','S'),
  ('Salon Nord','VIP',NULL,'Mumm Cordon Rouge','Champagne','R'),
  ('Salon Nord','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','S'),
  ('Salon Nord','VIP',NULL,'Pepsi Max bouteille','Softs / Eau / Sirops','S'),
  ('Salon Nord','VIP',NULL,'Pepsi bouteille','Softs / Eau / Sirops','S'),
  ('Salon Nord','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','S'),
  ('Salon Nord','VIP',NULL,'Sirop de menthe','Softs / Eau / Sirops','R'),
  ('Salon Nord','VIP',NULL,'Sirop de pêche','Softs / Eau / Sirops','R'),
  ('Salon Nord','VIP',NULL,'Cristalline 50cl','Softs / Eau / Sirops','P'),
  ('Salon Nord','VIP',NULL,'Sirop de grenadine','Softs / Eau / Sirops','P'),
  ('Salon Nord','VIP',NULL,'Sirop Orgeat','Softs / Eau / Sirops','C'),
  ('Salon Nord','VIP',NULL,'Sirop de citron','Softs / Eau / Sirops','C'),
  ('Salon Nord','VIP',NULL,'Get Bodega','Spiritueux / Apéritifs','S'),
  ('Salon Nord','VIP',NULL,'Ricard classique VP','Spiritueux / Apéritifs','S'),
  ('Salon Nord','VIP',NULL,'CO2','Gaz / Technique','P'),
  ('Salon Nord','VIP',NULL,'Schweppes','Autres','S'),
  ('Salon Nord','VIP',NULL,'Vittel verre','Autres','S'),
  ('Salon Nord','VIP',NULL,'Whisky Jameson','Autres','S'),
  ('Salon Nord','VIP',NULL,'San Pellegrino verre','Autres','R'),
  -- ── Salon Sud ──
  ('Salon Sud','VIP',NULL,'Fût Bud','Bière / Fûts','S'),
  ('Salon Sud','VIP',NULL,'Fût Leffe','Bière / Fûts','S'),
  ('Salon Sud','VIP',NULL,'Bière en verre','Bière / Fûts','C'),
  ('Salon Sud','VIP',NULL,'Mumm Blanc de Blanc','Champagne','R'),
  ('Salon Sud','VIP',NULL,'Mumm Cordon Rouge','Champagne','R'),
  ('Salon Sud','VIP',NULL,'Blanc Galinière','Vins','S'),
  ('Salon Sud','VIP',NULL,'Blanc du Seuil','Vins','S'),
  ('Salon Sud','VIP',NULL,'Rosé Miraval','Vins','S'),
  ('Salon Sud','VIP',NULL,'Rouge Grand Boise','Vins','S'),
  ('Salon Sud','VIP',NULL,'Rouge Les Alexandrins','Vins','S'),
  ('Salon Sud','VIP',NULL,'FADA BLANCHE BTL','Vins','S'),
  ('Salon Sud','VIP',NULL,'Blanc Montaurone','Vins','R'),
  ('Salon Sud','VIP',NULL,'Lillet Blanc','Vins','R'),
  ('Salon Sud','VIP',NULL,'Lillet rosé','Vins','R'),
  ('Salon Sud','VIP',NULL,'Rosé Réal','Vins','R'),
  ('Salon Sud','VIP',NULL,'Rouge Paradis','Vins','R'),
  ('Salon Sud','VIP',NULL,'Rosé NAIS','Vins','R'),
  ('Salon Sud','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','S'),
  ('Salon Sud','VIP',NULL,'Pepsi Max bouteille','Softs / Eau / Sirops','S'),
  ('Salon Sud','VIP',NULL,'Pepsi bouteille','Softs / Eau / Sirops','S'),
  ('Salon Sud','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','R'),
  ('Salon Sud','VIP',NULL,'Sirop de citron','Softs / Eau / Sirops','R'),
  ('Salon Sud','VIP',NULL,'Cristalline 50cl','Softs / Eau / Sirops','P'),
  ('Salon Sud','VIP',NULL,'Get Bodega','Spiritueux / Apéritifs','S'),
  ('Salon Sud','VIP',NULL,'Ricard classique VP','Spiritueux / Apéritifs','R'),
  ('Salon Sud','VIP',NULL,'CO2','Gaz / Technique','C'),
  ('Salon Sud','VIP',NULL,'San Pellegrino verre','Autres','S'),
  ('Salon Sud','VIP',NULL,'Vittel verre','Autres','S'),
  ('Salon Sud','VIP',NULL,'Whisky Jameson','Autres','S'),
  ('Salon Sud','VIP',NULL,'Schweppes','Autres','R'),
  -- ── Wine Bar Nord ──
  ('Wine Bar Nord','VIP',NULL,'Bière en verre','Bière / Fûts','R'),
  ('Wine Bar Nord','VIP',NULL,'Fût Bud','Bière / Fûts','C'),
  ('Wine Bar Nord','VIP',NULL,'Fût Leffe','Bière / Fûts','C'),
  ('Wine Bar Nord','VIP',NULL,'Mumm Cordon Rouge','Champagne','C'),
  ('Wine Bar Nord','VIP',NULL,'Cristalline 50cl','Softs / Eau / Sirops','R'),
  ('Wine Bar Nord','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','R'),
  ('Wine Bar Nord','VIP',NULL,'Pepsi bouteille','Softs / Eau / Sirops','R'),
  ('Wine Bar Nord','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','R'),
  ('Wine Bar Nord','VIP',NULL,'Ricard classique VP','Spiritueux / Apéritifs','C'),
  ('Wine Bar Nord','VIP',NULL,'CO2','Gaz / Technique','C'),
  ('Wine Bar Nord','VIP',NULL,'Schweppes','Autres','C'),
  ('Wine Bar Nord','VIP',NULL,'Whisky Jameson','Autres','C'),
  -- ── Wine Bar Sud ──
  ('Wine Bar Sud','VIP',NULL,'Bière en verre','Bière / Fûts','R'),
  ('Wine Bar Sud','VIP',NULL,'Fût Bud','Bière / Fûts','C'),
  ('Wine Bar Sud','VIP',NULL,'Fût Leffe','Bière / Fûts','C'),
  ('Wine Bar Sud','VIP',NULL,'Mumm Cordon Rouge','Champagne','C'),
  ('Wine Bar Sud','VIP',NULL,'Cristalline 50cl','Softs / Eau / Sirops','R'),
  ('Wine Bar Sud','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','R'),
  ('Wine Bar Sud','VIP',NULL,'Pepsi bouteille','Softs / Eau / Sirops','R'),
  ('Wine Bar Sud','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','R'),
  ('Wine Bar Sud','VIP',NULL,'Pepsi Max bouteille','Softs / Eau / Sirops','P'),
  ('Wine Bar Sud','VIP',NULL,'Ricard classique VP','Spiritueux / Apéritifs','C'),
  ('Wine Bar Sud','VIP',NULL,'CO2','Gaz / Technique','C'),
  ('Wine Bar Sud','VIP',NULL,'Schweppes','Autres','C'),
  ('Wine Bar Sud','VIP',NULL,'Whisky Jameson','Autres','C');

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Lier les product_id du catalogue (correspondance nom, insensible casse).
  UPDATE area_product_reference apr
  SET product_id = p.product_id
  FROM products p
  WHERE UPPER(TRIM(p.product_name)) = UPPER(TRIM(apr.product_name))
    AND p.active = true;

  RETURN json_build_object('success', true, 'inserted', v_count,
    'message', format('%s associations espace×produit injectées depuis CDC V3', v_count));
END;
$$;

GRANT EXECUTE ON FUNCTION inject_cdc_v3() TO authenticated;
SELECT inject_cdc_v3();

-- ══════════════════════════════════════════════════════════════════════════
-- BLOC 4 — RPC FICHE RUNNER PAR ESPACE (niveaux S/R/P/C, sans coûts)
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION get_runner_sheet_by_area(
  p_area_name  TEXT,
  p_show_level TEXT DEFAULT 'S'  -- 'S' | 'SR' | 'SRP' | 'ALL'
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN json_build_object(
    'area',  p_area_name,
    'level', p_show_level,
    'families', (
      SELECT COALESCE(JSON_AGG(fam ORDER BY fam->>'family'), '[]'::json)
      FROM (
        SELECT JSON_BUILD_OBJECT(
          'family', apr.product_family,
          'products', JSON_AGG(JSON_BUILD_OBJECT(
            'product_name',      apr.product_name,
            'association_level', apr.association_level,
            'is_default',        apr.is_default,
            'product_id',        apr.product_id,
            'recommended_qty',   spc.recommended_qty,
            'avg_conso',         spc.avg_consumption
          ) ORDER BY apr.association_level, apr.product_name)
        ) AS fam
        FROM area_product_reference apr
        LEFT JOIN spaces s
          ON UPPER(TRIM(s.space_name)) = UPPER(TRIM(apr.area_name))
        LEFT JOIN space_product_coefficients spc
          ON spc.space_id = s.space_id AND spc.product_id = apr.product_id
        WHERE UPPER(TRIM(apr.area_name)) = UPPER(TRIM(p_area_name))
          AND CASE p_show_level
            WHEN 'S'   THEN apr.association_level IN ('S')
            WHEN 'SR'  THEN apr.association_level IN ('S','R')
            WHEN 'SRP' THEN apr.association_level IN ('S','R','P')
            ELSE TRUE
          END
        GROUP BY apr.product_family
      ) sub
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_runner_sheet_by_area(TEXT, TEXT) TO authenticated;
