-- ═══════════════════════════════════════════════════════════════════════════
-- zone_staff_hours.sql — Recensement RH d'un espace par le responsable (match).
-- Saisie libre de toute l'équipe (nom, rôle, arrivée/départ réels, pause).
-- Heures + coût calculés (colonnes générées, passage minuit géré).
--
-- ⚠ Adaptations : pas de buvette_zone_id (table buvette_zones inexistante ;
-- space_id porte déjà la buvette B1..B9). RLS is_stade() (standard projet) ;
-- les accès terrain (anon/token) passent par les RPC SECURITY DEFINER.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS zone_staff_hours (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  space_id       UUID NOT NULL REFERENCES spaces(space_id),
  staff_name     TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'Serveur' CHECK (role IN (
                   'Serveur','Chef de rang','Barman','Agent de sécurité','Runner',
                   'Hôte / Hôtesse','Responsable espace','Autre')),
  arrival_time   TIME NOT NULL,
  departure_time TIME,
  break_minutes  INT DEFAULT 0,
  -- Durée (h) : (départ − arrivée, +24h si passage minuit) − pause.
  hours_worked   DECIMAL(5,2) GENERATED ALWAYS AS (
    CASE WHEN departure_time IS NOT NULL THEN ROUND(
      ((EXTRACT(EPOCH FROM (departure_time - arrival_time))
        + CASE WHEN departure_time < arrival_time THEN 86400 ELSE 0 END) / 3600.0
       - COALESCE(break_minutes, 0) / 60.0)::numeric, 2)
    ELSE NULL END) STORED,
  hourly_rate    DECIMAL(8,2),
  rh_cost        DECIMAL(10,2) GENERATED ALWAYS AS (
    CASE WHEN departure_time IS NOT NULL AND hourly_rate IS NOT NULL THEN ROUND(
      (((EXTRACT(EPOCH FROM (departure_time - arrival_time))
         + CASE WHEN departure_time < arrival_time THEN 86400 ELSE 0 END) / 3600.0
        - COALESCE(break_minutes, 0) / 60.0) * hourly_rate)::numeric, 2)
    ELSE NULL END) STORED,
  confirmed_by_staff   BOOLEAN DEFAULT false,
  confirmed_by_manager BOOLEAN DEFAULT false,
  entered_by     TEXT,
  notes          TEXT,
  event_category TEXT DEFAULT 'match' CHECK (event_category IN ('match','seminaire','autre')),
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zsh_event_space ON zone_staff_hours(event_id, space_id);

ALTER TABLE zone_staff_hours ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stade_all_staff_hours ON zone_staff_hours;
CREATE POLICY stade_all_staff_hours ON zone_staff_hours
  FOR ALL TO authenticated USING (is_stade()) WITH CHECK (is_stade());

-- event_category auto (réutilise classify_event_type de charges_security.sql).
CREATE OR REPLACE FUNCTION set_zsh_event_category()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  SELECT classify_event_type(event_type) INTO NEW.event_category FROM events WHERE event_id = NEW.event_id;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_zsh_category ON zone_staff_hours;
CREATE TRIGGER trg_zsh_category BEFORE INSERT OR UPDATE OF event_id ON zone_staff_hours
  FOR EACH ROW EXECUTE FUNCTION set_zsh_event_category();

-- ── RPC : lecture équipe + synthèse ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_zone_staff_hours(p_token TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_e UUID; v_s UUID;
BEGIN
  SELECT event_id, space_id INTO v_e, v_s FROM match_access_sessions WHERE session_token = p_token AND is_active = true;
  IF v_e IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session invalide'); END IF;
  RETURN json_build_object(
    'success', true,
    'staff', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', h.id, 'staff_name', h.staff_name, 'role', h.role,
        'arrival_time', h.arrival_time, 'departure_time', h.departure_time,
        'break_minutes', h.break_minutes, 'hours_worked', h.hours_worked, 'rh_cost', h.rh_cost,
        'confirmed_by_staff', h.confirmed_by_staff, 'confirmed_by_manager', h.confirmed_by_manager,
        'notes', h.notes) ORDER BY h.role, h.staff_name), '[]'::json)
      FROM zone_staff_hours h WHERE h.event_id = v_e AND h.space_id = v_s),
    'summary', (
      SELECT json_build_object('total_staff', COUNT(*), 'total_hours', COALESCE(SUM(h.hours_worked), 0),
        'total_rh_cost', COALESCE(SUM(h.rh_cost), 0),
        'all_confirmed', COALESCE(BOOL_AND(h.confirmed_by_staff AND h.confirmed_by_manager), false))
      FROM zone_staff_hours h WHERE h.event_id = v_e AND h.space_id = v_s)
  );
END; $$;

-- ── RPC : ajout / mise à jour d'un membre ───────────────────────────────────
CREATE OR REPLACE FUNCTION upsert_zone_staff_member(
  p_token TEXT, p_staff_id UUID, p_staff_name TEXT, p_role TEXT,
  p_arrival_time TIME, p_departure_time TIME, p_break_minutes INT DEFAULT 0, p_notes TEXT DEFAULT NULL
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_e UUID; v_s UUID; v_mgr TEXT; v_id UUID;
BEGIN
  SELECT event_id, space_id, staff_name INTO v_e, v_s, v_mgr FROM match_access_sessions WHERE session_token = p_token AND is_active = true;
  IF v_e IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session invalide'); END IF;
  IF length(TRIM(COALESCE(p_staff_name, ''))) < 2 THEN RETURN json_build_object('success', false, 'error', 'Nom requis'); END IF;
  IF p_staff_id IS NULL THEN
    INSERT INTO zone_staff_hours (event_id, space_id, staff_name, role, arrival_time, departure_time, break_minutes, notes, entered_by)
    VALUES (v_e, v_s, INITCAP(TRIM(p_staff_name)), p_role, p_arrival_time, p_departure_time, COALESCE(p_break_minutes, 0), p_notes, v_mgr)
    RETURNING id INTO v_id;
  ELSE
    UPDATE zone_staff_hours SET staff_name = INITCAP(TRIM(p_staff_name)), role = p_role,
      arrival_time = p_arrival_time, departure_time = p_departure_time, break_minutes = COALESCE(p_break_minutes, 0),
      notes = p_notes, updated_at = now()
    WHERE id = p_staff_id AND event_id = v_e AND space_id = v_s RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN json_build_object('success', false, 'error', 'Agent introuvable'); END IF;
  END IF;
  RETURN json_build_object('success', true, 'id', v_id);
END; $$;

-- ── RPC : bascule d'une confirmation ────────────────────────────────────────
CREATE OR REPLACE FUNCTION confirm_zone_staff_hour(p_token TEXT, p_staff_id UUID, p_type TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_e UUID; v_s UUID;
BEGIN
  SELECT event_id, space_id INTO v_e, v_s FROM match_access_sessions WHERE session_token = p_token AND is_active = true;
  IF v_e IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session invalide'); END IF;
  IF p_type = 'staff' THEN
    UPDATE zone_staff_hours SET confirmed_by_staff = NOT confirmed_by_staff, updated_at = now()
     WHERE id = p_staff_id AND event_id = v_e AND space_id = v_s;
  ELSIF p_type = 'manager' THEN
    UPDATE zone_staff_hours SET confirmed_by_manager = NOT confirmed_by_manager, updated_at = now()
     WHERE id = p_staff_id AND event_id = v_e AND space_id = v_s;
  END IF;
  RETURN json_build_object('success', true);
END; $$;

-- ── RPC : suppression ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION delete_zone_staff_member(p_token TEXT, p_staff_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_e UUID; v_s UUID;
BEGIN
  SELECT event_id, space_id INTO v_e, v_s FROM match_access_sessions WHERE session_token = p_token AND is_active = true;
  IF v_e IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session invalide'); END IF;
  DELETE FROM zone_staff_hours WHERE id = p_staff_id AND event_id = v_e AND space_id = v_s;
  RETURN json_build_object('success', true);
END; $$;

GRANT EXECUTE ON FUNCTION get_zone_staff_hours(TEXT), delete_zone_staff_member(TEXT, UUID),
  confirm_zone_staff_hour(TEXT, UUID, TEXT),
  upsert_zone_staff_member(TEXT, UUID, TEXT, TEXT, TIME, TIME, INT, TEXT) TO anon, authenticated;

-- ── Vue admin : charges RH par événement (zone_staff_hours) ─────────────────
CREATE OR REPLACE VIEW event_rh_summary
WITH (security_invoker = true) AS
SELECT
  e.event_id, e.event_name, e.event_type, e.event_date,
  COUNT(DISTINCT zsh.id)                          AS nb_agents_declares,
  COALESCE(SUM(zsh.hours_worked), 0)              AS total_hours_worked,
  COALESCE(SUM(zsh.rh_cost), 0)                   AS total_rh_cost_calculated,
  COUNT(DISTINCT zsh.space_id)                    AS nb_espaces_declares,
  COUNT(zsh.id) FILTER (WHERE zsh.confirmed_by_staff AND zsh.confirmed_by_manager) AS nb_agents_confirmes
FROM events e
LEFT JOIN zone_staff_hours zsh ON zsh.event_id = e.event_id
WHERE e.status IN ('clôturé','archivé','en_cours')
GROUP BY e.event_id, e.event_name, e.event_type, e.event_date;

GRANT SELECT ON event_rh_summary TO authenticated;
