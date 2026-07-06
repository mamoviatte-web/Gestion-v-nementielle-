-- ═══════════════════════════════════════════════════════════════════
-- RESET COMPLET DES STOCKS À 0 — base stricte avant inventaire physique
-- ───────────────────────────────────────────────────────────────────
-- Cible : dépôts (stock_balances), stocks par espace (area_stocks),
-- lignes d'événements NON clôturés (event_stock_lines), fûts pleins
-- (keg_inventory), stock initial des plannings runner (runner_auto_planning),
-- et suppression des livraisons + mouvements de démonstration.
--
-- ⚠ Corrections vs le SQL du prompt (schéma RÉEL du projet) :
--   • stock_balances.current_quantity   (PAS current_qty)
--   • stock_movements : PAS de colonne `comment` ni `responsible_name`.
--     Colonnes réelles : responsable_nom, movement_type, event_id (nullable),
--     from_location_id, to_location_id, created_at.
--   • area_stocks(current_qty, initial_qty, last_updated, updated_by) : OK.
--   • runner_auto_planning.initial_area_stock : OK.
--   • event_stock_lines(initial_qty, reassort_qty) + events.status
--     ∈ ('brouillon','préparé','en_cours','clôture_en_attente','clôturé','archivé') : OK.
--   • keg_inventory.status ∈ ('plein','en_espace','vide','retourné') : OK.
--
-- Idempotent. À exécuter dans le SQL Editor Supabase (rôle service) ou via MCP.
-- Un bloc final RAISE NOTICE affiche le nombre de lignes touchées par table.
-- ═══════════════════════════════════════════════════════════════════

DO $$
DECLARE
  n_balances   INT;
  n_area       INT;
  n_esl        INT;
  n_kegs       INT;
  n_runner     INT;
  n_deliv      INT;
  n_deliv_ln   INT;
  n_moves      INT;
BEGIN
  -- ─── 1. STOCK_BALANCES : dépôts + espaces à 0 ─────────────────────
  UPDATE stock_balances
     SET current_quantity  = 0,
         reusable_quantity = 0,
         opened_quantity   = 0,
         unit_value_ht     = NULL,
         last_movement_at  = now(),
         updated_by        = 'RESET_INVENTAIRE_INITIAL'
   WHERE current_quantity  <> 0
      OR reusable_quantity <> 0
      OR opened_quantity   <> 0;
  GET DIAGNOSTICS n_balances = ROW_COUNT;

  -- ─── 2. AREA_STOCKS : stock par espace à 0 ───────────────────────
  UPDATE area_stocks
     SET current_qty  = 0,
         initial_qty  = 0,
         last_updated = now(),
         updated_by   = 'RESET_INVENTAIRE_INITIAL'
   WHERE current_qty <> 0 OR initial_qty <> 0;
  GET DIAGNOSTICS n_area = ROW_COUNT;

  -- ─── 3. EVENT_STOCK_LINES : événements NON clôturés → initial/reassort 0
  UPDATE event_stock_lines esl
     SET initial_qty  = 0,
         reassort_qty = 0
    FROM events e
   WHERE e.event_id = esl.event_id
     AND e.status NOT IN ('clôturé', 'archivé')
     AND (esl.initial_qty > 0 OR esl.reassort_qty > 0);
  GET DIAGNOSTICS n_esl = ROW_COUNT;

  -- ─── 4. KEG_INVENTORY : fûts pleins → retournés ──────────────────
  UPDATE keg_inventory
     SET status = 'retourné',
         returned_to_supplier_at = COALESCE(returned_to_supplier_at, now())
   WHERE status = 'plein';
  GET DIAGNOSTICS n_kegs = ROW_COUNT;

  -- ─── 5. RUNNER_AUTO_PLANNING : stock initial espace → 0 ──────────
  UPDATE runner_auto_planning
     SET initial_area_stock = 0
   WHERE initial_area_stock <> 0;
  GET DIAGNOSTICS n_runner = ROW_COUNT;

  -- ─── 6. Suppression des livraisons + mouvements de démo ──────────
  DELETE FROM supplier_delivery_lines
   WHERE delivery_id IN (
     SELECT id FROM supplier_deliveries
      WHERE invoice_ref ILIKE 'BL-2026-000%'
         OR notes ILIKE '%démo%' OR notes ILIKE '%demo%' OR notes ILIKE '%test%'
   );
  GET DIAGNOSTICS n_deliv_ln = ROW_COUNT;

  DELETE FROM supplier_deliveries
   WHERE invoice_ref ILIKE 'BL-2026-000%'
      OR notes ILIKE '%démo%' OR notes ILIKE '%demo%' OR notes ILIKE '%test%';
  GET DIAGNOSTICS n_deliv = ROW_COUNT;

  -- Mouvements « entrée fournisseur » de démo au niveau dépôt (event_id NULL).
  -- Aucun inventaire réel n'ayant été saisi, ces entrées sont fictives ;
  -- on PRÉSERVE les mouvements rattachés à un événement.
  DELETE FROM stock_movements
   WHERE event_id IS NULL
     AND movement_type IN ('entrée_fournisseur', 'entrée')
     AND responsable_nom ILIKE ANY (ARRAY[
           '%Viatte%', '%Livraison%', '%TEST%', '%démo%', '%demo%',
           '%Castel%', '%Provençale%'])
     AND created_at > now() - INTERVAL '60 days';
  GET DIAGNOSTICS n_moves = ROW_COUNT;

  RAISE NOTICE '── RESET STOCKS — lignes touchées ──';
  RAISE NOTICE 'stock_balances mis à 0        : %', n_balances;
  RAISE NOTICE 'area_stocks mis à 0           : %', n_area;
  RAISE NOTICE 'event_stock_lines (en cours)  : %', n_esl;
  RAISE NOTICE 'keg_inventory pleins→retournés: %', n_kegs;
  RAISE NOTICE 'runner_auto_planning à 0      : %', n_runner;
  RAISE NOTICE 'supplier_delivery_lines suppr.: %', n_deliv_ln;
  RAISE NOTICE 'supplier_deliveries suppr.    : %', n_deliv;
  RAISE NOTICE 'stock_movements démo suppr.   : %', n_moves;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- VÉRIFICATION EXHAUSTIVE — attendu : 0 partout
-- ═══════════════════════════════════════════════════════════════════
SELECT 'stock_balances' AS table_name,
       COUNT(*) AS lignes_non_nulles
  FROM stock_balances
 WHERE current_quantity <> 0 OR reusable_quantity <> 0 OR opened_quantity <> 0
UNION ALL
SELECT 'area_stocks', COUNT(*)
  FROM area_stocks
 WHERE current_qty <> 0 OR initial_qty <> 0
UNION ALL
SELECT 'event_stock_lines (en cours)', COUNT(*)
  FROM event_stock_lines esl
  JOIN events e ON e.event_id = esl.event_id
 WHERE e.status NOT IN ('clôturé', 'archivé')
   AND (esl.initial_qty > 0 OR esl.reassort_qty > 0)
UNION ALL
SELECT 'keg_inventory (pleins)', COUNT(*)
  FROM keg_inventory WHERE status = 'plein'
UNION ALL
SELECT 'runner_auto_planning (stock initial)', COUNT(*)
  FROM runner_auto_planning WHERE initial_area_stock <> 0;

-- Résumé par dépôt (contrôle visuel : stock_total = 0 partout).
SELECT sl.name AS depot,
       COUNT(*) AS nb_references,
       SUM(sb.current_quantity) AS stock_total
  FROM stock_balances sb
  JOIN stock_locations sl ON sl.id = sb.location_id
 GROUP BY sl.name
 ORDER BY sl.name;
