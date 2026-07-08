-- ═══════════════════════════════════════════════════════════════════════════
-- runner_season_ref.sql — Base historique saison S-1 (5 matchs référence)
-- Nouvelle saison : espaces à 0 → À monter = Recommandé. Supersede vip_history_import.
-- Prérequis : _APPLY_ALL.sql (produits, event_consumptions) + buvettes_capacites.sql
--             (spaces.max_pax/service_type).
--
-- ⚠ Corrections vs le SQL du prompt (schéma RÉEL) :
--   • events n'a PAS de colonne notes → ALTER ADD notes.
--   • event_consumptions.consumed_qty est GÉNÉRÉE → on écrit initial_stock.
--   • insert_ref_conso : matching EXACT prioritaire + alias 'Pepsi bouteille 1L+'
--     → 'Pepsi bouteille' (le ILIKE '%Pepsi%' du prompt tapait 'Pepsi 50cl').
--   • PHASE 2 trend : le prompt met COUNT(*) DANS AVG() = agrégat imbriqué INVALIDE
--     → total_n via COUNT() OVER (colonne), comparaison 1re moitié / 2e moitié valide.
--   • PAS de « DELETE consumption_analytics WHERE event_type='match' » : effacerait
--     les analytics BUVETTES importées auparavant → on UPSERT uniquement.
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE events ADD COLUMN IF NOT EXISTS notes TEXT;

-- ╔═══ PHASE 1.1 — 5 événements de référence (S-1) ════════════════════════╗
INSERT INTO events (event_name, event_type, event_date, expected_attendees, status, notes)
SELECT v.n, 'match', v.d::date, v.a, 'archivé', 'Référence saison précédente'
FROM (VALUES
  ('Ref. vs Colomiers S-1',      '2025-03-26', 7750),
  ('Ref. vs Mont-de-Marsan S-1', '2025-04-10', 7500),
  ('Ref. vs Vannes S-1',         '2025-05-07', 7500),
  ('Ref. vs Angoulême S-1',      '2025-06-01', 8000),
  ('Ref. vs Barrage S-1',        '2025-06-20', 8500)
) AS v(n, d, a)
WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.event_name = v.n);

-- ╔═══ PHASE 1.2 — Fonction d'insertion (initial_stock, matching exact d'abord) ═╗
CREATE OR REPLACE FUNCTION insert_ref_conso(p_event_name TEXT, p_space_code TEXT, p_product_name TEXT, p_qty INT)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_event UUID; v_space UUID; v_product UUID; v_norm TEXT;
BEGIN
  SELECT event_id INTO v_event FROM events WHERE event_name = p_event_name LIMIT 1;
  SELECT space_id INTO v_space FROM spaces WHERE access_code = p_space_code;
  -- Alias connus (nom Excel ≠ catalogue).
  v_norm := p_product_name;  -- match exact (le vrai produit est 'Pepsi bouteille 1L+')
  -- Exact d'abord, puis fuzzy sur le premier mot.
  SELECT product_id INTO v_product FROM products
   WHERE active = true
     AND (lower(product_name) = lower(v_norm)
          OR product_name ILIKE '%' || SPLIT_PART(v_norm, ' ', 1) || '%')
   ORDER BY CASE WHEN lower(product_name) = lower(v_norm) THEN 0 ELSE 1 END, product_name
   LIMIT 1;

  IF v_event IS NULL OR v_space IS NULL OR v_product IS NULL THEN
    RAISE NOTICE 'Ignoré : event=% space=% prod=%', p_event_name, p_space_code, p_product_name;
    RETURN;
  END IF;

  INSERT INTO event_consumptions (event_id, space_id, product_id, initial_stock, restock_qty, final_stock, event_type, expected_attendance)
  SELECT v_event, v_space, v_product, p_qty, 0, 0, 'match', e.expected_attendees
  FROM events e WHERE e.event_id = v_event
  ON CONFLICT (event_id, space_id, product_id) DO UPDATE SET initial_stock = EXCLUDED.initial_stock;
END; $$;

-- ╔═══ PHASE 1.3 — SALON NORD (SN2026) ════════════════════════════════════╗
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Mumm Cordon Rouge',5);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Mumm Blanc de Blanc',38);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Rosé Miraval',15);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Rosé Réal',1);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Rouge Les Alexandrins',11);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Blanc Galiniere',11);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Blanc du Seuil',3);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Fût BUD',3);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Fût LEFFE',1);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Pepsi bouteille 1L+',21);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Pepsi Max bouteille',5);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Perrier grande bouteille',17);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Schweppes',8);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Jus de fruits',6);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Whisky Jameson',5);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','GET 27',5);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Lillet Blanc',4);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Lillet Rosé',3);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Ricard classique',3);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Mumm Cordon Rouge',20);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Mumm Blanc de Blanc',1);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Rosé Miraval',14);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Rosé Réal',7);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Blanc Galiniere',25);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Blanc du Seuil',2);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Blanc Montaurone',3);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Fût BUD',2);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Fût LEFFE',2);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Pepsi bouteille 1L+',16);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Pepsi Max bouteille',6);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Perrier grande bouteille',30);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Schweppes',10);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Jus de fruits',11);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Whisky Jameson',1);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','GET 27',2);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Lillet Blanc',4);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Ricard classique',2);
SELECT insert_ref_conso('Ref. vs Colomiers S-1','SN2026','Mumm Blanc de Blanc',70);
SELECT insert_ref_conso('Ref. vs Colomiers S-1','SN2026','Rosé Miraval',10);
SELECT insert_ref_conso('Ref. vs Colomiers S-1','SN2026','Blanc Galiniere',22);
SELECT insert_ref_conso('Ref. vs Colomiers S-1','SN2026','Blanc du Seuil',6);
SELECT insert_ref_conso('Ref. vs Colomiers S-1','SN2026','Fût BUD',5);
SELECT insert_ref_conso('Ref. vs Colomiers S-1','SN2026','Fût LEFFE',3);
SELECT insert_ref_conso('Ref. vs Colomiers S-1','SN2026','Pepsi bouteille 1L+',17);
SELECT insert_ref_conso('Ref. vs Colomiers S-1','SN2026','Pepsi Max bouteille',4);
SELECT insert_ref_conso('Ref. vs Colomiers S-1','SN2026','Schweppes',3);
SELECT insert_ref_conso('Ref. vs Colomiers S-1','SN2026','Jus de fruits',6);
SELECT insert_ref_conso('Ref. vs Colomiers S-1','SN2026','Whisky Jameson',9);
SELECT insert_ref_conso('Ref. vs Colomiers S-1','SN2026','GET 27',10);
SELECT insert_ref_conso('Ref. vs Colomiers S-1','SN2026','Ricard classique',3);
SELECT insert_ref_conso('Ref. vs Mont-de-Marsan S-1','SN2026','Mumm Blanc de Blanc',28);
SELECT insert_ref_conso('Ref. vs Mont-de-Marsan S-1','SN2026','Rosé Miraval',6);
SELECT insert_ref_conso('Ref. vs Mont-de-Marsan S-1','SN2026','Blanc Galiniere',10);
SELECT insert_ref_conso('Ref. vs Mont-de-Marsan S-1','SN2026','Blanc du Seuil',4);
SELECT insert_ref_conso('Ref. vs Mont-de-Marsan S-1','SN2026','Fût BUD',4);
SELECT insert_ref_conso('Ref. vs Mont-de-Marsan S-1','SN2026','Fût LEFFE',2);
SELECT insert_ref_conso('Ref. vs Mont-de-Marsan S-1','SN2026','Pepsi bouteille 1L+',22);
SELECT insert_ref_conso('Ref. vs Mont-de-Marsan S-1','SN2026','Pepsi Max bouteille',5);
SELECT insert_ref_conso('Ref. vs Mont-de-Marsan S-1','SN2026','Perrier grande bouteille',35);
SELECT insert_ref_conso('Ref. vs Mont-de-Marsan S-1','SN2026','Schweppes',9);
SELECT insert_ref_conso('Ref. vs Mont-de-Marsan S-1','SN2026','Jus de fruits',5);
SELECT insert_ref_conso('Ref. vs Mont-de-Marsan S-1','SN2026','Whisky Jameson',1);
SELECT insert_ref_conso('Ref. vs Mont-de-Marsan S-1','SN2026','GET 27',9);
SELECT insert_ref_conso('Ref. vs Mont-de-Marsan S-1','SN2026','Lillet Blanc',6);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','Mumm Cordon Rouge',20);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','Mumm Blanc de Blanc',18);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','Rosé Miraval',11);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','Blanc Galiniere',3);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','Blanc Montaurone',17);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','Blanc du Seuil',1);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','Fût BUD',2);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','Fût LEFFE',4);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','Pepsi bouteille 1L+',14);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','Pepsi Max bouteille',3);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','Perrier grande bouteille',28);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','Schweppes',2);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','Jus de fruits',2);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','Whisky Jameson',1);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','GET 27',14);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','Ricard classique',1);

-- ╔═══ PHASE 1.4 — SALON SUD (SS2026) ═════════════════════════════════════╗
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SS2026','Mumm Cordon Rouge',23);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SS2026','Rosé Réal',9);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SS2026','Rouge Les Alexandrins',13);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SS2026','Blanc Galiniere',17);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SS2026','Blanc du Seuil',2);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SS2026','Fût BUD',2);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SS2026','Fût LEFFE',2);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SS2026','Pepsi bouteille 1L+',13);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SS2026','Pepsi Max bouteille',6);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SS2026','Schweppes',6);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SS2026','Jus de fruits',1);

-- ╔═══ PHASE 1.5 — LE PUB (PUB2026) ═══════════════════════════════════════╗
SELECT insert_ref_conso('Ref. vs Angoulême S-1','PUB2026','Mumm Cordon Rouge',24);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','PUB2026','Rosé Miraval',5);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','PUB2026','Rouge Grand Boise',5);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','PUB2026','Blanc Galiniere',16);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','PUB2026','Fût BUD',2);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','PUB2026','Fût LEFFE',2);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','PUB2026','Pepsi bouteille 1L+',17);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','PUB2026','Pepsi Max bouteille',2);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','PUB2026','Perrier grande bouteille',16);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','PUB2026','Schweppes',8);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','PUB2026','Jus de fruits',3);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','PUB2026','Lillet Blanc',3);

-- ╔═══ PHASE 2 — Analytics depuis les données S-1 (UPSERT, sans DELETE) ════╗
INSERT INTO consumption_analytics
  (space_id, product_id, event_type, avg_qty_per_event, avg_qty_per_100_pax,
   confidence_score, nb_events_analyzed, trend_direction, last_updated)
SELECT
  x.space_id, x.product_id, 'match',
  ROUND(AVG(x.consumed_qty)::numeric, 2),
  ROUND((AVG(x.consumed_qty) / COALESCE(s.max_pax, 200) * 100)::numeric, 4),
  LEAST(0.95, 0.2 + COUNT(*) * 0.15),
  COUNT(*),
  CASE
    WHEN COUNT(*) >= 4
     AND AVG(CASE WHEN x.rn * 2 <= x.total_n THEN x.consumed_qty END) * 1.15
       < AVG(CASE WHEN x.rn * 2 >  x.total_n THEN x.consumed_qty END) THEN 'hausse'
    WHEN COUNT(*) >= 4
     AND AVG(CASE WHEN x.rn * 2 <= x.total_n THEN x.consumed_qty END) * 0.85
       > AVG(CASE WHEN x.rn * 2 >  x.total_n THEN x.consumed_qty END) THEN 'baisse'
    ELSE 'stable'
  END,
  now()
FROM (
  SELECT ec.space_id, ec.product_id, ec.consumed_qty,
         ROW_NUMBER() OVER (PARTITION BY ec.space_id, ec.product_id ORDER BY e.event_date) AS rn,
         COUNT(*)   OVER (PARTITION BY ec.space_id, ec.product_id)                         AS total_n
    FROM event_consumptions ec
    JOIN events e ON e.event_id = ec.event_id
   WHERE e.notes ILIKE '%Référence saison%' AND ec.consumed_qty > 0
) x
JOIN spaces s ON s.space_id = x.space_id
GROUP BY x.space_id, x.product_id, s.max_pax
ON CONFLICT (space_id, product_id, event_type) DO UPDATE SET
  avg_qty_per_event   = EXCLUDED.avg_qty_per_event,
  avg_qty_per_100_pax = EXCLUDED.avg_qty_per_100_pax,
  confidence_score    = EXCLUDED.confidence_score,
  nb_events_analyzed  = EXCLUDED.nb_events_analyzed,
  trend_direction     = EXCLUDED.trend_direction,
  last_updated        = now();

-- ╔═══ PHASE 5 — Vérification Salon Nord (À monter = Recommandé, espace = 0) ═╗
SELECT p.product_name,
       ca.avg_qty_per_event   AS ref_s1,
       ca.nb_events_analyzed  AS nb_ref,
       ca.trend_direction     AS tendance,
       CEIL(ca.avg_qty_per_event
            * CASE ca.trend_direction WHEN 'hausse' THEN 1.10 WHEN 'baisse' THEN 0.92 ELSE 1.00 END
       ) AS a_monter_temps_normal
  FROM consumption_analytics ca
  JOIN spaces s   ON s.space_id   = ca.space_id
  JOIN products p ON p.product_id = ca.product_id
 WHERE s.access_code = 'SN2026' AND ca.event_type = 'match' AND ca.avg_qty_per_event > 0
 ORDER BY ca.avg_qty_per_event DESC;
