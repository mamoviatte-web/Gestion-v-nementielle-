-- =====================================================================
-- GARDES-FOUS COORDINATION — SAISIES RESPONSABLE (ZONE MATCH)
-- ---------------------------------------------------------------------
-- Préparation du match avec accès de TOUS les responsables. On renforce la
-- cohérence des saisies côté zone en portant DEUX règles métier critiques au
-- niveau SERVEUR (jusqu'ici seulement côté front) — sans changer le
-- comportement pour un usage normal (le front applique déjà ces règles) :
--
--   • RG-001 — traçabilité nominative : nom du responsable obligatoire
--     (≥ 2 car.) sur l'ouverture ET la clôture. submit_zone_schedule le
--     faisait déjà ; on aligne submit_zone_initial_stock et
--     submit_zone_final_stock.
--   • RG-004 — consommation négative : si stock final > ouverture + réassort,
--     un commentaire d'anomalie est obligatoire. Vérifié AVANT toute écriture
--     (rejet atomique : aucune ligne écrite si une seule est en anomalie non
--     justifiée).
--
-- Les triggers existants (guard_close_requires_opening, on_stock_final_entered,
-- lock_closed_lines…) restent en place — défense en profondeur. Idempotent.
-- =====================================================================

-- ---------- Ouverture : RG-001 ----------
create or replace function public.submit_zone_initial_stock(p_token text, p_responsible_name text, p_stock_lines jsonb)
returns json language plpgsql security definer set search_path to 'public'
as $function$
DECLARE v_event UUID; v_space UUID; v_line JSONB;
BEGIN
  SELECT es.event_id, es.space_id INTO v_event, v_space
  FROM event_spaces es WHERE es.access_token = p_token AND es.token_expires_at > now();
  IF v_event IS NULL THEN RETURN '{"success": false, "error": "token_invalid"}'::json; END IF;
  -- RG-001 : traçabilité nominative obligatoire
  IF length(trim(coalesce(p_responsible_name,''))) < 2 THEN
    RETURN json_build_object('success', false, 'error', 'Nom du responsable requis (min. 2 caractères) — RG-001.');
  END IF;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_stock_lines) LOOP
    INSERT INTO event_stock_lines (event_id, space_id, product_id, initial_qty, product_state, responsable_nom)
    VALUES (v_event, v_space, (v_line->>'product_id')::UUID, COALESCE((v_line->>'qty')::INT,0),
            NULLIF(v_line->>'state',''), p_responsible_name)
    ON CONFLICT (event_id, space_id, product_id) DO UPDATE SET
      initial_qty = EXCLUDED.initial_qty, product_state = EXCLUDED.product_state,
      responsable_nom = EXCLUDED.responsable_nom;
  END LOOP;
  UPDATE event_spaces SET space_responsible_name = p_responsible_name WHERE event_id=v_event AND space_id=v_space;
  RETURN '{"success": true}'::json;
END; $function$;

-- ---------- Clôture : RG-001 + RG-004 (validation avant écriture) ----------
create or replace function public.submit_zone_final_stock(p_token text, p_responsible_name text, p_stock_lines jsonb)
returns json language plpgsql security definer set search_path to 'public'
as $function$
DECLARE v_event UUID; v_space UUID; v_line JSONB; v_ini INT; v_rea INT; v_pid UUID;
BEGIN
  SELECT es.event_id, es.space_id INTO v_event, v_space
  FROM event_spaces es WHERE es.access_token = p_token AND es.token_expires_at > now();
  IF v_event IS NULL THEN RETURN '{"success": false, "error": "token_invalid"}'::json; END IF;
  -- RG-001 : traçabilité nominative obligatoire
  IF length(trim(coalesce(p_responsible_name,''))) < 2 THEN
    RETURN json_build_object('success', false, 'error', 'Nom du responsable requis (min. 2 caractères) — RG-001.');
  END IF;
  -- RG-004 : consommation négative => commentaire d'anomalie obligatoire.
  -- Validation de TOUTES les lignes AVANT d'écrire (rejet atomique).
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_stock_lines) LOOP
    v_pid := (v_line->>'product_id')::UUID;
    SELECT coalesce(initial_qty,0), coalesce(reassort_qty,0) INTO v_ini, v_rea
      FROM event_stock_lines WHERE event_id=v_event AND space_id=v_space AND product_id=v_pid;
    IF (v_line->>'final_qty') IS NOT NULL
       AND (v_line->>'final_qty')::INT > coalesce(v_ini,0) + coalesce(v_rea,0)
       AND length(trim(coalesce(v_line->>'anomaly',''))) = 0 THEN
      RETURN json_build_object('success', false,
        'error', 'Consommation négative (stock final > ouverture + réassort) : un commentaire d''anomalie est requis — RG-004.');
    END IF;
  END LOOP;
  -- Écriture
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_stock_lines) LOOP
    INSERT INTO event_stock_lines (event_id, space_id, product_id, initial_qty, final_qty, product_state, anomaly_comment, responsable_nom, submitted_at)
    VALUES (v_event, v_space, (v_line->>'product_id')::UUID, 0,
            (v_line->>'final_qty')::INT, NULLIF(v_line->>'state',''), NULLIF(v_line->>'anomaly',''), p_responsible_name, now())
    ON CONFLICT (event_id, space_id, product_id) DO UPDATE SET
      final_qty = EXCLUDED.final_qty, product_state = EXCLUDED.product_state,
      anomaly_comment = EXCLUDED.anomaly_comment, responsable_nom = EXCLUDED.responsable_nom, submitted_at = now();
  END LOOP;
  RETURN '{"success": true}'::json;
END; $function$;
