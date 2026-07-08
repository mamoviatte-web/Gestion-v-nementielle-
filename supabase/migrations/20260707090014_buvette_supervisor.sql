-- ═══════════════════════════════════════════════════════════════════════════
-- buvette_supervisor.sql — Accès superviseur buvettes (Buvette 1 / Buvette 2).
--
-- ⚠ Approche ADDITIVE & non destructive (adaptée au schéma réel) :
--   • Les buvettes physiques (B1…B9, Toinou) SONT déjà des espaces, déjà
--     regroupés sous Buvette 1 / Buvette 2 via buvette_groups/buvette_group_members.
--   • On NE touche PAS à validate_match_code (les 27 espaces d'un match restent
--     accessibles — aucun responsable VIP/bar/buvette ne perd l'accès).
--   • On NE change PAS la contrainte unique de event_stock_lines
--     (event_id, space_id, product_id) : chaque buvette écrit sur SON space_id
--     existant. Pas de colonne buvette_zone_id, pas de table redondante.
--
-- Le superviseur se connecte sur l'espace « Buvette 1 » (ou 2), puis navigue
-- entre ses buvettes membres et saisit stock/RH pour chacune (sur leur space).
-- ═══════════════════════════════════════════════════════════════════════════

-- Vérifie que p_target_space est bien une buvette membre du groupe du superviseur
-- connecté (space de session = nom de groupe buvette_groups).
CREATE OR REPLACE FUNCTION _buvette_member(p_session_space UUID, p_target_space UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM spaces sup
    JOIN buvette_groups bg ON bg.group_name = sup.space_name AND bg.is_active
    JOIN buvette_group_members m ON m.group_id = bg.id AND m.is_active
    WHERE sup.space_id = p_session_space AND m.space_id = p_target_space
  );
$$;

-- ── Liste des buvettes du superviseur + avancement ──────────────────────────
CREATE OR REPLACE FUNCTION get_zone_buvettes(p_token TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event UUID; v_space UUID; v_name TEXT;
BEGIN
  SELECT event_id, space_id INTO v_event, v_space
  FROM match_access_sessions WHERE session_token = p_token AND is_active = true;
  IF v_event IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session invalide'); END IF;
  SELECT space_name INTO v_name FROM spaces WHERE space_id = v_space;

  RETURN json_build_object(
    'success', true,
    'supervisor', v_name,
    'buvettes', (
      SELECT COALESCE(json_agg(json_build_object(
        'space_id', ms.space_id,
        'code', ms.space_name,
        'label', ms.space_name,
        'location', COALESCE(ms.space_name, ''),
        'has_initial', EXISTS (SELECT 1 FROM event_stock_lines esl
          WHERE esl.event_id = v_event AND esl.space_id = ms.space_id AND esl.initial_qty > 0),
        'has_final', EXISTS (SELECT 1 FROM event_stock_lines esl
          WHERE esl.event_id = v_event AND esl.space_id = ms.space_id AND esl.final_qty IS NOT NULL)
      ) ORDER BY ms.space_name), '[]'::json)
      FROM buvette_groups bg
      JOIN buvette_group_members m ON m.group_id = bg.id AND m.is_active
      JOIN spaces ms ON ms.space_id = m.space_id AND ms.active
      WHERE bg.group_name = v_name AND bg.is_active
    )
  );
END; $$;

-- ── Produits d'une buvette membre (mêmes valeurs que get_zone_stock) ────────
CREATE OR REPLACE FUNCTION get_zone_buvette_stock(p_token TEXT, p_target_space UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event UUID; v_space UUID;
BEGIN
  SELECT event_id, space_id INTO v_event, v_space
  FROM match_access_sessions WHERE session_token = p_token AND is_active = true;
  IF v_event IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session invalide'); END IF;
  IF NOT _buvette_member(v_space, p_target_space) THEN
    RETURN json_build_object('success', false, 'error', 'Buvette non autorisée');
  END IF;

  RETURN json_build_object(
    'success', true,
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
    )
  );
END; $$;

-- ── Enregistrer le stock d'une buvette membre (space existant) ──────────────
-- Écrit sur event_stock_lines(event_id, target_space, product_id) : contrainte
-- unique EXISTANTE, aucun changement de schéma. RG-002 assuré par les triggers.
CREATE OR REPLACE FUNCTION save_zone_buvette_stock(
  p_token TEXT, p_step TEXT, p_responsable TEXT, p_lines JSONB, p_target_space UUID
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event UUID; v_space UUID; rec JSONB; v_name TEXT;
BEGIN
  SELECT event_id, space_id INTO v_event, v_space
  FROM match_access_sessions WHERE session_token = p_token AND is_active = true;
  IF v_event IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session invalide'); END IF;
  IF NOT _buvette_member(v_space, p_target_space) THEN
    RETURN json_build_object('success', false, 'error', 'Buvette non autorisée');
  END IF;
  v_name := UPPER(TRIM(p_responsable));
  IF length(v_name) < 2 THEN RETURN json_build_object('success', false, 'error', 'Nom requis (RG-001)'); END IF;

  FOR rec IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO event_stock_lines (event_id, space_id, product_id, initial_qty, reassort_qty, final_qty, product_state, responsable_nom, submitted_at)
    VALUES (v_event, p_target_space, (rec->>'product_id')::uuid,
      COALESCE((rec->>'initial_qty')::int, 0), COALESCE((rec->>'reassort_qty')::int, 0),
      CASE WHEN p_step = 'cloture' THEN (rec->>'final_qty')::int END,
      CASE WHEN p_step = 'cloture' THEN 'fermé' END,
      v_name, CASE WHEN p_step = 'cloture' THEN now() END)
    ON CONFLICT (event_id, space_id, product_id) DO UPDATE SET
      initial_qty  = CASE WHEN p_step = 'ouverture' THEN EXCLUDED.initial_qty ELSE event_stock_lines.initial_qty END,
      reassort_qty = CASE WHEN p_step = 'reassort'  THEN EXCLUDED.reassort_qty ELSE event_stock_lines.reassort_qty END,
      final_qty    = CASE WHEN p_step = 'cloture'   THEN EXCLUDED.final_qty ELSE event_stock_lines.final_qty END,
      product_state = CASE WHEN p_step = 'cloture'  THEN 'fermé' ELSE event_stock_lines.product_state END,
      responsable_nom = v_name,
      submitted_at = CASE WHEN p_step = 'cloture' THEN now() ELSE event_stock_lines.submitted_at END;
  END LOOP;
  RETURN json_build_object('success', true);
END; $$;

GRANT EXECUTE ON FUNCTION get_zone_buvettes(TEXT), get_zone_buvette_stock(TEXT, UUID),
  save_zone_buvette_stock(TEXT, TEXT, TEXT, JSONB, UUID) TO anon, authenticated;

-- ── Vue admin : avancement de chaque buvette membre ─────────────────────────
CREATE OR REPLACE VIEW match_buvettes_live
WITH (security_invoker = true) AS
SELECT
  e.event_id,
  e.event_name,
  bg.group_name        AS superviseur,
  ms.space_id,
  ms.space_name        AS code,
  COALESCE(BOOL_OR(esl.initial_qty > 0), false)        AS has_initial,
  COALESCE(BOOL_OR(esl.final_qty IS NOT NULL), false)  AS has_final,
  COUNT(DISTINCT esl.line_id) FILTER (WHERE esl.initial_qty > 0) AS produits_saisis,
  COALESCE(SUM(esl.initial_qty + COALESCE(esl.reassort_qty, 0) - COALESCE(esl.final_qty, 0)), 0) AS total_conso_estimee,
  MAX(esl.responsable_nom) AS responsable_nom,
  MAX(esl.submitted_at)    AS derniere_saisie
FROM events e
JOIN buvette_groups bg ON bg.is_active
JOIN buvette_group_members m ON m.group_id = bg.id AND m.is_active
JOIN spaces ms ON ms.space_id = m.space_id AND ms.active
LEFT JOIN event_stock_lines esl ON esl.event_id = e.event_id AND esl.space_id = ms.space_id
WHERE e.event_type = 'match'
GROUP BY e.event_id, e.event_name, bg.group_name, ms.space_id, ms.space_name
ORDER BY e.event_date DESC, bg.group_name, ms.space_name;

GRANT SELECT ON match_buvettes_live TO authenticated;
