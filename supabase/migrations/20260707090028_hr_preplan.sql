-- ═══════════════════════════════════════════════════════════════════════════
-- hr_preplan.sql — Pré-planification RH jour de match.
--   RH prépare (planifié) → verrouille (validé) → zone manager pointe (pointé).
--
-- ⚠ Adaptations au schéma réel :
--   • Heures générées avec gestion du passage minuit (+24 h), comme
--     zone_staff_hours.hours_worked.
--   • RLS via is_stade() (helper existant), pas via auth.jwt() brut.
--   • Résolution de session : session_token = p_token EXACT (les autres RPC zone
--     font pareil ; un UPPER/TRIM casserait la correspondance des tokens).
--   • zone_staff_hours n'a PAS de contrainte unique → garde-fou anti-doublon via
--     le lien zone_staff_hour_id (UPDATE si déjà pointé, sinon INSERT).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS event_staff_preplan (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  space_id      UUID NOT NULL REFERENCES spaces(space_id),
  agent_nom     TEXT NOT NULL,
  agent_prenom  TEXT NOT NULL,
  agent_role    TEXT NOT NULL DEFAULT 'Serveur' CHECK (agent_role IN (
                  'Serveur','Chef de rang','Barman','Agent de sécurité','Runner',
                  'Hôte / Hôtesse','Responsable espace','Autre')),
  planned_start TIME NOT NULL,
  planned_end   TIME,
  planned_hours DECIMAL(5,2) GENERATED ALWAYS AS (
    CASE WHEN planned_end IS NOT NULL THEN
      ROUND((EXTRACT(EPOCH FROM (planned_end - planned_start)) / 3600.0
        + CASE WHEN planned_end < planned_start THEN 24 ELSE 0 END)::numeric, 2)
    ELSE NULL END) STORED,
  hourly_rate   DECIMAL(8,2),
  status        TEXT NOT NULL DEFAULT 'planifié' CHECK (status IN (
                  'planifié','validé','présent','absent','pointé')),
  actual_start  TIME,
  actual_end    TIME,
  actual_hours  DECIMAL(5,2) GENERATED ALWAYS AS (
    CASE WHEN actual_end IS NOT NULL AND actual_start IS NOT NULL THEN
      ROUND((EXTRACT(EPOCH FROM (actual_end - actual_start)) / 3600.0
        + CASE WHEN actual_end < actual_start THEN 24 ELSE 0 END)::numeric, 2)
    ELSE NULL END) STORED,
  confirmed_by_hr    BOOLEAN DEFAULT false,
  confirmed_by_zone  BOOLEAN DEFAULT false,
  note               TEXT,
  created_by         TEXT,
  updated_by         TEXT,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now(),
  zone_staff_hour_id UUID REFERENCES zone_staff_hours(id) ON DELETE SET NULL
);

ALTER TABLE event_staff_preplan ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stade_all_preplan ON event_staff_preplan;
CREATE POLICY stade_all_preplan ON event_staff_preplan
  FOR ALL TO authenticated USING (is_stade()) WITH CHECK (is_stade());

CREATE INDEX IF NOT EXISTS idx_preplan_event       ON event_staff_preplan(event_id);
CREATE INDEX IF NOT EXISTS idx_preplan_event_space ON event_staff_preplan(event_id, space_id);
CREATE INDEX IF NOT EXISTS idx_preplan_status      ON event_staff_preplan(status);

CREATE OR REPLACE FUNCTION update_preplan_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_preplan_updated ON event_staff_preplan;
CREATE TRIGGER trg_preplan_updated BEFORE UPDATE ON event_staff_preplan
  FOR EACH ROW EXECUTE FUNCTION update_preplan_timestamp();

-- ── RPC RH (ROLE_STADE) : upsert d'un agent ─────────────────────────────────
CREATE OR REPLACE FUNCTION hr_upsert_agent(
  p_event_id UUID, p_space_id UUID, p_agent_id UUID,
  p_nom TEXT, p_prenom TEXT, p_role TEXT,
  p_start TIME, p_end TIME, p_rate DECIMAL DEFAULT NULL, p_created_by TEXT DEFAULT 'RH'
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id UUID;
BEGIN
  IF p_agent_id IS NULL THEN
    INSERT INTO event_staff_preplan (event_id, space_id, agent_nom, agent_prenom, agent_role, planned_start, planned_end, hourly_rate, created_by)
    VALUES (p_event_id, p_space_id, INITCAP(TRIM(p_nom)), INITCAP(TRIM(p_prenom)), p_role, p_start, p_end, p_rate, p_created_by)
    RETURNING id INTO v_id;
  ELSE
    UPDATE event_staff_preplan SET
      agent_nom=INITCAP(TRIM(p_nom)), agent_prenom=INITCAP(TRIM(p_prenom)), agent_role=p_role,
      planned_start=p_start, planned_end=p_end, hourly_rate=p_rate, updated_by=p_created_by
    WHERE id=p_agent_id AND event_id=p_event_id RETURNING id INTO v_id;
  END IF;
  RETURN json_build_object('success', true, 'id', v_id);
END; $$;

-- ── RPC RH : verrouiller la liste (planifié → validé) ───────────────────────
CREATE OR REPLACE FUNCTION hr_lock_preplan(p_event_id UUID, p_hr_name TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_count INT;
BEGIN
  UPDATE event_staff_preplan SET status='validé', confirmed_by_hr=true, updated_by=p_hr_name
  WHERE event_id=p_event_id AND status='planifié';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN json_build_object('success', true, 'agents_locked', v_count);
END; $$;

-- ── RPC RH : liste pré-planifiée par espace ─────────────────────────────────
CREATE OR REPLACE FUNCTION hr_get_preplan(p_event_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RETURN json_build_object(
    'success', true,
    'total', (SELECT COUNT(*) FROM event_staff_preplan WHERE event_id=p_event_id),
    'by_space', (
      SELECT COALESCE(json_agg(json_build_object(
        'space_id', s.space_id, 'space_name', s.space_name, 'service_type', s.service_type,
        'agents', (
          SELECT COALESCE(json_agg(json_build_object(
            'id', esp.id, 'nom', esp.agent_nom, 'prenom', esp.agent_prenom, 'role', esp.agent_role,
            'planned_start', esp.planned_start, 'planned_end', esp.planned_end, 'planned_hours', esp.planned_hours,
            'hourly_rate', esp.hourly_rate, 'status', esp.status,
            'actual_start', esp.actual_start, 'actual_end', esp.actual_end, 'actual_hours', esp.actual_hours,
            'confirmed_by_zone', esp.confirmed_by_zone, 'note', esp.note
          ) ORDER BY esp.agent_role, esp.agent_nom), '[]'::json)
          FROM event_staff_preplan esp WHERE esp.event_id=p_event_id AND esp.space_id=s.space_id),
        'nb_planifies', (SELECT COUNT(*) FROM event_staff_preplan WHERE event_id=p_event_id AND space_id=s.space_id),
        'nb_pointes', (SELECT COUNT(*) FROM event_staff_preplan WHERE event_id=p_event_id AND space_id=s.space_id AND status='pointé')
      ) ORDER BY s.space_name), '[]'::json)
      FROM event_spaces es JOIN spaces s ON s.space_id=es.space_id
      WHERE es.event_id=p_event_id AND s.active=true)
  );
END; $$;

-- ── RPC zone : liste pré-remplie depuis le token ────────────────────────────
CREATE OR REPLACE FUNCTION zone_get_preplan_staff(p_token TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_event_id UUID; v_space_id UUID;
BEGIN
  SELECT event_id, space_id INTO v_event_id, v_space_id
  FROM match_access_sessions WHERE session_token = p_token AND is_active = true;
  IF v_event_id IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session invalide'); END IF;
  RETURN json_build_object(
    'success', true,
    'is_prelocked', EXISTS (SELECT 1 FROM event_staff_preplan WHERE event_id=v_event_id AND space_id=v_space_id AND confirmed_by_hr=true),
    'staff', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', esp.id, 'nom', esp.agent_nom, 'prenom', esp.agent_prenom,
        'full_name', esp.agent_prenom || ' ' || esp.agent_nom, 'role', esp.agent_role,
        'planned_start', esp.planned_start, 'planned_end', esp.planned_end, 'planned_hours', esp.planned_hours,
        'actual_start', esp.actual_start, 'actual_end', esp.actual_end, 'status', esp.status
      ) ORDER BY esp.agent_role, esp.agent_nom), '[]'::json)
      FROM event_staff_preplan esp
      WHERE esp.event_id=v_event_id AND esp.space_id=v_space_id AND esp.status <> 'absent')
  );
END; $$;

-- ── RPC zone : pointage d'un agent (+ écriture zone_staff_hours) ─────────────
CREATE OR REPLACE FUNCTION zone_pointage_agent(
  p_token TEXT, p_agent_id UUID, p_status TEXT,
  p_start TIME DEFAULT NULL, p_end TIME DEFAULT NULL, p_note TEXT DEFAULT NULL
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_event_id UUID; v_space_id UUID; v_staff_name TEXT;
  v_agent event_staff_preplan%ROWTYPE; v_zsh_id UUID; v_existing UUID;
BEGIN
  SELECT event_id, space_id, staff_name INTO v_event_id, v_space_id, v_staff_name
  FROM match_access_sessions WHERE session_token = p_token AND is_active = true;
  IF v_event_id IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session invalide'); END IF;

  SELECT * INTO v_agent FROM event_staff_preplan
  WHERE id=p_agent_id AND event_id=v_event_id AND space_id=v_space_id;
  IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'Agent non trouvé'); END IF;

  v_existing := v_agent.zone_staff_hour_id;

  IF p_status = 'pointé' AND p_start IS NOT NULL THEN
    IF v_existing IS NOT NULL THEN
      -- Déjà pointé : mise à jour (pas de doublon).
      UPDATE zone_staff_hours SET
        arrival_time=COALESCE(p_start, v_agent.planned_start), departure_time=p_end,
        hourly_rate=v_agent.hourly_rate, confirmed_by_manager=true, entered_by=v_staff_name
      WHERE id=v_existing;
      v_zsh_id := v_existing;
    ELSE
      INSERT INTO zone_staff_hours (event_id, space_id, staff_name, role, arrival_time, departure_time, hourly_rate, entered_by, confirmed_by_manager)
      VALUES (v_event_id, v_space_id, v_agent.agent_prenom || ' ' || v_agent.agent_nom, v_agent.agent_role,
              COALESCE(p_start, v_agent.planned_start), p_end, v_agent.hourly_rate, v_staff_name, true)
      RETURNING id INTO v_zsh_id;
    END IF;
  END IF;

  UPDATE event_staff_preplan SET
    status=p_status,
    actual_start=COALESCE(p_start, actual_start, planned_start),
    actual_end=COALESCE(p_end, actual_end),
    confirmed_by_zone=(p_status='pointé'),
    note=COALESCE(p_note, note),
    updated_by=v_staff_name,
    zone_staff_hour_id=COALESCE(v_zsh_id, zone_staff_hour_id)
  WHERE id=p_agent_id;

  RETURN json_build_object('success', true, 'zsh_id', v_zsh_id, 'status', p_status);
END; $$;

GRANT EXECUTE ON FUNCTION hr_get_preplan(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION hr_upsert_agent(UUID,UUID,UUID,TEXT,TEXT,TEXT,TIME,TIME,DECIMAL,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION hr_lock_preplan(UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION zone_get_preplan_staff(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION zone_pointage_agent(TEXT,UUID,TEXT,TIME,TIME,TEXT) TO anon, authenticated;
