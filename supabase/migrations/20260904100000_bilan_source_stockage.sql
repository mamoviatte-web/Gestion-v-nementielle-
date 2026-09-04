-- =====================================================================
-- Bilan F&B — exposer la SOURCE de stockage de chaque consommation
-- ---------------------------------------------------------------------
-- Étend la vue event_stock_summary avec l'emplacement d'où la conso a été
-- prélevée (event_stock_lines.source_location_id), sous forme d'un libellé
-- court : « Sur place » / « AUC » / « Cave EST » / « Fûts ». Colonnes
-- ajoutées EN FIN → compatible CREATE OR REPLACE VIEW (consommateurs
-- existants intacts).
-- =====================================================================

create or replace view public.event_stock_summary as
 SELECT esl.event_id,
    esl.space_id,
    s.space_name,
    esl.product_id,
    p.product_name,
    p.category,
    p.unit,
    p.unit_price_ht,
    esl.initial_qty,
    COALESCE(esl.reassort_qty, 0) AS reassort_qty,
    esl.final_qty,
    esl.initial_qty + COALESCE(esl.reassort_qty, 0) - COALESCE(esl.final_qty, 0) AS consumed_qty,
        CASE
            WHEN p.unit_price_ht IS NOT NULL THEN (esl.initial_qty + COALESCE(esl.reassort_qty, 0) - COALESCE(esl.final_qty, 0))::numeric * p.unit_price_ht
            ELSE NULL::numeric
        END AS cost_ht,
    esl.final_qty IS NULL AND (esl.initial_qty > 0 OR COALESCE(esl.reassort_qty, 0) > 0) AS is_missing_cloture,
    p.unit_price_ht IS NULL AS is_missing_price,
    esl.product_state,
    esl.anomaly_comment,
    esl.responsable_nom,
    esl.submitted_at,
    -- Source de stockage (séminaire : prélèvement choisi par le régisseur)
    esl.source_location_id,
    CASE
      WHEN esl.source_location_id IS NULL THEN NULL::text
      WHEN sl.location_type = 'espace' THEN 'Sur place'
      WHEN sl.name ILIKE 'Stockage F%' THEN 'Fûts'
      WHEN sl.name ILIKE '%EST%' THEN 'Cave EST'
      ELSE 'AUC'
    END AS source_name
   FROM event_stock_lines esl
     JOIN products p ON p.product_id = esl.product_id
     JOIN spaces s ON s.space_id = esl.space_id
     LEFT JOIN stock_locations sl ON sl.id = esl.source_location_id;
