-- Fix superviseurs buvettes : sélection cassée par le motif hérité ^B[0-9]+$
-- ============================================================================
-- BUG : save_buvette_selection résolvait chaque code de buvette via
--   space_name = UPPER(TRIM(code)) AND space_type='Buvette' AND space_name ~ '^B[0-9]+$'
-- Or les buvettes réelles ont des noms descriptifs (« Buvette Toinou », « EST NORD »,
-- « Virage OUEST »…), aucune ne matche ^B[0-9]+$, et la comparaison sensible à la
-- casse échouait de toute façon. Résultat : AUCUNE buvette enregistrée, le front
-- recevait success:true (count 0) et basculait quand même sur le dashboard →
-- « 0/0 terminées », superviseur sans aucune buvette à remplir.
--
-- CORRECTIF : résolution alignée sur get_zone_buvettes / _buvette_member —
--   coalesce(display_name, space_name) insensible à la casse,
--   service_type='buvette' AND NOT is_supervisor_slot (plus de motif B[0-9]).
-- De plus, si aucune buvette n'est reconnue, on renvoie success:false (le front
-- reste sur l'écran de sélection au lieu d'un dashboard vide).

CREATE OR REPLACE FUNCTION public.save_buvette_selection(p_token text, p_buvette_codes text[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_sess UUID; v_e UUID; v_s UUID; v_code TEXT; v_bsp UUID; v_canon TEXT; v_n INT := 0;
BEGIN
  SELECT id, event_id, space_id INTO v_sess, v_e, v_s
  FROM match_access_sessions WHERE session_token = p_token AND is_active = true;
  IF v_e IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session invalide'); END IF;
  IF p_buvette_codes IS NULL OR array_length(p_buvette_codes, 1) IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Sélectionnez au moins une buvette');
  END IF;

  DELETE FROM supervisor_buvette_selection WHERE session_id = v_sess;
  FOREACH v_code IN ARRAY p_buvette_codes LOOP
    -- Résolution par nom affiché OU nom d'espace, insensible à la casse ;
    -- critère buvette physique = service_type='buvette' et pas un slot superviseur.
    -- On récupère aussi le code CANONIQUE (casse d'origine = celui que renvoie
    -- get_zone_buvettes) pour que le front retrouve la sélection (selected.has(code)).
    SELECT space_id, coalesce(display_name, space_name) INTO v_bsp, v_canon FROM spaces
     WHERE upper(trim(coalesce(display_name, space_name))) = upper(trim(v_code))
       AND active AND service_type = 'buvette'
       AND NOT coalesce(is_supervisor_slot, false);
    IF v_bsp IS NOT NULL THEN
      INSERT INTO supervisor_buvette_selection (session_id, event_id, space_id, buvette_code, buvette_space_id)
      VALUES (v_sess, v_e, v_s, v_canon, v_bsp)
      ON CONFLICT (session_id, buvette_code) DO NOTHING;
      v_n := v_n + 1;
    END IF;
  END LOOP;

  IF v_n = 0 THEN
    RETURN json_build_object('success', false, 'error', 'Aucune buvette reconnue');
  END IF;
  RETURN json_build_object('success', true, 'selected_count', v_n);
END; $function$;

GRANT EXECUTE ON FUNCTION public.save_buvette_selection(text, text[]) TO anon, authenticated;
