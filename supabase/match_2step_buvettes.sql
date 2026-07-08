-- ═══════════════════════════════════════════════════════════════════════════
-- match_2step_buvettes.sql — Sélection match : masquer les buvettes physiques.
--
-- Problème : la sélection d'espace affichait B1…B9 (encombrant). On les retire
-- de la sélection : seules « Buvette 1 » / « Buvette 2 » (superviseurs) + les
-- espaces VIP / Bars restent. Les responsables buvette choisissent Buvette 1/2
-- puis naviguent vers leurs buvettes physiques (flux superviseur existant).
--
-- ⚠ NON destructif : les VIP/Bars restent accessibles (pas de « 2 cartes only »
-- qui aurait coupé l'accès aux 15 responsables VIP/Bars). On réutilise
-- buvette_groups/buvette_group_members (pas de table buvette_zones).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION validate_match_code(p_code TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
        -- Superviseur buvettes : nb + codes des buvettes membres
        'nb_buvettes', (
          SELECT COUNT(*) FROM buvette_groups bg
          JOIN buvette_group_members m ON m.group_id = bg.id AND m.is_active
          JOIN spaces ms ON ms.space_id = m.space_id AND ms.active
          WHERE bg.group_name = s.space_name AND bg.is_active),
        'buvette_codes', (
          SELECT COALESCE(json_agg(ms.space_name ORDER BY ms.space_name), '[]'::json)
          FROM buvette_groups bg
          JOIN buvette_group_members m ON m.group_id = bg.id AND m.is_active
          JOIN spaces ms ON ms.space_id = m.space_id AND ms.active
          WHERE bg.group_name = s.space_name AND bg.is_active)
      ) ORDER BY s.space_type, s.space_name), '[]'::json)
      FROM event_spaces es
      JOIN spaces s ON s.space_id = es.space_id
      WHERE es.event_id = v_event.event_id
        AND s.active = true
        AND COALESCE(es.service_mode, 'auto') <> 'fermé'
        -- Masquer les buvettes physiques (B1…B9, Buvette Virage …) : on ne garde
        -- que les superviseurs « Buvette 1/2 » et les espaces VIP/Bars.
        AND s.space_name !~ '^B[0-9]+$'
        AND s.space_name NOT ILIKE 'Buvette Virage%'
    )
  );
END; $$;

GRANT EXECUTE ON FUNCTION validate_match_code(TEXT) TO anon, authenticated;

-- ── Nettoyage event_spaces : retirer les buvettes physiques des matchs ──────
-- (elles vivent dans buvette_groups ; le flux superviseur écrit sur leur space
-- sans passer par event_spaces). Buvette 1/2 + VIP + Bars conservés.
DELETE FROM event_spaces es
USING events e, spaces s
WHERE es.event_id = e.event_id AND s.space_id = es.space_id
  AND e.event_type = 'match'
  AND (s.space_name ~ '^B[0-9]+$' OR s.space_name ILIKE 'Buvette Virage%');

-- S'assurer que Buvette 1 / Buvette 2 sont bien liées à tous les matchs.
INSERT INTO event_spaces (event_id, space_id)
SELECT e.event_id, s.space_id
FROM events e CROSS JOIN spaces s
WHERE e.event_type = 'match' AND s.space_name IN ('Buvette 1', 'Buvette 2') AND s.active = true
ON CONFLICT (event_id, space_id) DO NOTHING;
