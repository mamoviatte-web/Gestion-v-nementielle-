-- ═══════════════════════════════════════════════════════════════════
-- get_event_costs(event) — coûts F&B + RH d'un événement (À APPLIQUER via MCP).
-- Défensif : lit occasional_hours seulement si la table existe (bloc 4).
-- compute_actual_hours(time,time) existe déjà (passage minuit géré).
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION get_event_costs(p_event_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_fb DECIMAL(12,2) := 0; v_rh DECIMAL(12,2) := 0; v_occ DECIMAL(12,2) := 0;
BEGIN
  SELECT COALESCE(SUM((esl.initial_qty + COALESCE(esl.reassort_qty,0) - esl.final_qty)
                      * COALESCE(p.unit_price_ht,0)), 0)
  INTO v_fb
  FROM event_stock_lines esl JOIN products p ON p.product_id = esl.product_id
  WHERE esl.event_id = p_event_id AND esl.final_qty IS NOT NULL AND p.unit_price_ht IS NOT NULL;

  SELECT COALESCE(SUM(CASE WHEN sc.actual_departure IS NOT NULL AND sc.hourly_rate IS NOT NULL
    THEN compute_actual_hours(sc.planned_arrival, sc.actual_departure) * sc.hourly_rate ELSE 0 END), 0)
  INTO v_rh FROM schedules sc WHERE sc.event_id = p_event_id;

  IF to_regclass('public.occasional_hours') IS NOT NULL THEN
    EXECUTE 'SELECT COALESCE(SUM(total_cost),0) FROM occasional_hours WHERE event_id = $1'
      INTO v_occ USING p_event_id;
  END IF;

  RETURN json_build_object(
    'fb_cost_ht',    ROUND(v_fb, 2),
    'rh_cost',       ROUND(v_rh + v_occ, 2),
    'total_cost_ht', ROUND(v_fb + v_rh + v_occ, 2)
  );
END; $$;
