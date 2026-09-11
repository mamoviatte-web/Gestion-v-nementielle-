-- =====================================================================
-- PMR — ESPACE CHOISISSABLE PAR UN RESPONSABLE (choix d'espace match)
-- ---------------------------------------------------------------------
-- Sur le choix d'espace du responsable (code match unique → « Mon espace »,
-- via validate_match_code), la PMR n'apparaissait pas. Cause : la PMR portait
-- le drapeau spaces.is_operational = true (regroupée avec les bars/espaces
-- techniques), or validate_match_code exclut les espaces operational
-- (`AND NOT is_operational`). La PMR est pourtant un vrai point de service
-- tenu par un responsable (assortiment + dotations runner déjà en place).
--
-- Correctif : PMR = espace de service (is_operational=false) → elle apparaît
-- dans « Mon espace » et dans la population pax VIP & Bars. Aucune incidence
-- sur le flux stock/runner (is_operational n'est lu que par validate_match_code,
-- get_event_spaces_pax, link_event_spaces_by_type et run_business_audit).
-- Les espaces réellement techniques (Garden Party, Purge tireuses) restent
-- operational. Idempotent.
-- =====================================================================

update spaces
   set is_operational = false
 where space_name = 'PMR'
   and coalesce(is_operational, false) is distinct from false;
