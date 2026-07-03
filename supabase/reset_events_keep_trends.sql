-- ═══════════════════════════════════════════════════════════════════
-- Remise à zéro des événements en CONSERVANT les tendances apprises.
-- (MCP 2026-07-03) — après import des 5 matchs historiques.
--
-- Objectif : repartir d'une base d'événements vierge pour les prochains
-- matchs, tout en gardant le « cerveau » analytique (consumption_analytics +
-- staff_analytics) qui alimente la génération des fiches runner.
--
-- Pourquoi c'est sûr (vérifié) :
--   • consumption_analytics.last_event_id  → ON DELETE SET NULL
--   • staff_analytics.last_event_id        → ON DELETE SET NULL
--     ⇒ les 345 tendances + 16 ratios RH SURVIVENT (seul le pointeur est nulé).
--   • Tout le transactionnel (event_consumptions, event_stock_lines,
--     stock_movements, runner_*, schedules, débriefs, provider_presence,
--     event_spaces, staff_event_summary, event_attachments…) est ON DELETE
--     CASCADE ⇒ nettoyé automatiquement.
--   • Aucun trigger sur DELETE (les triggers events sont BEFORE INSERT /
--     AFTER UPDATE) ⇒ pas de recalcul destructif.
--   • refresh_all_analytics() n'itère que sur les combos ayant des
--     event_consumptions liés à un événement clôturé ⇒ avec event_consumptions
--     vide, c'est un NO-OP : impossible d'effacer les tendances par mégarde.
--   • compute_consumption_analytics fait un UPSERT par (space,product,type) —
--     jamais de DELETE sur consumption_analytics.
--
-- keg_inventory.event_id est ON DELETE NO ACTION ⇒ on détache d'abord les fûts
-- physiques (on préserve les quantités pleins/vides).

UPDATE keg_inventory SET event_id = NULL, space_id = NULL WHERE event_id IS NOT NULL;
DELETE FROM events;

-- État après : events=0 ; consumption_analytics=345 (préservées) ;
-- staff_analytics=16 ; stock/kegs/référentiels intacts.
--
-- ⚠ Comportement d'apprentissage : les tendances sont désormais GELÉES.
-- La génération runner des prochains matchs les utilise telles quelles. À la
-- clôture d'un nouveau match, seuls les combos (espace×produit×type) de ce match
-- sont recalculés à partir des NOUVELLES données réelles (warm-start). Pour
-- conserver indéfiniment la profondeur des 5 matchs comme socle permanent, il
-- faudrait découpler les données d'entraînement des événements (évolution future).
