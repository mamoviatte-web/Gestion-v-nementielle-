-- ═══════════════════════════════════════════════════════════════════════════
-- zone_rpcs.sql — RPC SECURITY DEFINER pour l'accès responsable par TOKEN match.
-- Le responsable arrive par /zone/match/:token (anon, sans login) → RLS bloque
-- les tables. Ces fonctions valident le token (match_access_sessions) puis
-- lisent/écrivent côté serveur. Prérequis : match_access.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- Helper interne : token → (event_id, space_id, staff_name).
CREATE OR REPLACE FUNCTION _zone_resolve(p_token TEXT, OUT v_event UUID, OUT v_space UUID, OUT v_staff TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT event_id, space_id, staff_name FROM match_access_sessions
   WHERE session_token = p_token AND is_active = true LIMIT 1;
$$;

-- ── Feuille de route : dotations + équipe prévue ────────────────────────────
CREATE OR REPLACE FUNCTION get_zone_roadmap(p_token TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_e UUID; v_s UUID; v_n TEXT;
BEGIN
  SELECT * INTO v_e, v_s, v_n FROM _zone_resolve(p_token);
  IF v_e IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session expirée'); END IF;
  RETURN json_build_object(
    'success', true,
    'dotations', (
      SELECT COALESCE(json_agg(json_build_object(
        'product_name', p.product_name, 'category', p.category, 'unit', p.unit,
        'planned_qty', rd.planned_qty, 'runner_status', rd.runner_status
      ) ORDER BY p.category, p.product_name), '[]'::json)
      FROM runner_dotations rd JOIN products p ON p.product_id = rd.product_id
      WHERE rd.event_id = v_e AND rd.space_id = v_s),
    'schedules', (
      SELECT COALESCE(json_agg(json_build_object(
        'staff_name', sc.staff_name, 'role', sc.role,
        'planned_arrival', sc.planned_arrival, 'planned_departure', sc.planned_departure
      ) ORDER BY sc.planned_arrival), '[]'::json)
      FROM schedules sc WHERE sc.event_id = v_e AND sc.space_id = v_s)
  );
END; $$;

-- ── Statut de complétion (pour la home) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION get_zone_status(p_token TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_e UUID; v_s UUID; v_n TEXT; n_lines INT; n_final INT; n_init INT;
        n_sched INT; n_sched_ok INT; n_debrief INT;
BEGIN
  SELECT * INTO v_e, v_s, v_n FROM _zone_resolve(p_token);
  IF v_e IS NULL THEN RETURN json_build_object('success', false); END IF;
  SELECT COUNT(*), COUNT(final_qty), COUNT(*) FILTER (WHERE initial_qty > 0)
    INTO n_lines, n_final, n_init FROM event_stock_lines WHERE event_id = v_e AND space_id = v_s;
  SELECT COUNT(*), COUNT(*) FILTER (WHERE actual_departure IS NOT NULL AND confirmed_by_staff AND confirmed_by_manager)
    INTO n_sched, n_sched_ok FROM schedules WHERE event_id = v_e AND space_id = v_s;
  SELECT COUNT(*) INTO n_debrief FROM debriefs WHERE event_id = v_e AND space_id = v_s AND submitted_at IS NOT NULL;
  RETURN json_build_object(
    'success', true,
    'stocks', CASE WHEN n_lines = 0 THEN 'todo' WHEN n_final > 0 AND n_final = n_lines THEN 'done'
                   WHEN n_init > 0 THEN 'in_progress' ELSE 'todo' END,
    'schedules', CASE WHEN n_sched = 0 THEN 'todo' WHEN n_sched_ok = n_sched THEN 'done'
                      WHEN n_sched_ok > 0 THEN 'in_progress' ELSE 'todo' END,
    'debrief', CASE WHEN n_debrief > 0 THEN 'done' ELSE 'todo' END
  );
END; $$;

-- ── Lignes de stock éditables (produits dotés + valeurs saisies) ────────────
CREATE OR REPLACE FUNCTION get_zone_stock(p_token TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_e UUID; v_s UUID; v_n TEXT;
BEGIN
  SELECT * INTO v_e, v_s, v_n FROM _zone_resolve(p_token);
  IF v_e IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session expirée'); END IF;
  RETURN json_build_object(
    'success', true,
    'lines', (
      WITH prod AS (
        SELECT product_id FROM runner_dotations WHERE event_id = v_e AND space_id = v_s
        UNION
        SELECT product_id FROM event_stock_lines WHERE event_id = v_e AND space_id = v_s
      )
      SELECT COALESCE(json_agg(json_build_object(
        'product_id', p.product_id, 'product_name', p.product_name,
        'category', p.category, 'unit', p.unit,
        'planned_qty', COALESCE(rd.planned_qty, 0),
        'initial_qty', COALESCE(esl.initial_qty, 0),
        'reassort_qty', COALESCE(esl.reassort_qty, 0),
        'final_qty', esl.final_qty, 'product_state', esl.product_state
      ) ORDER BY p.category, p.product_name), '[]'::json)
      FROM prod
      JOIN products p ON p.product_id = prod.product_id
      LEFT JOIN runner_dotations rd ON rd.event_id = v_e AND rd.space_id = v_s AND rd.product_id = prod.product_id
      LEFT JOIN event_stock_lines esl ON esl.event_id = v_e AND esl.space_id = v_s AND esl.product_id = prod.product_id
    )
  );
END; $$;

-- ── Horaires agents (avec départs réels + confirmations) ────────────────────
CREATE OR REPLACE FUNCTION get_zone_schedule(p_token TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_e UUID; v_s UUID; v_n TEXT;
BEGIN
  SELECT * INTO v_e, v_s, v_n FROM _zone_resolve(p_token);
  IF v_e IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session expirée'); END IF;
  RETURN json_build_object(
    'success', true,
    'schedules', (
      SELECT COALESCE(json_agg(json_build_object(
        'schedule_id', sc.schedule_id, 'staff_name', sc.staff_name, 'role', sc.role,
        'planned_arrival', sc.planned_arrival, 'planned_departure', sc.planned_departure,
        'actual_departure', sc.actual_departure,
        'confirmed_by_staff', sc.confirmed_by_staff, 'confirmed_by_manager', sc.confirmed_by_manager
      ) ORDER BY sc.planned_arrival), '[]'::json)
      FROM schedules sc WHERE sc.event_id = v_e AND sc.space_id = v_s
    )
  );
END; $$;

-- ── Enregistrer une étape de stock (ouverture / réassort / clôture) ─────────
-- p_lines = [{product_id, initial_qty, reassort_qty, final_qty, product_state}]
CREATE OR REPLACE FUNCTION save_zone_stock(p_token TEXT, p_step TEXT, p_responsable TEXT, p_lines JSONB)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_e UUID; v_s UUID; v_n TEXT; rec JSONB; v_name TEXT;
BEGIN
  SELECT * INTO v_e, v_s, v_n FROM _zone_resolve(p_token);
  IF v_e IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session expirée'); END IF;
  v_name := UPPER(TRIM(p_responsable));
  IF length(v_name) < 2 THEN RETURN json_build_object('success', false, 'error', 'Nom requis (RG-001)'); END IF;

  FOR rec IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO event_stock_lines (event_id, space_id, product_id, initial_qty, reassort_qty, final_qty, product_state, anomaly_comment, responsable_nom, submitted_at)
    VALUES (v_e, v_s, (rec->>'product_id')::uuid,
      COALESCE((rec->>'initial_qty')::int, 0), COALESCE((rec->>'reassort_qty')::int, 0),
      CASE WHEN p_step = 'cloture' THEN (rec->>'final_qty')::int END,
      CASE WHEN p_step = 'cloture' THEN NULLIF(rec->>'product_state','') END,
      CASE WHEN p_step = 'cloture' THEN NULLIF(rec->>'anomaly_comment','') END,
      v_name, CASE WHEN p_step = 'cloture' THEN now() END)
    ON CONFLICT (event_id, space_id, product_id) DO UPDATE SET
      initial_qty  = CASE WHEN p_step = 'ouverture' THEN EXCLUDED.initial_qty ELSE event_stock_lines.initial_qty END,
      reassort_qty = CASE WHEN p_step = 'reassort'  THEN EXCLUDED.reassort_qty ELSE event_stock_lines.reassort_qty END,
      final_qty    = CASE WHEN p_step = 'cloture'   THEN EXCLUDED.final_qty ELSE event_stock_lines.final_qty END,
      product_state = CASE WHEN p_step = 'cloture'  THEN EXCLUDED.product_state ELSE event_stock_lines.product_state END,
      anomaly_comment = CASE WHEN p_step = 'cloture' THEN EXCLUDED.anomaly_comment ELSE event_stock_lines.anomaly_comment END,
      responsable_nom = v_name,
      submitted_at = CASE WHEN p_step = 'cloture' THEN now() ELSE event_stock_lines.submitted_at END;
  END LOOP;
  RETURN json_build_object('success', true);
END; $$;

-- ── Enregistrer un horaire agent (départ réel + confirmations) ──────────────
CREATE OR REPLACE FUNCTION save_zone_schedule(p_token TEXT, p_schedule_id UUID, p_actual_departure TIME, p_staff BOOLEAN, p_manager BOOLEAN)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_e UUID; v_s UUID; v_n TEXT;
BEGIN
  SELECT * INTO v_e, v_s, v_n FROM _zone_resolve(p_token);
  IF v_e IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session expirée'); END IF;
  UPDATE schedules SET actual_departure = p_actual_departure,
         confirmed_by_staff = COALESCE(p_staff, confirmed_by_staff),
         confirmed_by_manager = COALESCE(p_manager, confirmed_by_manager)
   WHERE schedule_id = p_schedule_id AND event_id = v_e AND space_id = v_s;
  RETURN json_build_object('success', FOUND);
END; $$;

-- ── Enregistrer le débrief (upsert) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION save_zone_debrief(p_token TEXT, p_responsable TEXT, p_payload JSONB)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_e UUID; v_s UUID; v_n TEXT; v_name TEXT;
BEGIN
  SELECT * INTO v_e, v_s, v_n FROM _zone_resolve(p_token);
  IF v_e IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session expirée'); END IF;
  v_name := UPPER(TRIM(p_responsable));
  IF length(v_name) < 2 THEN RETURN json_build_object('success', false, 'error', 'Nom requis (RG-001)'); END IF;

  INSERT INTO debriefs (event_id, space_id, responsable, submitted_at,
    nb_personnes, effectif_adapte, efficacite, suggestion_effectif,
    stocks_suffisants, stocks_comment, suggestions_stocks, besoins_materiel,
    consignes_claires, problemes_coordination, retours_clients, retours_clients_detail,
    espace_etat_bon, problemes_dechets, suggestions_generales, besoins_specifiques)
  VALUES (v_e, v_s, v_name, now(),
    (p_payload->>'nb_personnes')::int, p_payload->>'effectif_adapte', (p_payload->>'efficacite')::text, p_payload->>'suggestion_effectif',
    p_payload->>'stocks_suffisants', p_payload->>'stocks_comment', p_payload->>'suggestions_stocks', p_payload->>'besoins_materiel',
    p_payload->>'consignes_claires', p_payload->>'problemes_coordination', p_payload->>'retours_clients', p_payload->>'retours_clients_detail',
    p_payload->>'espace_etat_bon', p_payload->>'problemes_dechets', p_payload->>'suggestions_generales', p_payload->>'besoins_specifiques')
  ON CONFLICT (event_id, space_id) DO UPDATE SET
    responsable = v_name, submitted_at = now(),
    nb_personnes = EXCLUDED.nb_personnes, effectif_adapte = EXCLUDED.effectif_adapte,
    efficacite = EXCLUDED.efficacite, suggestion_effectif = EXCLUDED.suggestion_effectif,
    stocks_suffisants = EXCLUDED.stocks_suffisants, stocks_comment = EXCLUDED.stocks_comment,
    suggestions_stocks = EXCLUDED.suggestions_stocks, besoins_materiel = EXCLUDED.besoins_materiel,
    consignes_claires = EXCLUDED.consignes_claires, problemes_coordination = EXCLUDED.problemes_coordination,
    retours_clients = EXCLUDED.retours_clients, retours_clients_detail = EXCLUDED.retours_clients_detail,
    espace_etat_bon = EXCLUDED.espace_etat_bon, problemes_dechets = EXCLUDED.problemes_dechets,
    suggestions_generales = EXCLUDED.suggestions_generales, besoins_specifiques = EXCLUDED.besoins_specifiques;
  RETURN json_build_object('success', true);
END; $$;

GRANT EXECUTE ON FUNCTION get_zone_roadmap(TEXT), get_zone_status(TEXT),
  get_zone_stock(TEXT), get_zone_schedule(TEXT),
  save_zone_stock(TEXT,TEXT,TEXT,JSONB), save_zone_schedule(TEXT,UUID,TIME,BOOLEAN,BOOLEAN),
  save_zone_debrief(TEXT,TEXT,JSONB) TO anon, authenticated;
