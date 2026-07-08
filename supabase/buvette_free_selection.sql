-- ═══════════════════════════════════════════════════════════════════════════
-- buvette_free_selection.sql — Sélection libre des buvettes par le superviseur.
--
-- Chaque superviseur (Buvette 1/2) choisit librement, pour SA session, les
-- buvettes physiques B1…B9 qu'il gère ce soir (plus d'assignation figée).
--
-- ⚠ Adaptations au schéma réel :
--   • Le « pool » de buvettes = les espaces actifs nommés B1…B9 (space_type
--     Buvette). « Buvette Virage Toinou » n'y est PAS → il disparaît de la
--     liste sans qu'on désactive quoi que ce soit.
--   • On NE désactive PAS les espaces B1…B9 (le prompt le proposait) : le flux
--     stock superviseur écrit justement sur ces espaces.
--   • Pas de table buvette_zones (inexistante) : la sélection référence le
--     space_id de la buvette.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS supervisor_buvette_selection (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID NOT NULL REFERENCES match_access_sessions(id) ON DELETE CASCADE,
  event_id         UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  space_id         UUID NOT NULL REFERENCES spaces(space_id),   -- espace superviseur (Buvette 1/2)
  buvette_code     TEXT NOT NULL,                                -- 'B1'…'B9'
  buvette_space_id UUID NOT NULL REFERENCES spaces(space_id),    -- espace de la buvette choisie
  selected_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (session_id, buvette_code)
);

CREATE INDEX IF NOT EXISTS idx_sbs_session ON supervisor_buvette_selection(session_id);
CREATE INDEX IF NOT EXISTS idx_sbs_event_space ON supervisor_buvette_selection(event_id, space_id);

ALTER TABLE supervisor_buvette_selection ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sbs_read ON supervisor_buvette_selection;
DROP POLICY IF EXISTS sbs_stade ON supervisor_buvette_selection;
CREATE POLICY sbs_read ON supervisor_buvette_selection FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY sbs_stade ON supervisor_buvette_selection FOR ALL TO authenticated USING (is_stade()) WITH CHECK (is_stade());

-- Autorisation : le superviseur (Buvette 1/2) peut gérer n'importe quelle
-- buvette du pool B1…B9 (sélection libre).
CREATE OR REPLACE FUNCTION _buvette_member(p_session_space UUID, p_target_space UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM spaces sup, spaces tgt
    WHERE sup.space_id = p_session_space AND sup.space_name IN ('Buvette 1', 'Buvette 2')
      AND tgt.space_id = p_target_space AND tgt.active
      AND tgt.space_type = 'Buvette' AND tgt.space_name ~ '^B[0-9]+$'
  );
$$;

-- ── get_zone_buvettes : pool B1…B9 + état de sélection de la session ─────────
CREATE OR REPLACE FUNCTION get_zone_buvettes(p_token TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sess UUID; v_e UUID; v_s UUID; v_name TEXT;
BEGIN
  SELECT id, event_id, space_id INTO v_sess, v_e, v_s
  FROM match_access_sessions WHERE session_token = p_token AND is_active = true;
  IF v_e IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session invalide'); END IF;
  SELECT space_name INTO v_name FROM spaces WHERE space_id = v_s;

  -- Seuls les superviseurs Buvette 1/2 ont un pool de buvettes.
  IF v_name NOT IN ('Buvette 1', 'Buvette 2') THEN
    RETURN json_build_object('success', true, 'supervisor', v_name,
      'all_buvettes', '[]'::json, 'selected_buvettes', '[]'::json, 'selection_done', false);
  END IF;

  RETURN json_build_object(
    'success', true,
    'supervisor', v_name,
    'all_buvettes', (
      SELECT COALESCE(json_agg(json_build_object(
        'space_id', b.space_id,
        'code', b.space_name,
        'label', 'Buvette ' || b.space_name,
        'selected', EXISTS (SELECT 1 FROM supervisor_buvette_selection sbs
                            WHERE sbs.session_id = v_sess AND sbs.buvette_space_id = b.space_id),
        'has_initial', EXISTS (SELECT 1 FROM event_stock_lines esl
                               WHERE esl.event_id = v_e AND esl.space_id = b.space_id AND esl.initial_qty > 0),
        'has_final', EXISTS (SELECT 1 FROM event_stock_lines esl
                             WHERE esl.event_id = v_e AND esl.space_id = b.space_id AND esl.final_qty IS NOT NULL)
      ) ORDER BY b.space_name), '[]'::json)
      FROM spaces b
      WHERE b.active AND b.space_type = 'Buvette' AND b.space_name ~ '^B[0-9]+$'
    ),
    'selected_buvettes', (
      SELECT COALESCE(json_agg(sbs.buvette_code ORDER BY sbs.buvette_code), '[]'::json)
      FROM supervisor_buvette_selection sbs WHERE sbs.session_id = v_sess),
    'selection_done', EXISTS (SELECT 1 FROM supervisor_buvette_selection WHERE session_id = v_sess)
  );
END; $$;

-- ── save_buvette_selection : enregistre les buvettes choisies ───────────────
CREATE OR REPLACE FUNCTION save_buvette_selection(p_token TEXT, p_buvette_codes TEXT[])
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sess UUID; v_e UUID; v_s UUID; v_code TEXT; v_bsp UUID; v_n INT := 0;
BEGIN
  SELECT id, event_id, space_id INTO v_sess, v_e, v_s
  FROM match_access_sessions WHERE session_token = p_token AND is_active = true;
  IF v_e IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session invalide'); END IF;
  IF p_buvette_codes IS NULL OR array_length(p_buvette_codes, 1) IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Sélectionnez au moins une buvette');
  END IF;

  DELETE FROM supervisor_buvette_selection WHERE session_id = v_sess;
  FOREACH v_code IN ARRAY p_buvette_codes LOOP
    SELECT space_id INTO v_bsp FROM spaces
     WHERE space_name = UPPER(TRIM(v_code)) AND active AND space_type = 'Buvette' AND space_name ~ '^B[0-9]+$';
    IF v_bsp IS NOT NULL THEN
      INSERT INTO supervisor_buvette_selection (session_id, event_id, space_id, buvette_code, buvette_space_id)
      VALUES (v_sess, v_e, v_s, UPPER(TRIM(v_code)), v_bsp)
      ON CONFLICT (session_id, buvette_code) DO NOTHING;
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN json_build_object('success', true, 'selected_count', v_n);
END; $$;

GRANT EXECUTE ON FUNCTION get_zone_buvettes(TEXT), save_buvette_selection(TEXT, TEXT[]) TO anon, authenticated;
