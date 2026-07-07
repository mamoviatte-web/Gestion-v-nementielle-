-- ═══════════════════════════════════════════════════════════════════════════
-- buvettes_capacites.sql — Renommage B1-B9 · Capacités espaces · Schéma match
-- Idempotent. À exécuter dans le SQL Editor Supabase (rôle service) ou via MCP.
-- Note : espaces.space_type reste ('VIP','Bar','Buvette') ; service_type est la
-- nouvelle dimension de service ('vip','bar','buvette') pilotant les dotations.
-- ═══════════════════════════════════════════════════════════════════════════

-- ╔═══ ÉTAPE 1 — Renommage buvettes B1 à B9 (codes d'accès inchangés) ══════╗
UPDATE spaces SET space_name = 'B1' WHERE access_code = 'BNO2026';
UPDATE spaces SET space_name = 'B2' WHERE access_code = 'BNE2026';
UPDATE spaces SET space_name = 'B3' WHERE access_code = 'BEG2026';
UPDATE spaces SET space_name = 'B4' WHERE access_code = 'BEP2026';
UPDATE spaces SET space_name = 'B5' WHERE access_code = 'BVSE2026';
UPDATE spaces SET space_name = 'B6' WHERE access_code = 'BSE2026';
UPDATE spaces SET space_name = 'B7' WHERE access_code = 'BSO2026';
UPDATE spaces SET space_name = 'B8' WHERE access_code = 'BVSO2026';
UPDATE spaces SET space_name = 'B9' WHERE access_code = 'BVO2026';
-- Buvette Virage Toinou (BVTOI26) : occasionnelle, non renommée.

-- ╔═══ ÉTAPE 2 — Capacités + service_type ═════════════════════════════════╗
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS max_pax INT;
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS service_type TEXT DEFAULT 'bar';
-- CHECK ajouté séparément (idempotent) pour ne pas échouer si déjà présent.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spaces_service_type_check') THEN
    ALTER TABLE spaces ADD CONSTRAINT spaces_service_type_check
      CHECK (service_type IN ('vip','bar','buvette'));
  END IF;
END $$;

UPDATE spaces SET max_pax = 400, service_type = 'vip' WHERE access_code = 'SN2026';
UPDATE spaces SET max_pax = 290, service_type = 'vip' WHERE access_code = 'SS2026';
UPDATE spaces SET max_pax = 200, service_type = 'bar' WHERE access_code = 'PUB2026';
UPDATE spaces SET max_pax = 150, service_type = 'bar' WHERE access_code = 'C70S26';
UPDATE spaces SET max_pax = 150, service_type = 'bar' WHERE access_code = 'C70N26';
UPDATE spaces SET max_pax = 195, service_type = 'bar' WHERE access_code = 'CO2026';
UPDATE spaces SET max_pax = 165, service_type = 'bar' WHERE access_code = 'BI2026';
UPDATE spaces SET max_pax = 120, service_type = 'bar' WHERE access_code = 'WBS2026';
UPDATE spaces SET max_pax = 120, service_type = 'bar' WHERE access_code = 'WBN2026';
UPDATE spaces SET max_pax = 100, service_type = 'vip' WHERE access_code IN ('LE2026','LON2026','LOS2026');
UPDATE spaces SET service_type = 'buvette' WHERE space_type = 'Buvette';
UPDATE spaces SET max_pax = 300, service_type = 'bar' WHERE access_code = 'TER2026';
UPDATE spaces SET max_pax = 400, service_type = 'bar' WHERE access_code = 'BOD2026';

-- Garden Party — créée si absente.
INSERT INTO spaces (space_name, space_type, access_code, max_pax, service_type)
VALUES ('Garden Party', 'Bar', 'GP2026', 150, 'bar')
ON CONFLICT (access_code) DO UPDATE SET max_pax = 150, service_type = 'bar';

-- ╔═══ ÉTAPE 3 — Colonnes match + fonction dotation VIP ═══════════════════╗
ALTER TABLE event_spaces ADD COLUMN IF NOT EXISTS service_mode TEXT DEFAULT 'auto';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_spaces_service_mode_check') THEN
    ALTER TABLE event_spaces ADD CONSTRAINT event_spaces_service_mode_check
      CHECK (service_mode IN ('vip','bar','buvette','fermé','auto'));
  END IF;
END $$;
ALTER TABLE event_spaces ADD COLUMN IF NOT EXISTS expected_pax INT;

-- Dotation VIP = pax attendus × ratio produit / 100.
CREATE OR REPLACE FUNCTION get_vip_dotation(p_space_id UUID, p_product_id UUID, p_event_id UUID)
RETURNS INT LANGUAGE plpgsql STABLE AS $$
DECLARE v_pax INT; v_ratio DECIMAL(8,4); v_raw DECIMAL(8,2);
BEGIN
  SELECT COALESCE(es.expected_pax, s.max_pax, 100) INTO v_pax
    FROM event_spaces es JOIN spaces s ON s.space_id = es.space_id
   WHERE es.event_id = p_event_id AND es.space_id = p_space_id;
  v_pax := COALESCE(v_pax, 100);

  SELECT COALESCE(ca.avg_qty_per_100_pax, 0) INTO v_ratio
    FROM consumption_analytics ca
   WHERE ca.space_id = p_space_id AND ca.product_id = p_product_id AND ca.event_type = 'match'
   LIMIT 1;
  v_ratio := COALESCE(v_ratio, 0);

  IF v_ratio = 0 THEN
    SELECT COALESCE(rt.ratio_per_100, 0) INTO v_ratio
      FROM runner_templates rt
     WHERE rt.space_id = p_space_id AND rt.product_id = p_product_id AND rt.event_type = 'match'
     LIMIT 1;
    v_ratio := COALESCE(v_ratio, 0);
  END IF;

  v_raw := (v_pax::DECIMAL / 100) * v_ratio;
  RETURN CEIL(v_raw);
END; $$;

-- ╔═══ ÉTAPE 5 — Vue rapport consommation match (Grand Public / VIP) ══════╗
CREATE OR REPLACE VIEW match_consumption_report WITH (security_invoker = true) AS
SELECT
  e.event_id, e.event_name, e.event_date, e.expected_attendees,
  CASE WHEN s.service_type = 'buvette' THEN 'Grand Public'
       WHEN s.service_type = 'vip'     THEN 'VIP'
       ELSE 'Bar' END AS consumption_category,
  s.space_id, s.space_name, s.service_type, s.max_pax, es.expected_pax,
  p.product_id, p.product_name, p.category, p.unit, p.unit_price_ht,
  esl.initial_qty,
  COALESCE(esl.reassort_qty, 0) AS reassort_qty,
  esl.final_qty,
  esl.initial_qty + COALESCE(esl.reassort_qty,0) - COALESCE(esl.final_qty,0) AS consumed_qty,
  CASE WHEN esl.final_qty IS NOT NULL AND p.unit_price_ht IS NOT NULL
       THEN (esl.initial_qty + COALESCE(esl.reassort_qty,0) - esl.final_qty) * p.unit_price_ht END AS cost_ht,
  CASE WHEN esl.final_qty IS NOT NULL AND COALESCE(es.expected_pax, e.expected_attendees, 0) > 0
       THEN (esl.initial_qty + COALESCE(esl.reassort_qty,0) - esl.final_qty)::DECIMAL
            / COALESCE(es.expected_pax, e.expected_attendees, 1) * 100 END AS qty_per_100pax
FROM event_stock_lines esl
JOIN events   e ON e.event_id   = esl.event_id
JOIN spaces   s ON s.space_id   = esl.space_id
JOIN products p ON p.product_id = esl.product_id
JOIN event_spaces es ON es.event_id = e.event_id AND es.space_id = s.space_id
WHERE e.event_type = 'match'
ORDER BY e.event_date DESC,
  CASE s.service_type WHEN 'vip' THEN 1 WHEN 'bar' THEN 2 ELSE 3 END,
  s.space_name, p.category, p.product_name;

-- ╔═══ ÉTAPE 7 — Match test avec expected_pax par espace ══════════════════╗
DO $$
DECLARE v_event UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM events WHERE event_name = 'Provence Rugby vs TEST') THEN
    INSERT INTO events (event_name, event_type, event_date, start_time, expected_attendees, status)
    VALUES ('Provence Rugby vs TEST', 'match', CURRENT_DATE + 7, '19:00', 8000, 'préparé')
    RETURNING event_id INTO v_event;

    INSERT INTO event_spaces (event_id, space_id, service_mode, expected_pax)
    SELECT v_event, s.space_id, COALESCE(s.service_type, 'bar'),
      CASE s.access_code
        WHEN 'SN2026' THEN 400 WHEN 'SS2026' THEN 290 WHEN 'PUB2026' THEN 200
        WHEN 'C70S26' THEN 150 WHEN 'C70N26' THEN 150 WHEN 'CO2026' THEN 195
        WHEN 'BI2026' THEN 165 WHEN 'WBS2026' THEN 120 WHEN 'WBN2026' THEN 120
        WHEN 'TER2026' THEN 300 WHEN 'BOD2026' THEN 400 WHEN 'GP2026' THEN 150
        ELSE NULL END
    FROM spaces s WHERE s.active = true
    ON CONFLICT (event_id, space_id) DO NOTHING;
  END IF;
END $$;
