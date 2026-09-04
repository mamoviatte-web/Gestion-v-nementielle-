-- =====================================================================
-- Coûts événement — refléter les PRIX FIGÉS partout (rapport séminaire,
-- total consolidé F&B+RH)
-- ---------------------------------------------------------------------
-- get_event_costs (source F&B du rapport séminaire) et event_cost_details
-- (→ event_cost_summary, total consolidé) valorisaient au prix CATALOGUE.
-- On bascule le CALCUL sur le prix EFFECTIF = COALESCE(frozen, catalogue),
-- cohérent avec event_stock_summary et consumption_cost_ht. La colonne
-- unit_price_ht de event_cost_details reste le prix catalogue (pour les
-- consommateurs existants) ; seuls line_cost_ht / cost_per_pax passent au
-- prix effectif.
-- =====================================================================

-- 1) get_event_costs : F&B au prix effectif --------------------------
create or replace function public.get_event_costs(p_event_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_fb      DECIMAL(12,2) := 0;
  v_rh      DECIMAL(12,2) := 0;
  v_occ     DECIMAL(12,2) := 0;
  v_ext     DECIMAL(12,2) := 0;
  v_missing INT := 0;
BEGIN
  SELECT
    COALESCE(SUM((esl.initial_qty + COALESCE(esl.reassort_qty,0)
                  - COALESCE(esl.final_qty,0))
                 * COALESCE(esl.frozen_unit_price_ht, p.unit_price_ht, 0)), 0),
    COUNT(*) FILTER (WHERE esl.final_qty IS NULL
                       AND (esl.initial_qty > 0 OR COALESCE(esl.reassort_qty,0) > 0))
  INTO v_fb, v_missing
  FROM event_stock_lines esl
  JOIN products p ON p.product_id = esl.product_id
  WHERE esl.event_id = p_event_id
    AND COALESCE(esl.frozen_unit_price_ht, p.unit_price_ht) IS NOT NULL;

  SELECT COALESCE(SUM(CASE WHEN sc.actual_departure IS NOT NULL AND sc.hourly_rate IS NOT NULL
    THEN compute_actual_hours(sc.planned_arrival, sc.actual_departure) * sc.hourly_rate ELSE 0 END), 0)
  INTO v_rh FROM schedules sc WHERE sc.event_id = p_event_id;

  IF to_regclass('public.occasional_hours') IS NOT NULL THEN
    EXECUTE 'SELECT COALESCE(SUM(total_cost),0) FROM occasional_hours WHERE event_id = $1'
      INTO v_occ USING p_event_id;
  END IF;

  SELECT COALESCE(SUM(amount_ht), 0) INTO v_ext
  FROM event_external_charges WHERE event_id = p_event_id;

  RETURN json_build_object(
    'fb_cost_ht',       ROUND(v_fb, 2),
    'rh_cost',          ROUND(v_rh + v_occ, 2),
    'external_cost_ht', ROUND(v_ext, 2),
    'total_cost_ht',    ROUND(v_fb + v_rh + v_occ + v_ext, 2),
    'missing_clotures', v_missing
  );
END; $function$;

-- 2) event_cost_details : line_cost_ht / cost_per_pax au prix effectif
create or replace view public.event_cost_details as
 SELECT e.event_id,
    e.event_name,
    e.event_type,
    e.event_date,
    e.expected_attendees AS pax,
    e.status,
    s.space_id,
    s.space_name,
    s.space_type,
    p.product_id,
    p.product_name,
    p.category,
    p.unit,
    p.unit_price_ht,
    esl.initial_qty,
    COALESCE(esl.reassort_qty, 0) AS reassort_qty,
    esl.final_qty,
        CASE
            WHEN esl.final_qty IS NOT NULL THEN esl.initial_qty + COALESCE(esl.reassort_qty, 0) - esl.final_qty
            ELSE NULL::integer
        END AS consumed_qty,
        CASE
            WHEN esl.final_qty IS NOT NULL AND COALESCE(esl.frozen_unit_price_ht, p.unit_price_ht) IS NOT NULL
              THEN COALESCE(esl.frozen_unit_price_ht, p.unit_price_ht) * (esl.initial_qty + COALESCE(esl.reassort_qty, 0) - esl.final_qty)::numeric
            ELSE NULL::numeric
        END AS line_cost_ht,
        CASE
            WHEN esl.final_qty IS NOT NULL AND COALESCE(esl.frozen_unit_price_ht, p.unit_price_ht) IS NOT NULL AND e.expected_attendees > 0
              THEN COALESCE(esl.frozen_unit_price_ht, p.unit_price_ht) * (esl.initial_qty + COALESCE(esl.reassort_qty, 0) - esl.final_qty)::numeric / e.expected_attendees::numeric
            ELSE NULL::numeric
        END AS cost_per_pax,
    esl.product_state,
    esl.responsable_nom
   FROM event_stock_lines esl
     JOIN events e ON e.event_id = esl.event_id
     JOIN spaces s ON s.space_id = esl.space_id
     JOIN products p ON p.product_id = esl.product_id
  WHERE p.active = true;
