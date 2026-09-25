-- =====================================================================
-- RH — correction d'attribution : code d'accès « 8F7D1A » → Valentin CONSTANT
-- ---------------------------------------------------------------------
-- Sur le séminaire AMP (24/09), le responsable d'espace (Salon Nord) avait été
-- enregistré sous le CODE d'accès « 8F7D1A » au lieu de son nom → il ressortait
-- comme une personne distincte dans la synthèse de paie (10,5 h · 189 €).
-- On corrige la ligne de planning : ses heures se fondent alors dans Valentin
-- CONSTANT (rh_monthly_hours : 47,5 h → 58 h · 475 € → 664 €) et le créneau
-- apparaît dans le détail « presta » de l'export Excel (rh_person_event_shift).
--
-- On RENOMME la ligne précise (et non un alias du code) : un code d'accès est
-- réutilisé d'un événement à l'autre par des personnes différentes, donc il ne
-- doit jamais être aliasé globalement vers une personne. Idempotent.
-- =====================================================================

update public.schedules
set staff_name = 'Valentin CONSTANT'
where schedule_id = '6117c897-b987-4b10-ae3c-0539fd7acb78'
  and staff_name = '8F7D1A';
