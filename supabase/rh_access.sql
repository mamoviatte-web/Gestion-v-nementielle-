-- ═══════════════════════════════════════════════════════════════════════════
-- rh_access.sql — Accès dédié « Responsable RH » par code match.
--   Code RH par match (events.rh_access_code) → session anonyme (rh_sessions) →
--   interface de planification isolée (/rh/planning), zéro accès admin.
--
-- ⚠ Adaptations : RLS via is_stade() ; résolution session_token EXACT ;
--   suppression d'agent via RPC (le Responsable RH est anonyme → la RLS
--   is_stade() de event_staff_preplan bloque un DELETE direct).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── BLOC 1 : code d'accès RH sur les matchs ─────────────────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS rh_access_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS rh_locked_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rh_locked_by   TEXT;

UPDATE events
SET rh_access_code = 'RH' || UPPER(SUBSTRING(gen_random_uuid()::TEXT, 1, 6))
WHERE event_type = 'match' AND rh_access_code IS NULL;

CREATE OR REPLACE FUNCTION auto_generate_rh_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event_type = 'match' AND NEW.rh_access_code IS NULL THEN
    NEW.rh_access_code := 'RH' || UPPER(SUBSTRING(gen_random_uuid()::TEXT, 1, 6));
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_auto_rh_code ON events;
CREATE TRIGGER trg_auto_rh_code BEFORE INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION auto_generate_rh_code();

-- ── BLOC 2 : sessions RH par code ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rh_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  rh_nom         TEXT NOT NULL,
  session_token  TEXT NOT NULL UNIQUE DEFAULT 'RHS-' || UPPER(gen_random_uuid()::TEXT),
  is_active      BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT now(),
  last_active_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE rh_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stade_all_rh_sessions ON rh_sessions;
CREATE POLICY stade_all_rh_sessions ON rh_sessions
  FOR ALL TO authenticated USING (is_stade()) WITH CHECK (is_stade());
CREATE INDEX IF NOT EXISTS idx_rh_sessions_token ON rh_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_rh_sessions_event ON rh_sessions(event_id);

-- ── BLOC 3 : RPC accès RH (anonyme, par token) ──────────────────────────────
CREATE OR REPLACE FUNCTION validate_rh_code(p_code TEXT, p_rh_nom TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_event events%ROWTYPE; v_token TEXT;
BEGIN
  IF p_rh_nom IS NULL OR TRIM(p_rh_nom) = '' THEN
    RETURN json_build_object('success', false, 'error', 'Nom obligatoire');
  END IF;
  SELECT * INTO v_event FROM events
  WHERE UPPER(rh_access_code) = UPPER(TRIM(p_code))
    AND event_type = 'match' AND status IN ('brouillon','préparé','en_cours');
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Code RH invalide ou match non actif');
  END IF;
  INSERT INTO rh_sessions (event_id, rh_nom) VALUES (v_event.event_id, INITCAP(TRIM(p_rh_nom)))
  RETURNING session_token INTO v_token;
  RETURN json_build_object(
    'success', true, 'session_token', v_token, 'event_id', v_event.event_id,
    'event_name', v_event.event_name, 'event_date', v_event.event_date,
    'start_time', v_event.start_time, 'rh_nom', INITCAP(TRIM(p_rh_nom)));
END; $$;

CREATE OR REPLACE FUNCTION get_rh_session(p_token TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_session rh_sessions%ROWTYPE; v_event events%ROWTYPE;
BEGIN
  SELECT * INTO v_session FROM rh_sessions WHERE session_token = p_token AND is_active = true;
  IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'Session expirée'); END IF;
  SELECT * INTO v_event FROM events WHERE event_id = v_session.event_id;
  UPDATE rh_sessions SET last_active_at = now() WHERE id = v_session.id;
  RETURN json_build_object('success', true, 'event_id', v_event.event_id,
    'event_name', v_event.event_name, 'event_date', v_event.event_date, 'rh_nom', v_session.rh_nom);
END; $$;

CREATE OR REPLACE FUNCTION rh_get_preplan_by_token(p_token TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_event_id UUID;
BEGIN
  SELECT event_id INTO v_event_id FROM rh_sessions WHERE session_token = p_token AND is_active = true;
  IF v_event_id IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session invalide'); END IF;
  RETURN hr_get_preplan(v_event_id);
END; $$;

CREATE OR REPLACE FUNCTION rh_upsert_agent_by_token(
  p_token TEXT, p_space_id UUID, p_agent_id UUID, p_nom TEXT, p_prenom TEXT,
  p_role TEXT, p_start TIME, p_end TIME, p_rate DECIMAL DEFAULT NULL
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_event_id UUID; v_rh_nom TEXT;
BEGIN
  SELECT event_id, rh_nom INTO v_event_id, v_rh_nom FROM rh_sessions WHERE session_token = p_token AND is_active = true;
  IF v_event_id IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session invalide'); END IF;
  RETURN hr_upsert_agent(v_event_id, p_space_id, p_agent_id, p_nom, p_prenom, p_role, p_start, p_end, p_rate, v_rh_nom);
END; $$;

CREATE OR REPLACE FUNCTION rh_lock_preplan_by_token(p_token TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_event_id UUID; v_rh_nom TEXT;
BEGIN
  SELECT event_id, rh_nom INTO v_event_id, v_rh_nom FROM rh_sessions WHERE session_token = p_token AND is_active = true;
  IF v_event_id IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session invalide'); END IF;
  UPDATE events SET rh_locked_at = now(), rh_locked_by = v_rh_nom WHERE event_id = v_event_id;
  RETURN hr_lock_preplan(v_event_id, v_rh_nom);
END; $$;

-- Suppression d'un agent NON verrouillé via token (le Responsable RH est anon).
CREATE OR REPLACE FUNCTION rh_delete_agent_by_token(p_token TEXT, p_agent_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_event_id UUID;
BEGIN
  SELECT event_id INTO v_event_id FROM rh_sessions WHERE session_token = p_token AND is_active = true;
  IF v_event_id IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session invalide'); END IF;
  DELETE FROM event_staff_preplan WHERE id = p_agent_id AND event_id = v_event_id AND status = 'planifié';
  RETURN json_build_object('success', true);
END; $$;

GRANT EXECUTE ON FUNCTION validate_rh_code(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_rh_session(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rh_get_preplan_by_token(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rh_upsert_agent_by_token(TEXT,UUID,UUID,TEXT,TEXT,TEXT,TIME,TIME,DECIMAL) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rh_lock_preplan_by_token(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rh_delete_agent_by_token(TEXT, UUID) TO anon, authenticated;
