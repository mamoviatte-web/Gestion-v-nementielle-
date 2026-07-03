-- ═══════════════════════════════════════════════════════════════════
-- Corrections RH (appliqué via MCP le 2026-07-03).
-- 1) Heures négatives : passage minuit non géré. Un régisseur arrivé 06:00 et
--    parti 01:00 (lendemain) donnait -5h au lieu de +19h.
-- 2) Nom régisseur : nettoyage des staff_name valant un code d'accès zone.
-- ═══════════════════════════════════════════════════════════════════

-- Fonctions utilitaires : ajoutent 24h si départ < arrivée.
CREATE OR REPLACE FUNCTION compute_actual_hours(p_arrival time, p_departure time)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_arrival IS NULL OR p_departure IS NULL THEN RETURN NULL; END IF;
  IF p_departure < p_arrival THEN
    RETURN ROUND((EXTRACT(EPOCH FROM (p_departure - p_arrival + INTERVAL '24 hours'))/3600)::numeric, 2);
  ELSE
    RETURN ROUND((EXTRACT(EPOCH FROM (p_departure - p_arrival))/3600)::numeric, 2);
  END IF;
END; $$;
CREATE OR REPLACE FUNCTION compute_planned_hours(p_arrival time, p_departure time)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN compute_actual_hours(p_arrival, p_departure); END; $$;

-- compute_staff_hours() et generate_monthly_staff_report() réécrites pour
-- utiliser ces fonctions (planned/actual/delta/overtime). Voir migrations
-- fix_midnight_hours.

-- computed_hours est une COLONNE GÉNÉRÉE : l'expression avait le bug minuit.
-- Redéfinie via drop/add :
--   ALTER TABLE schedules DROP COLUMN computed_hours;
--   ALTER TABLE schedules ADD COLUMN computed_hours numeric
--     GENERATED ALWAYS AS (compute_actual_hours(planned_arrival, actual_departure)) STORED;
-- overtime_hours (colonne simple) recalculée = max(0, réelles - prévues).

-- Nettoyage noms = codes d'accès : remplacés par le nom terrain si disponible.
-- UPDATE schedules sc SET staff_name = es.space_responsible_name
--   FROM event_spaces es
--  WHERE es.event_id=sc.event_id AND es.space_id=sc.space_id
--    AND sc.staff_name ~ '^[A-Z0-9]{6}$'
--    AND es.space_responsible_name !~ '^[A-Z0-9]{6}$';

-- Vérification AIRBUS : HUGO PASCAL 06:00 → 01:00 = 19.00h (au lieu de -5.00h).
