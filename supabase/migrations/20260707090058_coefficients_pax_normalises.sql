-- 20260707090058 — Coefficients normalisés par PAX (conso / 100 spectateurs).
-- Colonne réelle = events.expected_attendees. compute_space_coefficients basé sur
-- la fonction existante (préserve seed/source='computed', normalisation par PROFIL,
-- std_deviation) — seul ajout : normalisation PAX + pax_normalized (seuil >=1 match
-- avec PAX). RPC get_dotations_pax_adjusted + vue enrichie (colonnes PAX en fin).

-- ============================================================================
-- Coefficients normalisés par PAX (conso / 100 spectateurs).
-- Colonne réelle = events.expected_attendees (le prompt disait 'pax_count').
-- Base sur la fonction EXISTANTE : préserve seed/source='computed', normalisation
-- par PROFIL (pas service_type), std_deviation. Seul ajout : normalisation PAX.
-- ============================================================================

ALTER TABLE space_product_coefficients
  ADD COLUMN IF NOT EXISTS avg_pax_match         INT,
  ADD COLUMN IF NOT EXISTS conso_per_100_pax     DECIMAL(8,4),
  ADD COLUMN IF NOT EXISTS min_conso_per_100_pax DECIMAL(8,4),
  ADD COLUMN IF NOT EXISTS max_conso_per_100_pax DECIMAL(8,4),
  ADD COLUMN IF NOT EXISTS pax_normalized        BOOLEAN DEFAULT false;

CREATE OR REPLACE FUNCTION public.compute_space_coefficients()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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

  RETURN json_build_object('success', true, 'deleted', v_deleted, 'updated', v_updated,
    'pax_normalized', (SELECT COUNT(*) FROM space_product_coefficients WHERE pax_normalized = true),
    'message', format('%s recalculés · %s normalisés PAX', v_updated,
      (SELECT COUNT(*) FROM space_product_coefficients WHERE pax_normalized = true)));
END; $function$;

GRANT EXECUTE ON FUNCTION compute_space_coefficients() TO authenticated;

-- RPC dotation ajustée par jauge (expected_attendees). Aucun coût exposé.
CREATE OR REPLACE FUNCTION get_dotations_pax_adjusted(p_event_id UUID, p_space_id UUID)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_pax INT;
BEGIN
  SELECT expected_attendees INTO v_pax FROM events WHERE event_id = p_event_id;
  RETURN json_build_object(
    'event_pax', v_pax,
    'products', (
      SELECT COALESCE(JSON_AGG(r ORDER BY r->>'product_name'), '[]'::json)
      FROM (
        SELECT JSON_BUILD_OBJECT(
          'product_id', spc.product_id, 'product_name', p.product_name,
          'category', p.category, 'unit', p.unit,
          'avg_conso', spc.avg_consumption, 'min_conso', spc.min_consumption, 'max_conso', spc.max_consumption,
          'recommended_std', spc.recommended_qty,
          'conso_100_pax', spc.conso_per_100_pax, 'pax_normalized', spc.pax_normalized, 'pax_ref', spc.avg_pax_match,
          'recommended_pax', CASE WHEN spc.pax_normalized AND v_pax > 0 AND spc.conso_per_100_pax > 0
            THEN CEIL(v_pax / 100.0 * spc.conso_per_100_pax * 1.20) ELSE spc.recommended_qty END,
          'min_pax', CASE WHEN spc.pax_normalized AND v_pax > 0
            THEN CEIL(v_pax / 100.0 * COALESCE(spc.min_conso_per_100_pax, spc.conso_per_100_pax)) ELSE spc.min_consumption END,
          'max_pax', CASE WHEN spc.pax_normalized AND v_pax > 0
            THEN CEIL(v_pax / 100.0 * COALESCE(spc.max_conso_per_100_pax, spc.conso_per_100_pax)) ELSE spc.max_consumption END,
          'pax_vs_ref', CASE WHEN spc.avg_pax_match > 0 AND v_pax > 0
            THEN ROUND((v_pax::DECIMAL / spc.avg_pax_match - 1) * 100) ELSE NULL END,
          'pax_alert', CASE WHEN spc.avg_pax_match > 0 AND v_pax > 0
            AND ABS(v_pax::DECIMAL / spc.avg_pax_match - 1) > 0.25 THEN true ELSE false END
        ) AS r
        FROM space_product_coefficients spc
        JOIN products p ON p.product_id = spc.product_id AND p.active = true
        WHERE spc.space_id = p_space_id AND spc.avg_consumption > 0
      ) sub
    )
  );
END; $function$;
GRANT EXECUTE ON FUNCTION get_dotations_pax_adjusted(UUID, UUID) TO authenticated;


-- Vue Coefficients : colonnes PAX ajoutées EN FIN (CREATE OR REPLACE exige l'ordre existant).
CREATE OR REPLACE VIEW v_space_dotation_recommendations AS
SELECT s.space_name, s.service_type, p.product_name, p.category, p.unit, p.unit_price_ht,
  spc.avg_consumption AS moy_historique, spc.coefficient AS coeff_espace,
  spc.recommended_qty AS qte_recommandee, spc.total_matches AS nb_matchs_historique,
  spc.confidence_level, spc.min_consumption, spc.max_consumption, spc.std_deviation,
  round((spc.recommended_qty * COALESCE(p.unit_price_ht, 0::numeric)), 2) AS cout_dotation_estime,
  CASE WHEN spc.coefficient >= 1.5 THEN '🔺 Forte demande'
       WHEN spc.coefficient >= 1.2 THEN '↑ Demande élevée'
       WHEN spc.coefficient <= 0.5 THEN '🔻 Faible demande'
       WHEN spc.coefficient <= 0.8 THEN '↓ Demande faible'
       ELSE '→ Demande normale' END AS signal,
  spc.last_computed_at,
  spc.avg_pax_match, spc.conso_per_100_pax, spc.min_conso_per_100_pax,
  spc.max_conso_per_100_pax, spc.pax_normalized
FROM space_product_coefficients spc
JOIN spaces s ON s.space_id = spc.space_id
JOIN products p ON p.product_id = spc.product_id
WHERE s.active = true AND p.active = true
ORDER BY s.service_type, s.space_name, spc.coefficient DESC;
