-- =====================================================================
-- BARS DE SERVICE — CHOISISSABLES PAR UN RESPONSABLE (durable)
-- ---------------------------------------------------------------------
-- Suite au correctif PMR : le MÊME blocage touchait tous les bars de service.
-- validate_match_code (choix « Mon espace ») exclut les espaces
-- is_operational=true ; or les bars de service (Bistrot, Le Pub, Comptoir,
-- Club 70 Nord/Sud, Wine bar Nord/Sud, Grandes Tablées, Tente Est, Garden
-- Party) portaient ce drapeau alors qu'ils ont un assortiment et/ou des
-- dotations runner → leurs responsables ne pouvaient pas se connecter.
--
-- Correctif durable : ces bars deviennent des espaces de service
-- (is_operational=false) → choisissables dans « Mon espace » sur TOUS les
-- matchs. Le seul espace réellement technique (« Purge tireuses », sans
-- assortiment ni dotation) reste is_operational=true, donc exclu du choix.
-- Aucune incidence sur le flux stock/runner (is_operational n'est lu que par
-- validate_match_code, get_event_spaces_pax, link_event_spaces_by_type,
-- run_business_audit). Idempotent.
-- =====================================================================

update spaces
   set is_operational = false
 where active
   and service_type = 'bar'
   and coalesce(is_operational, false) = true
   and space_name <> 'Purge tireuses';
