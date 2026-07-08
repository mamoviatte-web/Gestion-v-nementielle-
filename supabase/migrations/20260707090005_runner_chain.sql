-- ═══════════════════════════════════════════════════════════════════════════
-- runner_chain.sql — Espaces complémentaires S-1 + chaîne runner→stock→coût→débrief
-- À appliquer APRÈS runner_season_ref.sql (événements S-1 + helper insert_ref_conso).
-- Idempotent. Corrections vs prompt : consumed_qty GÉNÉRÉE → initial_stock ;
-- noms produits complets (le fuzzy '%Pepsi%' tape 'Pepsi 50cl') ; pas de DELETE
-- analytics (préserve les buvettes) ; ins() renommée insert_ref_conso (déjà fixée).
-- ═══════════════════════════════════════════════════════════════════════════

-- Filet de sécurité : (re)créer le helper corrigé si runner_season_ref pas encore joué.
CREATE OR REPLACE FUNCTION insert_ref_conso(p_event_name TEXT, p_space_code TEXT, p_product_name TEXT, p_qty INT)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_event UUID; v_space UUID; v_product UUID; v_norm TEXT;
BEGIN
  SELECT event_id INTO v_event FROM events WHERE event_name = p_event_name LIMIT 1;
  SELECT space_id INTO v_space FROM spaces WHERE access_code = p_space_code;
  v_norm := p_product_name;  -- match exact (le vrai produit est 'Pepsi bouteille 1L+')
  SELECT product_id INTO v_product FROM products
   WHERE active = true
     AND (lower(product_name) = lower(v_norm) OR product_name ILIKE '%' || SPLIT_PART(v_norm, ' ', 1) || '%')
   ORDER BY CASE WHEN lower(product_name) = lower(v_norm) THEN 0 ELSE 1 END, product_name
   LIMIT 1;
  IF v_event IS NULL OR v_space IS NULL OR v_product IS NULL THEN RETURN; END IF;
  INSERT INTO event_consumptions (event_id, space_id, product_id, initial_stock, restock_qty, final_stock, event_type, expected_attendance)
  SELECT v_event, v_space, v_product, p_qty, 0, 0, 'match', e.expected_attendees
  FROM events e WHERE e.event_id = v_event
  ON CONFLICT (event_id, space_id, product_id) DO UPDATE SET initial_stock = EXCLUDED.initial_stock;
END; $$;

-- ── Espaces complémentaires (noms produits COMPLETS) ────────────────────────
-- BISTROT (BI2026)
SELECT insert_ref_conso('Ref. vs Angoulême S-1','BI2026','Fût BUD',5);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','BI2026','Fût LEFFE',4);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','BI2026','Pepsi bouteille 1L+',17);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','BI2026','Pepsi Max bouteille',5);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','BI2026','Perrier grande bouteille',25);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','BI2026','Schweppes',9);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','BI2026','Blanc Montaurone',15);
SELECT insert_ref_conso('Ref. vs Barrage S-1','BI2026','Fût BUD',7);
SELECT insert_ref_conso('Ref. vs Barrage S-1','BI2026','Fût LEFFE',4);
SELECT insert_ref_conso('Ref. vs Barrage S-1','BI2026','Pepsi bouteille 1L+',20);
SELECT insert_ref_conso('Ref. vs Barrage S-1','BI2026','Perrier grande bouteille',28);
SELECT insert_ref_conso('Ref. vs Barrage S-1','BI2026','Schweppes',19);
-- COMPTOIR (CO2026)
SELECT insert_ref_conso('Ref. vs Angoulême S-1','CO2026','Fût BUD',5);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','CO2026','Rosé Miraval',6);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','CO2026','Rouge Les Alexandrins',6);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','CO2026','Pepsi bouteille 1L+',8);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','CO2026','Perrier grande bouteille',7);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','CO2026','Schweppes',13);
-- CLUB 70 NORD (C70N26)
SELECT insert_ref_conso('Ref. vs Angoulême S-1','C70N26','Mumm Cordon Rouge',24);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','C70N26','Rosé Pey Blanc',4);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','C70N26','Blanc du Seuil',9);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','C70N26','Fût BUD',3);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','C70N26','Pepsi bouteille 1L+',8);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','C70N26','Perrier grande bouteille',3);
SELECT insert_ref_conso('Ref. vs Barrage S-1','C70N26','Mumm Cordon Rouge',14);
SELECT insert_ref_conso('Ref. vs Barrage S-1','C70N26','Fût BUD',4);
SELECT insert_ref_conso('Ref. vs Barrage S-1','C70N26','Pepsi bouteille 1L+',11);
SELECT insert_ref_conso('Ref. vs Barrage S-1','C70N26','Perrier grande bouteille',18);
-- LOGES EST (LE2026)
SELECT insert_ref_conso('Ref. vs Angoulême S-1','LE2026','Mumm Cordon Rouge',1);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','LE2026','Bière en verre',16);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','LE2026','Rosé Réal',4);
SELECT insert_ref_conso('Ref. vs Barrage S-1','LE2026','Mumm Cordon Rouge',36);
SELECT insert_ref_conso('Ref. vs Barrage S-1','LE2026','Bière en verre',112);

-- ── Rafraîchir analytics (UPSERT, sans DELETE : buvettes préservées) ────────
INSERT INTO consumption_analytics
  (space_id, product_id, event_type, avg_qty_per_event, avg_qty_per_100_pax,
   confidence_score, nb_events_analyzed, trend_direction, last_updated)
SELECT ec.space_id, ec.product_id, 'match',
  ROUND(AVG(ec.consumed_qty)::numeric, 2),
  ROUND((AVG(ec.consumed_qty) / NULLIF(COALESCE(s.max_pax, 400), 0) * 100)::numeric, 4),
  LEAST(0.95, 0.2 + COUNT(*) * 0.15), COUNT(*), 'stable', now()
FROM event_consumptions ec
JOIN events e ON e.event_id = ec.event_id
JOIN spaces s ON s.space_id = ec.space_id
WHERE e.notes ILIKE '%Référence%' AND ec.consumed_qty > 0
GROUP BY ec.space_id, ec.product_id, s.max_pax
ON CONFLICT (space_id, product_id, event_type) DO UPDATE SET
  avg_qty_per_event = EXCLUDED.avg_qty_per_event,
  avg_qty_per_100_pax = EXCLUDED.avg_qty_per_100_pax,
  confidence_score = EXCLUDED.confidence_score,
  nb_events_analyzed = EXCLUDED.nb_events_analyzed,
  last_updated = now();

-- ── 3.1 Vue de liaison complète runner → stock → coût → débrief ─────────────
CREATE OR REPLACE VIEW event_full_chain WITH (security_invoker = true) AS
SELECT
  e.event_id, e.event_name, e.event_type, e.event_date,
  s.space_id, s.space_name, s.service_type,
  rap.product_id, p.product_name, p.category, p.unit, p.unit_price_ht,
  rap.recommended_quantity AS runner_reco,
  rap.quantity_to_move     AS runner_to_move,
  rap.validated_quantity   AS runner_validated,
  rap.validation_status    AS runner_status,
  esl.initial_qty, esl.reassort_qty, esl.final_qty,
  esl.initial_qty + COALESCE(esl.reassort_qty,0) - COALESCE(esl.final_qty,0) AS consumed_qty,
  CASE WHEN esl.final_qty IS NOT NULL AND p.unit_price_ht IS NOT NULL
       THEN (esl.initial_qty + COALESCE(esl.reassort_qty,0) - esl.final_qty) * p.unit_price_ht END AS line_cost_ht,
  d.overall_rating AS debrief_rating, d.cleaning_score, d.technical_score,
  d.stocks_suffisants AS debrief_stocks_ok,
  CASE WHEN rap.validated_quantity IS NOT NULL AND esl.final_qty IS NOT NULL
       THEN (esl.initial_qty + COALESCE(esl.reassort_qty,0) - esl.final_qty) - rap.validated_quantity END AS conso_vs_reco_delta
FROM runner_auto_planning rap
JOIN events e   ON e.event_id   = rap.event_id
JOIN spaces s   ON s.space_id   = rap.space_id
JOIN products p ON p.product_id = rap.product_id
LEFT JOIN event_stock_lines esl
  ON esl.event_id = rap.event_id AND esl.space_id = rap.space_id AND esl.product_id = rap.product_id
LEFT JOIN debriefs d ON d.event_id = rap.event_id AND d.space_id = rap.space_id
ORDER BY e.event_date DESC, s.space_name, p.category, p.product_name;

-- ── 3.2 Trigger : transmission runner → crée les lignes de stock ────────────
CREATE OR REPLACE FUNCTION on_runner_validate_create_stock_lines()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.validation_status = 'transmis_runners'
     AND OLD.validation_status IS DISTINCT FROM NEW.validation_status
     AND COALESCE(NEW.validated_quantity, 0) > 0 THEN
    INSERT INTO event_stock_lines (event_id, space_id, product_id, initial_qty, reassort_qty, responsable_nom)
    VALUES (NEW.event_id, NEW.space_id, NEW.product_id, NEW.validated_quantity, 0, 'Runner auto')
    ON CONFLICT (event_id, space_id, product_id) DO UPDATE SET initial_qty = EXCLUDED.initial_qty;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_runner_to_stock ON runner_auto_planning;
CREATE TRIGGER trg_runner_to_stock AFTER UPDATE ON runner_auto_planning FOR EACH ROW
  EXECUTE FUNCTION on_runner_validate_create_stock_lines();
