-- ═══════════════════════════════════════════════════════════════════
-- Chaîne de production stocks : dépôt → espace → conso/retour (MCP 2026-07-03).
--
-- NB schéma réel (≠ SQL du prompt) :
--   - stock_balances.current_quantity (pas current_qty).
--   - stock_movements : responsable_nom (pas responsible_name), PAS de colonne comment.
--   - runner_auto_planning : validation_status, validated_quantity, quantity_to_move,
--     recommended_quantity, responsible_name, alert_type (pas alert_message).
--   - RLS via is_stade().
--
-- Anti-double-comptage : les flux client existants (applyRunnerTransfersToStock,
-- applyClosureToStock) sont idempotents (hasMovements). Les triggers ci-dessous
-- ajoutent la même garde → « premier écrivain gagne ». Le trigger keg dédié
-- (trg_auto_empty_keg) est SUPPRIMÉ, la clôture le gère désormais.
-- ═══════════════════════════════════════════════════════════════════

-- ÉTAPE 1 : product_depot_routing (produit → dépôt source) + refresh_product_depot_routing().
--   Fûts+CO2 → Stockage Fûts ; Vins/Spiritueux → Stock EST ; reste → AUC.

-- ÉTAPE 2 : on_runner_transmitted (BEFORE UPDATE runner_auto_planning)
--   validation_status → 'transmis_runners' : déduit le dépôt source (transfert_espace),
--   initialise event_stock_lines.initial_qty, alerte non bloquante si stock insuffisant.

-- ÉTAPE 3 : on_reassort_updated (BEFORE UPDATE event_stock_lines WHEN reassort change)
--   déduit du dépôt le delta de réassort (réassort_événement).

-- ÉTAPE 4 : on_stock_final_entered (AFTER UPDATE event_stock_lines WHEN final_qty null→set)
--   consommation = initial + réassort − final ;
--   fermé → retour_réutilisable au dépôt source ; ouvert → retour + opened_quantity ;
--   fût_vide/percuté → keg_inventory 'vide' ; cassé/perdu/périmé → perte_casse.

-- ÉTAPE 5 : vue stock_live_balance (temps réel) — qty_auc/est/futs, qty_total_depot,
--   qty_in_event (event_stock_lines des événements en_cours non clôturés),
--   valeur_depot_ht, alert_status (rupture/critique/ok), source_depot.

-- ÉTAPE 8 : reconcile_stock_balances() — recalcule les balances de réserve AYANT des
--   mouvements (entrée_fournisseur + retour_réutilisable − transfert_espace − réassort_événement).
--   Prudent : n'écrase pas les stocks initiaux sans mouvement journalisé.
--   → NON exécuté automatiquement sur les données de démo (préserve les soldes de seed).
