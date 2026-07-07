-- ═══════════════════════════════════════════════════════════════════════════
-- match_access.sql — Accès match par code unique (1 code → choix espace → nom)
-- Prérequis : buvettes_capacites.sql (event_spaces.service_mode, spaces.service_type),
--             _APPLY_ALL.sql (buvette_groups).
--
-- ⚠ Corrections vs le SQL du prompt (schéma RÉEL) :
--   • schedules n'a PAS de colonne declared_by_self → ALTER ADD.
--   • schedules n'a PAS de contrainte UNIQUE(event_id,space_id,staff_name)
--     → l'insert horaire utilise IF NOT EXISTS (pas ON CONFLICT).
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── ÉTAPE 1 — Code d'accès match + sessions ─────────────────────────────────
ALTER TABLE events ADD COLUMN IF NOT EXISTS match_access_code TEXT UNIQUE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS match_access_url  TEXT;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS declared_by_self BOOLEAN DEFAULT false;

CREATE TABLE IF NOT EXISTS match_access_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  space_id       UUID NOT NULL REFERENCES spaces(space_id),
  staff_name     TEXT NOT NULL,
  connected_at   TIMESTAMPTZ DEFAULT now(),
  last_active_at TIMESTAMPTZ DEFAULT now(),
  session_token  TEXT UNIQUE DEFAULT substring(gen_random_uuid()::text, 1, 8),
  is_active      BOOLEAN DEFAULT true,
  completed_at   TIMESTAMPTZ,
  UNIQUE(event_id, space_id, staff_name)
);

-- Génération auto du code à la création d'un match.
CREATE OR REPLACE FUNCTION generate_match_access_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event_type = 'match' AND NEW.match_access_code IS NULL THEN
    NEW.match_access_code := UPPER(substring(md5(NEW.event_id::text || random()::text), 1, 6));
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_match_access_code ON events;
CREATE TRIGGER trg_match_access_code BEFORE INSERT ON events FOR EACH ROW
  EXECUTE FUNCTION generate_match_access_code();

-- Codes pour les matchs existants.
UPDATE events
   SET match_access_code = UPPER(substring(md5(event_id::text || random()::text), 1, 6))
 WHERE event_type = 'match' AND match_access_code IS NULL;

-- RLS.
ALTER TABLE match_access_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_create_session ON match_access_sessions;
CREATE POLICY public_create_session ON match_access_sessions
  FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS read_session ON match_access_sessions;
CREATE POLICY read_session ON match_access_sessions
  FOR SELECT TO anon, authenticated
  USING (
    session_token = current_setting('request.jwt.claims', true)::json->>'session_token'
    OR is_stade()
  );
DROP POLICY IF EXISTS update_session ON match_access_sessions;
CREATE POLICY update_session ON match_access_sessions
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- ── ÉTAPE 2 — RPC publiques (SECURITY DEFINER → bypass RLS) ─────────────────
CREATE OR REPLACE FUNCTION validate_match_code(p_code TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event events%ROWTYPE;
BEGIN
  SELECT * INTO v_event FROM events
   WHERE UPPER(match_access_code) = UPPER(p_code)
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
        'space_id', s.space_id, 'space_name', s.space_name,
        'service_type', s.service_type, 'max_pax', s.max_pax, 'group_name', bg.group_name
      ) ORDER BY s.service_type, s.space_name), '[]'::json)
      FROM event_spaces es
      JOIN spaces s ON s.space_id = es.space_id
      LEFT JOIN buvette_group_members bgm ON bgm.space_id = s.space_id
      LEFT JOIN buvette_groups bg ON bg.id = bgm.group_id
      WHERE es.event_id = v_event.event_id
        AND COALESCE(es.service_mode, 'auto') <> 'fermé'
    )
  );
END; $$;

CREATE OR REPLACE FUNCTION register_zone_staff(p_match_code TEXT, p_space_id UUID, p_staff_name TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event UUID; v_token TEXT; v_name TEXT;
BEGIN
  v_name := UPPER(TRIM(p_staff_name));
  SELECT event_id INTO v_event FROM events
   WHERE UPPER(match_access_code) = UPPER(p_match_code)
     AND event_type = 'match' AND status IN ('préparé','en_cours','brouillon');
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Code invalide');
  END IF;

  INSERT INTO match_access_sessions (event_id, space_id, staff_name)
  VALUES (v_event, p_space_id, v_name)
  ON CONFLICT (event_id, space_id, staff_name)
  DO UPDATE SET last_active_at = now(), is_active = true
  RETURNING session_token INTO v_token;

  -- Ligne horaire RH (schedules n'a pas de contrainte unique → NOT EXISTS).
  IF NOT EXISTS (
    SELECT 1 FROM schedules
     WHERE event_id = v_event AND space_id = p_space_id AND staff_name = v_name
  ) THEN
    INSERT INTO schedules (event_id, space_id, staff_name, role, planned_arrival, declared_by_self)
    VALUES (v_event, p_space_id, v_name, 'Responsable espace', '07:00', true);
  END IF;

  RETURN json_build_object('success', true, 'session_token', v_token,
    'event_id', v_event, 'space_id', p_space_id, 'staff_name', v_name);
END; $$;

-- Charger une session par son token (accès public au tableau de zone).
CREATE OR REPLACE FUNCTION get_match_session(p_token TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v JSON;
BEGIN
  UPDATE match_access_sessions SET last_active_at = now()
   WHERE session_token = p_token AND is_active = true;
  SELECT json_build_object(
    'success', true,
    'session_token', mas.session_token,
    'event_id', e.event_id, 'event_name', e.event_name, 'event_date', e.event_date,
    'space_id', s.space_id, 'space_name', s.space_name, 'service_type', s.service_type,
    'staff_name', mas.staff_name
  ) INTO v
  FROM match_access_sessions mas
  JOIN events e ON e.event_id = mas.event_id
  JOIN spaces s ON s.space_id = mas.space_id
  WHERE mas.session_token = p_token AND mas.is_active = true;
  RETURN COALESCE(v, json_build_object('success', false, 'error', 'Session expirée'));
END; $$;

GRANT EXECUTE ON FUNCTION validate_match_code(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION register_zone_staff(TEXT, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_match_session(TEXT) TO anon, authenticated;
