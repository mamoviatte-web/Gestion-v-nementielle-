-- ═══════════════════════════════════════════════════════════════════
-- Module Analyse RH — Staff & Horaires. Appliqué via Supabase MCP le 2026-07-01.
-- Corrections vs prompt d'origine :
--   • schedules.PK = schedule_id (le prompt utilisait sc.id → 42703)
--   • pas de colonne actual_arrival ; computed_hours = actual_departure - planned_arrival
--   • RLS via is_stade() (le claim JWT 'role' vaut 'authenticated')
-- ═══════════════════════════════════════════════════════════════════

-- Enrichissement schedules
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS hourly_rate   DECIMAL(8,2);
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS mission_type  TEXT;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS is_external   BOOLEAN DEFAULT false;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS contract_type TEXT;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS computed_hours DECIMAL(6,2) GENERATED ALWAYS AS (
  CASE WHEN actual_departure IS NOT NULL AND planned_arrival IS NOT NULL
    THEN EXTRACT(EPOCH FROM (actual_departure - planned_arrival)) / 3600 ELSE NULL END) STORED;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS overtime_hours DECIMAL(6,2);

-- Tables (voir migrations staff_analytics_tables / _functions pour le corps exact)
--   staff_analytics(space_id, role_name, event_type UNIQUE) : ratios historiques par rôle × espace
--   staff_event_summary(event_id UNIQUE) : résumé RH consolidé + efficiency_score + alert_details JSONB
-- RLS : stade_full_* via is_stade().
--
-- Fonctions :
--   compute_staff_hours(event_id) RETURNS TABLE (détail par agent : heures prévues/réelles/sup + alert_type)
--   compute_event_staff_summary(event_id) : upsert staff_event_summary + PERFORM compute_staff_analytics_by_role
--   compute_staff_analytics_by_role(event_id) : moyennes glissantes par rôle × espace (clôturé/archivé)
-- Trigger trg_staff_summary_on_close : recalcul AFTER UPDATE events → clôturé/archivé.
--
-- efficiency_score = total_actual_hours / total_planned_hours (1.0 = optimal, >1 sur-staffé, <1 sous-staffé)
-- Cibles agents/100pax par type d'espace : voir src/lib/staffTargets.ts.
