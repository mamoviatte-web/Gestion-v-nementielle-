-- Fiches runner — application du CDC V7 « Produits VIP vs Buvettes ».
--
-- Corrige deux erreurs de génération constatées sur les fiches VIP/Salons :
--   1. FADA BLANCHE BTL (produit désactivé, erreur) apparaissait encore car la
--      passe SOCLE ne filtrait pas products.active. → uniquement au Bistrot en
--      réalité ; on la retire définitivement de toutes les fiches.
--   2. Les softs 50cl (Cristaline/Pepsi/Orangina/Ice Tea/San Pellegrino 50cl)
--      descendaient en VIP et en bars. Règle métier : le format 50cl n'est
--      autorisé qu'en buvettes et à la Bodega (service_type buvette / bodega).
--
-- Garde bloquante dans le générateur (defense-in-depth, conforme au CDC V7 §7) :
-- même si une donnée de référence ou un historique de conso réintroduit un de
-- ces produits, il ne peut plus atterrir sur une fiche VIP/bar.

-- ── 1) Générateur : filtrer produits actifs + interdire le 50cl en VIP/bar ──
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

  -- (1) SOCLE CDC (niveau S) — autorité pour TOUS les espaces
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
  -- CDC V7 : produit actif obligatoire (RG-009) ; retire FADA BLANCHE BTL & inactifs
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
    -- CDC V7 : le format 50cl n'est autorisé qu'en buvette / Bodega
    and not (s.service_type in ('vip','bar') and p.product_name ilike '%50cl%')
    and not exists (select 1 from runner_auto_planning r
      where r.event_id=p_event_id and r.space_id=s.space_id and r.product_id=apr.product_id);

  get diagnostics v_count = row_count;

  -- (2) COMPLÉMENT HISTORIQUE — UNIQUEMENT espaces VIP/Bars (jamais les buvettes).
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
    -- CDC V7 : le format 50cl n'est autorisé qu'en buvette / Bodega
    and not (s.service_type in ('vip','bar') and p.product_name ilike '%50cl%')
    and not exists (select 1 from runner_auto_planning r
      where r.event_id=p_event_id and r.space_id=s.space_id and r.product_id=spc.product_id);

  get diagnostics v_count2 = row_count;

  return json_build_object('success',true,'event_id',p_event_id,
    'pax_total',v_total,'vip_pax',v_vip_pax,'grand_public_pax',v_gp_pax,
    'ratio_grand_public',round(v_r_gp,2),
    'lignes_socle',v_count,'lignes_historique_vip',v_count2,
    'lignes_generees',v_count + v_count2);
end $function$;

-- ── 2) Nettoyage du référentiel d'assortiment (area_product_reference) ──
-- 2a. FADA BLANCHE BTL retirée de toutes les fiches (produit erreur, désactivé).
delete from area_product_reference
 where product_id = '33e4b1d0-7ea8-4b29-b129-0f9578a918d5';

-- 2b. Softs 50cl retirés des espaces VIP et bars (conservés en buvettes / Bodega).
delete from area_product_reference apr
 using spaces s
 where upper(btrim(apr.area_name)) = upper(btrim(s.space_name))
   and s.service_type in ('vip','bar')
   and apr.product_name ilike '%50cl%';
