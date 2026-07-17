-- ═══════════════════════════════════════════════════════════════════════════
-- auto_activate_seminaires.sql — Auto-activation des séminaires du jour à 00:01.
--
-- ⚠ Adaptation clé : le vrai event_type est « séminaire » (ACCENTUÉ) — le
--   'seminaire' du prompt n'existe pas dans la contrainte CHECK et n'aurait
--   activé AUCUN événement. Les MATCHS ne sont jamais touchés (critique).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION auto_activate_todays_seminaires()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_count INT; v_event_ids UUID[];
BEGIN
  SELECT ARRAY_AGG(event_id) INTO v_event_ids
  FROM events
  WHERE event_type = 'séminaire'
    AND status IN ('préparé', 'brouillon')
    AND event_date = CURRENT_DATE;

  UPDATE events SET status = 'en_cours'
  WHERE event_type = 'séminaire'                 -- ← séminaires uniquement, jamais les matchs
    AND status IN ('préparé', 'brouillon')
    AND event_date = CURRENT_DATE;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Auto-activation séminaires : % activé(s) le %', v_count, CURRENT_DATE;

  RETURN json_build_object(
    'success', true, 'activated', v_count, 'event_type', 'séminaire',
    'date', CURRENT_DATE, 'event_ids', COALESCE(v_event_ids, ARRAY[]::UUID[]));
END; $$;

GRANT EXECUTE ON FUNCTION auto_activate_todays_seminaires() TO authenticated;

-- ── Planification pg_cron : chaque nuit à 00:01 UTC ─────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$
BEGIN
  -- Idempotent : retire le job existant avant de (re)planifier.
  PERFORM cron.unschedule('auto-activate-seminaires')
    FROM cron.job WHERE jobname = 'auto-activate-seminaires';
  PERFORM cron.schedule('auto-activate-seminaires', '1 0 * * *',
    'SELECT auto_activate_todays_seminaires()');
END $$;
