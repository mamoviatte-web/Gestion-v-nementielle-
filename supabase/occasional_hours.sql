-- ═══════════════════════════════════════════════════════════════════
-- Heures occasionnelles (mise en place, etc.) + vue cumulative par agent.
-- À APPLIQUER via MCP. RLS is_stade(). compute_actual_hours gère le minuit.
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS occasional_hours (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID REFERENCES events(event_id) ON DELETE CASCADE,
  staff_name   TEXT NOT NULL,
  mission_type TEXT NOT NULL DEFAULT 'mise_en_place'
               CHECK (mission_type IN ('mise_en_place','débarrassage','logistique','nettoyage','technique','sécurité','autre')),
  work_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  start_time   TIME,
  end_time     TIME,
  hours_worked DECIMAL(6,2) NOT NULL,
  hourly_rate  DECIMAL(8,2),
  total_cost   DECIMAL(10,2) GENERATED ALWAYS AS (hours_worked * COALESCE(hourly_rate, 0)) STORED,
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE occasional_hours ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stade_occ ON occasional_hours;
CREATE POLICY stade_occ ON occasional_hours FOR ALL TO authenticated
  USING (is_stade()) WITH CHECK (is_stade());

-- Vue cumulative : plannings (schedules) + heures occasionnelles.
CREATE OR REPLACE VIEW agent_hours_cumulative WITH (security_invoker = true) AS
  SELECT
    sc.staff_name, sc.role AS mission, e.event_name, e.event_date, e.event_type, e.event_id,
    'planifié' AS source,
    compute_actual_hours(sc.planned_arrival, sc.actual_departure) AS hours_worked,
    sc.hourly_rate,
    CASE WHEN sc.hourly_rate IS NOT NULL AND sc.actual_departure IS NOT NULL
      THEN compute_actual_hours(sc.planned_arrival, sc.actual_departure) * sc.hourly_rate END AS total_cost
  FROM schedules sc JOIN events e ON e.event_id = sc.event_id
  WHERE sc.staff_name IS NOT NULL
    AND sc.staff_name !~ '^[A-Z0-9]{6}$'
    AND sc.actual_departure IS NOT NULL
  UNION ALL
  SELECT
    oh.staff_name, oh.mission_type AS mission, COALESCE(e.event_name,'Sans événement') AS event_name,
    oh.work_date AS event_date, COALESCE(e.event_type,'autre') AS event_type, oh.event_id,
    'occasionnel' AS source, oh.hours_worked, oh.hourly_rate, oh.total_cost
  FROM occasional_hours oh LEFT JOIN events e ON e.event_id = oh.event_id;
