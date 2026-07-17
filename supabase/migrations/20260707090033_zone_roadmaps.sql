-- ═══════════════════════════════════════════════════════════════════════════
-- zone_roadmaps.sql — Feuille de route par espace (brief) : admin remplit,
-- responsable lit. Pré-initialisée à la création du match → jamais de page vide.
--
-- ⚠ Adaptations : get_zone_roadmap EXISTE déjà (dotations runner + horaires) →
--   on l'ÉTEND avec le brief (sans casser MatchZoneRoadmap). RLS is_stade() ;
--   pax = events.expected_attendees (pas pax_count) ; résolution via
--   _zone_resolve (token exact). Le brief n'est renvoyé au responsable que si
--   is_published = true (brouillon masqué).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS zone_roadmaps (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  space_id       UUID NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
  brief_client   TEXT,
  brief_consigne TEXT,
  brief_dress    TEXT,
  brief_horaires TEXT,
  nb_pax_espace  INT,
  dotations      JSONB,
  info_contact   TEXT,
  info_acces     TEXT,
  info_materiel  TEXT,
  is_published   BOOLEAN DEFAULT false,
  published_at   TIMESTAMPTZ,
  published_by   TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (event_id, space_id)
);
ALTER TABLE zone_roadmaps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stade_all_roadmaps ON zone_roadmaps;
CREATE POLICY stade_all_roadmaps ON zone_roadmaps
  FOR ALL TO authenticated USING (is_stade()) WITH CHECK (is_stade());
CREATE INDEX IF NOT EXISTS idx_roadmaps_event_space ON zone_roadmaps(event_id, space_id);

CREATE OR REPLACE FUNCTION set_roadmap_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_roadmap_updated ON zone_roadmaps;
CREATE TRIGGER trg_roadmap_updated BEFORE UPDATE ON zone_roadmaps
  FOR EACH ROW EXECUTE FUNCTION set_roadmap_updated_at();

-- ── Auto-création : une feuille par espace lié ──────────────────────────────
CREATE OR REPLACE FUNCTION init_event_roadmaps(p_event_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_count INT := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM events WHERE event_id = p_event_id) THEN
    RETURN json_build_object('success', false, 'error', 'Événement non trouvé');
  END IF;
  INSERT INTO zone_roadmaps (event_id, space_id, is_published)
  SELECT p_event_id, es.space_id, false
  FROM event_spaces es JOIN spaces s ON s.space_id = es.space_id
  WHERE es.event_id = p_event_id AND s.active = true
  ON CONFLICT (event_id, space_id) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN json_build_object('success', true, 'created', v_count);
END; $$;
GRANT EXECUTE ON FUNCTION init_event_roadmaps(UUID) TO authenticated;

-- Backfill de tous les événements non archivés.
DO $$
DECLARE v_id UUID;
BEGIN
  FOR v_id IN SELECT event_id FROM events WHERE status <> 'archivé' LOOP
    PERFORM init_event_roadmaps(v_id);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION auto_init_roadmaps()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_TABLE_NAME = 'events' THEN
    PERFORM init_event_roadmaps(NEW.event_id);           -- matchs ET séminaires
  ELSIF TG_TABLE_NAME = 'event_spaces' THEN
    INSERT INTO zone_roadmaps (event_id, space_id, is_published)
    VALUES (NEW.event_id, NEW.space_id, false)
    ON CONFLICT (event_id, space_id) DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_auto_roadmaps_events ON events;
CREATE TRIGGER trg_auto_roadmaps_events AFTER INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION auto_init_roadmaps();
DROP TRIGGER IF EXISTS trg_auto_roadmaps_spaces ON event_spaces;
CREATE TRIGGER trg_auto_roadmaps_spaces AFTER INSERT ON event_spaces
  FOR EACH ROW EXECUTE FUNCTION auto_init_roadmaps();

-- ── get_zone_roadmap ÉTENDU : dotations runner + horaires + BRIEF ───────────
CREATE OR REPLACE FUNCTION get_zone_roadmap(p_token text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_e UUID; v_s UUID; v_n TEXT; v_prof TEXT;
        v_ev events%ROWTYPE; v_sp spaces%ROWTYPE; v_rm zone_roadmaps%ROWTYPE; v_pub BOOLEAN;
BEGIN
  SELECT * INTO v_e, v_s, v_n FROM _zone_resolve(p_token);
  IF v_e IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session expirée'); END IF;
  v_prof := space_profile(v_n);
  SELECT * INTO v_ev FROM events WHERE event_id = v_e;
  SELECT * INTO v_sp FROM spaces WHERE space_id = v_s;

  SELECT * INTO v_rm FROM zone_roadmaps WHERE event_id = v_e AND space_id = v_s;
  IF NOT FOUND THEN
    INSERT INTO zone_roadmaps (event_id, space_id, is_published) VALUES (v_e, v_s, false)
    ON CONFLICT (event_id, space_id) DO NOTHING;
    SELECT * INTO v_rm FROM zone_roadmaps WHERE event_id = v_e AND space_id = v_s;
  END IF;
  v_pub := COALESCE(v_rm.is_published, false);  -- brief masqué tant que non publié

  RETURN json_build_object(
    'success', true,
    'event_name', v_ev.event_name, 'event_date', v_ev.event_date, 'start_time', v_ev.start_time,
    'pax_count', v_ev.expected_attendees,
    'space_name', v_sp.space_name, 'service_type', v_sp.service_type,
    'is_published', v_pub,
    'brief_client',   CASE WHEN v_pub THEN v_rm.brief_client   END,
    'brief_consigne', CASE WHEN v_pub THEN v_rm.brief_consigne END,
    'brief_dress',    CASE WHEN v_pub THEN v_rm.brief_dress    END,
    'brief_horaires', CASE WHEN v_pub THEN v_rm.brief_horaires END,
    'nb_pax_espace',  CASE WHEN v_pub THEN v_rm.nb_pax_espace  END,
    'brief_dotations', CASE WHEN v_pub THEN COALESCE(v_rm.dotations, '[]'::jsonb) ELSE '[]'::jsonb END,
    'info_contact',  CASE WHEN v_pub THEN v_rm.info_contact  END,
    'info_acces',    CASE WHEN v_pub THEN v_rm.info_acces    END,
    'info_materiel', CASE WHEN v_pub THEN v_rm.info_materiel END,
    'published_by',  CASE WHEN v_pub THEN v_rm.published_by  END,
    'published_at',  CASE WHEN v_pub THEN v_rm.published_at  END,
    'dotations', (
      SELECT COALESCE(json_agg(json_build_object(
        'product_name', p.product_name, 'category', p.category, 'unit', p.unit,
        'planned_qty', rd.planned_qty, 'runner_status', rd.runner_status
      ) ORDER BY p.category, p.product_name), '[]'::json)
      FROM runner_dotations rd JOIN products p ON p.product_id = rd.product_id
      WHERE rd.event_id = v_e AND rd.space_id = v_s
        AND (v_prof = ANY(p.space_types) OR p.space_types IS NULL OR p.space_types = '{}')),
    'schedules', (
      SELECT COALESCE(json_agg(json_build_object(
        'staff_name', sc.staff_name, 'role', sc.role,
        'planned_arrival', sc.planned_arrival, 'planned_departure', sc.planned_departure
      ) ORDER BY sc.planned_arrival), '[]'::json)
      FROM schedules sc WHERE sc.event_id = v_e AND sc.space_id = v_s)
  );
END; $$;
GRANT EXECUTE ON FUNCTION get_zone_roadmap(TEXT) TO anon, authenticated;
