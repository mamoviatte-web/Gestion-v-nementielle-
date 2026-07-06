-- ═══════════════════════════════════════════════════════════════════
-- REMISE À ZÉRO DE TOUS LES STOCKS — Base à 0 avant inventaire physique
-- ───────────────────────────────────────────────────────────────────
-- Contexte : les événements démarrent, l'inventaire physique n'a pas
-- encore été saisi. Règle : tous les stocks = 0 jusqu'à réception de
-- l'inventaire réel. Les événements clôturés peuvent afficher des
-- consommations « négatives » (consommé sans stock initial) — normal.
--
-- ⚠ Corrections vs le SQL du prompt (schéma RÉEL du projet) :
--   • stock_balances.current_quantity  (PAS current_qty)
--   • stock_movements : PAS de colonne `comment` ni `responsible_name`.
--     Colonnes réelles : responsable_nom, movement_type, event_id (nullable),
--     from_location_id, to_location_id, created_at.
--   • current_quantity est DECIMAL(10,2) SANS contrainte CHECK (>= 0) :
--     les négatifs sont déjà autorisés → l'ÉTAPE 3 est un no-op de sécurité.
--   • keg_inventory.status ∈ ('plein','en_espace','vide','retourné').
--   • supplier_deliveries(id, invoice_ref, notes) /
--     supplier_delivery_lines(id, delivery_id) : colonnes conformes.
--
-- Idempotent. À exécuter dans le SQL Editor Supabase (rôle service) ou via MCP.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─── ÉTAPE 1 — Remettre TOUS les stock_balances à 0 ─────────────────
UPDATE stock_balances
   SET current_quantity  = 0,
       reusable_quantity = 0,
       opened_quantity   = 0,
       last_movement_at  = now()
 WHERE current_quantity  <> 0
    OR reusable_quantity <> 0
    OR opened_quantity   <> 0;

-- ─── ÉTAPE 2 — Remettre les fûts pleins à 0 (statut 'retourné') ─────
-- NB : on ne touche pas aux fûts 'en_espace' (rattachés à un événement en
-- cours) ; ils seront réconciliés à la clôture. Vides/retournés inchangés.
UPDATE keg_inventory
   SET status = 'retourné',
       returned_to_supplier_at = COALESCE(returned_to_supplier_at, now())
 WHERE status = 'plein';

-- ─── ÉTAPE 3 — Autoriser les stocks négatifs (no-op de sécurité) ────
-- current_quantity est DECIMAL sans CHECK (>= 0) : rien à supprimer.
-- Le bloc reste défensif au cas où une contrainte aurait été ajoutée.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.check_constraints cc
        ON cc.constraint_name = tc.constraint_name
       AND cc.constraint_schema = tc.constraint_schema
     WHERE tc.table_name = 'stock_balances'
       AND tc.constraint_type = 'CHECK'
       AND cc.check_clause ILIKE '%current_quantity%'
       AND cc.check_clause ILIKE '%>= 0%'
  LOOP
    EXECUTE format('ALTER TABLE stock_balances DROP CONSTRAINT %I', c.constraint_name);
    RAISE NOTICE 'Contrainte supprimée : %', c.constraint_name;
  END LOOP;
END $$;

-- ─── ÉTAPE 4 — Nettoyer les livraisons + mouvements de démo ─────────
-- 4a. Lignes des livraisons de démo (CASCADE gère aussi la suppression,
--     on l'explicite pour la clarté).
DELETE FROM supplier_delivery_lines
 WHERE delivery_id IN (
   SELECT id FROM supplier_deliveries
    WHERE invoice_ref ILIKE 'BL-2026-000%'
       OR notes ILIKE '%démo%'
       OR notes ILIKE '%demo%'
       OR notes ILIKE '%test%'
 );

-- 4b. Livraisons de démo elles-mêmes.
DELETE FROM supplier_deliveries
 WHERE invoice_ref ILIKE 'BL-2026-000%'
    OR notes ILIKE '%démo%'
    OR notes ILIKE '%demo%'
    OR notes ILIKE '%test%';

-- 4c. Mouvements « entrée fournisseur » de démo au niveau dépôt
--     (event_id NULL = mouvement dépôt, pas rattaché à un événement).
--     Aucun inventaire réel n'ayant encore été saisi, ces entrées sont
--     toutes fictives. On PRÉSERVE les mouvements liés à un événement.
DELETE FROM stock_movements
 WHERE event_id IS NULL
   AND movement_type IN ('entrée_fournisseur','entrée')
   AND responsable_nom ILIKE ANY (ARRAY['%Viatte%','%Livraison%','%démo%','%demo%','%test%','%Castel%','%Provençale%']);

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- VÉRIFICATIONS (SELECT — à lancer après le COMMIT)
-- ═══════════════════════════════════════════════════════════════════

-- V1 — Résumé par dépôt : total_qty attendu = 0 partout.
SELECT sl.name AS depot,
       COUNT(*) AS nb_references,
       SUM(sb.current_quantity) AS stock_total,
       MIN(sb.current_quantity) AS min_qty,
       MAX(sb.current_quantity) AS max_qty
  FROM stock_balances sb
  JOIN stock_locations sl ON sl.id = sb.location_id
 GROUP BY sl.name
 ORDER BY sl.name;

-- V2 — Anomalies : lignes de stock non nulles (attendu : 0 ligne).
SELECT sl.name AS depot, p.category, p.product_name, sb.current_quantity
  FROM stock_balances sb
  JOIN stock_locations sl ON sl.id = sb.location_id
  JOIN products p ON p.product_id = sb.product_id
 WHERE sb.current_quantity <> 0
 ORDER BY sl.name, p.category, p.product_name;

-- V3 — Fûts : plus aucun 'plein'.
SELECT status, COUNT(*) FROM keg_inventory GROUP BY status ORDER BY status;

-- V4 — Contraintes CHECK bloquantes restantes (attendu : 0 ligne).
SELECT tc.constraint_name, cc.check_clause
  FROM information_schema.table_constraints tc
  JOIN information_schema.check_constraints cc
    ON cc.constraint_name = tc.constraint_name
 WHERE tc.table_name = 'stock_balances'
   AND cc.check_clause ILIKE '%current_quantity%'
   AND cc.check_clause ILIKE '%>= 0%';

-- V5 — Restes de démo.
SELECT COUNT(*) AS mouvements_restants FROM stock_movements;
SELECT COUNT(*) AS livraisons_restantes FROM supplier_deliveries;
