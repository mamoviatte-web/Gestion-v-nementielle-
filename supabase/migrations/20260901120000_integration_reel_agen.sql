-- Intégration de la réalité de consommation du match Agen (buvettes + Tente Est)
-- ===========================================================================
-- Source : fichier régie « Provence Rugby vs Agen » (relevé physique par buvette).
-- Aligne initial / réassort / restant des 11 buvettes + crée la Tente Est,
-- recalcule conso & coût (trigger), trace chaque écart (mouvement 'inventaire',
-- RG-002) et réajuste le dépôt sur les espaces non conservés. Idempotent.
-- Événement clôturé : bypass tracé via app.allow_adjustment (ajustement d'inventaire).

do $$
declare v_agen uuid := '5b999a21-25e6-4fb3-babc-d89cf69e2e27'; v_resp text := 'Intégration Excel « réalité match » Agen — régie';
begin
  if exists (select 1 from stock_movements where event_id=v_agen and movement_type='inventaire' and responsable_nom=v_resp) then
    raise notice 'Intégration réelle Agen déjà appliquée — aucune action.'; return;
  end if;
  perform set_config('app.allow_adjustment','on', true);
  alter table event_stock_lines disable trigger trg_initial_entered;
  alter table event_stock_lines disable trigger trg_reassort_updated;
  alter table event_stock_lines disable trigger trg_stock_final_entered;
  alter table event_stock_lines disable trigger trg_guard_close_requires_opening;

  insert into event_spaces(event_id, space_id) values (v_agen,'5da7f2ae-7d2d-461f-8819-8ccf7859504c'::uuid) on conflict do nothing;

  -- cible (relevé réel)
  create temp table _tgt(space_id uuid, product_id uuid, i int, r int, f int) on commit drop;
  insert into _tgt(space_id,product_id,i,r,f) values
    ('84793dcb-ca05-4c10-9b60-4e4b05ff5402'::uuid,'5459c24f-0993-4538-8a85-7c0bfa174d17'::uuid,6,0,2),
    ('84793dcb-ca05-4c10-9b60-4e4b05ff5402'::uuid,'1b99d9a0-4294-4cc9-baa8-7b57b13d3f28'::uuid,3,0,2),
    ('84793dcb-ca05-4c10-9b60-4e4b05ff5402'::uuid,'3b9cba0f-5984-40b2-a009-79ba922d1281'::uuid,3,0,2),
    ('84793dcb-ca05-4c10-9b60-4e4b05ff5402'::uuid,'599baa88-87d2-4a86-a6fd-e212c387b2ad'::uuid,3,0,1),
    ('84793dcb-ca05-4c10-9b60-4e4b05ff5402'::uuid,'0583ad72-5c12-4203-a186-0f4310aad9f8'::uuid,0,0,0),
    ('84793dcb-ca05-4c10-9b60-4e4b05ff5402'::uuid,'12b21f99-f7f7-4004-bfcb-7025e145c2d8'::uuid,40,0,17),
    ('84793dcb-ca05-4c10-9b60-4e4b05ff5402'::uuid,'7d193944-c98c-48d6-860b-20bbc5fff904'::uuid,15,0,4),
    ('84793dcb-ca05-4c10-9b60-4e4b05ff5402'::uuid,'f9eee516-c6ce-4571-b8d7-a8251a8cb498'::uuid,25,0,1),
    ('84793dcb-ca05-4c10-9b60-4e4b05ff5402'::uuid,'271f1cdb-49c6-4bd0-a029-d5f839bfc84a'::uuid,50,24,25),
    ('84793dcb-ca05-4c10-9b60-4e4b05ff5402'::uuid,'4de1db33-75ff-46ae-b797-332ab925ebce'::uuid,21,0,0),
    ('84793dcb-ca05-4c10-9b60-4e4b05ff5402'::uuid,'c430ebe8-e635-48e3-b41f-aa1b30303d61'::uuid,1,0,0),
    ('84793dcb-ca05-4c10-9b60-4e4b05ff5402'::uuid,'c00a79f4-f560-4e54-bcae-da4444a8c438'::uuid,0,0,0),
    ('84793dcb-ca05-4c10-9b60-4e4b05ff5402'::uuid,'dec7af25-40d4-4a4d-b7d3-deed6d6b108c'::uuid,1,0,0),
    ('84793dcb-ca05-4c10-9b60-4e4b05ff5402'::uuid,'69217d5b-a1c1-4764-ad95-5417f29ad52d'::uuid,8,0,0),
    ('1d35419e-a798-4060-85f7-1c7daa450da2'::uuid,'5459c24f-0993-4538-8a85-7c0bfa174d17'::uuid,10,0,2),
    ('1d35419e-a798-4060-85f7-1c7daa450da2'::uuid,'1b99d9a0-4294-4cc9-baa8-7b57b13d3f28'::uuid,4,0,2),
    ('1d35419e-a798-4060-85f7-1c7daa450da2'::uuid,'3b9cba0f-5984-40b2-a009-79ba922d1281'::uuid,5,0,1),
    ('1d35419e-a798-4060-85f7-1c7daa450da2'::uuid,'599baa88-87d2-4a86-a6fd-e212c387b2ad'::uuid,6,0,1),
    ('1d35419e-a798-4060-85f7-1c7daa450da2'::uuid,'0583ad72-5c12-4203-a186-0f4310aad9f8'::uuid,0,0,0),
    ('1d35419e-a798-4060-85f7-1c7daa450da2'::uuid,'12b21f99-f7f7-4004-bfcb-7025e145c2d8'::uuid,50,0,0),
    ('1d35419e-a798-4060-85f7-1c7daa450da2'::uuid,'7d193944-c98c-48d6-860b-20bbc5fff904'::uuid,24,0,0),
    ('1d35419e-a798-4060-85f7-1c7daa450da2'::uuid,'f9eee516-c6ce-4571-b8d7-a8251a8cb498'::uuid,37,11,0),
    ('1d35419e-a798-4060-85f7-1c7daa450da2'::uuid,'271f1cdb-49c6-4bd0-a029-d5f839bfc84a'::uuid,78,48,0),
    ('1d35419e-a798-4060-85f7-1c7daa450da2'::uuid,'4de1db33-75ff-46ae-b797-332ab925ebce'::uuid,42,0,0),
    ('1d35419e-a798-4060-85f7-1c7daa450da2'::uuid,'c430ebe8-e635-48e3-b41f-aa1b30303d61'::uuid,2,0,0),
    ('1d35419e-a798-4060-85f7-1c7daa450da2'::uuid,'c00a79f4-f560-4e54-bcae-da4444a8c438'::uuid,0,0,0),
    ('1d35419e-a798-4060-85f7-1c7daa450da2'::uuid,'dec7af25-40d4-4a4d-b7d3-deed6d6b108c'::uuid,2,0,1),
    ('1d35419e-a798-4060-85f7-1c7daa450da2'::uuid,'69217d5b-a1c1-4764-ad95-5417f29ad52d'::uuid,0,0,0),
    ('4796e971-8a0a-4837-96ee-3f94f794bcc4'::uuid,'5459c24f-0993-4538-8a85-7c0bfa174d17'::uuid,6,0,3),
    ('4796e971-8a0a-4837-96ee-3f94f794bcc4'::uuid,'1b99d9a0-4294-4cc9-baa8-7b57b13d3f28'::uuid,4,0,2),
    ('4796e971-8a0a-4837-96ee-3f94f794bcc4'::uuid,'3b9cba0f-5984-40b2-a009-79ba922d1281'::uuid,4,0,2),
    ('4796e971-8a0a-4837-96ee-3f94f794bcc4'::uuid,'599baa88-87d2-4a86-a6fd-e212c387b2ad'::uuid,5,0,2),
    ('4796e971-8a0a-4837-96ee-3f94f794bcc4'::uuid,'0583ad72-5c12-4203-a186-0f4310aad9f8'::uuid,3,0,0),
    ('4796e971-8a0a-4837-96ee-3f94f794bcc4'::uuid,'12b21f99-f7f7-4004-bfcb-7025e145c2d8'::uuid,51,0,9),
    ('4796e971-8a0a-4837-96ee-3f94f794bcc4'::uuid,'7d193944-c98c-48d6-860b-20bbc5fff904'::uuid,19,0,0),
    ('4796e971-8a0a-4837-96ee-3f94f794bcc4'::uuid,'f9eee516-c6ce-4571-b8d7-a8251a8cb498'::uuid,53,0,16),
    ('4796e971-8a0a-4837-96ee-3f94f794bcc4'::uuid,'271f1cdb-49c6-4bd0-a029-d5f839bfc84a'::uuid,96,0,0),
    ('4796e971-8a0a-4837-96ee-3f94f794bcc4'::uuid,'4de1db33-75ff-46ae-b797-332ab925ebce'::uuid,23,0,0),
    ('4796e971-8a0a-4837-96ee-3f94f794bcc4'::uuid,'c430ebe8-e635-48e3-b41f-aa1b30303d61'::uuid,2,0,1),
    ('4796e971-8a0a-4837-96ee-3f94f794bcc4'::uuid,'c00a79f4-f560-4e54-bcae-da4444a8c438'::uuid,2,0,2),
    ('4796e971-8a0a-4837-96ee-3f94f794bcc4'::uuid,'dec7af25-40d4-4a4d-b7d3-deed6d6b108c'::uuid,6,0,5),
    ('4796e971-8a0a-4837-96ee-3f94f794bcc4'::uuid,'69217d5b-a1c1-4764-ad95-5417f29ad52d'::uuid,6,0,5),
    ('0c2dcd24-a5ca-4629-aa67-8177be695ff7'::uuid,'5459c24f-0993-4538-8a85-7c0bfa174d17'::uuid,5,0,1),
    ('0c2dcd24-a5ca-4629-aa67-8177be695ff7'::uuid,'1b99d9a0-4294-4cc9-baa8-7b57b13d3f28'::uuid,3,0,1),
    ('0c2dcd24-a5ca-4629-aa67-8177be695ff7'::uuid,'3b9cba0f-5984-40b2-a009-79ba922d1281'::uuid,4,0,1),
    ('0c2dcd24-a5ca-4629-aa67-8177be695ff7'::uuid,'599baa88-87d2-4a86-a6fd-e212c387b2ad'::uuid,5,0,2),
    ('0c2dcd24-a5ca-4629-aa67-8177be695ff7'::uuid,'0583ad72-5c12-4203-a186-0f4310aad9f8'::uuid,3,0,2),
    ('0c2dcd24-a5ca-4629-aa67-8177be695ff7'::uuid,'12b21f99-f7f7-4004-bfcb-7025e145c2d8'::uuid,27,0,0),
    ('0c2dcd24-a5ca-4629-aa67-8177be695ff7'::uuid,'7d193944-c98c-48d6-860b-20bbc5fff904'::uuid,31,0,20),
    ('0c2dcd24-a5ca-4629-aa67-8177be695ff7'::uuid,'f9eee516-c6ce-4571-b8d7-a8251a8cb498'::uuid,24,0,1),
    ('0c2dcd24-a5ca-4629-aa67-8177be695ff7'::uuid,'271f1cdb-49c6-4bd0-a029-d5f839bfc84a'::uuid,97,0,12),
    ('0c2dcd24-a5ca-4629-aa67-8177be695ff7'::uuid,'4de1db33-75ff-46ae-b797-332ab925ebce'::uuid,30,0,0),
    ('0c2dcd24-a5ca-4629-aa67-8177be695ff7'::uuid,'c430ebe8-e635-48e3-b41f-aa1b30303d61'::uuid,5,0,4),
    ('0c2dcd24-a5ca-4629-aa67-8177be695ff7'::uuid,'c00a79f4-f560-4e54-bcae-da4444a8c438'::uuid,0,0,0),
    ('0c2dcd24-a5ca-4629-aa67-8177be695ff7'::uuid,'dec7af25-40d4-4a4d-b7d3-deed6d6b108c'::uuid,2,0,1),
    ('0c2dcd24-a5ca-4629-aa67-8177be695ff7'::uuid,'69217d5b-a1c1-4764-ad95-5417f29ad52d'::uuid,0,0,0),
    ('9dc75c34-4cde-4f39-ac98-feea0fb75a6f'::uuid,'5459c24f-0993-4538-8a85-7c0bfa174d17'::uuid,6,0,1),
    ('9dc75c34-4cde-4f39-ac98-feea0fb75a6f'::uuid,'1b99d9a0-4294-4cc9-baa8-7b57b13d3f28'::uuid,2,0,0),
    ('9dc75c34-4cde-4f39-ac98-feea0fb75a6f'::uuid,'3b9cba0f-5984-40b2-a009-79ba922d1281'::uuid,6,0,3),
    ('9dc75c34-4cde-4f39-ac98-feea0fb75a6f'::uuid,'599baa88-87d2-4a86-a6fd-e212c387b2ad'::uuid,3,0,0),
    ('9dc75c34-4cde-4f39-ac98-feea0fb75a6f'::uuid,'0583ad72-5c12-4203-a186-0f4310aad9f8'::uuid,1,0,0),
    ('9dc75c34-4cde-4f39-ac98-feea0fb75a6f'::uuid,'12b21f99-f7f7-4004-bfcb-7025e145c2d8'::uuid,49,0,12),
    ('9dc75c34-4cde-4f39-ac98-feea0fb75a6f'::uuid,'7d193944-c98c-48d6-860b-20bbc5fff904'::uuid,33,0,14),
    ('9dc75c34-4cde-4f39-ac98-feea0fb75a6f'::uuid,'f9eee516-c6ce-4571-b8d7-a8251a8cb498'::uuid,55,0,12),
    ('9dc75c34-4cde-4f39-ac98-feea0fb75a6f'::uuid,'271f1cdb-49c6-4bd0-a029-d5f839bfc84a'::uuid,34,0,3),
    ('9dc75c34-4cde-4f39-ac98-feea0fb75a6f'::uuid,'4de1db33-75ff-46ae-b797-332ab925ebce'::uuid,43,0,1),
    ('9dc75c34-4cde-4f39-ac98-feea0fb75a6f'::uuid,'c430ebe8-e635-48e3-b41f-aa1b30303d61'::uuid,5,0,4),
    ('9dc75c34-4cde-4f39-ac98-feea0fb75a6f'::uuid,'c00a79f4-f560-4e54-bcae-da4444a8c438'::uuid,0,0,0),
    ('9dc75c34-4cde-4f39-ac98-feea0fb75a6f'::uuid,'dec7af25-40d4-4a4d-b7d3-deed6d6b108c'::uuid,4,0,3),
    ('9dc75c34-4cde-4f39-ac98-feea0fb75a6f'::uuid,'69217d5b-a1c1-4764-ad95-5417f29ad52d'::uuid,0,0,0),
    ('431db55f-ea08-435d-9646-754197a123b7'::uuid,'5459c24f-0993-4538-8a85-7c0bfa174d17'::uuid,5,0,0),
    ('431db55f-ea08-435d-9646-754197a123b7'::uuid,'1b99d9a0-4294-4cc9-baa8-7b57b13d3f28'::uuid,3,0,1),
    ('431db55f-ea08-435d-9646-754197a123b7'::uuid,'3b9cba0f-5984-40b2-a009-79ba922d1281'::uuid,3,0,0),
    ('431db55f-ea08-435d-9646-754197a123b7'::uuid,'599baa88-87d2-4a86-a6fd-e212c387b2ad'::uuid,5,0,2),
    ('431db55f-ea08-435d-9646-754197a123b7'::uuid,'0583ad72-5c12-4203-a186-0f4310aad9f8'::uuid,0,0,0),
    ('431db55f-ea08-435d-9646-754197a123b7'::uuid,'12b21f99-f7f7-4004-bfcb-7025e145c2d8'::uuid,48,0,11),
    ('431db55f-ea08-435d-9646-754197a123b7'::uuid,'7d193944-c98c-48d6-860b-20bbc5fff904'::uuid,32,0,7),
    ('431db55f-ea08-435d-9646-754197a123b7'::uuid,'f9eee516-c6ce-4571-b8d7-a8251a8cb498'::uuid,40,0,5),
    ('431db55f-ea08-435d-9646-754197a123b7'::uuid,'271f1cdb-49c6-4bd0-a029-d5f839bfc84a'::uuid,89,0,3),
    ('431db55f-ea08-435d-9646-754197a123b7'::uuid,'4de1db33-75ff-46ae-b797-332ab925ebce'::uuid,24,0,0),
    ('431db55f-ea08-435d-9646-754197a123b7'::uuid,'c430ebe8-e635-48e3-b41f-aa1b30303d61'::uuid,2,0,1),
    ('431db55f-ea08-435d-9646-754197a123b7'::uuid,'c00a79f4-f560-4e54-bcae-da4444a8c438'::uuid,0,0,0),
    ('431db55f-ea08-435d-9646-754197a123b7'::uuid,'dec7af25-40d4-4a4d-b7d3-deed6d6b108c'::uuid,1,0,0),
    ('431db55f-ea08-435d-9646-754197a123b7'::uuid,'69217d5b-a1c1-4764-ad95-5417f29ad52d'::uuid,0,0,0),
    ('5da7f2ae-7d2d-461f-8819-8ccf7859504c'::uuid,'5459c24f-0993-4538-8a85-7c0bfa174d17'::uuid,4,0,2),
    ('5da7f2ae-7d2d-461f-8819-8ccf7859504c'::uuid,'1b99d9a0-4294-4cc9-baa8-7b57b13d3f28'::uuid,2,0,1),
    ('5da7f2ae-7d2d-461f-8819-8ccf7859504c'::uuid,'3b9cba0f-5984-40b2-a009-79ba922d1281'::uuid,0,0,0),
    ('5da7f2ae-7d2d-461f-8819-8ccf7859504c'::uuid,'599baa88-87d2-4a86-a6fd-e212c387b2ad'::uuid,0,0,0),
    ('5da7f2ae-7d2d-461f-8819-8ccf7859504c'::uuid,'0583ad72-5c12-4203-a186-0f4310aad9f8'::uuid,0,0,0),
    ('5da7f2ae-7d2d-461f-8819-8ccf7859504c'::uuid,'12b21f99-f7f7-4004-bfcb-7025e145c2d8'::uuid,8,0,0),
    ('5da7f2ae-7d2d-461f-8819-8ccf7859504c'::uuid,'7d193944-c98c-48d6-860b-20bbc5fff904'::uuid,9,0,6),
    ('5da7f2ae-7d2d-461f-8819-8ccf7859504c'::uuid,'f9eee516-c6ce-4571-b8d7-a8251a8cb498'::uuid,8,0,3),
    ('5da7f2ae-7d2d-461f-8819-8ccf7859504c'::uuid,'271f1cdb-49c6-4bd0-a029-d5f839bfc84a'::uuid,65,0,44),
    ('5da7f2ae-7d2d-461f-8819-8ccf7859504c'::uuid,'4de1db33-75ff-46ae-b797-332ab925ebce'::uuid,15,0,13),
    ('5da7f2ae-7d2d-461f-8819-8ccf7859504c'::uuid,'c430ebe8-e635-48e3-b41f-aa1b30303d61'::uuid,0,0,0),
    ('5da7f2ae-7d2d-461f-8819-8ccf7859504c'::uuid,'c00a79f4-f560-4e54-bcae-da4444a8c438'::uuid,0,0,0),
    ('5da7f2ae-7d2d-461f-8819-8ccf7859504c'::uuid,'dec7af25-40d4-4a4d-b7d3-deed6d6b108c'::uuid,0,0,0),
    ('5da7f2ae-7d2d-461f-8819-8ccf7859504c'::uuid,'69217d5b-a1c1-4764-ad95-5417f29ad52d'::uuid,0,0,0),
    ('5e99693a-5844-469b-ba5d-468e98fef2f4'::uuid,'5459c24f-0993-4538-8a85-7c0bfa174d17'::uuid,6,0,2),
    ('5e99693a-5844-469b-ba5d-468e98fef2f4'::uuid,'1b99d9a0-4294-4cc9-baa8-7b57b13d3f28'::uuid,3,0,0),
    ('5e99693a-5844-469b-ba5d-468e98fef2f4'::uuid,'3b9cba0f-5984-40b2-a009-79ba922d1281'::uuid,5,0,2),
    ('5e99693a-5844-469b-ba5d-468e98fef2f4'::uuid,'599baa88-87d2-4a86-a6fd-e212c387b2ad'::uuid,4,0,1),
    ('5e99693a-5844-469b-ba5d-468e98fef2f4'::uuid,'0583ad72-5c12-4203-a186-0f4310aad9f8'::uuid,2,0,0),
    ('5e99693a-5844-469b-ba5d-468e98fef2f4'::uuid,'12b21f99-f7f7-4004-bfcb-7025e145c2d8'::uuid,30,24,8),
    ('5e99693a-5844-469b-ba5d-468e98fef2f4'::uuid,'7d193944-c98c-48d6-860b-20bbc5fff904'::uuid,18,0,0),
    ('5e99693a-5844-469b-ba5d-468e98fef2f4'::uuid,'f9eee516-c6ce-4571-b8d7-a8251a8cb498'::uuid,33,0,6),
    ('5e99693a-5844-469b-ba5d-468e98fef2f4'::uuid,'271f1cdb-49c6-4bd0-a029-d5f839bfc84a'::uuid,37,48,0),
    ('5e99693a-5844-469b-ba5d-468e98fef2f4'::uuid,'4de1db33-75ff-46ae-b797-332ab925ebce'::uuid,16,0,0),
    ('5e99693a-5844-469b-ba5d-468e98fef2f4'::uuid,'c430ebe8-e635-48e3-b41f-aa1b30303d61'::uuid,2,0,1),
    ('5e99693a-5844-469b-ba5d-468e98fef2f4'::uuid,'c00a79f4-f560-4e54-bcae-da4444a8c438'::uuid,0,0,0),
    ('5e99693a-5844-469b-ba5d-468e98fef2f4'::uuid,'dec7af25-40d4-4a4d-b7d3-deed6d6b108c'::uuid,1,0,0),
    ('5e99693a-5844-469b-ba5d-468e98fef2f4'::uuid,'69217d5b-a1c1-4764-ad95-5417f29ad52d'::uuid,0,0,0),
    ('7394dc6d-8344-48c9-8fa7-02f7c561d3f8'::uuid,'5459c24f-0993-4538-8a85-7c0bfa174d17'::uuid,5,0,1),
    ('7394dc6d-8344-48c9-8fa7-02f7c561d3f8'::uuid,'1b99d9a0-4294-4cc9-baa8-7b57b13d3f28'::uuid,4,0,2),
    ('7394dc6d-8344-48c9-8fa7-02f7c561d3f8'::uuid,'3b9cba0f-5984-40b2-a009-79ba922d1281'::uuid,0,0,0),
    ('7394dc6d-8344-48c9-8fa7-02f7c561d3f8'::uuid,'599baa88-87d2-4a86-a6fd-e212c387b2ad'::uuid,0,0,0),
    ('7394dc6d-8344-48c9-8fa7-02f7c561d3f8'::uuid,'0583ad72-5c12-4203-a186-0f4310aad9f8'::uuid,0,0,0),
    ('7394dc6d-8344-48c9-8fa7-02f7c561d3f8'::uuid,'12b21f99-f7f7-4004-bfcb-7025e145c2d8'::uuid,41,0,20),
    ('7394dc6d-8344-48c9-8fa7-02f7c561d3f8'::uuid,'7d193944-c98c-48d6-860b-20bbc5fff904'::uuid,17,0,13),
    ('7394dc6d-8344-48c9-8fa7-02f7c561d3f8'::uuid,'f9eee516-c6ce-4571-b8d7-a8251a8cb498'::uuid,24,0,0),
    ('7394dc6d-8344-48c9-8fa7-02f7c561d3f8'::uuid,'271f1cdb-49c6-4bd0-a029-d5f839bfc84a'::uuid,62,0,31),
    ('7394dc6d-8344-48c9-8fa7-02f7c561d3f8'::uuid,'4de1db33-75ff-46ae-b797-332ab925ebce'::uuid,11,0,0),
    ('7394dc6d-8344-48c9-8fa7-02f7c561d3f8'::uuid,'c430ebe8-e635-48e3-b41f-aa1b30303d61'::uuid,1,0,0),
    ('7394dc6d-8344-48c9-8fa7-02f7c561d3f8'::uuid,'c00a79f4-f560-4e54-bcae-da4444a8c438'::uuid,0,0,0),
    ('7394dc6d-8344-48c9-8fa7-02f7c561d3f8'::uuid,'dec7af25-40d4-4a4d-b7d3-deed6d6b108c'::uuid,1,0,0),
    ('7394dc6d-8344-48c9-8fa7-02f7c561d3f8'::uuid,'69217d5b-a1c1-4764-ad95-5417f29ad52d'::uuid,0,0,0),
    ('12a14ac5-65cb-458e-b85b-e4874561572d'::uuid,'5459c24f-0993-4538-8a85-7c0bfa174d17'::uuid,5,0,1),
    ('12a14ac5-65cb-458e-b85b-e4874561572d'::uuid,'1b99d9a0-4294-4cc9-baa8-7b57b13d3f28'::uuid,3,0,2),
    ('12a14ac5-65cb-458e-b85b-e4874561572d'::uuid,'3b9cba0f-5984-40b2-a009-79ba922d1281'::uuid,0,0,0),
    ('12a14ac5-65cb-458e-b85b-e4874561572d'::uuid,'599baa88-87d2-4a86-a6fd-e212c387b2ad'::uuid,0,0,0),
    ('12a14ac5-65cb-458e-b85b-e4874561572d'::uuid,'0583ad72-5c12-4203-a186-0f4310aad9f8'::uuid,0,0,0),
    ('12a14ac5-65cb-458e-b85b-e4874561572d'::uuid,'12b21f99-f7f7-4004-bfcb-7025e145c2d8'::uuid,0,0,0),
    ('12a14ac5-65cb-458e-b85b-e4874561572d'::uuid,'7d193944-c98c-48d6-860b-20bbc5fff904'::uuid,0,0,0),
    ('12a14ac5-65cb-458e-b85b-e4874561572d'::uuid,'f9eee516-c6ce-4571-b8d7-a8251a8cb498'::uuid,0,0,0),
    ('12a14ac5-65cb-458e-b85b-e4874561572d'::uuid,'271f1cdb-49c6-4bd0-a029-d5f839bfc84a'::uuid,0,0,0),
    ('12a14ac5-65cb-458e-b85b-e4874561572d'::uuid,'4de1db33-75ff-46ae-b797-332ab925ebce'::uuid,0,0,0),
    ('12a14ac5-65cb-458e-b85b-e4874561572d'::uuid,'c430ebe8-e635-48e3-b41f-aa1b30303d61'::uuid,1,0,0),
    ('12a14ac5-65cb-458e-b85b-e4874561572d'::uuid,'c00a79f4-f560-4e54-bcae-da4444a8c438'::uuid,0,0,0),
    ('12a14ac5-65cb-458e-b85b-e4874561572d'::uuid,'dec7af25-40d4-4a4d-b7d3-deed6d6b108c'::uuid,0,0,0),
    ('12a14ac5-65cb-458e-b85b-e4874561572d'::uuid,'69217d5b-a1c1-4764-ad95-5417f29ad52d'::uuid,0,0,0),
    ('17f232a3-2e7d-4207-8eb6-52060c7bb197'::uuid,'5459c24f-0993-4538-8a85-7c0bfa174d17'::uuid,4,0,3),
    ('17f232a3-2e7d-4207-8eb6-52060c7bb197'::uuid,'1b99d9a0-4294-4cc9-baa8-7b57b13d3f28'::uuid,2,0,1),
    ('17f232a3-2e7d-4207-8eb6-52060c7bb197'::uuid,'3b9cba0f-5984-40b2-a009-79ba922d1281'::uuid,0,0,0),
    ('17f232a3-2e7d-4207-8eb6-52060c7bb197'::uuid,'599baa88-87d2-4a86-a6fd-e212c387b2ad'::uuid,0,0,0),
    ('17f232a3-2e7d-4207-8eb6-52060c7bb197'::uuid,'0583ad72-5c12-4203-a186-0f4310aad9f8'::uuid,1,0,0),
    ('17f232a3-2e7d-4207-8eb6-52060c7bb197'::uuid,'12b21f99-f7f7-4004-bfcb-7025e145c2d8'::uuid,0,0,0),
    ('17f232a3-2e7d-4207-8eb6-52060c7bb197'::uuid,'7d193944-c98c-48d6-860b-20bbc5fff904'::uuid,0,0,0),
    ('17f232a3-2e7d-4207-8eb6-52060c7bb197'::uuid,'f9eee516-c6ce-4571-b8d7-a8251a8cb498'::uuid,0,0,0),
    ('17f232a3-2e7d-4207-8eb6-52060c7bb197'::uuid,'271f1cdb-49c6-4bd0-a029-d5f839bfc84a'::uuid,0,0,0),
    ('17f232a3-2e7d-4207-8eb6-52060c7bb197'::uuid,'4de1db33-75ff-46ae-b797-332ab925ebce'::uuid,0,0,0),
    ('17f232a3-2e7d-4207-8eb6-52060c7bb197'::uuid,'c430ebe8-e635-48e3-b41f-aa1b30303d61'::uuid,0,0,0),
    ('17f232a3-2e7d-4207-8eb6-52060c7bb197'::uuid,'c00a79f4-f560-4e54-bcae-da4444a8c438'::uuid,0,0,0),
    ('17f232a3-2e7d-4207-8eb6-52060c7bb197'::uuid,'dec7af25-40d4-4a4d-b7d3-deed6d6b108c'::uuid,0,0,0),
    ('17f232a3-2e7d-4207-8eb6-52060c7bb197'::uuid,'69217d5b-a1c1-4764-ad95-5417f29ad52d'::uuid,0,0,0),
    ('18724979-a105-4d57-b048-41e2b8091f0e'::uuid,'5459c24f-0993-4538-8a85-7c0bfa174d17'::uuid,3,0,1),
    ('18724979-a105-4d57-b048-41e2b8091f0e'::uuid,'1b99d9a0-4294-4cc9-baa8-7b57b13d3f28'::uuid,3,0,1),
    ('18724979-a105-4d57-b048-41e2b8091f0e'::uuid,'3b9cba0f-5984-40b2-a009-79ba922d1281'::uuid,0,0,0),
    ('18724979-a105-4d57-b048-41e2b8091f0e'::uuid,'599baa88-87d2-4a86-a6fd-e212c387b2ad'::uuid,0,0,0),
    ('18724979-a105-4d57-b048-41e2b8091f0e'::uuid,'0583ad72-5c12-4203-a186-0f4310aad9f8'::uuid,1,0,0),
    ('18724979-a105-4d57-b048-41e2b8091f0e'::uuid,'12b21f99-f7f7-4004-bfcb-7025e145c2d8'::uuid,0,0,0),
    ('18724979-a105-4d57-b048-41e2b8091f0e'::uuid,'7d193944-c98c-48d6-860b-20bbc5fff904'::uuid,0,0,0),
    ('18724979-a105-4d57-b048-41e2b8091f0e'::uuid,'f9eee516-c6ce-4571-b8d7-a8251a8cb498'::uuid,0,0,0),
    ('18724979-a105-4d57-b048-41e2b8091f0e'::uuid,'271f1cdb-49c6-4bd0-a029-d5f839bfc84a'::uuid,0,0,0),
    ('18724979-a105-4d57-b048-41e2b8091f0e'::uuid,'4de1db33-75ff-46ae-b797-332ab925ebce'::uuid,0,0,0),
    ('18724979-a105-4d57-b048-41e2b8091f0e'::uuid,'c430ebe8-e635-48e3-b41f-aa1b30303d61'::uuid,0,0,0),
    ('18724979-a105-4d57-b048-41e2b8091f0e'::uuid,'c00a79f4-f560-4e54-bcae-da4444a8c438'::uuid,0,0,0),
    ('18724979-a105-4d57-b048-41e2b8091f0e'::uuid,'dec7af25-40d4-4a4d-b7d3-deed6d6b108c'::uuid,0,0,0),
    ('18724979-a105-4d57-b048-41e2b8091f0e'::uuid,'69217d5b-a1c1-4764-ad95-5417f29ad52d'::uuid,0,0,0);

  -- 1) tracer l'écart de conso AVANT mise à jour (mouvement 'inventaire', RG-002)
  insert into stock_movements(event_id,product_id,space_id,movement_type,qty,responsable_nom,event_category,status) values
    (v_agen,'271f1cdb-49c6-4bd0-a029-d5f839bfc84a'::uuid,'84793dcb-ca05-4c10-9b60-4e4b05ff5402'::uuid,'inventaire',24, v_resp,'match','validated'),
    (v_agen,'4de1db33-75ff-46ae-b797-332ab925ebce'::uuid,'84793dcb-ca05-4c10-9b60-4e4b05ff5402'::uuid,'inventaire',21, v_resp,'match','validated'),
    (v_agen,'c430ebe8-e635-48e3-b41f-aa1b30303d61'::uuid,'84793dcb-ca05-4c10-9b60-4e4b05ff5402'::uuid,'inventaire',1, v_resp,'match','validated'),
    (v_agen,'dec7af25-40d4-4a4d-b7d3-deed6d6b108c'::uuid,'84793dcb-ca05-4c10-9b60-4e4b05ff5402'::uuid,'inventaire',1, v_resp,'match','validated'),
    (v_agen,'69217d5b-a1c1-4764-ad95-5417f29ad52d'::uuid,'84793dcb-ca05-4c10-9b60-4e4b05ff5402'::uuid,'inventaire',8, v_resp,'match','validated'),
    (v_agen,'12b21f99-f7f7-4004-bfcb-7025e145c2d8'::uuid,'1d35419e-a798-4060-85f7-1c7daa450da2'::uuid,'inventaire',50, v_resp,'match','validated'),
    (v_agen,'7d193944-c98c-48d6-860b-20bbc5fff904'::uuid,'1d35419e-a798-4060-85f7-1c7daa450da2'::uuid,'inventaire',24, v_resp,'match','validated'),
    (v_agen,'f9eee516-c6ce-4571-b8d7-a8251a8cb498'::uuid,'1d35419e-a798-4060-85f7-1c7daa450da2'::uuid,'inventaire',48, v_resp,'match','validated'),
    (v_agen,'271f1cdb-49c6-4bd0-a029-d5f839bfc84a'::uuid,'1d35419e-a798-4060-85f7-1c7daa450da2'::uuid,'inventaire',126, v_resp,'match','validated'),
    (v_agen,'4de1db33-75ff-46ae-b797-332ab925ebce'::uuid,'1d35419e-a798-4060-85f7-1c7daa450da2'::uuid,'inventaire',42, v_resp,'match','validated'),
    (v_agen,'c430ebe8-e635-48e3-b41f-aa1b30303d61'::uuid,'1d35419e-a798-4060-85f7-1c7daa450da2'::uuid,'inventaire',2, v_resp,'match','validated'),
    (v_agen,'0583ad72-5c12-4203-a186-0f4310aad9f8'::uuid,'4796e971-8a0a-4837-96ee-3f94f794bcc4'::uuid,'inventaire',3, v_resp,'match','validated'),
    (v_agen,'7d193944-c98c-48d6-860b-20bbc5fff904'::uuid,'4796e971-8a0a-4837-96ee-3f94f794bcc4'::uuid,'inventaire',19, v_resp,'match','validated'),
    (v_agen,'271f1cdb-49c6-4bd0-a029-d5f839bfc84a'::uuid,'4796e971-8a0a-4837-96ee-3f94f794bcc4'::uuid,'inventaire',96, v_resp,'match','validated'),
    (v_agen,'4de1db33-75ff-46ae-b797-332ab925ebce'::uuid,'4796e971-8a0a-4837-96ee-3f94f794bcc4'::uuid,'inventaire',23, v_resp,'match','validated'),
    (v_agen,'0583ad72-5c12-4203-a186-0f4310aad9f8'::uuid,'0c2dcd24-a5ca-4629-aa67-8177be695ff7'::uuid,'inventaire',1, v_resp,'match','validated'),
    (v_agen,'12b21f99-f7f7-4004-bfcb-7025e145c2d8'::uuid,'0c2dcd24-a5ca-4629-aa67-8177be695ff7'::uuid,'inventaire',27, v_resp,'match','validated'),
    (v_agen,'4de1db33-75ff-46ae-b797-332ab925ebce'::uuid,'0c2dcd24-a5ca-4629-aa67-8177be695ff7'::uuid,'inventaire',30, v_resp,'match','validated'),
    (v_agen,'1b99d9a0-4294-4cc9-baa8-7b57b13d3f28'::uuid,'9dc75c34-4cde-4f39-ac98-feea0fb75a6f'::uuid,'inventaire',2, v_resp,'match','validated'),
    (v_agen,'599baa88-87d2-4a86-a6fd-e212c387b2ad'::uuid,'9dc75c34-4cde-4f39-ac98-feea0fb75a6f'::uuid,'inventaire',3, v_resp,'match','validated'),
    (v_agen,'0583ad72-5c12-4203-a186-0f4310aad9f8'::uuid,'9dc75c34-4cde-4f39-ac98-feea0fb75a6f'::uuid,'inventaire',1, v_resp,'match','validated'),
    (v_agen,'12b21f99-f7f7-4004-bfcb-7025e145c2d8'::uuid,'9dc75c34-4cde-4f39-ac98-feea0fb75a6f'::uuid,'inventaire',9, v_resp,'match','validated'),
    (v_agen,'5459c24f-0993-4538-8a85-7c0bfa174d17'::uuid,'431db55f-ea08-435d-9646-754197a123b7'::uuid,'inventaire',5, v_resp,'match','validated'),
    (v_agen,'3b9cba0f-5984-40b2-a009-79ba922d1281'::uuid,'431db55f-ea08-435d-9646-754197a123b7'::uuid,'inventaire',3, v_resp,'match','validated'),
    (v_agen,'4de1db33-75ff-46ae-b797-332ab925ebce'::uuid,'431db55f-ea08-435d-9646-754197a123b7'::uuid,'inventaire',24, v_resp,'match','validated'),
    (v_agen,'dec7af25-40d4-4a4d-b7d3-deed6d6b108c'::uuid,'431db55f-ea08-435d-9646-754197a123b7'::uuid,'inventaire',1, v_resp,'match','validated'),
    (v_agen,'5459c24f-0993-4538-8a85-7c0bfa174d17'::uuid,'5da7f2ae-7d2d-461f-8819-8ccf7859504c'::uuid,'inventaire',2, v_resp,'match','validated'),
    (v_agen,'1b99d9a0-4294-4cc9-baa8-7b57b13d3f28'::uuid,'5da7f2ae-7d2d-461f-8819-8ccf7859504c'::uuid,'inventaire',1, v_resp,'match','validated'),
    (v_agen,'12b21f99-f7f7-4004-bfcb-7025e145c2d8'::uuid,'5da7f2ae-7d2d-461f-8819-8ccf7859504c'::uuid,'inventaire',8, v_resp,'match','validated'),
    (v_agen,'7d193944-c98c-48d6-860b-20bbc5fff904'::uuid,'5da7f2ae-7d2d-461f-8819-8ccf7859504c'::uuid,'inventaire',3, v_resp,'match','validated'),
    (v_agen,'f9eee516-c6ce-4571-b8d7-a8251a8cb498'::uuid,'5da7f2ae-7d2d-461f-8819-8ccf7859504c'::uuid,'inventaire',5, v_resp,'match','validated'),
    (v_agen,'271f1cdb-49c6-4bd0-a029-d5f839bfc84a'::uuid,'5da7f2ae-7d2d-461f-8819-8ccf7859504c'::uuid,'inventaire',21, v_resp,'match','validated'),
    (v_agen,'4de1db33-75ff-46ae-b797-332ab925ebce'::uuid,'5da7f2ae-7d2d-461f-8819-8ccf7859504c'::uuid,'inventaire',2, v_resp,'match','validated'),
    (v_agen,'1b99d9a0-4294-4cc9-baa8-7b57b13d3f28'::uuid,'5e99693a-5844-469b-ba5d-468e98fef2f4'::uuid,'inventaire',3, v_resp,'match','validated'),
    (v_agen,'0583ad72-5c12-4203-a186-0f4310aad9f8'::uuid,'5e99693a-5844-469b-ba5d-468e98fef2f4'::uuid,'inventaire',2, v_resp,'match','validated'),
    (v_agen,'7d193944-c98c-48d6-860b-20bbc5fff904'::uuid,'5e99693a-5844-469b-ba5d-468e98fef2f4'::uuid,'inventaire',18, v_resp,'match','validated'),
    (v_agen,'271f1cdb-49c6-4bd0-a029-d5f839bfc84a'::uuid,'5e99693a-5844-469b-ba5d-468e98fef2f4'::uuid,'inventaire',85, v_resp,'match','validated'),
    (v_agen,'4de1db33-75ff-46ae-b797-332ab925ebce'::uuid,'5e99693a-5844-469b-ba5d-468e98fef2f4'::uuid,'inventaire',16, v_resp,'match','validated'),
    (v_agen,'dec7af25-40d4-4a4d-b7d3-deed6d6b108c'::uuid,'5e99693a-5844-469b-ba5d-468e98fef2f4'::uuid,'inventaire',1, v_resp,'match','validated'),
    (v_agen,'1b99d9a0-4294-4cc9-baa8-7b57b13d3f28'::uuid,'7394dc6d-8344-48c9-8fa7-02f7c561d3f8'::uuid,'inventaire',1, v_resp,'match','validated'),
    (v_agen,'12b21f99-f7f7-4004-bfcb-7025e145c2d8'::uuid,'7394dc6d-8344-48c9-8fa7-02f7c561d3f8'::uuid,'inventaire',2, v_resp,'match','validated'),
    (v_agen,'7d193944-c98c-48d6-860b-20bbc5fff904'::uuid,'7394dc6d-8344-48c9-8fa7-02f7c561d3f8'::uuid,'inventaire',7, v_resp,'match','validated'),
    (v_agen,'271f1cdb-49c6-4bd0-a029-d5f839bfc84a'::uuid,'7394dc6d-8344-48c9-8fa7-02f7c561d3f8'::uuid,'inventaire',18, v_resp,'match','validated'),
    (v_agen,'4de1db33-75ff-46ae-b797-332ab925ebce'::uuid,'7394dc6d-8344-48c9-8fa7-02f7c561d3f8'::uuid,'inventaire',11, v_resp,'match','validated'),
    (v_agen,'c430ebe8-e635-48e3-b41f-aa1b30303d61'::uuid,'7394dc6d-8344-48c9-8fa7-02f7c561d3f8'::uuid,'inventaire',1, v_resp,'match','validated'),
    (v_agen,'dec7af25-40d4-4a4d-b7d3-deed6d6b108c'::uuid,'7394dc6d-8344-48c9-8fa7-02f7c561d3f8'::uuid,'inventaire',1, v_resp,'match','validated'),
    (v_agen,'5459c24f-0993-4538-8a85-7c0bfa174d17'::uuid,'12a14ac5-65cb-458e-b85b-e4874561572d'::uuid,'inventaire',4, v_resp,'match','validated'),
    (v_agen,'1b99d9a0-4294-4cc9-baa8-7b57b13d3f28'::uuid,'12a14ac5-65cb-458e-b85b-e4874561572d'::uuid,'inventaire',1, v_resp,'match','validated'),
    (v_agen,'599baa88-87d2-4a86-a6fd-e212c387b2ad'::uuid,'12a14ac5-65cb-458e-b85b-e4874561572d'::uuid,'inventaire',3, v_resp,'match','validated'),
    (v_agen,'12b21f99-f7f7-4004-bfcb-7025e145c2d8'::uuid,'12a14ac5-65cb-458e-b85b-e4874561572d'::uuid,'inventaire',37, v_resp,'match','validated'),
    (v_agen,'7d193944-c98c-48d6-860b-20bbc5fff904'::uuid,'12a14ac5-65cb-458e-b85b-e4874561572d'::uuid,'inventaire',25, v_resp,'match','validated'),
    (v_agen,'f9eee516-c6ce-4571-b8d7-a8251a8cb498'::uuid,'12a14ac5-65cb-458e-b85b-e4874561572d'::uuid,'inventaire',35, v_resp,'match','validated'),
    (v_agen,'271f1cdb-49c6-4bd0-a029-d5f839bfc84a'::uuid,'12a14ac5-65cb-458e-b85b-e4874561572d'::uuid,'inventaire',86, v_resp,'match','validated'),
    (v_agen,'0583ad72-5c12-4203-a186-0f4310aad9f8'::uuid,'17f232a3-2e7d-4207-8eb6-52060c7bb197'::uuid,'inventaire',1, v_resp,'match','validated'),
    (v_agen,'0583ad72-5c12-4203-a186-0f4310aad9f8'::uuid,'18724979-a105-4d57-b048-41e2b8091f0e'::uuid,'inventaire',1, v_resp,'match','validated');

  -- 2) mettre à jour les lignes existantes
  update event_stock_lines l set initial_qty=t.i, reassort_qty=t.r, final_qty=t.f
    from _tgt t where l.event_id=v_agen and l.space_id=t.space_id and l.product_id=t.product_id;

  -- 3) créer les lignes absentes (Tente Est notamment)
  insert into event_stock_lines(event_id,space_id,product_id,initial_qty,reassort_qty,final_qty,responsable_nom)
  select v_agen,t.space_id,t.product_id,t.i,t.r,t.f,v_resp from _tgt t
  where (t.i>0 or t.r>0 or coalesce(t.f,0)>0)
    and not exists (select 1 from event_stock_lines l where l.event_id=v_agen and l.space_id=t.space_id and l.product_id=t.product_id);

  -- 4) réajuster le dépôt (espaces non conservés, hors fûts/CO2 gérés par le keg)
  update stock_balances b set current_quantity=greatest(0, b.current_quantity + (-19)), last_movement_at=now()
    from product_depot_routing r where r.product_id='12b21f99-f7f7-4004-bfcb-7025e145c2d8'::uuid and b.product_id=r.product_id and b.location_id=r.depot_id;
  insert into stock_movements(event_id,product_id,space_id,movement_type,qty,from_location_id,responsable_nom,event_category,status)
    select v_agen,'12b21f99-f7f7-4004-bfcb-7025e145c2d8'::uuid,null,'inventaire',19, r.depot_id, v_resp,'match','validated' from product_depot_routing r where r.product_id='12b21f99-f7f7-4004-bfcb-7025e145c2d8'::uuid;
  update stock_balances b set current_quantity=greatest(0, b.current_quantity + (-13)), last_movement_at=now()
    from product_depot_routing r where r.product_id='7d193944-c98c-48d6-860b-20bbc5fff904'::uuid and b.product_id=r.product_id and b.location_id=r.depot_id;
  insert into stock_movements(event_id,product_id,space_id,movement_type,qty,from_location_id,responsable_nom,event_category,status)
    select v_agen,'7d193944-c98c-48d6-860b-20bbc5fff904'::uuid,null,'inventaire',13, r.depot_id, v_resp,'match','validated' from product_depot_routing r where r.product_id='7d193944-c98c-48d6-860b-20bbc5fff904'::uuid;
  update stock_balances b set current_quantity=greatest(0, b.current_quantity + (-18)), last_movement_at=now()
    from product_depot_routing r where r.product_id='f9eee516-c6ce-4571-b8d7-a8251a8cb498'::uuid and b.product_id=r.product_id and b.location_id=r.depot_id;
  insert into stock_movements(event_id,product_id,space_id,movement_type,qty,from_location_id,responsable_nom,event_category,status)
    select v_agen,'f9eee516-c6ce-4571-b8d7-a8251a8cb498'::uuid,null,'inventaire',18, r.depot_id, v_resp,'match','validated' from product_depot_routing r where r.product_id='f9eee516-c6ce-4571-b8d7-a8251a8cb498'::uuid;
  update stock_balances b set current_quantity=greatest(0, b.current_quantity + (-152)), last_movement_at=now()
    from product_depot_routing r where r.product_id='271f1cdb-49c6-4bd0-a029-d5f839bfc84a'::uuid and b.product_id=r.product_id and b.location_id=r.depot_id;
  insert into stock_movements(event_id,product_id,space_id,movement_type,qty,from_location_id,responsable_nom,event_category,status)
    select v_agen,'271f1cdb-49c6-4bd0-a029-d5f839bfc84a'::uuid,null,'inventaire',152, r.depot_id, v_resp,'match','validated' from product_depot_routing r where r.product_id='271f1cdb-49c6-4bd0-a029-d5f839bfc84a'::uuid;
  update stock_balances b set current_quantity=greatest(0, b.current_quantity + (-116)), last_movement_at=now()
    from product_depot_routing r where r.product_id='4de1db33-75ff-46ae-b797-332ab925ebce'::uuid and b.product_id=r.product_id and b.location_id=r.depot_id;
  insert into stock_movements(event_id,product_id,space_id,movement_type,qty,from_location_id,responsable_nom,event_category,status)
    select v_agen,'4de1db33-75ff-46ae-b797-332ab925ebce'::uuid,null,'inventaire',116, r.depot_id, v_resp,'match','validated' from product_depot_routing r where r.product_id='4de1db33-75ff-46ae-b797-332ab925ebce'::uuid;
  update stock_balances b set current_quantity=greatest(0, b.current_quantity + (-4)), last_movement_at=now()
    from product_depot_routing r where r.product_id='c430ebe8-e635-48e3-b41f-aa1b30303d61'::uuid and b.product_id=r.product_id and b.location_id=r.depot_id;
  insert into stock_movements(event_id,product_id,space_id,movement_type,qty,from_location_id,responsable_nom,event_category,status)
    select v_agen,'c430ebe8-e635-48e3-b41f-aa1b30303d61'::uuid,null,'inventaire',4, r.depot_id, v_resp,'match','validated' from product_depot_routing r where r.product_id='c430ebe8-e635-48e3-b41f-aa1b30303d61'::uuid;
  update stock_balances b set current_quantity=greatest(0, b.current_quantity + (-4)), last_movement_at=now()
    from product_depot_routing r where r.product_id='dec7af25-40d4-4a4d-b7d3-deed6d6b108c'::uuid and b.product_id=r.product_id and b.location_id=r.depot_id;
  insert into stock_movements(event_id,product_id,space_id,movement_type,qty,from_location_id,responsable_nom,event_category,status)
    select v_agen,'dec7af25-40d4-4a4d-b7d3-deed6d6b108c'::uuid,null,'inventaire',4, r.depot_id, v_resp,'match','validated' from product_depot_routing r where r.product_id='dec7af25-40d4-4a4d-b7d3-deed6d6b108c'::uuid;
  update stock_balances b set current_quantity=greatest(0, b.current_quantity + (-8)), last_movement_at=now()
    from product_depot_routing r where r.product_id='69217d5b-a1c1-4764-ad95-5417f29ad52d'::uuid and b.product_id=r.product_id and b.location_id=r.depot_id;
  insert into stock_movements(event_id,product_id,space_id,movement_type,qty,from_location_id,responsable_nom,event_category,status)
    select v_agen,'69217d5b-a1c1-4764-ad95-5417f29ad52d'::uuid,null,'inventaire',8, r.depot_id, v_resp,'match','validated' from product_depot_routing r where r.product_id='69217d5b-a1c1-4764-ad95-5417f29ad52d'::uuid;

  alter table event_stock_lines enable trigger trg_initial_entered;
  alter table event_stock_lines enable trigger trg_reassort_updated;
  alter table event_stock_lines enable trigger trg_stock_final_entered;
  alter table event_stock_lines enable trigger trg_guard_close_requires_opening;
  raise notice 'Intégration réelle Agen appliquée.';
end $$;
