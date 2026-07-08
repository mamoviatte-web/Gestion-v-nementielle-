-- ═══════════════════════════════════════════════════════════════════════════
-- stock_summary_fix.sql — Correction liaison Stocks → Synthèse F&B → Export.
--
-- Problème (événement SALESFORCE) : un produit dont le stock final n'a pas été
-- saisi (final_qty IS NULL) était PUREMENT EXCLU des coûts et de la synthèse
-- F&B (ex. Blanc Montauronne → catégorie « Vins » disparue).
--
-- Règle corrigée : quand final_qty IS NULL, la consommation est estimée à
--   initial + réassort  (hypothèse : tout ce qui est sorti est consommé),
-- avec un indicateur « clôture manquante » (is_missing_cloture) pour la
-- traçabilité. On n'exclut plus que les produits SANS prix (RG-005).
--
-- Contenu :
--   BLOC 2 — prix Blanc Montauronne + audit vins sans prix
--   BLOC 4 — vue event_stock_summary (source unifiée synthèse + export)
--   BLOC 3 — get_event_costs corrigé : COALESCE(final_qty,0) + missing_clotures
-- ═══════════════════════════════════════════════════════════════════════════

-- ── BLOC 2 — Prix Blanc Montauronne ────────────────────────────────────────
-- Le produit existe déjà au catalogue ; on garantit un prix + catégorie Vins.
UPDATE products
   SET unit_price_ht = COALESCE(unit_price_ht, 5.20),  -- 5.20 € HT (estimé, à confirmer)
       category      = 'Vins',
       unit          = COALESCE(NULLIF(unit, ''), 'btl'),
       active        = true
 WHERE product_name ILIKE '%Montaur%';

-- ── BLOC 4 — Vue event_stock_summary ───────────────────────────────────────
-- Une ligne par event × space × produit, INCLUANT les lignes sans clôture.
-- consumed_qty = initial + réassort − COALESCE(final,0) ; flags d'anomalie.
CREATE OR REPLACE VIEW event_stock_summary
WITH (security_invoker = true) AS
SELECT
  esl.event_id,
  esl.space_id,
  s.space_name,
  esl.product_id,
  p.product_name,
  p.category,
  p.unit,
  p.unit_price_ht,
  esl.initial_qty,
  COALESCE(esl.reassort_qty, 0)                                       AS reassort_qty,
  esl.final_qty,                                                       -- NULL si clôture non faite
  esl.initial_qty + COALESCE(esl.reassort_qty, 0)
    - COALESCE(esl.final_qty, 0)                                      AS consumed_qty,
  CASE WHEN p.unit_price_ht IS NOT NULL
       THEN (esl.initial_qty + COALESCE(esl.reassort_qty, 0)
             - COALESCE(esl.final_qty, 0)) * p.unit_price_ht
       ELSE NULL END                                                  AS cost_ht,
  (esl.final_qty IS NULL
   AND (esl.initial_qty > 0 OR COALESCE(esl.reassort_qty, 0) > 0))    AS is_missing_cloture,
  (p.unit_price_ht IS NULL)                                           AS is_missing_price,
  esl.product_state,
  esl.anomaly_comment,
  esl.responsable_nom,
  esl.submitted_at
FROM event_stock_lines esl
JOIN products p ON p.product_id = esl.product_id
JOIN spaces   s ON s.space_id   = esl.space_id;

GRANT SELECT ON event_stock_summary TO authenticated;

-- ── BLOC 3 — get_event_costs corrigé ───────────────────────────────────────
-- Remplace le filtre `final_qty IS NOT NULL` (qui excluait les produits non
-- clôturés) par COALESCE(final_qty, 0). Ajoute missing_clotures au retour.
-- Seuls les produits SANS prix restent exclus du total (RG-005).
CREATE OR REPLACE FUNCTION get_event_costs(p_event_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fb      DECIMAL(12,2) := 0;
  v_rh      DECIMAL(12,2) := 0;
  v_occ     DECIMAL(12,2) := 0;
  v_missing INT := 0;
BEGIN
  SELECT
    COALESCE(SUM((esl.initial_qty + COALESCE(esl.reassort_qty,0)
                  - COALESCE(esl.final_qty,0)) * COALESCE(p.unit_price_ht,0)), 0),
    COUNT(*) FILTER (
      WHERE esl.final_qty IS NULL
        AND (esl.initial_qty > 0 OR COALESCE(esl.reassort_qty,0) > 0))
  INTO v_fb, v_missing
  FROM event_stock_lines esl
  JOIN products p ON p.product_id = esl.product_id
  WHERE esl.event_id = p_event_id
    AND p.unit_price_ht IS NOT NULL;      -- exclut seulement si prix manquant

  SELECT COALESCE(SUM(CASE WHEN sc.actual_departure IS NOT NULL AND sc.hourly_rate IS NOT NULL
    THEN compute_actual_hours(sc.planned_arrival, sc.actual_departure) * sc.hourly_rate ELSE 0 END), 0)
  INTO v_rh FROM schedules sc WHERE sc.event_id = p_event_id;

  IF to_regclass('public.occasional_hours') IS NOT NULL THEN
    EXECUTE 'SELECT COALESCE(SUM(total_cost),0) FROM occasional_hours WHERE event_id = $1'
      INTO v_occ USING p_event_id;
  END IF;

  RETURN json_build_object(
    'fb_cost_ht',       ROUND(v_fb, 2),
    'rh_cost',          ROUND(v_rh + v_occ, 2),
    'total_cost_ht',    ROUND(v_fb + v_rh + v_occ, 2),
    'missing_clotures', v_missing
  );
END; $$;

-- Audit : produits actifs sans prix HT (à compléter au catalogue).
-- SELECT product_name, category, unit FROM products
--  WHERE unit_price_ht IS NULL AND active = true ORDER BY category, product_name;
