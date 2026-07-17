-- ═══════════════════════════════════════════════════════════════════════════
-- space_coefficients.sql — Coefficients de consommation par espace.
--
-- ⚠ Adaptations au schéma réel :
--   • products.product_name n'a PAS de contrainte UNIQUE → upsert défensif
--     (UPDATE puis INSERT WHERE NOT EXISTS) au lieu de ON CONFLICT (product_name).
--   • Le « type » de comparaison des coefficients = le PROFIL d'espace
--     (space_profile : salon/loge/wine_bar/bar_pub/…), pas service_type — sinon
--     Salon Nord et Salon Sud ne se compareraient pas entre eux.
--   • RLS via is_stade() ; vue coûts réservée authenticated (RG-003, REVOKE anon).
--   • San Pellegrino 50cl garde ses profils actuels (déjà buvette+bodega) ;
--     on n'écrase pas le mapping club/terrasse établi précédemment.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── BLOC 1 : San Pellegrino verre (inactif) → bouteille (format VIP) ────────
UPDATE products SET active = false WHERE product_name ILIKE '%pellegrino%verre%';

UPDATE products SET active = true, unit = 'btl', category = 'Soft',
  unit_price_ht = COALESCE(unit_price_ht, 0.95),
  space_types = ARRAY['salon','loge','bar_pub','wine_bar','club','pmr','terrasse']
WHERE product_name = 'San Pellegrino bouteille';
INSERT INTO products (product_name, category, unit, unit_price_ht, active, space_types)
SELECT 'San Pellegrino bouteille', 'Soft', 'btl', 0.95, true,
       ARRAY['salon','loge','bar_pub','wine_bar','club','pmr','terrasse']
WHERE NOT EXISTS (SELECT 1 FROM products WHERE product_name = 'San Pellegrino bouteille');

-- San Pellegrino 50cl : s'assurer qu'il reste actif + buvette/bodega présents.
UPDATE products SET active = true,
  space_types = (SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(space_types,'{}') || ARRAY['buvette','bodega'])))
WHERE product_name ILIKE '%pellegrino%50%' OR product_name ILIKE '%san pe 50%';

-- ── BLOC 2 : table des coefficients ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS space_product_coefficients (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id         UUID NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
  product_id       UUID NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
  avg_consumption  DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_matches    INT NOT NULL DEFAULT 0,
  min_consumption  DECIMAL(10,2) DEFAULT 0,
  max_consumption  DECIMAL(10,2) DEFAULT 0,
  std_deviation    DECIMAL(10,2) DEFAULT 0,
  coefficient      DECIMAL(5,2) NOT NULL DEFAULT 1.00,
  confidence_level TEXT DEFAULT 'faible' CHECK (confidence_level IN ('faible','moyen','élevé','très élevé')),
  recommended_qty  DECIMAL(10,2),
  safety_factor    DECIMAL(4,2) DEFAULT 1.20,
  last_computed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (space_id, product_id)
);
ALTER TABLE space_product_coefficients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stade_all_coefficients ON space_product_coefficients;
CREATE POLICY stade_all_coefficients ON space_product_coefficients
  FOR ALL TO authenticated USING (is_stade()) WITH CHECK (is_stade());
CREATE INDEX IF NOT EXISTS idx_spc_space   ON space_product_coefficients(space_id);
CREATE INDEX IF NOT EXISTS idx_spc_product ON space_product_coefficients(product_id);
CREATE INDEX IF NOT EXISTS idx_spc_coeff   ON space_product_coefficients(coefficient);

-- ── BLOC 3 : calcul des coefficients (par profil d'espace) ──────────────────
CREATE OR REPLACE FUNCTION compute_space_coefficients()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_updated INT := 0;
BEGIN
  WITH space_averages AS (
    SELECT esl.space_id, esl.product_id,
      COUNT(DISTINCT esl.event_id) AS nb_matches,
      ROUND(AVG(esl.initial_qty + COALESCE(esl.reassort_qty,0) - COALESCE(esl.final_qty,0))::DECIMAL, 2) AS avg_conso,
      ROUND(MIN(esl.initial_qty + COALESCE(esl.reassort_qty,0) - COALESCE(esl.final_qty,0))::DECIMAL, 2) AS min_conso,
      ROUND(MAX(esl.initial_qty + COALESCE(esl.reassort_qty,0) - COALESCE(esl.final_qty,0))::DECIMAL, 2) AS max_conso,
      ROUND(STDDEV(esl.initial_qty + COALESCE(esl.reassort_qty,0) - COALESCE(esl.final_qty,0))::DECIMAL, 2) AS std_dev
    FROM event_stock_lines esl
    JOIN events e ON e.event_id = esl.event_id
    JOIN products p ON p.product_id = esl.product_id
    WHERE e.status IN ('clôturé','archivé') AND e.event_type = 'match'
      AND esl.final_qty IS NOT NULL
      AND (esl.initial_qty + COALESCE(esl.reassort_qty,0)) > 0
      AND p.active = true
    GROUP BY esl.space_id, esl.product_id
  ),
  type_averages AS (
    SELECT space_profile(s.space_name) AS profile, sa.product_id, AVG(sa.avg_conso) AS type_avg_conso
    FROM space_averages sa JOIN spaces s ON s.space_id = sa.space_id
    GROUP BY space_profile(s.space_name), sa.product_id
  )
  INSERT INTO space_product_coefficients (
    space_id, product_id, avg_consumption, total_matches, min_consumption, max_consumption,
    std_deviation, coefficient, confidence_level, recommended_qty, last_computed_at)
  SELECT sa.space_id, sa.product_id, sa.avg_conso, sa.nb_matches, sa.min_conso, sa.max_conso,
    COALESCE(sa.std_dev, 0),
    CASE WHEN COALESCE(ta.type_avg_conso,0) > 0 THEN ROUND((sa.avg_conso / ta.type_avg_conso)::DECIMAL, 2) ELSE 1.00 END,
    CASE WHEN sa.nb_matches >= 5 THEN 'très élevé' WHEN sa.nb_matches >= 4 THEN 'élevé'
         WHEN sa.nb_matches >= 3 THEN 'moyen' ELSE 'faible' END,
    ROUND((sa.avg_conso * 1.20)::DECIMAL, 0), now()
  FROM space_averages sa
  JOIN spaces s ON s.space_id = sa.space_id
  LEFT JOIN type_averages ta ON ta.profile = space_profile(s.space_name) AND ta.product_id = sa.product_id
  ON CONFLICT (space_id, product_id) DO UPDATE SET
    avg_consumption=EXCLUDED.avg_consumption, total_matches=EXCLUDED.total_matches,
    min_consumption=EXCLUDED.min_consumption, max_consumption=EXCLUDED.max_consumption,
    std_deviation=EXCLUDED.std_deviation, coefficient=EXCLUDED.coefficient,
    confidence_level=EXCLUDED.confidence_level, recommended_qty=EXCLUDED.recommended_qty,
    last_computed_at=now();
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN json_build_object('success', true, 'updated', v_updated);
END; $$;
GRANT EXECUTE ON FUNCTION compute_space_coefficients() TO authenticated;

CREATE OR REPLACE FUNCTION auto_compute_coefficients()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('clôturé','archivé') AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM compute_space_coefficients();
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_auto_coefficients ON events;
CREATE TRIGGER trg_auto_coefficients AFTER UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION auto_compute_coefficients();

SELECT compute_space_coefficients();

-- ── BLOC 5 : vue recommandations (RG-003 : authenticated seul) ──────────────
CREATE OR REPLACE VIEW v_space_dotation_recommendations AS
SELECT s.space_name, s.service_type, p.product_name, p.category, p.unit, p.unit_price_ht,
  spc.avg_consumption AS moy_historique, spc.coefficient AS coeff_espace,
  spc.recommended_qty AS qte_recommandee, spc.total_matches AS nb_matchs_historique,
  spc.confidence_level, spc.min_consumption, spc.max_consumption, spc.std_deviation,
  ROUND(spc.recommended_qty * COALESCE(p.unit_price_ht, 0), 2) AS cout_dotation_estime,
  CASE WHEN spc.coefficient >= 1.5 THEN '🔺 Forte demande'
       WHEN spc.coefficient >= 1.2 THEN '↑ Demande élevée'
       WHEN spc.coefficient <= 0.5 THEN '🔻 Faible demande'
       WHEN spc.coefficient <= 0.8 THEN '↓ Demande faible'
       ELSE '→ Demande normale' END AS signal,
  spc.last_computed_at
FROM space_product_coefficients spc
JOIN spaces s ON s.space_id = spc.space_id
JOIN products p ON p.product_id = spc.product_id
WHERE s.active = true AND p.active = true
ORDER BY s.service_type, s.space_name, spc.coefficient DESC;

GRANT SELECT ON v_space_dotation_recommendations TO authenticated;
REVOKE SELECT ON v_space_dotation_recommendations FROM anon;

-- ── BLOC 7 : RPC recommandations pour un événement ──────────────────────────
CREATE OR REPLACE FUNCTION get_recommended_dotation(p_event_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RETURN json_build_object('success', true, 'by_space', (
    SELECT COALESCE(json_agg(json_build_object(
      'space_name', s.space_name, 'service_type', s.service_type,
      'products', (
        SELECT COALESCE(json_agg(json_build_object(
          'product_name', p.product_name, 'category', p.category, 'unit', p.unit,
          'recommended_qty', spc.recommended_qty, 'avg_historical', spc.avg_consumption,
          'coefficient', spc.coefficient, 'confidence', spc.confidence_level,
          'signal', CASE WHEN spc.coefficient >= 1.5 THEN '🔺 Forte demande'
                         WHEN spc.coefficient >= 1.2 THEN '↑ Élevée'
                         WHEN spc.coefficient <= 0.5 THEN '🔻 Faible' ELSE '→ Normale' END
        ) ORDER BY spc.coefficient DESC), '[]'::json)
        FROM space_product_coefficients spc JOIN products p ON p.product_id = spc.product_id
        WHERE spc.space_id = s.space_id AND p.active = true AND spc.avg_consumption > 0)
    ) ORDER BY s.space_name), '[]'::json)
    FROM event_spaces es JOIN spaces s ON s.space_id = es.space_id
    WHERE es.event_id = p_event_id AND s.active = true));
END; $$;
GRANT EXECUTE ON FUNCTION get_recommended_dotation(UUID) TO authenticated;
