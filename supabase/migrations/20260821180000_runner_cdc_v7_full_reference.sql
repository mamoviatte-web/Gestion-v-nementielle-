-- Fiches runner — reconstruction complete du referentiel CDC V7 (VIP/Bars).
--
-- 1) area_product_reference reconstruit pour les 13 espaces VIP/Salons/Bars a
--    partir de la grille CDC V7 (section 3). Overrides metier appliques :
--      * FADA BLANCHE BTL absente partout (bistrot = biere FADA Blanche Bouteille) ;
--      * format 50cl absent des VIP/bars (buvettes / Bodega uniquement).
--    Correspondances confirmees : Get Bodega=GET 27, SAN PE VERRE=San Pellegrino
--    bouteille, Fada Blanche(Bistrot)=FADA Blanche Bouteille.
-- 2) generate_runner_dotations : la passe historique n'ajoute plus que des
--    produits AUTORISES par le referentiel de l'espace (si referentiel present).
--    => l'affichage respecte la grille CDC ; les quantites viennent du moteur de
--       tendance (CDC V7 section 3).

CREATE OR REPLACE FUNCTION public.generate_runner_dotations(p_event_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_total numeric; v_vip_pax numeric; v_gp_pax numeric; v_ref_gp numeric; v_r_gp numeric; v_count int; v_count2 int;
begin
  select coalesce(reference_gp_pax,1) into v_ref_gp from attendance_config where id=1;
  select coalesce(expected_attendees,0) into v_total from events where event_id=p_event_id;
  select coalesce(sum(coalesce(s.max_pax,0) * coalesce(es.fill_ratio,1.0)),0) into v_vip_pax
    from event_spaces es join spaces s on s.space_id=es.space_id
    where es.event_id=p_event_id and s.service_type in ('vip','bar');
  v_gp_pax := greatest(v_total - v_vip_pax, 0);
  v_r_gp   := coalesce(event_gp_ratio(p_event_id), 1);

  delete from runner_auto_planning
   where event_id=p_event_id and coalesce(validation_status,'brouillon')='brouillon';

  -- (1) SOCLE CDC (niveau S) — autorite pour TOUS les espaces
  insert into runner_auto_planning (
    event_id, space_id, product_id, initial_area_stock,
    historical_avg_consumption, consumption_reference, attendance_coefficient,
    recommended_quantity, quantity_to_move, stock_sufficient,
    validated_quantity, validation_status, alert_type
  )
  select
    p_event_id, s.space_id, apr.product_id,
    case when s.retains_stock then coalesce(ast.current_qty,0) else 0 end,
    coalesce(spc.avg_consumption,0),
    coalesce(spc.avg_consumption,0),
    case when s.service_type='buvette' then round(v_r_gp,2) else round(coalesce(es.fill_ratio,1.0),2) end,
    reco.q,
    greatest(reco.q - case when s.retains_stock then coalesce(ast.current_qty,0) else 0 end, 0),
    true, reco.q, 'brouillon',
    case when spc.coefficient >= 1.5 then 'forte_demande'
         when spc.coefficient <= 0.5 then 'faible_demande' else null end
  from event_spaces es
  join spaces s on s.space_id=es.space_id and s.active=true and s.space_name not in ('Buvette 1','Buvette 2')
  join area_product_reference apr
       on upper(btrim(apr.area_name))=upper(btrim(s.space_name))
      and apr.association_level='S' and apr.product_id is not null
  join products p on p.product_id=apr.product_id and p.active=true
  left join space_product_coefficients spc on spc.space_id=s.space_id and spc.product_id=apr.product_id
  left join area_stocks ast on ast.area_id=s.space_id and ast.product_id=apr.product_id
  cross join lateral (
    select ceil(
      coalesce(
        spc.avg_consumption,
        case apr.product_family
          when 'Bière / Fûts' then 2 when 'Softs / Eau / Sirops' then 12
          when 'Gaz / Technique' then 1 else 2 end
      )
      * case when s.service_type='buvette' then v_r_gp else coalesce(es.fill_ratio,1.0) end
      * 1.20
    )::int as q
  ) reco
  where es.event_id=p_event_id
    and not (s.service_type in ('vip','bar') and p.product_name ilike '%50cl%')
    and not exists (select 1 from runner_auto_planning r
      where r.event_id=p_event_id and r.space_id=s.space_id and r.product_id=apr.product_id);

  get diagnostics v_count = row_count;

  -- (2) COMPLEMENT HISTORIQUE — UNIQUEMENT espaces VIP/Bars (jamais les buvettes).
  --     CDC V7 : n'ajoute que des produits AUTORISES par le referentiel de l'espace
  --     (si un referentiel existe pour cet espace) ; les espaces sans referentiel
  --     gardent l'historique complet.
  insert into runner_auto_planning (
    event_id, space_id, product_id, initial_area_stock,
    historical_avg_consumption, consumption_reference, attendance_coefficient,
    recommended_quantity, quantity_to_move, stock_sufficient,
    validated_quantity, validation_status, alert_type
  )
  select
    p_event_id, s.space_id, spc.product_id,
    case when s.retains_stock then coalesce(ast.current_qty,0) else 0 end,
    spc.avg_consumption, spc.avg_consumption,
    round(coalesce(es.fill_ratio,1.0),2),
    reco.q,
    greatest(reco.q - case when s.retains_stock then coalesce(ast.current_qty,0) else 0 end, 0),
    true, reco.q, 'brouillon',
    case when spc.coefficient >= 1.5 then 'forte_demande'
         when spc.coefficient <= 0.5 then 'faible_demande' else null end
  from event_spaces es
  join spaces s on s.space_id=es.space_id and s.active=true
       and s.service_type <> 'buvette'
       and s.space_name not in ('Buvette 1','Buvette 2')
  join space_product_coefficients spc
       on spc.space_id=s.space_id and coalesce(spc.avg_consumption,0) > 0
  join products p on p.product_id=spc.product_id and p.active=true
  left join area_stocks ast on ast.area_id=s.space_id and ast.product_id=spc.product_id
  cross join lateral (
    select ceil(spc.avg_consumption * coalesce(es.fill_ratio,1.0) * 1.20)::int as q
  ) reco
  where es.event_id=p_event_id
    and not (s.service_type in ('vip','bar') and p.product_name ilike '%50cl%')
    and (
      not exists (select 1 from area_product_reference a2
                   where upper(btrim(a2.area_name))=upper(btrim(s.space_name)))
      or exists (select 1 from area_product_reference a2
                  where upper(btrim(a2.area_name))=upper(btrim(s.space_name))
                    and a2.product_id=spc.product_id)
    )
    and not exists (select 1 from runner_auto_planning r
      where r.event_id=p_event_id and r.space_id=s.space_id and r.product_id=spc.product_id);

  get diagnostics v_count2 = row_count;

  return json_build_object('success',true,'event_id',p_event_id,
    'pax_total',v_total,'vip_pax',v_vip_pax,'grand_public_pax',v_gp_pax,
    'ratio_grand_public',round(v_r_gp,2),
    'lignes_socle',v_count,'lignes_historique_vip',v_count2,
    'lignes_generees',v_count + v_count2);
end $function$;

-- Reconstruction du referentiel CDC V7 (13 espaces)
delete from area_product_reference where upper(btrim(area_name))=upper('Salon Nord') or upper(btrim(area_name))=upper('Salon Sud') or upper(btrim(area_name))=upper('Club 70 Nord') or upper(btrim(area_name))=upper('Club 70 Sud') or upper(btrim(area_name))=upper('Bistrot') or upper(btrim(area_name))=upper('Comptoir') or upper(btrim(area_name))=upper('Le Pub') or upper(btrim(area_name))=upper('Loge Est') or upper(btrim(area_name))=upper('Loge Ouest Nord') or upper(btrim(area_name))=upper('Loge Ouest Sud') or upper(btrim(area_name))=upper('Wine bar Nord') or upper(btrim(area_name))=upper('Wine bar Sud') or upper(btrim(area_name))=upper('PMR');

insert into area_product_reference (area_name, area_group, legacy_area_name, product_name, product_family, association_level, product_id, cdc_version) values
('Salon Nord','VIP',NULL,'Mumm Blanc de Blanc','Champagne','S','1a1a93c8-13df-4bb9-938e-301c294a3686','V7'),
('Salon Nord','VIP',NULL,'Mumm Cordon Rouge','Champagne','S','ef052c42-caec-4b2d-9f34-9f298e97383b','V7'),
('Salon Nord','VIP',NULL,'Blanc Galiniere','Vins','S','1bb26ba7-a01b-4041-8785-31c61f6ecd9b','V7'),
('Salon Nord','VIP',NULL,'Blanc Montaurone','Vins','S','6cc890cc-ad92-49ce-ae90-1ab60909d92c','V7'),
('Salon Nord','VIP',NULL,'Blanc du Seuil','Vins','S','333bb2dd-7016-4dd1-b401-2a4a2d00ae21','V7'),
('Salon Nord','VIP',NULL,'Lillet Blanc','Vins','S','27d55c20-9761-4c39-a6bf-a6c5faf9334e','V7'),
('Salon Nord','VIP',NULL,'Lillet Rosé','Vins','S','766c7278-e14f-442f-86c5-25c17aace260','V7'),
('Salon Nord','VIP',NULL,'Rosé Miraval','Vins','S','056a3e3a-c074-457c-9966-a5c98040e8a1','V7'),
('Salon Nord','VIP',NULL,'Rosé Réal','Vins','S','00755134-7027-4ae9-be41-9f953c5eab30','V7'),
('Salon Nord','VIP',NULL,'Rouge Grand Boise','Vins','S','e17d4f66-b29b-464d-9236-cc69ad83b768','V7'),
('Salon Nord','VIP',NULL,'Rouge Les Alexandrins','Vins','S','4bac03c5-f5d9-497d-aa67-8ceb7ed31110','V7'),
('Salon Nord','VIP',NULL,'Rouge Paradis','Vins','S','f81b4b03-afa9-49eb-bde2-022fa61cb949','V7'),
('Salon Nord','VIP',NULL,'Fût BUD','Bière / Fûts','S','5459c24f-0993-4538-8a85-7c0bfa174d17','V7'),
('Salon Nord','VIP',NULL,'Fût LEFFE','Bière / Fûts','S','1b99d9a0-4294-4cc9-baa8-7b57b13d3f28','V7'),
('Salon Nord','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','S','0a6b296e-57e1-4354-bfe0-2f6f210660a5','V7'),
('Salon Nord','VIP',NULL,'Pepsi Max bouteille','Softs / Eau / Sirops','S','db3ce9c0-1e46-4cb1-a53a-5a073669f96b','V7'),
('Salon Nord','VIP',NULL,'Pepsi bouteille 1L+','Softs / Eau / Sirops','S','800e26a7-5d25-4a2e-96eb-feabac36fe1a','V7'),
('Salon Nord','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','S','e4f25bc7-dd41-4036-aff6-877c925e1679','V7'),
('Salon Nord','VIP',NULL,'Sirop de menthe','Softs / Eau / Sirops','S','c00a79f4-f560-4e54-bcae-da4444a8c438','V7'),
('Salon Nord','VIP',NULL,'Sirop de pêche','Softs / Eau / Sirops','S','c430ebe8-e635-48e3-b41f-aa1b30303d61','V7'),
('Salon Nord','VIP',NULL,'GET 27','Spiritueux / Apéritifs','S','fea603fb-7b98-49ff-a59c-6a41191aec5b','V7'),
('Salon Nord','VIP',NULL,'Ricard classique','Spiritueux / Apéritifs','S','40de0dac-e3e4-409f-8fef-5c87234490cc','V7'),
('Salon Nord','VIP',NULL,'San Pellegrino bouteille','Autres','R','08c46d8d-5566-4046-b372-8f437e5e7cce','V7'),
('Salon Nord','VIP',NULL,'Schweppes','Autres','R','8b33ceba-1945-4539-b5c8-142820504554','V7'),
('Salon Nord','VIP',NULL,'Vittel verre','Autres','R','922c8f3c-4274-49a0-8870-e331c87d857f','V7'),
('Salon Nord','VIP',NULL,'Whisky Jameson','Autres','R','03d4c105-1fb6-4eb4-89d4-f11ea3764d87','V7'),
('Salon Sud','VIP',NULL,'Mumm Blanc de Blanc','Champagne','S','1a1a93c8-13df-4bb9-938e-301c294a3686','V7'),
('Salon Sud','VIP',NULL,'Mumm Cordon Rouge','Champagne','S','ef052c42-caec-4b2d-9f34-9f298e97383b','V7'),
('Salon Sud','VIP',NULL,'Blanc Galiniere','Vins','S','1bb26ba7-a01b-4041-8785-31c61f6ecd9b','V7'),
('Salon Sud','VIP',NULL,'Blanc Montaurone','Vins','S','6cc890cc-ad92-49ce-ae90-1ab60909d92c','V7'),
('Salon Sud','VIP',NULL,'Blanc du Seuil','Vins','S','333bb2dd-7016-4dd1-b401-2a4a2d00ae21','V7'),
('Salon Sud','VIP',NULL,'Rosé Miraval','Vins','S','056a3e3a-c074-457c-9966-a5c98040e8a1','V7'),
('Salon Sud','VIP',NULL,'Rosé Réal','Vins','S','00755134-7027-4ae9-be41-9f953c5eab30','V7'),
('Salon Sud','VIP',NULL,'Rouge Grand Boise','Vins','S','e17d4f66-b29b-464d-9236-cc69ad83b768','V7'),
('Salon Sud','VIP',NULL,'Rouge Les Alexandrins','Vins','S','4bac03c5-f5d9-497d-aa67-8ceb7ed31110','V7'),
('Salon Sud','VIP',NULL,'Fût BUD','Bière / Fûts','S','5459c24f-0993-4538-8a85-7c0bfa174d17','V7'),
('Salon Sud','VIP',NULL,'Fût LEFFE','Bière / Fûts','S','1b99d9a0-4294-4cc9-baa8-7b57b13d3f28','V7'),
('Salon Sud','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','S','0a6b296e-57e1-4354-bfe0-2f6f210660a5','V7'),
('Salon Sud','VIP',NULL,'Pepsi Max bouteille','Softs / Eau / Sirops','S','db3ce9c0-1e46-4cb1-a53a-5a073669f96b','V7'),
('Salon Sud','VIP',NULL,'Pepsi bouteille 1L+','Softs / Eau / Sirops','S','800e26a7-5d25-4a2e-96eb-feabac36fe1a','V7'),
('Salon Sud','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','S','e4f25bc7-dd41-4036-aff6-877c925e1679','V7'),
('Salon Sud','VIP',NULL,'Sirop de citron','Softs / Eau / Sirops','S','69217d5b-a1c1-4764-ad95-5417f29ad52d','V7'),
('Salon Sud','VIP',NULL,'GET 27','Spiritueux / Apéritifs','S','fea603fb-7b98-49ff-a59c-6a41191aec5b','V7'),
('Salon Sud','VIP',NULL,'Ricard classique','Spiritueux / Apéritifs','S','40de0dac-e3e4-409f-8fef-5c87234490cc','V7'),
('Salon Sud','VIP',NULL,'San Pellegrino bouteille','Autres','R','08c46d8d-5566-4046-b372-8f437e5e7cce','V7'),
('Salon Sud','VIP',NULL,'Schweppes','Autres','R','8b33ceba-1945-4539-b5c8-142820504554','V7'),
('Salon Sud','VIP',NULL,'Vittel verre','Autres','R','922c8f3c-4274-49a0-8870-e331c87d857f','V7'),
('Salon Sud','VIP',NULL,'Whisky Jameson','Autres','R','03d4c105-1fb6-4eb4-89d4-f11ea3764d87','V7'),
('Club 70 Nord','VIP',NULL,'Mumm Cordon Rouge','Champagne','S','ef052c42-caec-4b2d-9f34-9f298e97383b','V7'),
('Club 70 Nord','VIP',NULL,'Blanc Montaurone','Vins','S','6cc890cc-ad92-49ce-ae90-1ab60909d92c','V7'),
('Club 70 Nord','VIP',NULL,'Blanc du Seuil','Vins','S','333bb2dd-7016-4dd1-b401-2a4a2d00ae21','V7'),
('Club 70 Nord','VIP',NULL,'Rosé Miraval','Vins','S','056a3e3a-c074-457c-9966-a5c98040e8a1','V7'),
('Club 70 Nord','VIP',NULL,'Rosé Pey Blanc','Vins','S','9d3c5ecb-fcd4-44f0-bf36-e76326b828d2','V7'),
('Club 70 Nord','VIP',NULL,'Rouge Les Alexandrins','Vins','S','4bac03c5-f5d9-497d-aa67-8ceb7ed31110','V7'),
('Club 70 Nord','VIP',NULL,'Fût BUD','Bière / Fûts','S','5459c24f-0993-4538-8a85-7c0bfa174d17','V7'),
('Club 70 Nord','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','S','0a6b296e-57e1-4354-bfe0-2f6f210660a5','V7'),
('Club 70 Nord','VIP',NULL,'Pepsi Max bouteille','Softs / Eau / Sirops','S','db3ce9c0-1e46-4cb1-a53a-5a073669f96b','V7'),
('Club 70 Nord','VIP',NULL,'Pepsi bouteille 1L+','Softs / Eau / Sirops','S','800e26a7-5d25-4a2e-96eb-feabac36fe1a','V7'),
('Club 70 Nord','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','S','e4f25bc7-dd41-4036-aff6-877c925e1679','V7'),
('Club 70 Nord','VIP',NULL,'Sirop Orgeat','Softs / Eau / Sirops','S','651fce04-bf3f-4d3e-a1d7-ddd4a05a6afe','V7'),
('Club 70 Nord','VIP',NULL,'Sirop de citron','Softs / Eau / Sirops','S','69217d5b-a1c1-4764-ad95-5417f29ad52d','V7'),
('Club 70 Nord','VIP',NULL,'Sirop de grenadine','Softs / Eau / Sirops','S','dec7af25-40d4-4a4d-b7d3-deed6d6b108c','V7'),
('Club 70 Nord','VIP',NULL,'Sirop de pêche','Softs / Eau / Sirops','S','c430ebe8-e635-48e3-b41f-aa1b30303d61','V7'),
('Club 70 Nord','VIP',NULL,'Ricard classique','Spiritueux / Apéritifs','S','40de0dac-e3e4-409f-8fef-5c87234490cc','V7'),
('Club 70 Nord','VIP',NULL,'CO2','Gaz / Technique','S','0583ad72-5c12-4203-a186-0f4310aad9f8','V7'),
('Club 70 Sud','VIP',NULL,'Mumm Cordon Rouge','Champagne','S','ef052c42-caec-4b2d-9f34-9f298e97383b','V7'),
('Club 70 Sud','VIP',NULL,'Blanc du Seuil','Vins','S','333bb2dd-7016-4dd1-b401-2a4a2d00ae21','V7'),
('Club 70 Sud','VIP',NULL,'Rosé Miraval','Vins','S','056a3e3a-c074-457c-9966-a5c98040e8a1','V7'),
('Club 70 Sud','VIP',NULL,'Rosé Pey Blanc','Vins','S','9d3c5ecb-fcd4-44f0-bf36-e76326b828d2','V7'),
('Club 70 Sud','VIP',NULL,'Rouge Les Alexandrins','Vins','S','4bac03c5-f5d9-497d-aa67-8ceb7ed31110','V7'),
('Club 70 Sud','VIP',NULL,'Fût BUD','Bière / Fûts','S','5459c24f-0993-4538-8a85-7c0bfa174d17','V7'),
('Club 70 Sud','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','S','0a6b296e-57e1-4354-bfe0-2f6f210660a5','V7'),
('Club 70 Sud','VIP',NULL,'Pepsi Max bouteille','Softs / Eau / Sirops','S','db3ce9c0-1e46-4cb1-a53a-5a073669f96b','V7'),
('Club 70 Sud','VIP',NULL,'Pepsi bouteille 1L+','Softs / Eau / Sirops','S','800e26a7-5d25-4a2e-96eb-feabac36fe1a','V7'),
('Club 70 Sud','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','S','e4f25bc7-dd41-4036-aff6-877c925e1679','V7'),
('Club 70 Sud','VIP',NULL,'CO2','Gaz / Technique','S','0583ad72-5c12-4203-a186-0f4310aad9f8','V7'),
('Bistrot','VIP',NULL,'Blanc Montaurone','Vins','S','6cc890cc-ad92-49ce-ae90-1ab60909d92c','V7'),
('Bistrot','VIP',NULL,'Blanc du Seuil','Vins','S','333bb2dd-7016-4dd1-b401-2a4a2d00ae21','V7'),
('Bistrot','VIP',NULL,'Lillet Blanc','Vins','S','27d55c20-9761-4c39-a6bf-a6c5faf9334e','V7'),
('Bistrot','VIP',NULL,'Lillet Rosé','Vins','S','766c7278-e14f-442f-86c5-25c17aace260','V7'),
('Bistrot','VIP',NULL,'Rosé Réal','Vins','S','00755134-7027-4ae9-be41-9f953c5eab30','V7'),
('Bistrot','VIP',NULL,'Rouge Paradis','Vins','S','f81b4b03-afa9-49eb-bde2-022fa61cb949','V7'),
('Bistrot','VIP',NULL,'Fût BUD','Bière / Fûts','S','5459c24f-0993-4538-8a85-7c0bfa174d17','V7'),
('Bistrot','VIP',NULL,'Fût LEFFE','Bière / Fûts','S','1b99d9a0-4294-4cc9-baa8-7b57b13d3f28','V7'),
('Bistrot','VIP',NULL,'FADA Blanche Bouteille','Bière / Fûts','S','1ed609ab-e199-4f77-ac11-5ed69bf11a14','V7'),
('Bistrot','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','S','0a6b296e-57e1-4354-bfe0-2f6f210660a5','V7'),
('Bistrot','VIP',NULL,'Pepsi Max bouteille','Softs / Eau / Sirops','S','db3ce9c0-1e46-4cb1-a53a-5a073669f96b','V7'),
('Bistrot','VIP',NULL,'Pepsi bouteille 1L+','Softs / Eau / Sirops','S','800e26a7-5d25-4a2e-96eb-feabac36fe1a','V7'),
('Bistrot','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','S','e4f25bc7-dd41-4036-aff6-877c925e1679','V7'),
('Bistrot','VIP',NULL,'Sirop Orgeat','Softs / Eau / Sirops','S','651fce04-bf3f-4d3e-a1d7-ddd4a05a6afe','V7'),
('Bistrot','VIP',NULL,'Sirop de citron','Softs / Eau / Sirops','S','69217d5b-a1c1-4764-ad95-5417f29ad52d','V7'),
('Bistrot','VIP',NULL,'Sirop de grenadine','Softs / Eau / Sirops','S','dec7af25-40d4-4a4d-b7d3-deed6d6b108c','V7'),
('Bistrot','VIP',NULL,'Sirop de pêche','Softs / Eau / Sirops','S','c430ebe8-e635-48e3-b41f-aa1b30303d61','V7'),
('Bistrot','VIP',NULL,'Ricard classique','Spiritueux / Apéritifs','S','40de0dac-e3e4-409f-8fef-5c87234490cc','V7'),
('Bistrot','VIP',NULL,'Corona','Autres','R','7cb29594-1f7b-4cb3-8df9-3728124fcd54','V7'),
('Bistrot','VIP',NULL,'CORONA SANS ALCOOL','Autres','R','2ba6594e-c8f1-4aad-ae73-6f0c5fd103cc','V7'),
('Bistrot','VIP',NULL,'FADA Abricot Bouteille','Autres','R','49be0b87-8478-46a0-826e-6db527f51c64','V7'),
('Bistrot','VIP',NULL,'FADA IPA Bouteille','Autres','R','b0d3d848-54d5-4be8-ab72-94ce5ded1d10','V7'),
('Bistrot','VIP',NULL,'Schweppes','Autres','R','8b33ceba-1945-4539-b5c8-142820504554','V7'),
('Bistrot','VIP',NULL,'Whisky Jameson','Autres','R','03d4c105-1fb6-4eb4-89d4-f11ea3764d87','V7'),
('Comptoir','VIP',NULL,'Blanc Galiniere','Vins','S','1bb26ba7-a01b-4041-8785-31c61f6ecd9b','V7'),
('Comptoir','VIP',NULL,'Blanc Montaurone','Vins','S','6cc890cc-ad92-49ce-ae90-1ab60909d92c','V7'),
('Comptoir','VIP',NULL,'Lillet Blanc','Vins','S','27d55c20-9761-4c39-a6bf-a6c5faf9334e','V7'),
('Comptoir','VIP',NULL,'Lillet Rosé','Vins','S','766c7278-e14f-442f-86c5-25c17aace260','V7'),
('Comptoir','VIP',NULL,'Rosé Miraval','Vins','S','056a3e3a-c074-457c-9966-a5c98040e8a1','V7'),
('Comptoir','VIP',NULL,'Rosé Pey Blanc','Vins','S','9d3c5ecb-fcd4-44f0-bf36-e76326b828d2','V7'),
('Comptoir','VIP',NULL,'Rouge Les Alexandrins','Vins','S','4bac03c5-f5d9-497d-aa67-8ceb7ed31110','V7'),
('Comptoir','VIP',NULL,'Fût BUD','Bière / Fûts','S','5459c24f-0993-4538-8a85-7c0bfa174d17','V7'),
('Comptoir','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','S','0a6b296e-57e1-4354-bfe0-2f6f210660a5','V7'),
('Comptoir','VIP',NULL,'Pepsi Max bouteille','Softs / Eau / Sirops','S','db3ce9c0-1e46-4cb1-a53a-5a073669f96b','V7'),
('Comptoir','VIP',NULL,'Pepsi bouteille 1L+','Softs / Eau / Sirops','S','800e26a7-5d25-4a2e-96eb-feabac36fe1a','V7'),
('Comptoir','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','S','e4f25bc7-dd41-4036-aff6-877c925e1679','V7'),
('Comptoir','VIP',NULL,'Ricard classique','Spiritueux / Apéritifs','S','40de0dac-e3e4-409f-8fef-5c87234490cc','V7'),
('Comptoir','VIP',NULL,'Pastis','Autres','R','97cc29fd-a16f-4a5d-9e37-147c74544403','V7'),
('Comptoir','VIP',NULL,'Schweppes','Autres','R','8b33ceba-1945-4539-b5c8-142820504554','V7'),
('Comptoir','VIP',NULL,'Whisky Jameson','Autres','R','03d4c105-1fb6-4eb4-89d4-f11ea3764d87','V7'),
('Le Pub','VIP',NULL,'Mumm Cordon Rouge','Champagne','S','ef052c42-caec-4b2d-9f34-9f298e97383b','V7'),
('Le Pub','VIP',NULL,'Blanc Galiniere','Vins','S','1bb26ba7-a01b-4041-8785-31c61f6ecd9b','V7'),
('Le Pub','VIP',NULL,'Blanc du Seuil','Vins','S','333bb2dd-7016-4dd1-b401-2a4a2d00ae21','V7'),
('Le Pub','VIP',NULL,'Lillet Blanc','Vins','S','27d55c20-9761-4c39-a6bf-a6c5faf9334e','V7'),
('Le Pub','VIP',NULL,'Lillet Rosé','Vins','S','766c7278-e14f-442f-86c5-25c17aace260','V7'),
('Le Pub','VIP',NULL,'Rosé Miraval','Vins','S','056a3e3a-c074-457c-9966-a5c98040e8a1','V7'),
('Le Pub','VIP',NULL,'Rosé Réal','Vins','S','00755134-7027-4ae9-be41-9f953c5eab30','V7'),
('Le Pub','VIP',NULL,'Rouge Grand Boise','Vins','S','e17d4f66-b29b-464d-9236-cc69ad83b768','V7'),
('Le Pub','VIP',NULL,'Fût BUD','Bière / Fûts','S','5459c24f-0993-4538-8a85-7c0bfa174d17','V7'),
('Le Pub','VIP',NULL,'Fût LEFFE','Bière / Fûts','S','1b99d9a0-4294-4cc9-baa8-7b57b13d3f28','V7'),
('Le Pub','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','S','0a6b296e-57e1-4354-bfe0-2f6f210660a5','V7'),
('Le Pub','VIP',NULL,'Pepsi Max bouteille','Softs / Eau / Sirops','S','db3ce9c0-1e46-4cb1-a53a-5a073669f96b','V7'),
('Le Pub','VIP',NULL,'Pepsi bouteille 1L+','Softs / Eau / Sirops','S','800e26a7-5d25-4a2e-96eb-feabac36fe1a','V7'),
('Le Pub','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','S','e4f25bc7-dd41-4036-aff6-877c925e1679','V7'),
('Le Pub','VIP',NULL,'Sirop de grenadine','Softs / Eau / Sirops','S','dec7af25-40d4-4a4d-b7d3-deed6d6b108c','V7'),
('Le Pub','VIP',NULL,'Ricard classique','Spiritueux / Apéritifs','S','40de0dac-e3e4-409f-8fef-5c87234490cc','V7'),
('Le Pub','VIP',NULL,'CO2','Gaz / Technique','S','0583ad72-5c12-4203-a186-0f4310aad9f8','V7'),
('Le Pub','VIP',NULL,'Schweppes','Autres','R','8b33ceba-1945-4539-b5c8-142820504554','V7'),
('Le Pub','VIP',NULL,'Whisky Jameson','Autres','R','03d4c105-1fb6-4eb4-89d4-f11ea3764d87','V7'),
('Loge Est','VIP',NULL,'Mumm Cordon Rouge','Champagne','S','ef052c42-caec-4b2d-9f34-9f298e97383b','V7'),
('Loge Est','VIP',NULL,'Blanc Montaurone','Vins','S','6cc890cc-ad92-49ce-ae90-1ab60909d92c','V7'),
('Loge Est','VIP',NULL,'Blanc du Seuil','Vins','S','333bb2dd-7016-4dd1-b401-2a4a2d00ae21','V7'),
('Loge Est','VIP',NULL,'Rosé Miraval','Vins','S','056a3e3a-c074-457c-9966-a5c98040e8a1','V7'),
('Loge Est','VIP',NULL,'Rosé Réal','Vins','S','00755134-7027-4ae9-be41-9f953c5eab30','V7'),
('Loge Est','VIP',NULL,'Rouge Grand Boise','Vins','S','e17d4f66-b29b-464d-9236-cc69ad83b768','V7'),
('Loge Est','VIP',NULL,'Rouge Les Alexandrins','Vins','S','4bac03c5-f5d9-497d-aa67-8ceb7ed31110','V7'),
('Loge Est','VIP',NULL,'Rouge Paradis','Vins','S','f81b4b03-afa9-49eb-bde2-022fa61cb949','V7'),
('Loge Est','VIP',NULL,'Bière en verre','Bière / Fûts','S','f7ba17a8-26ab-410d-a012-8a1825bd4430','V7'),
('Loge Est','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','S','0a6b296e-57e1-4354-bfe0-2f6f210660a5','V7'),
('Loge Est','VIP',NULL,'Pepsi bouteille 1L+','Softs / Eau / Sirops','S','800e26a7-5d25-4a2e-96eb-feabac36fe1a','V7'),
('Loge Est','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','S','e4f25bc7-dd41-4036-aff6-877c925e1679','V7'),
('Loge Est','VIP',NULL,'Ricard classique','Spiritueux / Apéritifs','S','40de0dac-e3e4-409f-8fef-5c87234490cc','V7'),
('Loge Est','VIP',NULL,'Whisky Jameson','Autres','R','03d4c105-1fb6-4eb4-89d4-f11ea3764d87','V7'),
('Loge Ouest Nord','VIP',NULL,'Mumm Cordon Rouge','Champagne','S','ef052c42-caec-4b2d-9f34-9f298e97383b','V7'),
('Loge Ouest Nord','VIP',NULL,'Blanc Montaurone','Vins','S','6cc890cc-ad92-49ce-ae90-1ab60909d92c','V7'),
('Loge Ouest Nord','VIP',NULL,'Blanc du Seuil','Vins','S','333bb2dd-7016-4dd1-b401-2a4a2d00ae21','V7'),
('Loge Ouest Nord','VIP',NULL,'Rosé Réal','Vins','S','00755134-7027-4ae9-be41-9f953c5eab30','V7'),
('Loge Ouest Nord','VIP',NULL,'Rouge Grand Boise','Vins','S','e17d4f66-b29b-464d-9236-cc69ad83b768','V7'),
('Loge Ouest Nord','VIP',NULL,'Rouge Les Alexandrins','Vins','S','4bac03c5-f5d9-497d-aa67-8ceb7ed31110','V7'),
('Loge Ouest Nord','VIP',NULL,'Bière en verre','Bière / Fûts','S','f7ba17a8-26ab-410d-a012-8a1825bd4430','V7'),
('Loge Ouest Nord','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','S','0a6b296e-57e1-4354-bfe0-2f6f210660a5','V7'),
('Loge Ouest Nord','VIP',NULL,'Pepsi bouteille 1L+','Softs / Eau / Sirops','S','800e26a7-5d25-4a2e-96eb-feabac36fe1a','V7'),
('Loge Ouest Nord','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','S','e4f25bc7-dd41-4036-aff6-877c925e1679','V7'),
('Loge Ouest Nord','VIP',NULL,'Ricard classique','Spiritueux / Apéritifs','S','40de0dac-e3e4-409f-8fef-5c87234490cc','V7'),
('Loge Ouest Nord','VIP',NULL,'Whisky Jameson','Autres','R','03d4c105-1fb6-4eb4-89d4-f11ea3764d87','V7'),
('Loge Ouest Sud','VIP',NULL,'Mumm Cordon Rouge','Champagne','S','ef052c42-caec-4b2d-9f34-9f298e97383b','V7'),
('Loge Ouest Sud','VIP',NULL,'Rouge Grand Boise','Vins','S','e17d4f66-b29b-464d-9236-cc69ad83b768','V7'),
('Loge Ouest Sud','VIP',NULL,'Bière en verre','Bière / Fûts','S','f7ba17a8-26ab-410d-a012-8a1825bd4430','V7'),
('Loge Ouest Sud','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','S','0a6b296e-57e1-4354-bfe0-2f6f210660a5','V7'),
('Loge Ouest Sud','VIP',NULL,'Pepsi bouteille 1L+','Softs / Eau / Sirops','S','800e26a7-5d25-4a2e-96eb-feabac36fe1a','V7'),
('Loge Ouest Sud','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','S','e4f25bc7-dd41-4036-aff6-877c925e1679','V7'),
('Loge Ouest Sud','VIP',NULL,'Ricard classique','Spiritueux / Apéritifs','S','40de0dac-e3e4-409f-8fef-5c87234490cc','V7'),
('Loge Ouest Sud','VIP',NULL,'Whisky Jameson','Autres','R','03d4c105-1fb6-4eb4-89d4-f11ea3764d87','V7'),
('Wine bar Nord','VIP',NULL,'Bière en verre','Bière / Fûts','S','f7ba17a8-26ab-410d-a012-8a1825bd4430','V7'),
('Wine bar Nord','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','S','0a6b296e-57e1-4354-bfe0-2f6f210660a5','V7'),
('Wine bar Nord','VIP',NULL,'Pepsi bouteille 1L+','Softs / Eau / Sirops','S','800e26a7-5d25-4a2e-96eb-feabac36fe1a','V7'),
('Wine bar Nord','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','S','e4f25bc7-dd41-4036-aff6-877c925e1679','V7'),
('Wine bar Sud','VIP',NULL,'Bière en verre','Bière / Fûts','S','f7ba17a8-26ab-410d-a012-8a1825bd4430','V7'),
('Wine bar Sud','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','S','0a6b296e-57e1-4354-bfe0-2f6f210660a5','V7'),
('Wine bar Sud','VIP',NULL,'Pepsi bouteille 1L+','Softs / Eau / Sirops','S','800e26a7-5d25-4a2e-96eb-feabac36fe1a','V7'),
('Wine bar Sud','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','S','e4f25bc7-dd41-4036-aff6-877c925e1679','V7'),
('PMR','VIP',NULL,'Blanc Galiniere','Vins','S','1bb26ba7-a01b-4041-8785-31c61f6ecd9b','V7'),
('PMR','VIP',NULL,'Blanc Montaurone','Vins','S','6cc890cc-ad92-49ce-ae90-1ab60909d92c','V7'),
('PMR','VIP',NULL,'Blanc du Seuil','Vins','S','333bb2dd-7016-4dd1-b401-2a4a2d00ae21','V7'),
('PMR','VIP',NULL,'Rosé Miraval','Vins','S','056a3e3a-c074-457c-9966-a5c98040e8a1','V7'),
('PMR','VIP',NULL,'Rosé NAIS','Vins','S','2755c827-b791-4d8d-8e5f-12fb4c147320','V7'),
('PMR','VIP',NULL,'Rouge Grand Boise','Vins','S','e17d4f66-b29b-464d-9236-cc69ad83b768','V7'),
('PMR','VIP',NULL,'Rouge Les Alexandrins','Vins','S','4bac03c5-f5d9-497d-aa67-8ceb7ed31110','V7'),
('PMR','VIP',NULL,'Bière en verre','Bière / Fûts','S','f7ba17a8-26ab-410d-a012-8a1825bd4430','V7'),
('PMR','VIP',NULL,'Fût FADA Blonde','Bière / Fûts','S','0c93bd1c-d70e-4945-b799-51356a00dee7','V7'),
('PMR','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','S','0a6b296e-57e1-4354-bfe0-2f6f210660a5','V7'),
('PMR','VIP',NULL,'Pepsi bouteille 1L+','Softs / Eau / Sirops','S','800e26a7-5d25-4a2e-96eb-feabac36fe1a','V7'),
('PMR','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','S','e4f25bc7-dd41-4036-aff6-877c925e1679','V7'),
('PMR','VIP',NULL,'FADA Abricot Bouteille','Autres','R','49be0b87-8478-46a0-826e-6db527f51c64','V7');
