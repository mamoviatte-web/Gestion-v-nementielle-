-- =====================================================================
-- AXE 3 — « ASSURER LA CHARGE RH » : INCLURE zone_staff_hours DANS LES COÛTS
-- ---------------------------------------------------------------------
-- get_event_costs calculait la charge RH à partir des seules tables
-- `schedules` (planning admin) + `occasional_hours`, en IGNORANT
-- `zone_staff_hours` — c'est pourtant là que le régisseur enregistre son
-- équipe et ses prestataires externes (Axe 1). Résultat : les heures saisies
-- par le régisseur n'apparaissaient PAS dans la charge RH du rapport séminaire.
--
-- L'analytique RH (vue rh_monthly_hours) additionne déjà ces trois sources ;
-- get_event_costs était la seule à en omettre une. On la remet en cohérence :
-- la charge RH = schedules + occasional_hours + zone_staff_hours (coût généré).
-- Seules les lignes avec un taux horaire (rh_cost NON NULL) sont comptées.
-- Le calcul F&B / externes / total est inchangé. Idempotent.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_event_costs(p_event_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_fb      DECIMAL(12,2) := 0;
  v_rh      DECIMAL(12,2) := 0;
  v_occ     DECIMAL(12,2) := 0;
  v_zone    DECIMAL(12,2) := 0;
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

  -- Planning admin (schedules) : heures réelles pointées.
  SELECT COALESCE(SUM(CASE WHEN sc.actual_departure IS NOT NULL AND sc.hourly_rate IS NOT NULL
    THEN compute_actual_hours(sc.planned_arrival, sc.actual_departure) * sc.hourly_rate ELSE 0 END), 0)
  INTO v_rh FROM schedules sc WHERE sc.event_id = p_event_id;

  -- Heures occasionnelles (ponctuel / hors espace).
  IF to_regclass('public.occasional_hours') IS NOT NULL THEN
    EXECUTE 'SELECT COALESCE(SUM(total_cost),0) FROM occasional_hours WHERE event_id = $1'
      INTO v_occ USING p_event_id;
  END IF;

  -- Équipe & prestataires externes saisis par le régisseur (zone_staff_hours).
  SELECT COALESCE(SUM(z.rh_cost), 0)
  INTO v_zone FROM zone_staff_hours z
  WHERE z.event_id = p_event_id AND z.rh_cost IS NOT NULL;

  SELECT COALESCE(SUM(amount_ht), 0) INTO v_ext
  FROM event_external_charges WHERE event_id = p_event_id;

  RETURN json_build_object(
    'fb_cost_ht',       ROUND(v_fb, 2),
    'rh_cost',          ROUND(v_rh + v_occ + v_zone, 2),
    'external_cost_ht', ROUND(v_ext, 2),
    'total_cost_ht',    ROUND(v_fb + v_rh + v_occ + v_zone + v_ext, 2),
    'missing_clotures', v_missing
  );
END; $function$;
