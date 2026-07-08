-- ═══════════════════════════════════════════════════════════════════════════
-- product_space_filter.sql — Filtrage des produits par type d'espace.
--
-- Source : analyse des 3 fichiers Excel (ANGOULEME, BARRAGE, COLOMIERS).
--   • Buvettes  : fûts pression + softs 50cl + sirops + CO2 (jamais vin/spirit.)
--   • VIP/Bars  : champagnes + vins + bière en verre + softs grand format + spirit.
--   • Bodega    : mix (vins NAIS + fûts FADA + softs 50cl + GET) → superset.
--
-- ⚠ Adaptations au schéma réel (le SQL du prompt suppose des objets absents) :
--   • Pas de table buvette_zones ni de colonne event_stock_lines.buvette_zone_id.
--   • Pas de RPC get_zone_products : le filtre est appliqué dans les RPC réelles
--     get_zone_stock (VIP/bar) et get_zone_buvette_stock (buvettes B1…B9).
--   • spaces.service_type existe déjà (bar/buvette/vip) et est peuplé. On ajoute
--     'bodega' pour l'espace Bodega (mix spécifique).
--   • La saisie séminaire (admin/responsable) est pilotée par runner_dotations
--     (produits planifiés uniquement) → déjà filtrée en amont, pas de catalogue
--     complet à restreindre là.
--   • Garde-fou : un produit déjà doté (runner_dotations) ou déjà saisi
--     (event_stock_lines) reste TOUJOURS visible, même hors de son type d'espace
--     (indispensable pour la clôture).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── BLOC 2 : colonne space_types ────────────────────────────────────────────
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS space_types TEXT[] DEFAULT ARRAY['vip','bar','buvette','bodega'];

CREATE INDEX IF NOT EXISTS idx_products_space_types ON products USING GIN(space_types);

-- Rétro-remplissage des lignes existantes restées NULL (sécurité).
UPDATE products SET space_types = ARRAY['vip','bar','buvette','bodega']
WHERE space_types IS NULL;

-- ── BLOC 3 : mapping produits → types d'espace (basé sur les noms réels) ─────
-- Vins & champagnes (bouteilles) : jamais en buvette.
UPDATE products SET space_types = ARRAY['vip','bar','bodega']
WHERE active AND category = 'Vins';

-- Spiritueux (whisky, lillet, ricard, get) : jamais en buvette.
UPDATE products SET space_types = ARRAY['vip','bar','bodega']
WHERE active AND category = 'Spiritueux';

-- Bière en verre : VIP / bars / bodega (pas buvette — pression uniquement).
UPDATE products SET space_types = ARRAY['vip','bar','bodega']
WHERE active AND product_name ILIKE '%Bière en verre%';

-- Bières bouteille (FADA bouteille, Corona) : pas buvette.
UPDATE products SET space_types = ARRAY['vip','bar','bodega']
WHERE active AND category = 'Bières'
  AND (product_name ILIKE '%Bouteille%' OR product_name ILIKE '%Corona%');

-- Softs 50cl aromatisés (format buvette) : buvette + bodega uniquement.
UPDATE products SET space_types = ARRAY['buvette','bodega']
WHERE active AND (
     product_name ILIKE '%Pepsi 50%'
  OR product_name ILIKE '%Orangina 50%'
  OR product_name ILIKE '%Ice Tea 50%'
  OR product_name ILIKE '%San Pellegrino 50%'
);

-- Softs grand format (bouteille VIP) : VIP / bars / bodega (pas buvette).
UPDATE products SET space_types = ARRAY['vip','bar','bodega']
WHERE active AND (
     product_name ILIKE '%Pepsi bouteille%'
  OR product_name ILIKE '%Pepsi Max%'
  OR product_name ILIKE '%Perrier grande%'
  OR product_name ILIKE '%Schweppes%'
  OR product_name ILIKE '%Jus de fruits%'
  OR product_name ILIKE '%Vittel%'
);

-- Fûts pression + CO2 + Sirops + Cristaline 50cl (eau) : partout → défaut conservé.

-- ── BLOC 6 : service_type Bodega (mix festif distinct) ──────────────────────
-- Étendre la contrainte CHECK pour autoriser 'bodega'.
ALTER TABLE spaces DROP CONSTRAINT IF EXISTS spaces_service_type_check;
ALTER TABLE spaces ADD CONSTRAINT spaces_service_type_check
  CHECK (service_type = ANY (ARRAY['vip','bar','buvette','bodega']));

UPDATE spaces SET service_type = 'bodega' WHERE space_name = 'Bodega';

-- ── BLOC 1 : nettoyage « Buvette Virage Toinou » du groupe superviseur ──────
UPDATE buvette_group_members SET is_active = false
WHERE space_id = (SELECT space_id FROM spaces WHERE space_name = 'Buvette Virage Toinou');

-- validate_match_code : nb_buvettes / buvette_codes restreints aux buvettes
-- physiques B1…B9 (^B[0-9]+$) → « Buvette Virage Toinou » disparaît des puces.
CREATE OR REPLACE FUNCTION validate_match_code(p_code text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_event events%ROWTYPE;
BEGIN
  SELECT * INTO v_event FROM events
   WHERE UPPER(match_access_code) = UPPER(TRIM(p_code))
     AND event_type = 'match' AND status IN ('préparé','en_cours','brouillon')
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Code invalide ou match non actif');
  END IF;
  RETURN json_build_object(
    'success', true, 'event_id', v_event.event_id, 'event_name', v_event.event_name,
    'event_date', v_event.event_date, 'start_time', v_event.start_time, 'status', v_event.status,
    'spaces', (
      SELECT COALESCE(json_agg(json_build_object(
        'space_id', s.space_id,
        'space_name', s.space_name,
        'space_type', s.space_type,
        'service_type', s.service_type,
        'max_pax', s.max_pax,
        'group_name', NULL,
        'nb_buvettes', (
          SELECT COUNT(*) FROM buvette_groups bg
          JOIN buvette_group_members m ON m.group_id = bg.id AND m.is_active
          JOIN spaces ms ON ms.space_id = m.space_id AND ms.active
          WHERE bg.group_name = s.space_name AND bg.is_active
            AND ms.space_name ~ '^B[0-9]+$'),
        'buvette_codes', (
          SELECT COALESCE(json_agg(ms.space_name ORDER BY ms.space_name), '[]'::json)
          FROM buvette_groups bg
          JOIN buvette_group_members m ON m.group_id = bg.id AND m.is_active
          JOIN spaces ms ON ms.space_id = m.space_id AND ms.active
          WHERE bg.group_name = s.space_name AND bg.is_active
            AND ms.space_name ~ '^B[0-9]+$')
      ) ORDER BY s.space_type, s.space_name), '[]'::json)
      FROM event_spaces es
      JOIN spaces s ON s.space_id = es.space_id
      WHERE es.event_id = v_event.event_id
        AND s.active = true
        AND COALESCE(es.service_mode, 'auto') <> 'fermé'
        AND s.space_name !~ '^B[0-9]+$'
        AND s.space_name NOT ILIKE 'Buvette Virage%'
    )
  );
END; $$;

-- ── BLOC 4 : filtre produits par type d'espace dans les RPC zone ────────────
-- get_zone_stock (espace VIP / bar / bodega du responsable).
CREATE OR REPLACE FUNCTION get_zone_stock(p_token text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_e UUID; v_s UUID; v_n TEXT; v_st TEXT;
BEGIN
  SELECT * INTO v_e, v_s, v_n FROM _zone_resolve(p_token);
  IF v_e IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session expirée'); END IF;
  SELECT COALESCE(service_type, 'bar') INTO v_st FROM spaces WHERE space_id = v_s;
  RETURN json_build_object(
    'success', true,
    'space_type', v_st,
    'lines', (
      SELECT COALESCE(json_agg(json_build_object(
        'product_id', p.product_id, 'product_name', p.product_name,
        'category', p.category, 'unit', p.unit,
        'planned_qty', COALESCE(rd.planned_qty, 0),
        'initial_qty', COALESCE(esl.initial_qty, 0),
        'reassort_qty', COALESCE(esl.reassort_qty, 0),
        'final_qty', esl.final_qty, 'product_state', esl.product_state
      ) ORDER BY p.category, p.product_name), '[]'::json)
      FROM products p
      LEFT JOIN runner_dotations rd ON rd.event_id = v_e AND rd.space_id = v_s AND rd.product_id = p.product_id
      LEFT JOIN event_stock_lines esl ON esl.event_id = v_e AND esl.space_id = v_s AND esl.product_id = p.product_id
      WHERE p.active = true AND p.category <> 'Matériel'
        AND (
          v_st = ANY(p.space_types) OR p.space_types IS NULL OR p.space_types = '{}'
          OR esl.line_id IS NOT NULL OR rd.dotation_id IS NOT NULL
        )
    )
  );
END; $$;

-- get_zone_buvette_stock (buvette physique B1…B9 → produits buvette).
CREATE OR REPLACE FUNCTION get_zone_buvette_stock(p_token text, p_target_space uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_event UUID; v_space UUID; v_st TEXT;
BEGIN
  SELECT event_id, space_id INTO v_event, v_space
  FROM match_access_sessions WHERE session_token = p_token AND is_active = true;
  IF v_event IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session invalide'); END IF;
  IF NOT _buvette_member(v_space, p_target_space) THEN
    RETURN json_build_object('success', false, 'error', 'Buvette non autorisée');
  END IF;
  SELECT COALESCE(service_type, 'buvette') INTO v_st FROM spaces WHERE space_id = p_target_space;

  RETURN json_build_object(
    'success', true,
    'space_type', v_st,
    'lines', (
      SELECT COALESCE(json_agg(json_build_object(
        'product_id', p.product_id, 'product_name', p.product_name,
        'category', p.category, 'unit', p.unit,
        'planned_qty', COALESCE(rd.planned_qty, 0),
        'initial_qty', COALESCE(esl.initial_qty, 0),
        'reassort_qty', COALESCE(esl.reassort_qty, 0),
        'final_qty', esl.final_qty, 'product_state', esl.product_state
      ) ORDER BY p.category, p.product_name), '[]'::json)
      FROM products p
      LEFT JOIN runner_dotations rd ON rd.event_id = v_event AND rd.space_id = p_target_space AND rd.product_id = p.product_id
      LEFT JOIN event_stock_lines esl ON esl.event_id = v_event AND esl.space_id = p_target_space AND esl.product_id = p.product_id
      WHERE p.active = true AND p.category <> 'Matériel'
        AND (
          v_st = ANY(p.space_types) OR p.space_types IS NULL OR p.space_types = '{}'
          OR esl.line_id IS NOT NULL OR rd.dotation_id IS NOT NULL
        )
    )
  );
END; $$;

GRANT EXECUTE ON FUNCTION validate_match_code(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_zone_stock(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_zone_buvette_stock(TEXT, UUID) TO anon, authenticated;
