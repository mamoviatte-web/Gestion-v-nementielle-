-- ═══════════════════════════════════════════════════════════════════════════
-- charges_security.sql — Sécurisation des liaisons charges → événement.
--
-- Chaque ligne de charge (F&B, RH, externe, mouvement) hérite automatiquement
-- de la catégorie (match / seminaire / autre) de son événement parent, via un
-- trigger BEFORE INSERT/UPDATE. Impossible à falsifier ou oublier. Une vue
-- d'audit vérifie l'intégrité en 1 requête.
--
-- ⚠ Adaptations vs le cahier des charges :
--   • PAS de trigger de recompute appelant compute_event_full_cost sur
--     event_stock_lines : compute_event_full_cost fait un UPDATE de
--     event_stock_lines → récursion. Les coûts sont recalculés à la lecture
--     (get_event_costs) ; inutile de matérialiser.
--   • L'audit ne lit PAS event_commercial_data (vide pour les séminaires) ;
--     il se base sur les incohérences de catégorie réelles.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Classification event_type → catégorie binaire ───────────────────────────
CREATE OR REPLACE FUNCTION classify_event_type(p_event_type TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_event_type = 'match' THEN 'match'
    WHEN p_event_type IN ('séminaire','réunion','cocktail','réception_vip','événement_partenaire') THEN 'seminaire'
    ELSE 'autre'
  END;
$$;

-- ── Colonnes event_category (générées par trigger, non saisissables) ────────
ALTER TABLE event_stock_lines     ADD COLUMN IF NOT EXISTS event_category TEXT CHECK (event_category IN ('match','seminaire','autre'));
ALTER TABLE event_external_charges ADD COLUMN IF NOT EXISTS event_category TEXT CHECK (event_category IN ('match','seminaire','autre'));
ALTER TABLE schedules             ADD COLUMN IF NOT EXISTS event_category TEXT CHECK (event_category IN ('match','seminaire','autre'));
ALTER TABLE stock_movements       ADD COLUMN IF NOT EXISTS event_category TEXT CHECK (event_category IN ('match','seminaire','autre'));

-- ── Backfill de l'existant ──────────────────────────────────────────────────
UPDATE event_stock_lines esl     SET event_category = classify_event_type(e.event_type) FROM events e WHERE e.event_id = esl.event_id AND esl.event_category IS DISTINCT FROM classify_event_type(e.event_type);
UPDATE event_external_charges eec SET event_category = classify_event_type(e.event_type) FROM events e WHERE e.event_id = eec.event_id AND eec.event_category IS DISTINCT FROM classify_event_type(e.event_type);
UPDATE schedules sc              SET event_category = classify_event_type(e.event_type) FROM events e WHERE e.event_id = sc.event_id AND sc.event_category IS DISTINCT FROM classify_event_type(e.event_type);
UPDATE stock_movements sm        SET event_category = classify_event_type(e.event_type) FROM events e WHERE e.event_id = sm.event_id AND sm.event_category IS DISTINCT FROM classify_event_type(e.event_type);

-- ── Trigger générique d'auto-classification (partagé) ───────────────────────
CREATE OR REPLACE FUNCTION set_event_category()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  SELECT classify_event_type(event_type) INTO NEW.event_category FROM events WHERE event_id = NEW.event_id;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_event_cat ON event_stock_lines;
CREATE TRIGGER trg_event_cat BEFORE INSERT OR UPDATE OF event_id ON event_stock_lines
  FOR EACH ROW EXECUTE FUNCTION set_event_category();

DROP TRIGGER IF EXISTS trg_event_cat ON event_external_charges;
CREATE TRIGGER trg_event_cat BEFORE INSERT OR UPDATE OF event_id ON event_external_charges
  FOR EACH ROW EXECUTE FUNCTION set_event_category();

DROP TRIGGER IF EXISTS trg_event_cat ON schedules;
CREATE TRIGGER trg_event_cat BEFORE INSERT OR UPDATE OF event_id ON schedules
  FOR EACH ROW EXECUTE FUNCTION set_event_category();

DROP TRIGGER IF EXISTS trg_event_cat ON stock_movements;
CREATE TRIGGER trg_event_cat BEFORE INSERT OR UPDATE OF event_id ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION set_event_category();

-- ── Vue d'audit d'intégrité (re-sourcée, sans event_commercial_data) ────────
CREATE OR REPLACE VIEW charges_integrity_check AS
SELECT
  e.event_id,
  e.event_name,
  e.event_type,
  e.status,
  classify_event_type(e.event_type) AS event_category,
  COUNT(DISTINCT esl.line_id) FILTER (WHERE esl.event_category IS DISTINCT FROM classify_event_type(e.event_type))     AS stock_category_mismatch,
  COUNT(DISTINCT eec.id)      FILTER (WHERE eec.event_category IS DISTINCT FROM classify_event_type(e.event_type))     AS external_category_mismatch,
  COUNT(DISTINCT sc.schedule_id) FILTER (WHERE sc.event_category IS DISTINCT FROM classify_event_type(e.event_type))  AS schedule_category_mismatch,
  COUNT(DISTINCT esl.line_id) FILTER (WHERE esl.initial_qty > 0) AS stock_lines_saisies,
  COUNT(DISTINCT esl.line_id) FILTER (WHERE esl.final_qty IS NOT NULL) AS clotures_completes,
  COUNT(DISTINCT sc.schedule_id) AS agents_planifies,
  COUNT(DISTINCT eec.id) AS charges_externes,
  COUNT(DISTINCT eec.id) FILTER (WHERE eec.is_confirmed) AS factures_confirmees
FROM events e
LEFT JOIN event_stock_lines     esl ON esl.event_id = e.event_id
LEFT JOIN event_external_charges eec ON eec.event_id = e.event_id
LEFT JOIN schedules              sc  ON sc.event_id  = e.event_id
WHERE e.status IN ('clôturé','archivé','en_cours')
GROUP BY e.event_id, e.event_name, e.event_type, e.status;

GRANT SELECT ON charges_integrity_check TO authenticated;
