-- =====================================================================
-- Bilan F&B — refléter les PRIX FIGÉS (frozen_unit_price_ht)
-- ---------------------------------------------------------------------
-- event_stock_summary valorisait la consommation au prix CATALOGUE
-- (products.unit_price_ht), ignorant le prix figé posé sur la ligne
-- (event_stock_lines.frozen_unit_price_ht). Le Bilan n'affichait donc
-- pas les prix « feuille » des fûts (séminaires et matchs).
--
-- On bascule sur le PRIX EFFECTIF = COALESCE(frozen, catalogue), cohérent
-- avec event_stock_lines.consumption_cost_ht (calculé par
-- auto_compute_line_cost, qui priorise déjà le prix figé). L'alerte
-- « prix manquant » (RG-005) porte désormais sur ce prix effectif.
-- Colonnes inchangées → compatible consommateurs existants.
-- =====================================================================

create or replace view public.event_stock_summary as
 SELECT esl.event_id,
    esl.space_id,
    s.space_name,
    esl.product_id,
    p.product_name,
    p.category,
    p.unit,
    COALESCE(esl.frozen_unit_price_ht, p.unit_price_ht) AS unit_price_ht,   -- prix effectif (figé prioritaire)
    esl.initial_qty,
    COALESCE(esl.reassort_qty, 0) AS reassort_qty,
    esl.final_qty,
    esl.initial_qty + COALESCE(esl.reassort_qty, 0) - COALESCE(esl.final_qty, 0) AS consumed_qty,
        CASE
            WHEN COALESCE(esl.frozen_unit_price_ht, p.unit_price_ht) IS NOT NULL
              THEN (esl.initial_qty + COALESCE(esl.reassort_qty, 0) - COALESCE(esl.final_qty, 0))::numeric
                   * COALESCE(esl.frozen_unit_price_ht, p.unit_price_ht)
            ELSE NULL::numeric
        END AS cost_ht,
    esl.final_qty IS NULL AND (esl.initial_qty > 0 OR COALESCE(esl.reassort_qty, 0) > 0) AS is_missing_cloture,
    COALESCE(esl.frozen_unit_price_ht, p.unit_price_ht) IS NULL AS is_missing_price,
    esl.product_state,
    esl.anomaly_comment,
    esl.responsable_nom,
    esl.submitted_at,
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
