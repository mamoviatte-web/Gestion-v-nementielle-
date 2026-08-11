-- RG-003 : event_runner_board / event_runner_space_summary exposent cost_ht mais
-- étaient sélectionnables par anon → retiré (aucun écran anon ne les consomme ;
-- la vue publique du runner terrain est runner_terrain_public, sans coûts).
-- reset_event (destructif) : retrait d'anon en défense en profondeur (garde
-- is_stade() déjà en place).
REVOKE SELECT ON event_runner_board FROM anon;
REVOKE SELECT ON event_runner_space_summary FROM anon;
REVOKE EXECUTE ON FUNCTION reset_event(uuid, text, text, boolean) FROM anon, public;
