-- ═══════════════════════════════════════════════════════════════════
-- Corrections dépôts (MCP 2026-07-03) : Stock EST complet + AUC softs par format,
-- + correctifs chaîne (sync fûts keg_inventory ↔ stock_balances, dispatch view).
--
-- ⚠ Piège corrigé : `name ILIKE '%EST%'` matche aussi « Loge Est — Espace ».
--   → cibler le vrai dépôt : name = 'Stock EST — Cave vins & spiritueux'
--     (ou 'AUC%' pour l'AUC). Le LIMIT 1 du prompt polluait Loge Est.
-- ⚠ `current_quantity` (pas current_qty) ; products n'a pas d'unique(product_name).
--   Les 14 vins + 6 spiritueux et les 12 softs existaient déjà (import catalogue).
-- ═══════════════════════════════════════════════════════════════════

-- Points 1 & 2 (chaîne) — voir migrations chain_keg_sync_and_dispatch_location :
--   reduce_keg_plein(), espace_location_of(), on_runner_transmitted (fût plein→en_espace,
--   to_location_id renseigné), on_reassort_updated (idem), on_stock_final_entered
--   (fûts : en_espace → vide (consommés + finaux vidés) / plein (retour fermé)).
--   → keg_summary reste cohérent avec stock_balances ; depot_dispatch_view voit les
--     dispatchs runner.

-- Correction 1 — Stock EST : prix Rosé Miraval
UPDATE products SET unit_price_ht=12.50 WHERE product_name='Rosé Miraval';
-- (14 vins + 6 spiritueux déjà en EST → 20 références.)

-- Correction 2 — AUC softs par format
UPDATE products SET product_name='Pepsi bouteille 1L+' WHERE product_name='Pepsi bouteille' AND unit='btl';
UPDATE products SET unit_price_ht=4.80 WHERE product_name='Sirop de citron';
UPDATE products SET unit_price_ht=5.50 WHERE product_name='Sirop de menthe';
UPDATE products SET packaging_qty=24, packaging_unit='pack'   WHERE product_name IN ('Pepsi 50cl','Orangina 50cl','Ice Tea 50cl');
UPDATE products SET packaging_qty=24, packaging_unit='carton' WHERE product_name='San Pellegrino 50cl';
UPDATE products SET packaging_qty=12, packaging_unit='carton' WHERE product_name IN ('Pepsi Max bouteille','Perrier grande bouteille');

-- Balances AUC softs/sirops/bières bouteilles + EST vins/spiritueux (idempotent, ON CONFLICT DO NOTHING).
-- refresh_product_depot_routing() ré-exécuté.

-- Vue auc_stock_view : format_group (50cl / grande bouteille / verre / sirops / bières)
--   + espaces_cibles. security_invoker.

-- runner_templates : « Match standard — Buvette » (softs 50cl → BV1/BV2/Terrasses),
--   « Match standard — VIP » (grandes bouteilles + verres → salons/loges). NOT EXISTS.

-- Front : DepotStockView groupe le stock par format (helper formatGroup/espacesCibles),
--   affiche tout l'assortiment (y compris qté 0) avec sous-totaux par groupe.
