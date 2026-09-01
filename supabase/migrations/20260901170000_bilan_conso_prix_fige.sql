-- Bilan de consommation : honorer le prix figé (frozen_unit_price_ht)
-- ============================================================================
-- La vue event_space_product_consumption (source du bilan par espace, du total
-- événement et du détail produit) calculait pu_ht / valeur_ht sur le SEUL prix
-- catalogue (products.unit_price_ht), en ignorant le prix figé sur la ligne.
-- Résultat : un prix figé (ex. fûts FADA d'Agen) n'apparaissait pas dans le bilan.
-- On aligne la vue sur la logique de auto_compute_line_cost :
--   prix effectif = COALESCE(frozen_unit_price_ht, unit_price_ht, 0)
-- Les vues de synthèse (consumption_by_event_space / consumption_by_event) en
-- dérivent : elles sont corrigées automatiquement.

create or replace view public.event_space_product_consumption as
 SELECT e.event_id,
    e.event_name,
    e.event_date,
    esl.space_id,
    s.space_name,
        CASE
            WHEN s.service_type = 'buvette'::text THEN 'Buvettes'::text
            WHEN s.service_type = 'bar'::text THEN 'Bars'::text
            ELSE 'VIP'::text
        END AS family,
    s.service_type,
    esl.product_id,
    p.product_name,
    p.category,
    p.unit,
    COALESCE(esl.initial_qty, 0) + COALESCE(esl.reassort_qty, 0) AS stock_rempli,
    COALESCE(esl.final_qty, 0) AS stock_final,
    esl.consumed_qty AS consomme_brut,
    GREATEST(COALESCE(esl.consumed_qty, 0), 0) AS consomme,
    COALESCE(esl.frozen_unit_price_ht, p.unit_price_ht, 0::numeric) AS pu_ht,
    round(GREATEST(COALESCE(esl.consumed_qty, 0), 0)::numeric
          * COALESCE(esl.frozen_unit_price_ht, p.unit_price_ht, 0::numeric), 2) AS valeur_ht,
    COALESCE(esl.consumed_qty, 0) < 0 AS anomalie
   FROM event_stock_lines esl
     JOIN events e ON e.event_id = esl.event_id AND (lower(COALESCE(e.status, ''::text)) = ANY (ARRAY['clôturé'::text, 'cloture'::text, 'clôturée'::text, 'archivé'::text, 'archive'::text]))
     JOIN spaces s ON s.space_id = esl.space_id
     JOIN products p ON p.product_id = esl.product_id
  WHERE COALESCE(esl.consumed_qty, 0) <> 0 OR COALESCE(esl.final_qty, 0) < (COALESCE(esl.initial_qty, 0) + COALESCE(esl.reassort_qty, 0));
