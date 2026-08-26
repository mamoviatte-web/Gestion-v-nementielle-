-- CTR-1 Phase 3.3 — le recalcul des coefficients alimente le catalogue
-- ============================================================================
-- sync_catalog_complement() reconstruit le membership 'complement' du catalogue
-- = source exacte du bloc (2) de generate_runner_dotations
-- (space_product_coefficients avg>0 filtré par le référentiel, hors loges/buvettes,
-- hors socle). compute_space_coefficients() l'appelle en fin de recalcul → le
-- catalogue reste synchronisé à chaque recompute des coefficients.
-- (La garde area_product_reference / l'array de loges seront retirés par CTR-3/4.)

CREATE OR REPLACE FUNCTION public.sync_catalog_complement()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  delete from space_product_catalog where membership_level='complement';
  insert into space_product_catalog (space_id, product_id, membership_level, association_level, product_family, is_default, avg_consumption, coefficient, confidence_level, active, source)
  select spc.space_id, spc.product_id, 'complement', 'C',
    case p.category when 'Bières' then 'Bière / Fûts' when 'Soft' then 'Softs / Eau / Sirops' when 'Sirops' then 'Softs / Eau / Sirops' when 'Spiritueux' then 'Spiritueux / Apéritifs' when 'Vins' then 'Vins' else 'Autres' end,
    false, spc.avg_consumption, spc.coefficient, spc.confidence_level, true, 'ctr1_resync'
  from space_product_coefficients spc
  join spaces s on s.space_id=spc.space_id and s.active=true and s.service_type<>'buvette' and s.space_name not in ('Buvette 1','Buvette 2') and s.space_id not in ('a96044d1-9ab0-45d0-85eb-73672df6ab82','673b6e4e-0f5a-406f-9029-c35b25a38103','8be2956e-a379-4e8e-a3eb-65401bac3c56')
  join products p on p.product_id=spc.product_id and p.active=true
  where coalesce(spc.avg_consumption,0)>0
    and (not exists (select 1 from area_product_reference a2 where upper(btrim(a2.area_name))=upper(btrim(s.space_name)))
         or exists (select 1 from area_product_reference a2 where upper(btrim(a2.area_name))=upper(btrim(s.space_name)) and a2.product_id=spc.product_id))
  on conflict (space_id, product_id) do nothing;
end $function$
;

CREATE OR REPLACE FUNCTION public.compute_space_coefficients()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_deleted INT := 0; v_updated INT := 0;
BEGIN
  -- 1) Purger les coefficients COMPUTED sans source réelle (seed préservé).
  DELETE FROM space_product_coefficients spc
  WHERE COALESCE(spc.source, 'computed') = 'computed'
    AND NOT EXISTS (
      SELECT 1 FROM event_stock_lines esl
      JOIN events e ON e.event_id = esl.event_id
      WHERE esl.space_id = spc.space_id AND esl.product_id = spc.product_id
        AND e.status IN ('clôturé', 'archivé') AND e.event_type = 'match'
        AND COALESCE(e.is_simulation, false) = false
        AND esl.final_qty IS NOT NULL
        AND (esl.initial_qty + COALESCE(esl.reassort_qty, 0)) > 0
    );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- 2) Recalculer depuis les données réelles + normalisation PAX.
  WITH space_averages AS (
    SELECT esl.space_id, esl.product_id,
      COUNT(DISTINCT esl.event_id) AS nb_matches,
      ROUND(AVG(esl.initial_qty + COALESCE(esl.reassort_qty,0) - COALESCE(esl.final_qty,0))::DECIMAL, 2) AS avg_conso,
      ROUND(MIN(esl.initial_qty + COALESCE(esl.reassort_qty,0) - COALESCE(esl.final_qty,0))::DECIMAL, 2) AS min_conso,
      ROUND(MAX(esl.initial_qty + COALESCE(esl.reassort_qty,0) - COALESCE(esl.final_qty,0))::DECIMAL, 2) AS max_conso,
      ROUND(STDDEV(esl.initial_qty + COALESCE(esl.reassort_qty,0) - COALESCE(esl.final_qty,0))::DECIMAL, 2) AS std_dev,
      -- PAX (events.expected_attendees) : matchs avec jauge connue uniquement
      COUNT(DISTINCT esl.event_id) FILTER (WHERE e.expected_attendees > 0) AS nb_matches_pax,
      ROUND(AVG(e.expected_attendees) FILTER (WHERE e.expected_attendees > 0)) AS avg_pax,
      ROUND(AVG(CASE WHEN e.expected_attendees > 0
        THEN (esl.initial_qty + COALESCE(esl.reassort_qty,0) - COALESCE(esl.final_qty,0))::DECIMAL / e.expected_attendees * 100 END), 4) AS avg_c100,
      ROUND(MIN(CASE WHEN e.expected_attendees > 0
        THEN (esl.initial_qty + COALESCE(esl.reassort_qty,0) - COALESCE(esl.final_qty,0))::DECIMAL / e.expected_attendees * 100 END), 4) AS min_c100,
      ROUND(MAX(CASE WHEN e.expected_attendees > 0
        THEN (esl.initial_qty + COALESCE(esl.reassort_qty,0) - COALESCE(esl.final_qty,0))::DECIMAL / e.expected_attendees * 100 END), 4) AS max_c100
    FROM event_stock_lines esl
    JOIN events e ON e.event_id = esl.event_id
    JOIN products p ON p.product_id = esl.product_id
    WHERE e.status IN ('clôturé','archivé') AND e.event_type = 'match'
      AND COALESCE(e.is_simulation, false) = false
      AND esl.final_qty IS NOT NULL
      AND (esl.initial_qty + COALESCE(esl.reassort_qty,0)) > 0
      AND p.active = true
      AND (esl.initial_qty + COALESCE(esl.reassort_qty,0) - COALESCE(esl.final_qty,0)) > 0
    GROUP BY esl.space_id, esl.product_id
    HAVING COUNT(DISTINCT esl.event_id) >= 1
  ),
  type_averages AS (
    SELECT space_profile(s.space_name) AS profile, sa.product_id, AVG(sa.avg_conso) AS type_avg_conso
    FROM space_averages sa JOIN spaces s ON s.space_id = sa.space_id
    GROUP BY space_profile(s.space_name), sa.product_id
  )
  INSERT INTO space_product_coefficients (
    space_id, product_id, avg_consumption, total_matches, min_consumption,
    max_consumption, std_deviation, coefficient, confidence_level, recommended_qty,
    avg_pax_match, conso_per_100_pax, min_conso_per_100_pax, max_conso_per_100_pax, pax_normalized,
    source, last_computed_at)
  SELECT sa.space_id, sa.product_id, sa.avg_conso, sa.nb_matches, sa.min_conso, sa.max_conso,
    COALESCE(sa.std_dev, 0),
    CASE WHEN COALESCE(ta.type_avg_conso,0) > 0 THEN ROUND((sa.avg_conso / ta.type_avg_conso)::DECIMAL, 2) ELSE 1.00 END,
    CASE WHEN sa.nb_matches >= 5 THEN 'très élevé' WHEN sa.nb_matches >= 4 THEN 'élevé'
         WHEN sa.nb_matches >= 3 THEN 'moyen' ELSE 'faible' END,
    ROUND((sa.avg_conso * 1.20)::DECIMAL, 0),
    sa.avg_pax, sa.avg_c100, sa.min_c100, sa.max_c100,
    (sa.nb_matches_pax >= 1),   -- normalisé dès 1 match avec PAX (fiabilité ↑ avec l'historique)
    'computed', now()
  FROM space_averages sa
  JOIN spaces s ON s.space_id = sa.space_id
  LEFT JOIN type_averages ta ON ta.profile = space_profile(s.space_name) AND ta.product_id = sa.product_id
  ON CONFLICT (space_id, product_id) DO UPDATE SET
    avg_consumption=EXCLUDED.avg_consumption, total_matches=EXCLUDED.total_matches,
    min_consumption=EXCLUDED.min_consumption, max_consumption=EXCLUDED.max_consumption,
    std_deviation=EXCLUDED.std_deviation, coefficient=EXCLUDED.coefficient,
    confidence_level=EXCLUDED.confidence_level, recommended_qty=EXCLUDED.recommended_qty,
    avg_pax_match=EXCLUDED.avg_pax_match, conso_per_100_pax=EXCLUDED.conso_per_100_pax,
    min_conso_per_100_pax=EXCLUDED.min_conso_per_100_pax, max_conso_per_100_pax=EXCLUDED.max_conso_per_100_pax,
    pax_normalized=EXCLUDED.pax_normalized, source='computed', last_computed_at=now();
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- CTR-1 Phase 3.3 : le recalcul des coefficients alimente le catalogue
  -- (membership 'complement' = source du bloc (2) de generate_runner_dotations).
  PERFORM public.sync_catalog_complement();

  RETURN json_build_object('success', true, 'deleted', v_deleted, 'updated', v_updated,
    'pax_normalized', (SELECT COUNT(*) FROM space_product_coefficients WHERE pax_normalized = true),
    'message', format('%s recalculés · %s normalisés PAX', v_updated,
      (SELECT COUNT(*) FROM space_product_coefficients WHERE pax_normalized = true)));
END; $function$
;
