-- Assortiment espaces = autorité unique : on retire la garde 50cl du générateur.
-- La composition d'un espace se pilote désormais entièrement par son socle
-- (area_product_reference, éditable via « Assortiment des espaces ») : un produit
-- buvette peut être mis en VIP et inversement, et la fiche runner le reprend.
-- Le drift automatique reste borné par le ref-gate de la passe historique
-- (n'ajoute que des produits présents au référentiel de l'espace).

CREATE OR REPLACE FUNCTION public.generate_runner_dotations(p_event_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_total numeric; v_vip_pax numeric; v_gp_pax numeric; v_ref_gp numeric; v_r_gp numeric;
  v_count int; v_count2 int; v_count0 int;
  -- espaces Loges (dotation par loge = autorite de la fiche)
  v_loges uuid[] := array[
    'a96044d1-9ab0-45d0-85eb-73672df6ab82',  -- Loge Est
    '673b6e4e-0f5a-406f-9029-c35b25a38103',  -- Loge Ouest Nord (GALICE)
    '8be2956e-a379-4e8e-a3eb-65401bac3c56'   -- Loge Ouest Sud (PAGNOL)
  ]::uuid[];
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

  -- (0) LOGES — besoin = dotation par loge (somme) x facteur d'affluence,
  --     stock office soustrait. La dotation par loge fait autorite ici
  --     (pas de socle CDC generique, pas de garde 50cl : Cristaline = eau loge).
  insert into runner_auto_planning (
    event_id, space_id, product_id, initial_area_stock,
    historical_avg_consumption, consumption_reference, attendance_coefficient,
    recommended_quantity, quantity_to_move, stock_sufficient,
    validated_quantity, validation_status, alert_type
  )
  select
    p_event_id, s.space_id, d.product_id,
    coalesce(ast.current_qty,0),
    coalesce(spc.avg_consumption,0), coalesce(spc.avg_consumption,0),
    round(coalesce(es.fill_ratio,1.0),2),
    reco.q,
    greatest(reco.q - coalesce(ast.current_qty,0), 0),
    true, reco.q, 'brouillon', null
  from event_spaces es
  join spaces s on s.space_id=es.space_id and s.active=true and s.space_id = any(v_loges)
  join (
    select space_id, product_id, sum(qty)::int as tot
      from loge_dotations where product_id is not null
      group by space_id, product_id
  ) d on d.space_id = s.space_id
  join products p on p.product_id=d.product_id and p.active=true
  left join space_product_coefficients spc on spc.space_id=s.space_id and spc.product_id=d.product_id
  left join area_stocks ast on ast.area_id=s.space_id and ast.product_id=d.product_id
  cross join lateral (select ceil(d.tot * coalesce(es.fill_ratio,1.0))::int as q) reco
  where es.event_id=p_event_id
    and not exists (select 1 from runner_auto_planning r
      where r.event_id=p_event_id and r.space_id=s.space_id and r.product_id=d.product_id);

  get diagnostics v_count0 = row_count;

  -- (1) SOCLE CDC (niveau S) — tous les espaces SAUF les Loges.
  insert into runner_auto_planning (
    event_id, space_id, product_id, initial_area_stock,
    historical_avg_consumption, consumption_reference, attendance_coefficient,
    recommended_quantity, quantity_to_move, stock_sufficient,
    validated_quantity, validation_status, alert_type
  )
  select
    p_event_id, s.space_id, apr.product_id,
    coalesce(ast.current_qty,0),
    coalesce(spc.avg_consumption,0),
    coalesce(spc.avg_consumption,0),
    case when s.service_type='buvette' then round(v_r_gp,2) else round(coalesce(es.fill_ratio,1.0),2) end,
    reco.q,
    greatest(reco.q - coalesce(ast.current_qty,0), 0),
    true, reco.q, 'brouillon',
    case when spc.coefficient >= 1.5 then 'forte_demande'
         when spc.coefficient <= 0.5 then 'faible_demande' else null end
  from event_spaces es
  join spaces s on s.space_id=es.space_id and s.active=true
       and s.space_name not in ('Buvette 1','Buvette 2')
       and not (s.space_id = any(v_loges))
  join area_product_reference apr
       on upper(btrim(apr.area_name))=upper(btrim(s.space_name))
      and apr.association_level='S' and apr.product_id is not null
  join products p on p.product_id=apr.product_id and p.active=true
  left join space_product_coefficients spc on spc.space_id=s.space_id and spc.product_id=apr.product_id
  left join area_stocks ast on ast.area_id=s.space_id and ast.product_id=apr.product_id
  cross join lateral (
    select ceil(
      coalesce(spc.avg_consumption,
        case apr.product_family
          when 'Bière / Fûts' then 2 when 'Softs / Eau / Sirops' then 12
          when 'Gaz / Technique' then 1 else 2 end)
      * case when s.service_type='buvette' then v_r_gp else coalesce(es.fill_ratio,1.0) end
      * 1.20
    )::int as q
  ) reco
  where es.event_id=p_event_id
    and not exists (select 1 from runner_auto_planning r
      where r.event_id=p_event_id and r.space_id=s.space_id and r.product_id=apr.product_id);

  get diagnostics v_count = row_count;

  -- (2) COMPLEMENT HISTORIQUE — VIP/Bars (jamais buvettes ni Loges), produits
  --     autorises par le referentiel (si present).
  insert into runner_auto_planning (
    event_id, space_id, product_id, initial_area_stock,
    historical_avg_consumption, consumption_reference, attendance_coefficient,
    recommended_quantity, quantity_to_move, stock_sufficient,
    validated_quantity, validation_status, alert_type
  )
  select
    p_event_id, s.space_id, spc.product_id,
    coalesce(ast.current_qty,0),
    spc.avg_consumption, spc.avg_consumption,
    round(coalesce(es.fill_ratio,1.0),2),
    reco.q,
    greatest(reco.q - coalesce(ast.current_qty,0), 0),
    true, reco.q, 'brouillon',
    case when spc.coefficient >= 1.5 then 'forte_demande'
         when spc.coefficient <= 0.5 then 'faible_demande' else null end
  from event_spaces es
  join spaces s on s.space_id=es.space_id and s.active=true
       and s.service_type <> 'buvette'
       and s.space_name not in ('Buvette 1','Buvette 2')
       and not (s.space_id = any(v_loges))
  join space_product_coefficients spc
       on spc.space_id=s.space_id and coalesce(spc.avg_consumption,0) > 0
  join products p on p.product_id=spc.product_id and p.active=true
  left join area_stocks ast on ast.area_id=s.space_id and ast.product_id=spc.product_id
  cross join lateral (select ceil(spc.avg_consumption * coalesce(es.fill_ratio,1.0) * 1.20)::int as q) reco
  where es.event_id=p_event_id
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
    'lignes_loges',v_count0,'lignes_socle',v_count,'lignes_historique_vip',v_count2,
    'lignes_generees',v_count0 + v_count + v_count2);
end $function$;
