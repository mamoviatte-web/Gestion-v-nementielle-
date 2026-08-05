-- ═══════════════════════════════════════════════════════════════════════════
-- coefficients_orphan_fix.sql — purge des coefficients orphelins à la
-- suppression d'un événement + reset total + exclusion des simulations.
--
-- ⚠ CONFLIT RÉSOLU avec la base runner injectée (coefficients_5match / 038) :
--   Cette base (~180 lignes) n'a AUCUNE source dans event_stock_lines → la purge
--   d'orphelins du prompt l'aurait DÉTRUITE. On ajoute une colonne `source`
--   ('seed' | 'computed'). La purge et le reset ne touchent QUE les lignes
--   'computed'. La base injectée (tagguée 'seed' par 038) est préservée.
--   type_averages : on garde space_profile() (cohérent avec l'existant), PAS
--   service_type (le prompt s'était trompé — service_type ≠ 9 profils).
--   Simulations (is_simulation=true) exclues des calculs même clôturées.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE space_product_coefficients ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'computed';
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_simulation BOOLEAN DEFAULT false;

CREATE OR REPLACE FUNCTION compute_space_coefficients()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_deleted INT := 0; v_updated INT := 0;
BEGIN
  -- ── 1) Purger les coefficients COMPUTED sans source réelle ────────────────
  --     (seed préservé ; simulations non comptées comme source).
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

  -- ── 2) Recalculer depuis les données réelles (hors simulations) ───────────
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
    source, last_computed_at)
  SELECT sa.space_id, sa.product_id, sa.avg_conso, sa.nb_matches, sa.min_conso, sa.max_conso,
    COALESCE(sa.std_dev, 0),
    CASE WHEN COALESCE(ta.type_avg_conso,0) > 0 THEN ROUND((sa.avg_conso / ta.type_avg_conso)::DECIMAL, 2) ELSE 1.00 END,
    CASE WHEN sa.nb_matches >= 5 THEN 'très élevé' WHEN sa.nb_matches >= 4 THEN 'élevé'
         WHEN sa.nb_matches >= 3 THEN 'moyen' ELSE 'faible' END,
    ROUND((sa.avg_conso * 1.20)::DECIMAL, 0), 'computed', now()
  FROM space_averages sa
  JOIN spaces s ON s.space_id = sa.space_id
  LEFT JOIN type_averages ta ON ta.profile = space_profile(s.space_name) AND ta.product_id = sa.product_id
  ON CONFLICT (space_id, product_id) DO UPDATE SET
    avg_consumption=EXCLUDED.avg_consumption, total_matches=EXCLUDED.total_matches,
    min_consumption=EXCLUDED.min_consumption, max_consumption=EXCLUDED.max_consumption,
    std_deviation=EXCLUDED.std_deviation, coefficient=EXCLUDED.coefficient,
    confidence_level=EXCLUDED.confidence_level, recommended_qty=EXCLUDED.recommended_qty,
    source='computed', last_computed_at=now();
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN json_build_object('success', true, 'deleted', v_deleted, 'updated', v_updated,
    'message', format('%s orphelins supprimés · %s coefficients recalculés', v_deleted, v_updated));
END; $$;
GRANT EXECUTE ON FUNCTION compute_space_coefficients() TO authenticated;

-- Reset : vide les COMPUTED (préserve la base seed) puis recalcule.
CREATE OR REPLACE FUNCTION reset_all_coefficients()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_before INT; v_res JSON;
BEGIN
  SELECT COUNT(*) INTO v_before FROM space_product_coefficients WHERE COALESCE(source,'computed') = 'computed';
  DELETE FROM space_product_coefficients WHERE COALESCE(source,'computed') = 'computed';
  SELECT compute_space_coefficients() INTO v_res;
  RETURN json_build_object('success', true, 'cleared_before', v_before,
    'recomputed', (v_res->>'updated')::INT,
    'message', format('Reset : %s lignes computed effacées, %s recalculées (base « seed » préservée)',
      v_before, v_res->>'updated'));
END; $$;
GRANT EXECUTE ON FUNCTION reset_all_coefficients() TO authenticated;

-- ── 3) Trigger after_event_delete ────────────────────────────────────────────
--   Le trigger trg_after_event_delete (migration 037) appelle DÉJÀ
--   compute_space_coefficients() après chaque suppression d'événement. Comme
--   cette fonction purge désormais les orphelins avant de recalculer, la
--   suppression d'un événement nettoie automatiquement ses coefficients sans
--   trigger supplémentaire. On garantit simplement sa présence (idempotent).
CREATE OR REPLACE FUNCTION after_event_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM compute_space_coefficients();
  BEGIN
    UPDATE event_deletion_log SET recalculated_at = now()
     WHERE event_id = OLD.event_id AND recalculated_at IS NULL;
  EXCEPTION WHEN undefined_table THEN NULL;  -- log optionnel (037)
  END;
  RETURN OLD;
END; $$;
DROP TRIGGER IF EXISTS trg_after_event_delete ON events;
CREATE TRIGGER trg_after_event_delete AFTER DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION after_event_delete();

-- Nettoyage immédiat de l'état actuel (purge des orphelins de simulation).
SELECT compute_space_coefficients();
