-- ═══════════════════════════════════════════════════════════════════════════
-- vip_history_import.sql — Import historique 5 matchs (Salon Nord) + analytics
-- Prérequis : _APPLY_ALL.sql (produits, event_consumptions) + buvettes_capacites.sql
--             (event_spaces.service_mode/expected_pax, spaces.max_pax).
--
-- ⚠ Corrections vs le SQL du prompt (schéma RÉEL) :
--   • event_consumptions.consumed_qty est une colonne GÉNÉRÉE
--     (initial_stock + restock_qty - final_stock) → on renseigne initial_stock,
--     pas consumed_qty (sinon « cannot insert into generated column »).
--   • expected_attendance = pax de l'ESPACE (400 pour SN), PAS l'affluence stade :
--     sinon avg_qty_per_100_pax est minuscule → reco ≈ 0. Avec 400, la reco
--     reproduit la moyenne (Mumm BdB 31, Perrier 28, Pepsi 18).
--   • Correspondance produits EXACTE via table de mapping (le ILIKE '%Pepsi%'
--     du prompt matcherait plusieurs produits Pepsi).
--   • refresh_all_analytics du prompt est invalide (CORR(ROW_NUMBER() OVER…) =
--     window dans un agrégat) → tendance via regr_slope (agrégat valide),
--     fonction dédiée recalc_vip_analytics() (ne clobbère pas l'existante).
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- ╔═══ ÉTAPE 1.1 — 5 événements historiques (idempotent) ══════════════════╗
INSERT INTO events (event_name, event_type, event_date, expected_attendees, status)
SELECT v.n, 'match', v.d::date, v.a, 'archivé'
FROM (VALUES
  ('vs Colomiers (hist.)',      '2026-03-26', 7750),
  ('vs Mont-de-Marsan (hist.)', '2026-04-10', 7500),
  ('vs Vannes (hist.)',         '2026-05-07', 7500),
  ('vs Angoulême (hist.)',      '2026-06-01', 8000),
  ('vs Barrage (hist.)',        '2026-06-20', 8500)
) AS v(n, d, a)
WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.event_name = v.n);

-- ╔═══ ÉTAPE 1.2 — Association Salon Nord (400 pax) aux 5 matchs ═══════════╗
INSERT INTO event_spaces (event_id, space_id, service_mode, expected_pax)
SELECT e.event_id, s.space_id, 'vip', 400
FROM events e
CROSS JOIN (SELECT space_id FROM spaces WHERE access_code = 'SN2026') s
WHERE e.event_name ILIKE '%hist%'
ON CONFLICT (event_id, space_id) DO UPDATE SET service_mode = 'vip', expected_pax = 400;

-- ╔═══ ÉTAPE 1.3 — Consommations Salon Nord (initial_stock = conso réelle) ═╗
WITH sn AS (SELECT space_id FROM spaces WHERE access_code = 'SN2026'),
name_map(excel, real) AS (VALUES
  ('MUMM CORDON ROUGE','Mumm Cordon Rouge'),
  ('MUMM BLANC DE BLANC','Mumm Blanc de Blanc'),
  ('Rosé Miraval','Rosé Miraval'),
  ('Rosé Réal','Rosé Réal'),
  ('Rouge Les Alexandrins','Rouge Les Alexandrins'),
  ('Rouge Grand Boise','Rouge Grand Boise'),
  ('Blanc Galiniere','Blanc Galiniere'),
  ('Blanc du Seuil','Blanc du Seuil'),
  ('Blanc Montaurone','Blanc Montaurone'),
  ('Fût BUD','Fût BUD'),
  ('Fût LEFFE','Fût LEFFE'),
  ('Pepsi bouteille 1L+','Pepsi bouteille'),
  ('Pepsi Max bouteille','Pepsi Max bouteille'),
  ('Perrier grande bouteille','Perrier grande bouteille'),
  ('Schweppes','Schweppes'),
  ('Jus de fruits','Jus de fruits'),
  ('Whisky Jameson','Whisky Jameson'),
  ('GET 27','GET 27'),
  ('Lillet Blanc','Lillet Blanc'),
  ('Lillet Rosé','Lillet Rosé'),
  ('Ricard classique','Ricard classique')
),
data(event_name, product_excel, qty) AS (VALUES
  ('vs Angoulême (hist.)','MUMM CORDON ROUGE',5),('vs Angoulême (hist.)','MUMM BLANC DE BLANC',38),
  ('vs Angoulême (hist.)','Rosé Miraval',15),('vs Angoulême (hist.)','Rosé Réal',1),
  ('vs Angoulême (hist.)','Rouge Les Alexandrins',11),('vs Angoulême (hist.)','Rouge Grand Boise',1),
  ('vs Angoulême (hist.)','Blanc Galiniere',11),('vs Angoulême (hist.)','Blanc du Seuil',3),
  ('vs Angoulême (hist.)','Fût BUD',3),('vs Angoulême (hist.)','Fût LEFFE',1),
  ('vs Angoulême (hist.)','Pepsi bouteille 1L+',21),('vs Angoulême (hist.)','Pepsi Max bouteille',5),
  ('vs Angoulême (hist.)','Perrier grande bouteille',17),('vs Angoulême (hist.)','Schweppes',8),
  ('vs Angoulême (hist.)','Jus de fruits',6),('vs Angoulême (hist.)','Whisky Jameson',5),
  ('vs Angoulême (hist.)','GET 27',5),('vs Angoulême (hist.)','Lillet Blanc',4),
  ('vs Angoulême (hist.)','Lillet Rosé',3),('vs Angoulême (hist.)','Ricard classique',3),
  ('vs Barrage (hist.)','MUMM CORDON ROUGE',20),('vs Barrage (hist.)','MUMM BLANC DE BLANC',1),
  ('vs Barrage (hist.)','Rosé Miraval',14),('vs Barrage (hist.)','Rosé Réal',7),
  ('vs Barrage (hist.)','Rouge Les Alexandrins',1),('vs Barrage (hist.)','Rouge Grand Boise',7),
  ('vs Barrage (hist.)','Blanc Galiniere',25),('vs Barrage (hist.)','Blanc du Seuil',2),
  ('vs Barrage (hist.)','Blanc Montaurone',3),('vs Barrage (hist.)','Fût BUD',2),
  ('vs Barrage (hist.)','Fût LEFFE',2),('vs Barrage (hist.)','Pepsi bouteille 1L+',16),
  ('vs Barrage (hist.)','Pepsi Max bouteille',6),('vs Barrage (hist.)','Perrier grande bouteille',30),
  ('vs Barrage (hist.)','Schweppes',10),('vs Barrage (hist.)','Jus de fruits',11),
  ('vs Barrage (hist.)','Whisky Jameson',1),('vs Barrage (hist.)','GET 27',2),
  ('vs Barrage (hist.)','Lillet Blanc',4),('vs Barrage (hist.)','Lillet Rosé',1),
  ('vs Barrage (hist.)','Ricard classique',2),
  ('vs Colomiers (hist.)','MUMM BLANC DE BLANC',70),('vs Colomiers (hist.)','Rosé Miraval',10),
  ('vs Colomiers (hist.)','Rouge Les Alexandrins',9),('vs Colomiers (hist.)','Rouge Grand Boise',10),
  ('vs Colomiers (hist.)','Blanc Galiniere',22),('vs Colomiers (hist.)','Blanc du Seuil',6),
  ('vs Colomiers (hist.)','Fût BUD',5),('vs Colomiers (hist.)','Fût LEFFE',3),
  ('vs Colomiers (hist.)','Pepsi bouteille 1L+',17),('vs Colomiers (hist.)','Pepsi Max bouteille',4),
  ('vs Colomiers (hist.)','Schweppes',3),('vs Colomiers (hist.)','Jus de fruits',6),
  ('vs Colomiers (hist.)','Whisky Jameson',9),('vs Colomiers (hist.)','GET 27',10),
  ('vs Colomiers (hist.)','Ricard classique',3),
  ('vs Mont-de-Marsan (hist.)','MUMM BLANC DE BLANC',28),('vs Mont-de-Marsan (hist.)','Rosé Miraval',6),
  ('vs Mont-de-Marsan (hist.)','Rouge Les Alexandrins',4),('vs Mont-de-Marsan (hist.)','Rouge Grand Boise',3),
  ('vs Mont-de-Marsan (hist.)','Blanc Galiniere',10),('vs Mont-de-Marsan (hist.)','Blanc du Seuil',4),
  ('vs Mont-de-Marsan (hist.)','Fût BUD',4),('vs Mont-de-Marsan (hist.)','Fût LEFFE',2),
  ('vs Mont-de-Marsan (hist.)','Pepsi bouteille 1L+',22),('vs Mont-de-Marsan (hist.)','Pepsi Max bouteille',5),
  ('vs Mont-de-Marsan (hist.)','Perrier grande bouteille',35),('vs Mont-de-Marsan (hist.)','Schweppes',9),
  ('vs Mont-de-Marsan (hist.)','Jus de fruits',5),('vs Mont-de-Marsan (hist.)','Whisky Jameson',1),
  ('vs Mont-de-Marsan (hist.)','GET 27',9),('vs Mont-de-Marsan (hist.)','Lillet Blanc',6),
  ('vs Mont-de-Marsan (hist.)','Ricard classique',1),
  ('vs Vannes (hist.)','MUMM CORDON ROUGE',20),('vs Vannes (hist.)','MUMM BLANC DE BLANC',18),
  ('vs Vannes (hist.)','Rosé Miraval',11),('vs Vannes (hist.)','Blanc Galiniere',3),
  ('vs Vannes (hist.)','Blanc Montaurone',17),('vs Vannes (hist.)','Blanc du Seuil',1),
  ('vs Vannes (hist.)','Fût BUD',2),('vs Vannes (hist.)','Fût LEFFE',4),
  ('vs Vannes (hist.)','Pepsi bouteille 1L+',14),('vs Vannes (hist.)','Pepsi Max bouteille',3),
  ('vs Vannes (hist.)','Perrier grande bouteille',28),('vs Vannes (hist.)','Schweppes',2),
  ('vs Vannes (hist.)','Jus de fruits',2),('vs Vannes (hist.)','Whisky Jameson',1),
  ('vs Vannes (hist.)','GET 27',14),('vs Vannes (hist.)','Ricard classique',1)
)
INSERT INTO event_consumptions
  (event_id, space_id, product_id, initial_stock, restock_qty, final_stock, unit_price_ht, event_type, expected_attendance)
SELECT e.event_id, sn.space_id, p.product_id, d.qty, 0, 0, p.unit_price_ht, 'match', 400
FROM data d
JOIN name_map nm ON nm.excel = d.product_excel
JOIN products p ON lower(p.product_name) = lower(nm.real) AND p.active = true
JOIN events e ON e.event_name = d.event_name
CROSS JOIN sn
ON CONFLICT (event_id, space_id, product_id) DO UPDATE
  SET initial_stock = EXCLUDED.initial_stock, expected_attendance = EXCLUDED.expected_attendance;

-- ╔═══ ÉTAPE 2 — Recalcul analytics depuis event_consumptions ═════════════╗
-- Fonction dédiée (ne remplace pas refresh_all_analytics existante).
CREATE OR REPLACE FUNCTION recalc_vip_analytics() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO consumption_analytics
    (space_id, product_id, event_type, avg_qty_per_event, avg_qty_per_100_pax,
     trend_direction, confidence_score, nb_events_analyzed, last_updated)
  SELECT
    ec.space_id, ec.product_id, ec.event_type,
    AVG(ec.consumed_qty),
    CASE WHEN AVG(ec.expected_attendance) > 0
         THEN AVG(ec.consumed_qty) / AVG(ec.expected_attendance) * 100 ELSE 0 END,
    CASE WHEN COUNT(*) >= 3 AND regr_slope(ec.consumed_qty, EXTRACT(EPOCH FROM e.event_date)::float8) > 0 THEN 'hausse'
         WHEN COUNT(*) >= 3 AND regr_slope(ec.consumed_qty, EXTRACT(EPOCH FROM e.event_date)::float8) < 0 THEN 'baisse'
         ELSE 'stable' END,
    LEAST(0.95, 0.2 + COUNT(*) * 0.15),
    COUNT(*), now()
  FROM event_consumptions ec
  JOIN events e ON e.event_id = ec.event_id
  WHERE ec.consumed_qty > 0
  GROUP BY ec.space_id, ec.product_id, ec.event_type
  ON CONFLICT (space_id, product_id, event_type) DO UPDATE SET
    avg_qty_per_event   = EXCLUDED.avg_qty_per_event,
    avg_qty_per_100_pax = EXCLUDED.avg_qty_per_100_pax,
    trend_direction     = EXCLUDED.trend_direction,
    confidence_score    = EXCLUDED.confidence_score,
    nb_events_analyzed  = EXCLUDED.nb_events_analyzed,
    last_updated        = now();
END; $$;
SELECT recalc_vip_analytics();

-- ╔═══ ÉTAPE 6 — Recalcul des fiches runner des matchs 'préparé' ══════════╗
UPDATE runner_auto_planning rap
SET recommended_quantity = CEIL(
      ca.avg_qty_per_100_pax * (COALESCE(es.expected_pax, s.max_pax, 100)::DECIMAL / 100)
      * COALESCE(rap.attendance_coefficient,1) * COALESCE(rap.weather_coefficient,1)
      * COALESCE(rap.event_type_coefficient,1) * COALESCE(rap.trend_coefficient,1)),
    quantity_to_move = GREATEST(0, CEIL(
      ca.avg_qty_per_100_pax * (COALESCE(es.expected_pax, s.max_pax, 100)::DECIMAL / 100)
      * COALESCE(rap.attendance_coefficient,1) * COALESCE(rap.weather_coefficient,1))
      - COALESCE(rap.initial_area_stock, 0))
FROM consumption_analytics ca, event_spaces es, spaces s, events e
WHERE ca.space_id = rap.space_id AND ca.product_id = rap.product_id
  AND ca.event_type = 'match' AND ca.avg_qty_per_100_pax > 0
  AND es.event_id = rap.event_id AND es.space_id = rap.space_id
  AND s.space_id = rap.space_id
  AND e.event_id = rap.event_id
  AND e.status IN ('brouillon','préparé','en_cours');

-- ╔═══ VÉRIFICATION ═══════════════════════════════════════════════════════╗
SELECT p.product_name,
       ROUND(ca.avg_qty_per_event,1)   AS moy_hist,
       ROUND(ca.avg_qty_per_100_pax,3) AS ratio_100,
       ca.nb_events_analyzed           AS nb_matchs,
       ca.trend_direction              AS tendance,
       CEIL(ca.avg_qty_per_100_pax * 4) AS reco_400pax
  FROM consumption_analytics ca
  JOIN spaces s   ON s.space_id   = ca.space_id
  JOIN products p ON p.product_id = ca.product_id
 WHERE s.access_code = 'SN2026' AND ca.event_type = 'match' AND ca.avg_qty_per_event > 0
 ORDER BY ca.avg_qty_per_event DESC;
