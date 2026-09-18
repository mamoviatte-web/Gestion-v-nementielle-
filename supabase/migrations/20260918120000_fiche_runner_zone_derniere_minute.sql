-- =====================================================================
-- FICHE RUNNER D'UNE ZONE ACTIVÉE AU DERNIER MOMENT (C70, bars, etc.)
-- ---------------------------------------------------------------------
-- Besoin : pouvoir activer une zone à la dernière minute sur un match
-- (ex. Club 70 Sud / Club 70 Nord) et générer SA fiche runner sans écraser
-- les quantités déjà ajustées sur les autres espaces.
--
-- Le générateur global generate_runner_dotations purge TOUTES les lignes
-- « brouillon » de l'événement puis reconstruit → il efface les quantités
-- « à acheminer » saisies à la main sur les autres zones. Dangereux en fin
-- de préparation.
--
-- Solution : generate_runner_dotations reçoit un paramètre optionnel
-- p_space_id. Quand il est fourni, la purge et TOUTES les étapes (loges,
-- socle, complément, consolidation gammes) sont limitées à cette seule zone.
-- p_space_id NULL = comportement global inchangé (source unique de vérité,
-- pas de duplication de logique).
--
-- Wrapper activate_zone_runner(p_event_id, p_space_id) (ROLE_STADE) :
-- rattache la zone au match (event_spaces), initialise sa feuille de route
-- puis génère UNIQUEMENT sa fiche → la zone apparaît aussitôt dans le tableau
-- runner, sans toucher aux autres. Idempotent.
-- =====================================================================

-- Remplace la signature 1-arg par la version scindable (défaut NULL = global).
drop function if exists public.generate_runner_dotations(uuid);

CREATE OR REPLACE FUNCTION public.generate_runner_dotations(p_event_id uuid, p_space_id uuid default null)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_total numeric; v_vip_pax numeric; v_gp_pax numeric; v_ref_gp numeric; v_r_gp numeric;
  v_count int; v_count2 int; v_count0 int; v_merged int := 0;
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
   where event_id=p_event_id and coalesce(validation_status,'brouillon')='brouillon'
     and (p_space_id is null or space_id=p_space_id);

  -- (0) LOGES — besoin = dotation par loge (somme par produit), STOCK DE BASE
  --     FIXE : l'affluence n'entre PAS en jeu. On soustrait seulement le stock
  --     deja present dans l'espace (à_monter = besoin − stock, borne a 0).
  --     La dotation par loge fait autorite (pas de socle CDC, pas de garde 50cl).
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
    1.00,                                             -- dotation fixe : coeff neutre
    reco.q,                                           -- besoin = dotation loge fixe
    greatest(reco.q - coalesce(ast.current_qty,0), 0),-- à monter = besoin − stock espace
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
  cross join lateral (select d.tot::int as q) reco    -- FIXE : plus de × fill_ratio
  where es.event_id=p_event_id and (p_space_id is null or s.space_id=p_space_id)
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
    p_event_id, s.space_id, cat.product_id,
    coalesce(ast.current_qty,0),
    coalesce(cat.avg_consumption,0),
    coalesce(cat.avg_consumption,0),
    case when s.service_type='buvette' then round(v_r_gp,2) else round(coalesce(es.fill_ratio,1.0),2) end,
    reco.q,
    greatest(reco.q - coalesce(ast.current_qty,0), 0),
    true, reco.q, 'brouillon',
    case when cat.coefficient >= 1.5 then 'forte_demande'
         when cat.coefficient <= 0.5 then 'faible_demande' else null end
  from event_spaces es
  join spaces s on s.space_id=es.space_id and s.active=true
       and s.space_name not in ('Buvette 1','Buvette 2')
       and not (s.space_id = any(v_loges))
  join space_product_catalog cat
       on cat.space_id=s.space_id and cat.membership_level='socle' and cat.active=true
  join products p on p.product_id=cat.product_id and p.active=true
  left join area_stocks ast on ast.area_id=s.space_id and ast.product_id=cat.product_id
  cross join lateral (
    select ceil(
      coalesce(cat.avg_consumption, public.dotation_floor(p.category, cat.product_family))
      * case when s.service_type='buvette' then v_r_gp else coalesce(es.fill_ratio,1.0) end
      * 1.20
    )::int as q
  ) reco
  where es.event_id=p_event_id and (p_space_id is null or s.space_id=p_space_id)
    and not exists (select 1 from runner_auto_planning r
      where r.event_id=p_event_id and r.space_id=s.space_id and r.product_id=cat.product_id);

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
    p_event_id, s.space_id, cat.product_id,
    coalesce(ast.current_qty,0),
    cat.avg_consumption, cat.avg_consumption,
    round(coalesce(es.fill_ratio,1.0),2),
    reco.q,
    greatest(reco.q - coalesce(ast.current_qty,0), 0),
    true, reco.q, 'brouillon',
    case when cat.coefficient >= 1.5 then 'forte_demande'
         when cat.coefficient <= 0.5 then 'faible_demande' else null end
  from event_spaces es
  join spaces s on s.space_id=es.space_id and s.active=true
       and s.service_type <> 'buvette'
       and s.space_name not in ('Buvette 1','Buvette 2')
       and not (s.space_id = any(v_loges))
  join space_product_catalog cat
       on cat.space_id=s.space_id and cat.membership_level='complement'
      and cat.active=true and coalesce(cat.avg_consumption,0) > 0
  join products p on p.product_id=cat.product_id and p.active=true
  left join area_stocks ast on ast.area_id=s.space_id and ast.product_id=cat.product_id
  cross join lateral (select ceil(cat.avg_consumption * coalesce(es.fill_ratio,1.0) * 1.20)::int as q) reco
  where es.event_id=p_event_id and (p_space_id is null or s.space_id=p_space_id)
    and not exists (select 1 from runner_auto_planning r
      where r.event_id=p_event_id and r.space_id=s.space_id and r.product_id=cat.product_id);

  get diagnostics v_count2 = row_count;

  -- (3) CONSOLIDATION ANTI-MELANGE — gammes exclusives (allow_multiple=false)
  --     Pour chaque (espace, gamme exclusive) ou plusieurs "produits similaires"
  --     ont ete generes (ex. 3 rouges), on garde UNE seule ligne = le produit
  --     PRIMAIRE choisi pour l'event (event_area_product_selection), et la
  --     quantite = SOMME des besoins de la gamme (la bonne quantite totale).
  --     A defaut de primaire, on retient le produit historiquement dominant.
  --     Les Loges (dotation fixe et manuelle) sont exclues.
  declare
    r record;
    v_target uuid; v_keep uuid; v_price numeric;
    v_sum_reco int; v_sum_val int; v_sum_stock int; v_sum_hist numeric;
  begin
    for r in
      select rap.space_id, p.selection_group_id
        from runner_auto_planning rap
        join products p on p.product_id=rap.product_id
        join product_selection_groups psg on psg.id=p.selection_group_id
       where rap.event_id=p_event_id
         and coalesce(rap.validation_status,'brouillon')='brouillon'
         and psg.allow_multiple = false
         and not (rap.space_id = any(v_loges))
         and (p_space_id is null or rap.space_id=p_space_id)
       group by rap.space_id, p.selection_group_id
      having count(*) > 1
    loop
      -- agregats de la gamme dans cet espace
      select coalesce(sum(recommended_quantity),0), coalesce(sum(validated_quantity),0),
             coalesce(sum(initial_area_stock),0), coalesce(sum(historical_avg_consumption),0)
        into v_sum_reco, v_sum_val, v_sum_stock, v_sum_hist
        from runner_auto_planning rap
        join products p on p.product_id=rap.product_id
       where rap.event_id=p_event_id and rap.space_id=r.space_id
         and p.selection_group_id=r.selection_group_id
         and coalesce(rap.validation_status,'brouillon')='brouillon';

      -- produit cible = primaire de l'event si defini
      v_target := null;
      select eaps.product_id into v_target
        from event_area_product_selection eaps
       where eaps.event_id=p_event_id and eaps.space_id=r.space_id
         and eaps.selection_group_id=r.selection_group_id
         and eaps.is_primary = true
       limit 1;

      -- sinon : produit historiquement dominant parmi les lignes generees
      if v_target is null then
        select rap.product_id into v_target
          from runner_auto_planning rap
          join products p on p.product_id=rap.product_id
         where rap.event_id=p_event_id and rap.space_id=r.space_id
           and p.selection_group_id=r.selection_group_id
           and coalesce(rap.validation_status,'brouillon')='brouillon'
         order by rap.historical_avg_consumption desc nulls last,
                  rap.recommended_quantity desc
         limit 1;
      end if;

      -- ligne a conserver : celle portant deja le produit cible, sinon la dominante
      v_keep := null;
      select rap.id into v_keep
        from runner_auto_planning rap
        join products p on p.product_id=rap.product_id
       where rap.event_id=p_event_id and rap.space_id=r.space_id
         and p.selection_group_id=r.selection_group_id
         and rap.product_id=v_target
         and coalesce(rap.validation_status,'brouillon')='brouillon'
       limit 1;

      if v_keep is null then
        select rap.id into v_keep
          from runner_auto_planning rap
          join products p on p.product_id=rap.product_id
         where rap.event_id=p_event_id and rap.space_id=r.space_id
           and p.selection_group_id=r.selection_group_id
           and coalesce(rap.validation_status,'brouillon')='brouillon'
         order by rap.historical_avg_consumption desc nulls last
         limit 1;
      end if;

      -- supprime les autres "produits similaires" de la gamme
      delete from runner_auto_planning rap
        using products p
       where p.product_id=rap.product_id
         and rap.event_id=p_event_id and rap.space_id=r.space_id
         and p.selection_group_id=r.selection_group_id
         and coalesce(rap.validation_status,'brouillon')='brouillon'
         and rap.id <> v_keep;

      -- prix cible pour recalcul du cout
      select coalesce(unit_price_ht,0) into v_price from products where product_id=v_target;

      -- ligne conservee = produit primaire + quantite consolidee (somme)
      update runner_auto_planning
         set product_id = v_target,
             recommended_quantity = v_sum_reco,
             validated_quantity   = v_sum_val,
             initial_area_stock   = v_sum_stock,
             historical_avg_consumption = v_sum_hist,
             consumption_reference      = v_sum_hist,
             quantity_to_move = greatest(v_sum_reco - coalesce(v_sum_stock,0), 0),
             estimated_cost_ht = round(v_sum_reco * coalesce(v_price,0), 2),
             updated_at = now()
       where id = v_keep;

      v_merged := v_merged + 1;
    end loop;
  end;

  return json_build_object('success',true,'event_id',p_event_id,
    'pax_total',v_total,'vip_pax',v_vip_pax,'grand_public_pax',v_gp_pax,
    'ratio_grand_public',round(v_r_gp,2),
    'lignes_loges',v_count0,'lignes_socle',v_count,'lignes_historique_vip',v_count2,
    'gammes_consolidees',v_merged,
    'lignes_generees',v_count0 + v_count + v_count2);
end $function$;

grant execute on function public.generate_runner_dotations(uuid, uuid) to authenticated;

-- ── Wrapper : activer une zone + générer sa fiche (dernière minute) ───
create or replace function public.activate_zone_runner(
  p_event_id uuid,
  p_space_id uuid
) returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_event events%rowtype;
  v_space spaces%rowtype;
  v_added boolean := false;
  v_lines int; v_qtm numeric;
begin
  if not is_stade() then
    return json_build_object('success', false, 'error', 'Réservé au rôle Stade.');
  end if;
  select * into v_event from events where event_id = p_event_id;
  if not found then
    return json_build_object('success', false, 'error', 'Événement introuvable.');
  end if;
  select * into v_space from spaces where space_id = p_space_id;
  if not found or not coalesce(v_space.active, false) then
    return json_build_object('success', false, 'error', 'Espace introuvable ou inactif.');
  end if;

  insert into event_spaces (event_id, space_id)
  values (p_event_id, p_space_id)
  on conflict (event_id, space_id) do nothing;
  v_added := found;

  if exists (select 1 from pg_proc where proname = 'init_event_roadmaps') then
    perform init_event_roadmaps(p_event_id);
  end if;

  perform generate_runner_dotations(p_event_id, p_space_id);

  select count(*), coalesce(sum(quantity_to_move), 0)
    into v_lines, v_qtm
    from runner_auto_planning
   where event_id = p_event_id and space_id = p_space_id;

  return json_build_object(
    'success', true, 'space_id', p_space_id, 'space_name', v_space.space_name,
    'newly_linked', v_added, 'lines', v_lines, 'qty_to_move', v_qtm
  );
end;
$function$;

grant execute on function public.activate_zone_runner(uuid, uuid) to authenticated;
