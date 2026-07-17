-- ═══════════════════════════════════════════════════════════════════════════
-- event_planning_phases.sql — planning hebdomadaire dynamique (remplace l'Excel).
--   BLOC 1 — table des phases opérationnelles + auto-création + backfill
--   BLOC 2 — vue weekly_planning (auto-alimentée par les événements)
--
-- ⚠ ADAPTATIONS AU SCHÉMA RÉEL :
--   • events n'a PAS pax_count → expected_attendees (aliasé pax_count dans la vue).
--   • event_type = 'séminaire' (accentué) ; couleur = match vs non-match.
--   • zone_staff_hours n'a PAS agent_role → colonne `role` ; le régisseur vient
--     de events.regisseur_name (fiable), pas d'un rôle RH.
--   • RLS via is_stade() (helper existant), pas via auth.jwt() brut.
--   • Index unique partiel + NOT EXISTS → auto-création idempotente.
--   • RG-003 : weekly_planning porte des coûts → admin only.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS event_planning_phases (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  space_id     UUID REFERENCES spaces(space_id) ON DELETE SET NULL,
  phase_type   TEXT NOT NULL CHECK (phase_type IN (
    'mise_en_place', 'evenement', 'demontage', 'ilot', 'autre'
  )),
  phase_date   DATE NOT NULL,
  start_time   TIME,
  end_time     TIME,
  label        TEXT,
  detail       TEXT,
  nb_personnes INT DEFAULT 0,
  regisseur    TEXT,
  is_validated BOOLEAN DEFAULT false,
  color        TEXT DEFAULT '#1A1A2E',
  created_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE event_planning_phases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stade_all_phases ON event_planning_phases;
CREATE POLICY stade_all_phases ON event_planning_phases
  FOR ALL TO authenticated USING (is_stade()) WITH CHECK (is_stade());

CREATE INDEX IF NOT EXISTS idx_phases_date  ON event_planning_phases(phase_date);
CREATE INDEX IF NOT EXISTS idx_phases_event ON event_planning_phases(event_id);
-- Une seule phase auto « evenement » par événement (idempotence trigger/backfill).
CREATE UNIQUE INDEX IF NOT EXISTS idx_phases_event_evenement
  ON event_planning_phases(event_id) WHERE phase_type = 'evenement';

-- Auto-création de la phase « evenement » à la création d'un événement.
CREATE OR REPLACE FUNCTION auto_create_event_phases()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO event_planning_phases (event_id, phase_type, phase_date, start_time, label, color)
  VALUES (
    NEW.event_id, 'evenement', NEW.event_date::date, NEW.start_time, NEW.event_name,
    CASE WHEN NEW.event_type = 'match' THEN '#1A1A2E' ELSE '#2563EB' END
  )
  ON CONFLICT (event_id) WHERE phase_type = 'evenement' DO NOTHING;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_auto_phases ON events;
CREATE TRIGGER trg_auto_phases AFTER INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION auto_create_event_phases();

-- Backfill des événements existants (non archivés), idempotent.
INSERT INTO event_planning_phases (event_id, phase_type, phase_date, start_time, label, color)
SELECT e.event_id, 'evenement', e.event_date::date, e.start_time, e.event_name,
       CASE WHEN e.event_type = 'match' THEN '#1A1A2E' ELSE '#2563EB' END
FROM events e
WHERE e.status <> 'archivé'
  AND NOT EXISTS (
    SELECT 1 FROM event_planning_phases p
    WHERE p.event_id = e.event_id AND p.phase_type = 'evenement'
  );

-- ══════════════════════════════════════════════════════════════════════════
-- BLOC 2 — Vue planning hebdomadaire
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW weekly_planning AS
SELECT
  e.event_id,
  e.event_name,
  e.event_type,
  e.status,
  e.expected_attendees                          AS pax_count,
  e.event_date::date                            AS event_day,
  EXTRACT(DOW FROM e.event_date)                AS day_of_week,
  TO_CHAR(e.event_date, 'IYYY-IW')              AS iso_week,
  e.start_time,

  (SELECT s.space_name FROM event_spaces es
   JOIN spaces s ON s.space_id = es.space_id
   WHERE es.event_id = e.event_id
   ORDER BY s.service_type, s.space_name LIMIT 1)  AS space_principal,

  (SELECT STRING_AGG(s.space_name, ' · ' ORDER BY s.service_type, s.space_name)
   FROM event_spaces es JOIN spaces s ON s.space_id = es.space_id
   WHERE es.event_id = e.event_id)                 AS all_spaces,

  -- Régisseur : champ événement (fiable), pas un rôle RH inexistant.
  e.regisseur_name                              AS regisseurs,

  (SELECT COUNT(DISTINCT zsh.id) FROM zone_staff_hours zsh
   WHERE zsh.event_id = e.event_id)                AS nb_agents_total,

  (SELECT JSON_AGG(JSON_BUILD_OBJECT(
     'phase_type', p.phase_type, 'label', p.label, 'phase_date', p.phase_date,
     'start_time', p.start_time, 'regisseur', p.regisseur, 'color', p.color
   ) ORDER BY p.phase_date, p.start_time)
   FROM event_planning_phases p WHERE p.event_id = e.event_id)  AS phases,

  e.total_fb_cost_ht,
  e.total_rh_cost,
  CASE WHEN e.event_type = 'match' THEN '#1A1A2E' ELSE '#2563EB' END AS event_color

FROM events e
WHERE e.status <> 'archivé'
ORDER BY e.event_date;

ALTER VIEW weekly_planning SET (security_invoker = on);
GRANT SELECT ON weekly_planning TO authenticated;
REVOKE SELECT ON weekly_planning FROM anon;
