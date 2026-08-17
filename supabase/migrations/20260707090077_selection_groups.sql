-- ═══════════════════════════════════════════════════════════════════════════
-- selection_groups.sql — CDC V5 #1 : ONE_ACTIVE_VARIANT_PER_SELECTION_GROUP.
--
-- Non-mélange des gammes : pour un (événement × espace × groupe de sélection),
-- un seul produit ACTIF (« principal ») si le groupe n'autorise pas le multiple.
-- Les autres produits du groupe restent proposés en ALTERNATIVE (priorité).
-- Ex. « Blanc Montaurone » (principal) vs « Blanc du Seuil » (alternative).
--
-- Réservé ROLE_STADE (RLS is_stade). Additif / idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) Groupes de sélection ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_selection_groups (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code           TEXT UNIQUE NOT NULL,
  label          TEXT NOT NULL,
  category       TEXT NOT NULL,
  allow_multiple BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ DEFAULT now()
);

INSERT INTO product_selection_groups (code, label, category) VALUES
  ('WINE_RED_SPACE_EVENT',       'Vin rouge',            'Vins'),
  ('WINE_WHITE_SPACE_EVENT',     'Vin blanc',            'Vins'),
  ('WINE_ROSE_SPACE_EVENT',      'Vin rosé',             'Vins'),
  ('CHAMPAGNE_SPACE_EVENT',      'Champagne',            'Vins'),
  ('BEER_DRAFT_SPACE_EVENT',     'Bière pression (fût)', 'Bières'),
  ('SOFT_COLA_SPACE_EVENT',      'Cola',                 'Soft'),
  ('WATER_FLAT_SPACE_EVENT',     'Eau plate',            'Soft'),
  ('WATER_SPARKLING_SPACE_EVENT','Eau gazeuse',          'Soft')
ON CONFLICT (code) DO NOTHING;

-- ── 2) Rattachement produit → groupe ─────────────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS selection_group_id UUID REFERENCES product_selection_groups(id);

DO $$
DECLARE
  g_red UUID; g_white UUID; g_rose UUID; g_champ UUID; g_beer UUID; g_cola UUID; g_flat UUID; g_spark UUID;
BEGIN
  SELECT id INTO g_red   FROM product_selection_groups WHERE code='WINE_RED_SPACE_EVENT';
  SELECT id INTO g_white FROM product_selection_groups WHERE code='WINE_WHITE_SPACE_EVENT';
  SELECT id INTO g_rose  FROM product_selection_groups WHERE code='WINE_ROSE_SPACE_EVENT';
  SELECT id INTO g_champ FROM product_selection_groups WHERE code='CHAMPAGNE_SPACE_EVENT';
  SELECT id INTO g_beer  FROM product_selection_groups WHERE code='BEER_DRAFT_SPACE_EVENT';
  SELECT id INTO g_cola  FROM product_selection_groups WHERE code='SOFT_COLA_SPACE_EVENT';
  SELECT id INTO g_flat  FROM product_selection_groups WHERE code='WATER_FLAT_SPACE_EVENT';
  SELECT id INTO g_spark FROM product_selection_groups WHERE code='WATER_SPARKLING_SPACE_EVENT';

  UPDATE products SET selection_group_id = g_champ WHERE category='Vins'   AND product_name ILIKE 'Mumm%';
  UPDATE products SET selection_group_id = g_red   WHERE category='Vins'   AND product_name ILIKE 'Rouge %';
  UPDATE products SET selection_group_id = g_white WHERE category='Vins'   AND product_name ILIKE 'Blanc %';
  UPDATE products SET selection_group_id = g_rose  WHERE category='Vins'   AND (product_name ILIKE 'Rosé %' OR product_name ILIKE 'Rose %');
  UPDATE products SET selection_group_id = g_beer  WHERE category='Bières' AND product_name ILIKE 'Fût %';
  UPDATE products SET selection_group_id = g_cola  WHERE category='Soft'   AND product_name ILIKE 'Pepsi%';
  UPDATE products SET selection_group_id = g_flat  WHERE category='Soft'   AND (product_name ILIKE 'Cristaline%' OR product_name ILIKE 'Vittel%');
  UPDATE products SET selection_group_id = g_spark WHERE category='Soft'   AND (product_name ILIKE 'San Pellegrino%' OR product_name ILIKE 'Perrier%');
END $$;

-- ── 3) Sélection active par événement × espace × groupe ──────────────────────
CREATE TABLE IF NOT EXISTS event_area_product_selection (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id           UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  space_id           UUID NOT NULL REFERENCES spaces(space_id),
  selection_group_id UUID NOT NULL REFERENCES product_selection_groups(id),
  product_id         UUID NOT NULL REFERENCES products(product_id),
  is_primary         BOOLEAN NOT NULL DEFAULT true,   -- principal (vs alternative)
  allow_multiple     BOOLEAN NOT NULL DEFAULT false,  -- copié du groupe (contrainte)
  priority           INT NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ DEFAULT now(),
  created_by         TEXT,
  UNIQUE (event_id, space_id, selection_group_id, product_id)
);
-- Un seul PRINCIPAL par (événement, espace, groupe) quand allow_multiple = false.
CREATE UNIQUE INDEX IF NOT EXISTS uq_eaps_one_primary
  ON event_area_product_selection (event_id, space_id, selection_group_id)
  WHERE is_primary AND NOT allow_multiple;

CREATE INDEX IF NOT EXISTS idx_eaps_event_space ON event_area_product_selection (event_id, space_id);

ALTER TABLE product_selection_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS psg_sel ON product_selection_groups;
DROP POLICY IF EXISTS psg_wr ON product_selection_groups;
CREATE POLICY psg_sel ON product_selection_groups FOR SELECT TO authenticated USING (true);
CREATE POLICY psg_wr  ON product_selection_groups FOR ALL TO authenticated USING (is_stade()) WITH CHECK (is_stade());

ALTER TABLE event_area_product_selection ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS eaps_sel ON event_area_product_selection;
DROP POLICY IF EXISTS eaps_wr ON event_area_product_selection;
CREATE POLICY eaps_sel ON event_area_product_selection FOR SELECT TO authenticated USING (true);
CREATE POLICY eaps_wr  ON event_area_product_selection FOR ALL TO authenticated USING (is_stade()) WITH CHECK (is_stade());

-- ── 4) RPC : définir le produit principal d'un groupe (démote les autres) ────
CREATE OR REPLACE FUNCTION set_event_area_selection(
  p_event UUID, p_space UUID, p_group UUID, p_product UUID, p_by TEXT
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_multi BOOLEAN; v_grp UUID;
BEGIN
  IF NOT is_stade() THEN RETURN json_build_object('success', false, 'error', 'Réservé équipe stade'); END IF;
  SELECT allow_multiple INTO v_multi FROM product_selection_groups WHERE id = p_group;
  IF v_multi IS NULL THEN RETURN json_build_object('success', false, 'error', 'Groupe inconnu'); END IF;
  SELECT selection_group_id INTO v_grp FROM products WHERE product_id = p_product AND active;
  IF v_grp IS NULL OR v_grp <> p_group THEN
    RETURN json_build_object('success', false, 'error', 'Ce produit n''appartient pas à ce groupe');
  END IF;

  -- Non multiple : les autres produits du groupe deviennent des alternatives.
  IF NOT v_multi THEN
    UPDATE event_area_product_selection
       SET is_primary = false
     WHERE event_id = p_event AND space_id = p_space AND selection_group_id = p_group AND product_id <> p_product;
  END IF;

  INSERT INTO event_area_product_selection (event_id, space_id, selection_group_id, product_id, is_primary, allow_multiple, created_by)
  VALUES (p_event, p_space, p_group, p_product, true, v_multi, p_by)
  ON CONFLICT (event_id, space_id, selection_group_id, product_id)
  DO UPDATE SET is_primary = true, allow_multiple = v_multi, created_by = p_by;

  RETURN json_build_object('success', true, 'primary_product_id', p_product);
END; $$;

-- ── 5) RPC : état des gammes d'un espace (principal + options) ────────────────
CREATE OR REPLACE FUNCTION get_event_area_selections(p_event UUID, p_space UUID)
RETURNS JSON LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(json_agg(json_build_object(
    'group_id', g.id, 'code', g.code, 'label', g.label, 'category', g.category, 'allow_multiple', g.allow_multiple,
    'primary_product_id', (
      SELECT s.product_id FROM event_area_product_selection s
      WHERE s.event_id = p_event AND s.space_id = p_space AND s.selection_group_id = g.id AND s.is_primary
      LIMIT 1),
    'options', (
      SELECT COALESCE(json_agg(json_build_object(
        'product_id', p.product_id, 'product_name', p.product_name,
        'is_primary', EXISTS (SELECT 1 FROM event_area_product_selection s
                              WHERE s.event_id = p_event AND s.space_id = p_space AND s.selection_group_id = g.id
                                AND s.product_id = p.product_id AND s.is_primary)
      ) ORDER BY p.product_name), '[]'::json)
      FROM products p WHERE p.selection_group_id = g.id AND p.active)
  ) ORDER BY g.category, g.label), '[]'::json)
  FROM product_selection_groups g
  WHERE EXISTS (SELECT 1 FROM products p WHERE p.selection_group_id = g.id AND p.active);
$$;

GRANT EXECUTE ON FUNCTION set_event_area_selection(UUID, UUID, UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_event_area_selections(UUID, UUID) TO authenticated;
