-- ═══════════════════════════════════════════════════════════════════════════
-- analytics_stadium.sql — Vues pour la refonte « Analyses » (Stadium Manager).
--
-- ⚠ Adaptations au schéma réel (le SQL du prompt suppose des objets absents) :
--   • Pas de table buvette_zones : les buvettes physiques = les espaces B1…B9
--     (space_type 'Buvette', space_name ~ '^B[0-9]+$'). « Buvette Virage Toinou »
--     et les superviseurs « Buvette 1 / Buvette 2 » sont hors pool → ils
--     disparaissent de la heatmap sans qu'on désactive quoi que ce soit.
--   • event_stock_lines.space_id (et non buvette_zone_id, inexistante).
--   • RG-003 : ces vues exposent unit_price_ht / coûts → réservées à
--     authenticated (ROLE_STADE). REVOKE anon : le flux zone anonyme ne doit
--     jamais atteindre les prix.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Vue enrichie par produit ────────────────────────────────────────────────
CREATE OR REPLACE VIEW analytics_products_full AS
SELECT
  p.product_id,
  p.product_name,
  p.category,
  p.unit,
  p.unit_price_ht,
  COUNT(DISTINCT esl.event_id) FILTER (WHERE e.event_type = 'match')  AS nb_matchs,
  COUNT(DISTINCT esl.event_id) FILTER (WHERE e.event_type <> 'match') AS nb_semis,
  ROUND(AVG(esl.initial_qty + COALESCE(esl.reassort_qty, 0) - COALESCE(esl.final_qty, 0))
        FILTER (WHERE e.event_type = 'match'), 2)                     AS avg_conso_match,
  ROUND(AVG(esl.initial_qty + COALESCE(esl.reassort_qty, 0) - COALESCE(esl.final_qty, 0))
        FILTER (WHERE e.event_type <> 'match'), 2)                    AS avg_conso_semi,
  ROUND(AVG(CASE WHEN (esl.initial_qty + COALESCE(esl.reassort_qty, 0)) > 0
                 THEN COALESCE(esl.final_qty, 0)::DECIMAL
                      / (esl.initial_qty + COALESCE(esl.reassort_qty, 0))
                 ELSE 0 END) * 100, 1)                                AS taux_retour_pct,
  COALESCE(SUM(
    (esl.initial_qty + COALESCE(esl.reassort_qty, 0) - COALESCE(esl.final_qty, 0))
    * p.unit_price_ht
  ), 0)                                                              AS total_cost_ht,
  MAX(e.event_date)                                                  AS last_used_date,
  MAX(esl.initial_qty + COALESCE(esl.reassort_qty, 0) - COALESCE(esl.final_qty, 0)) AS max_conso_ever
FROM products p
JOIN event_stock_lines esl ON esl.product_id = p.product_id
JOIN events e ON e.event_id = esl.event_id
WHERE e.status IN ('clôturé', 'archivé')
  AND p.active = true
GROUP BY p.product_id, p.product_name, p.category, p.unit, p.unit_price_ht;

-- ── Vue heatmap buvettes B1…B9 ──────────────────────────────────────────────
CREATE OR REPLACE VIEW analytics_buvette_heatmap AS
SELECT
  s.space_name                                       AS code,
  'Buvette ' || s.space_name                         AS label,
  s.space_name                                       AS location,
  CAST(substring(s.space_name FROM '[0-9]+') AS INT) AS sort_order,
  -- Consommations : uniquement les événements clôturés/archivés (e non NULL).
  COALESCE(SUM(
    esl.initial_qty + COALESCE(esl.reassort_qty, 0) - COALESCE(esl.final_qty, 0)
  ) FILTER (WHERE e.event_id IS NOT NULL), 0)        AS total_consumed,
  COALESCE(ROUND(AVG(
    esl.initial_qty + COALESCE(esl.reassort_qty, 0) - COALESCE(esl.final_qty, 0)
  ) FILTER (WHERE e.event_id IS NOT NULL), 1), 0)    AS avg_per_event,
  COUNT(DISTINCT esl.event_id) FILTER (WHERE e.event_id IS NOT NULL) AS nb_events,
  COALESCE(SUM(
    (esl.initial_qty + COALESCE(esl.reassort_qty, 0) - COALESCE(esl.final_qty, 0))
    * p.unit_price_ht
  ) FILTER (WHERE e.event_id IS NOT NULL), 0)        AS total_cost,
  -- Top produit consommé de cette buvette (événements clôturés uniquement).
  (
    SELECT p2.product_name
    FROM event_stock_lines esl2
    JOIN products p2 ON p2.product_id = esl2.product_id
    JOIN events e2 ON e2.event_id = esl2.event_id
      AND e2.status IN ('clôturé', 'archivé')
    WHERE esl2.space_id = s.space_id
    GROUP BY p2.product_name
    ORDER BY SUM(esl2.initial_qty + COALESCE(esl2.reassort_qty, 0)
                 - COALESCE(esl2.final_qty, 0)) DESC
    LIMIT 1
  )                                                  AS top_produit
FROM spaces s
LEFT JOIN event_stock_lines esl ON esl.space_id = s.space_id
LEFT JOIN products p ON p.product_id = esl.product_id
LEFT JOIN events e ON e.event_id = esl.event_id
  AND e.status IN ('clôturé', 'archivé')
WHERE s.active = true
  AND s.space_type = 'Buvette'
  AND s.space_name ~ '^B[0-9]+$'
GROUP BY s.space_id, s.space_name
ORDER BY sort_order;

-- ── RG-003 : prix réservés à ROLE_STADE (authenticated), jamais à anon ───────
GRANT SELECT ON analytics_products_full, analytics_buvette_heatmap TO authenticated;
REVOKE SELECT ON analytics_products_full, analytics_buvette_heatmap FROM anon;
