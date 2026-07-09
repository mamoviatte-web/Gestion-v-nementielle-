-- ═══════════════════════════════════════════════════════════════════════════
-- product_space_mapping.sql — Mapping produits ↔ espaces FIN (par profil).
--
-- Remplace le mapping service_type (vip/bar/buvette/bodega) par des profils
-- fins : salon, loge, bar_pub, wine_bar, club, pmr, bodega, terrasse, buvette.
-- Motif : Salon et Loge sont tous deux service_type='vip' mais n'ont PAS la
-- même gamme (Loge = bière en verre, sans Lillet/GET/Mumm Blanc de Blanc…).
--
-- ⚠ Patterns corrigés d'après les NOMS RÉELS en base (le prompt visait des
--   libellés inexistants) :
--   • « Cristaline 50cl » (un seul L, ≠ 'Cristalline').
--   • FADA en bouteille = « FADA X Bouteille » (≠ 'FADA X BTL').
--   • Vins NAIS : « Rosé/Blanc/Rouge NAIS ».
--   • « San Pellegrino verre » est désactivé → seul « Vittel verre » reste.
--   • Un profil est dérivé du nom d'espace (fonction space_profile), il n'y a
--     pas de colonne dédiée.
--   • Garde-fou dans les RPC : un produit déjà doté/saisi reste visible.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE products ADD COLUMN IF NOT EXISTS space_types TEXT[] DEFAULT NULL;
UPDATE products SET space_types = NULL WHERE active = true;

-- ── 🍾 SALON (Salon Nord/Sud) — gamme premium complète ──────────────────────
UPDATE products SET space_types = array_append(COALESCE(space_types, '{}'), 'salon')
WHERE active AND product_name ILIKE ANY (ARRAY[
  '%Mumm Cordon Rouge%','%Mumm Blanc de Blanc%',
  '%Rosé Réal%','%Rosé Miraval%','%Rouge Les Alexandrins%','%Rouge Grand Boise%','%Rouge Gigondas%',
  '%Blanc du Seuil%','%Blanc Galiniere%','%Blanc Montaurone%',
  '%Fût BUD%','%Fût LEFFE%','CO2',
  '%Pepsi bouteille%','%Pepsi Max%','%Perrier grande%','%Schweppes%','%Jus de fruits%',
  '%Vittel verre%','%San Pellegrino verre%',
  '%Sirop%',
  '%Whisky Jameson%','%Lillet%','%Ricard%','%GET 27%'
]);

-- ── 🏆 LOGE (Loges Est/Ouest) — bière en verre star, sans Lillet/GET ─────────
UPDATE products SET space_types = array_append(COALESCE(space_types, '{}'), 'loge')
WHERE active AND product_name ILIKE ANY (ARRAY[
  '%Mumm Cordon Rouge%',
  '%Rosé Réal%','%Rosé Miraval%','%Rosé Pey Blanc%',
  '%Rouge Grand Boise%','%Rouge Les Alexandrins%','%Rouge Gigondas%',
  '%Blanc du Seuil%','%Blanc Montaurone%','%Blanc Galiniere%',
  '%Bière en verre%',
  '%Pepsi bouteille%','%Perrier grande%','%Jus de fruits%','%Cristaline%',
  '%Whisky Jameson%','%Ricard classique%'
]);

-- ── 🍺 BAR / PUB (Le Pub, Bistrot, Comptoir) — fûts FADA + Corona + Lillet ───
UPDATE products SET space_types = array_append(COALESCE(space_types, '{}'), 'bar_pub')
WHERE active AND product_name ILIKE ANY (ARRAY[
  '%Mumm Cordon Rouge%',
  '%Rosé Réal%','%Rosé Pey Blanc%','%Rosé Miraval%',
  '%Rouge Les Alexandrins%','%Rouge Grand Boise%','%Rouge Gigondas%',
  '%Blanc du Seuil%','%Blanc Montaurone%','%Blanc Galiniere%',
  '%Fût BUD%','%Fût LEFFE%','%Fût FADA%',
  '%Corona%','CO2',
  '%Pepsi bouteille%','%Pepsi Max%','%Perrier grande%','%Schweppes%','%Jus de fruits%','%Cristaline%',
  '%Sirop%',
  '%Whisky Jameson%','%Lillet%','%Ricard%'
]);

-- ── 🍷 WINE BAR (Wine bar Nord/Sud) — gamme vins (partagée Salon) ────────────
UPDATE products SET space_types = array_append(COALESCE(space_types, '{}'), 'wine_bar')
WHERE active AND product_name ILIKE ANY (ARRAY[
  '%Mumm Cordon Rouge%','%Mumm Blanc de Blanc%',
  '%Rosé Réal%','%Rosé Miraval%','%Rosé Pey Blanc%',
  '%Rouge Les Alexandrins%','%Rouge Grand Boise%','%Rouge Gigondas%',
  '%Blanc du Seuil%','%Blanc Galiniere%','%Blanc Montaurone%',
  '%Bière en verre%',
  '%Pepsi bouteille%','%Perrier grande%','%Jus de fruits%','%Cristaline%',
  '%Whisky Jameson%','%Lillet%'
]);

-- ── 🎵 CLUB 70 (Nord/Sud) — gamme courte, Fût BUD seul, sirops, softs 50cl ───
UPDATE products SET space_types = array_append(COALESCE(space_types, '{}'), 'club')
WHERE active AND product_name ILIKE ANY (ARRAY[
  '%Mumm Cordon Rouge%',
  '%Rosé Miraval%','%Rosé Pey Blanc%',
  '%Rouge Les Alexandrins%',
  '%Blanc du Seuil%','%Blanc Montaurone%',
  '%Fût BUD%','CO2',
  '%Pepsi bouteille%','%Pepsi Max%','%Perrier grande%','%Jus de fruits%',
  '%Pepsi 50%','%Orangina 50%','%Ice Tea 50%','%Cristaline 50%','%San Pellegrino 50%',
  '%Sirop%',
  '%Ricard classique%'
]);

-- ── ♿ PMR / TERRASSES — vins simples + FADA BOUTEILLE (spécifique) ──────────
UPDATE products SET space_types = array_append(COALESCE(space_types, '{}'), 'pmr')
WHERE active AND product_name ILIKE ANY (ARRAY[
  '%Rosé Miraval%',
  '%Rouge Grand Boise%','%Rouge Les Alexandrins%',
  '%Blanc Montaurone%','%Blanc du Seuil%','%Blanc Galiniere%',
  '%FADA Abricot Bouteille%','%FADA Blanche Bouteille%','%FADA Blonde Bouteille%','%FADA IPA Bouteille%',
  '%Bière en verre%',
  '%Pepsi bouteille%','%Perrier grande%','%Jus de fruits%','%Cristaline%'
]);

-- ── 🎭 BODEGA — vins NAIS + fûts FADA + 2 formats softs + GET ────────────────
UPDATE products SET space_types = array_append(COALESCE(space_types, '{}'), 'bodega')
WHERE active AND product_name ILIKE ANY (ARRAY[
  '%Mumm Cordon Rouge%',
  '%Rosé NAIS%','%Blanc NAIS%','%Rouge NAIS%','%Blanc Montaurone%',
  '%Fût FADA%',
  '%Pepsi bouteille%','%Perrier grande%','%Jus de fruits%',
  '%Pepsi 50%','%Orangina 50%','%Ice Tea 50%','%Cristaline 50%','%San Pellegrino 50%',
  '%GET%','%Ricard classique%',
  '%Sirop de pêche%','%Sirop de menthe%','%Sirop de grenadine%'
]);

-- ── 🌿 TERRASSE (Garden Party, Grandes Tablées, Tente Est) — minimaliste ────
UPDATE products SET space_types = array_append(COALESCE(space_types, '{}'), 'terrasse')
WHERE active AND product_name ILIKE ANY (ARRAY[
  '%Rosé Miraval%','%Rouge Les Alexandrins%','%Blanc Montaurone%',
  '%Fût BUD%','%Fût LEFFE%','%Fût FADA Blanche%','%Fût FADA IPA%',
  'CO2',
  '%Pepsi bouteille%','%Perrier grande%','%Jus de fruits%','%Cristaline%',
  '%Pepsi 50%','%Orangina 50%','%Ice Tea 50%'
]);

-- ── 🍺 BUVETTE (B1→B9) — gamme fermée : fûts + softs 50cl + sirops + CO2 ─────
UPDATE products SET space_types = array_append(COALESCE(space_types, '{}'), 'buvette')
WHERE active AND product_name ILIKE ANY (ARRAY[
  '%Fût BUD%','%Fût LEFFE%','%Hoegaarden%','%Goose Island%',
  'CO2',
  '%Pepsi 50%','%Orangina 50%','%Ice Tea 50%','%Cristaline 50%','%San Pellegrino 50%',
  '%Sirop de pêche%','%Sirop de menthe%','%Sirop de grenadine%','%Sirop de citron%'
]);

-- ── Profil d'un espace dérivé de son nom ────────────────────────────────────
CREATE OR REPLACE FUNCTION space_profile(p_name TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_name ILIKE 'Salon%'                                   THEN 'salon'
    WHEN p_name ILIKE 'Loge%'                                    THEN 'loge'
    WHEN p_name ILIKE 'Wine bar%' OR p_name ILIKE 'Wine Bar%'    THEN 'wine_bar'
    WHEN p_name ILIKE 'Club%'                                    THEN 'club'
    WHEN p_name ILIKE 'Bodega%'                                  THEN 'bodega'
    WHEN p_name ILIKE 'Le Pub%' OR p_name ILIKE 'Bistrot%' OR p_name ILIKE 'Comptoir%' THEN 'bar_pub'
    WHEN p_name ILIKE 'PMR%'                                     THEN 'pmr'
    WHEN p_name ILIKE 'Terrasse%' OR p_name ILIKE 'Garden%'
      OR p_name ILIKE 'Grandes Tabl%' OR p_name ILIKE 'Tente%'   THEN 'terrasse'
    WHEN p_name ~ '^B[0-9]+$' OR p_name ILIKE 'Buvette%'         THEN 'buvette'
    ELSE 'bar_pub'
  END;
$$;

-- ── RPC : filtre produits par profil d'espace ───────────────────────────────
CREATE OR REPLACE FUNCTION get_zone_stock(p_token text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_e UUID; v_s UUID; v_n TEXT; v_prof TEXT;
BEGIN
  SELECT * INTO v_e, v_s, v_n FROM _zone_resolve(p_token);
  IF v_e IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session expirée'); END IF;
  SELECT space_profile(space_name) INTO v_prof FROM spaces WHERE space_id = v_s;
  RETURN json_build_object(
    'success', true,
    'space_profile', v_prof,
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
          v_prof = ANY(p.space_types) OR p.space_types IS NULL OR p.space_types = '{}'
          OR esl.line_id IS NOT NULL OR rd.dotation_id IS NOT NULL
        )
    )
  );
END; $$;

CREATE OR REPLACE FUNCTION get_zone_buvette_stock(p_token text, p_target_space uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_event UUID; v_space UUID; v_prof TEXT;
BEGIN
  SELECT event_id, space_id INTO v_event, v_space
  FROM match_access_sessions WHERE session_token = p_token AND is_active = true;
  IF v_event IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session invalide'); END IF;
  IF NOT _buvette_member(v_space, p_target_space) THEN
    RETURN json_build_object('success', false, 'error', 'Buvette non autorisée');
  END IF;
  SELECT space_profile(space_name) INTO v_prof FROM spaces WHERE space_id = p_target_space;

  RETURN json_build_object(
    'success', true,
    'space_profile', v_prof,
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
          v_prof = ANY(p.space_types) OR p.space_types IS NULL OR p.space_types = '{}'
          OR esl.line_id IS NOT NULL OR rd.dotation_id IS NOT NULL
        )
    )
  );
END; $$;

GRANT EXECUTE ON FUNCTION space_profile(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_zone_stock(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_zone_buvette_stock(TEXT, UUID) TO anon, authenticated;
