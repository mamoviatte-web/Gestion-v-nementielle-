-- ═══════════════════════════════════════════════════════════════════════════
-- fix_closure_and_pdf_photos.sql
--
-- 1. FIX CLÔTURE : generate_seminar_report_draft (déclenchée AFTER UPDATE sur
--    events lors de la clôture d'un séminaire) faisait « ORDER BY sc.created_at »
--    alors que la table schedules n'a PAS de colonne created_at → la clôture
--    échouait silencieusement (rollback) → bouton « Clôturer » sans effet.
--    Correctif : ordonner par planned_arrival (colonne réelle).
--
-- 2. Sélection photos PDF : colonnes include_in_pdf / pdf_caption / pdf_order
--    sur debrief_photos (le régisseur choisit les photos du rapport PDF).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Correctif clôture ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_seminar_report_draft(p_event_id uuid)
RETURNS void LANGUAGE plpgsql AS $function$
DECLARE v_event events%ROWTYPE; v_costs JSON; v_regisseur TEXT; v_traiteur TEXT; v_bullets JSONB := '[]';
BEGIN
  SELECT * INTO v_event FROM events WHERE event_id = p_event_id;
  IF v_event.event_type = 'match' THEN RETURN; END IF;

  SELECT get_event_costs(p_event_id) INTO v_costs;

  SELECT sc.staff_name INTO v_regisseur
    FROM schedules sc
   WHERE sc.event_id = p_event_id AND sc.staff_name IS NOT NULL
     AND sc.staff_name !~ '^[A-Z0-9]{6}$'
   ORDER BY sc.planned_arrival NULLS LAST      -- ← était sc.created_at (inexistant)
   LIMIT 1;
  v_regisseur := COALESCE(v_regisseur, v_event.regisseur_name,
                          (SELECT responsable FROM debriefs WHERE event_id = p_event_id LIMIT 1));

  SELECT pp.provider_company INTO v_traiteur
    FROM provider_presence pp
   WHERE pp.event_id = p_event_id AND pp.provider_type = 'traiteur' LIMIT 1;

  INSERT INTO seminar_report_draft (
    event_id, report_title, client_name, report_date, regisseur_name, traiteur_company, pax,
    total_fb_cost_ht, total_rh_cost, total_cost_ht, gain_net_ht, debrief_bullets, draft_status)
  VALUES (
    p_event_id,
    'RETOUR ' || UPPER(v_event.event_name) || ' ' || TO_CHAR(v_event.event_date,'DD/MM'),
    v_event.event_name, v_event.event_date, v_regisseur, v_traiteur, v_event.expected_attendees,
    (v_costs->>'fb_cost_ht')::DECIMAL, (v_costs->>'rh_cost')::DECIMAL,
    (v_costs->>'total_cost_ht')::DECIMAL, 0 - (v_costs->>'total_cost_ht')::DECIMAL,
    v_bullets, 'brouillon')
  ON CONFLICT (event_id) DO UPDATE SET
    total_fb_cost_ht = EXCLUDED.total_fb_cost_ht, total_rh_cost = EXCLUDED.total_rh_cost,
    total_cost_ht = EXCLUDED.total_cost_ht, gain_net_ht = EXCLUDED.gain_net_ht;
END; $function$;

-- ── 2. Colonnes sélection PDF sur debrief_photos ────────────────────────────
ALTER TABLE debrief_photos
  ADD COLUMN IF NOT EXISTS include_in_pdf BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS pdf_caption    TEXT,
  ADD COLUMN IF NOT EXISTS pdf_order      INT DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_debrief_photos_pdf
  ON debrief_photos(event_id, include_in_pdf, photo_type)
  WHERE include_in_pdf = true;

-- Politique UPDATE manquante (seuls SELECT/INSERT/DELETE existaient) : sans elle,
-- le toggle include_in_pdf / pdf_caption serait bloqué silencieusement par la RLS.
DROP POLICY IF EXISTS debrief_photos_update ON debrief_photos;
CREATE POLICY debrief_photos_update ON debrief_photos
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
