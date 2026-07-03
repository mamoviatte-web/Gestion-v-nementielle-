-- ═══════════════════════════════════════════════════════════════════
-- Système Buvette 1 / Buvette 2 + tendances 5 matchs (MCP 2026-07-03).
--
-- NB schéma réel (≠ SQL du prompt) :
--   - Noms produits : « Cristaine 50cl » (un L), « Pepsi 50cl » (pas Pespi).
--   - event_consumptions.restock_qty (pas restock_quantity) ; consumed_qty ET
--     total_cost_ht sont GÉNÉRÉES (= initial+restock-final) → on pose final_stock.
--   - dates '2026-06-XX' invalides → dates réelles.
--   - RLS via is_stade().
-- ═══════════════════════════════════════════════════════════════════

-- ÉTAPE 1 : buvette_groups + buvette_group_members (RLS is_stade), 10 espaces
--   buvettes (BVO/BVSO/BVSE/BVTOI/BNO/BNE/BEG/BEP/BSE/BSO 2026), spaces.buvette_group_id,
--   vue responsable_buvette_spaces. Groupe 1 = Ouest/Sud-Ouest/Nord-Ouest/Nord-Est/Toinou ;
--   Groupe 2 = Sud-Est/Est Galice/Est Pagnol/Sud-Est/Sud-Ouest.

-- ÉTAPE 3 : runner_templates « Match — Buvette Standard » (12 buvettes) +
--   « Match — Buvette Premium » (Virage Ouest). Quantités = moyennes 5 matchs.

-- ÉTAPE 4 : 5 matchs historiques + import event_consumptions (Virage Ouest,
--   9 produits × 5 matchs = 45 lignes). refresh_all_analytics() exécuté.
--   Résultat consumption_analytics (Virage Ouest, event_type match) :
--     Cristaline 50cl avg 27.6 (+52 %), Pepsi 50cl avg 20.4 (+129 %),
--     Fût BUD avg 4.6 (+89 %)… nb_events_analyzed=5, confidence_score=0.700,
--     trend_direction=forte_hausse.

-- ÉTAPE 7 (front) : BUVETTE_REFERENCE_RATIOS, getBuvetteWeatherCoeff,
--   BUVETTE_TREND_COEFF (1.15) dans src/lib/runnerCalculations.ts.

-- ÉTAPE 8 : buvettes exclues des non-matchs (useEventCreation filtre space_type='Buvette').
