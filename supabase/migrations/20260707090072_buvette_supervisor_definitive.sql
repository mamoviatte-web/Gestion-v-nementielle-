-- ═══════════════════════════════════════════════════════════════════════════
-- buvette_supervisor_definitive.sql — Process buvettes « définitif ».
--
-- MODÈLE CIBLE (confirmé) :
--   • 2 responsables buvettes = espaces « Buvette 1 » / « Buvette 2 »
--     (superviseurs). Ce sont les 2 POINTS D'ACCÈS de l'écran « Mon espace ».
--   • Chaque superviseur choisit LIBREMENT les buvettes physiques B1…B9 qu'il
--     gère (get_zone_buvettes / save_buvette_selection, table
--     supervisor_buvette_selection — cf. buvette_free_selection.sql).
--   • Pour CHAQUE buvette : process complet STOCK (ouverture/réassort/clôture)
--     ET DÉBRIEF, écrits sur le space de la buvette (p_target_space).
--
-- Pourquoi ce fichier : le correctif précédent avait fait renvoyer B1…B9
-- directement par validate_match_code (les 9 buvettes en accès), ce qui
-- court-circuitait les 2 superviseurs. On rétablit l'accès par les 2
-- responsables + on complète le process avec le débrief par buvette.
--
-- ⚠ Interaction canonique (migration 061) : « Buvette 1 » a un canonique (B1)
--   et le trigger trg_event_spaces_canonical réécrit tout insert event_spaces
--   vers le canonique → « Buvette 1/2 » ne peuvent JAMAIS être dans event_spaces.
--   validate_match_code les propose donc PAR NOM (indépendamment d'event_spaces).
--   register_zone_staff stocke le space_id BRUT (pas de canonicalisation sur
--   les sessions) → une session « Buvette 1 » garde son nom → le pool
--   superviseur fonctionne.
--
-- 100 % additif / idempotent. Aucun DELETE. Aucun changement de schéma.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0) S'assurer que les 2 superviseurs existent et sont actifs ──────────────
-- (Ils ont pu être désactivés lors d'un nettoyage de doublons ; ici on les
-- réactive car ce sont désormais des RÔLES superviseurs, pas des doublons.)
UPDATE spaces SET active = true
 WHERE space_name IN ('Buvette 1', 'Buvette 2') AND active = false;

-- ── 1) validate_match_code : accès par les 2 superviseurs (+ VIP/Bars) ───────
CREATE OR REPLACE FUNCTION validate_match_code(p_code TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event events%ROWTYPE; v_pool INT;
BEGIN
  SELECT * INTO v_event FROM events
   WHERE UPPER(match_access_code) = UPPER(TRIM(p_code))
     AND event_type = 'match' AND status IN ('préparé','en_cours','brouillon')
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Code invalide ou match non actif');
  END IF;

  -- Pool de buvettes physiques B1…B9 (piloté par chaque superviseur).
  SELECT COUNT(*) INTO v_pool
    FROM spaces
   WHERE active AND space_type = 'Buvette' AND space_name ~ '^B[0-9]+$';

  RETURN json_build_object(
    'success', true,
    'event_id', v_event.event_id, 'event_name', v_event.event_name,
    'event_date', v_event.event_date, 'start_time', v_event.start_time, 'status', v_event.status,
    'spaces', (
      SELECT COALESCE(json_agg(elem ORDER BY ord, nm), '[]'::json)
      FROM (
        -- VIP & Bars OUVERTS de l'événement (toutes les buvettes exclues ici).
        SELECT 0 AS ord, s.space_name AS nm, json_build_object(
          'space_id', s.space_id,
          'space_name', s.space_name,
          'space_type', s.space_type,
          'service_type', s.service_type,
          'family', 'VIP & Bars',
          'is_buvette', false,
          'max_pax', s.max_pax,
          'group_name', NULL,
          'nb_buvettes', 0
        ) AS elem
        FROM event_spaces es
        JOIN spaces s ON s.space_id = es.space_id
        WHERE es.event_id = v_event.event_id
          AND s.active = true
          AND COALESCE(es.service_mode, 'auto') <> 'fermé'
          AND s.space_type <> 'Buvette'

        UNION ALL

        -- Les 2 superviseurs buvettes (toujours proposés, PAR NOM — cf. note
        -- canonique : ils ne sont jamais dans event_spaces).
        SELECT 1 AS ord, s.space_name AS nm, json_build_object(
          'space_id', s.space_id,
          'space_name', s.space_name,
          'space_type', s.space_type,
          'service_type', s.service_type,
          'family', 'Buvettes',
          'is_buvette', true,
          'max_pax', s.max_pax,
          'group_name', NULL,
          'nb_buvettes', v_pool
        ) AS elem
        FROM spaces s
        WHERE s.active = true
          AND s.space_name IN ('Buvette 1', 'Buvette 2')
      ) q
    )
  );
END; $$;

GRANT EXECUTE ON FUNCTION validate_match_code(TEXT) TO anon, authenticated;

-- ── 2) get_zone_buvettes : + état DÉBRIEF par buvette ────────────────────────
-- (Version « sélection libre » de buvette_free_selection.sql, enrichie de
-- has_debrief. Le front lit all_buvettes / selected_buvettes / selection_done.)
CREATE OR REPLACE FUNCTION get_zone_buvettes(p_token TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sess UUID; v_e UUID; v_s UUID; v_name TEXT;
BEGIN
  SELECT id, event_id, space_id INTO v_sess, v_e, v_s
  FROM match_access_sessions WHERE session_token = p_token AND is_active = true;
  IF v_e IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session invalide'); END IF;
  SELECT space_name INTO v_name FROM spaces WHERE space_id = v_s;

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
                             WHERE esl.event_id = v_e AND esl.space_id = b.space_id AND esl.final_qty IS NOT NULL),
        'has_debrief', EXISTS (SELECT 1 FROM debriefs d
                               WHERE d.event_id = v_e AND d.space_id = b.space_id AND d.submitted_at IS NOT NULL)
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

GRANT EXECUTE ON FUNCTION get_zone_buvettes(TEXT) TO anon, authenticated;

-- ── 3) Débrief par buvette (lecture / écriture) ──────────────────────────────
-- Écrit debriefs(event_id, target_space) — contrainte UNIQUE(event_id, space_id)
-- existante. Autorisation : _buvette_member (superviseur Buvette 1/2 → B1…B9).

CREATE OR REPLACE FUNCTION get_zone_buvette_debrief(p_token TEXT, p_target_space UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event UUID; v_space UUID; v_d debriefs%ROWTYPE;
BEGIN
  SELECT event_id, space_id INTO v_event, v_space
  FROM match_access_sessions WHERE session_token = p_token AND is_active = true;
  IF v_event IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session invalide'); END IF;
  IF NOT _buvette_member(v_space, p_target_space) THEN
    RETURN json_build_object('success', false, 'error', 'Buvette non autorisée');
  END IF;

  SELECT * INTO v_d FROM debriefs WHERE event_id = v_event AND space_id = p_target_space;
  RETURN json_build_object(
    'success', true,
    'debrief', CASE WHEN v_d.debrief_id IS NULL THEN NULL ELSE row_to_json(v_d) END
  );
END; $$;

CREATE OR REPLACE FUNCTION save_zone_buvette_debrief(
  p_token TEXT, p_responsable TEXT, p_payload JSONB, p_target_space UUID
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event UUID; v_space UUID; v_name TEXT;
BEGIN
  SELECT event_id, space_id INTO v_event, v_space
  FROM match_access_sessions WHERE session_token = p_token AND is_active = true;
  IF v_event IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session invalide'); END IF;
  IF NOT _buvette_member(v_space, p_target_space) THEN
    RETURN json_build_object('success', false, 'error', 'Buvette non autorisée');
  END IF;
  v_name := UPPER(TRIM(p_responsable));
  IF length(v_name) < 2 THEN RETURN json_build_object('success', false, 'error', 'Nom requis (RG-001)'); END IF;

  INSERT INTO debriefs (event_id, space_id, responsable, submitted_at,
    nb_personnes, effectif_adapte, efficacite, suggestion_effectif,
    stocks_suffisants, stocks_comment, suggestions_stocks, besoins_materiel,
    consignes_claires, problemes_coordination, retours_clients, retours_clients_detail,
    espace_etat_bon, problemes_dechets, suggestions_generales, besoins_specifiques)
  VALUES (v_event, p_target_space, v_name, now(),
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

GRANT EXECUTE ON FUNCTION get_zone_buvette_debrief(TEXT, UUID),
  save_zone_buvette_debrief(TEXT, TEXT, JSONB, UUID) TO anon, authenticated;

-- ── Vérification rapide ──────────────────────────────────────────────────────
-- Accès (doit lister VIP/Bars + « Buvette 1 » + « Buvette 2 », family renseignée,
-- nb_buvettes > 0 sur les superviseurs) :
--   SELECT (validate_match_code('71D766')::jsonb) -> 'spaces';
