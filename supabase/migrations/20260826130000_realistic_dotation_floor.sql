-- Plancher de dotation réaliste — sirops & spiritueux ne sont plus sur-provisionnés
-- ============================================================================
-- PROBLÈME : sur une fiche runner sans historique, chaque sirop était monté à 15
-- (base forfaitaire 12 de la famille « Softs / Eau / Sirops » × 1.20). Or un sirop
-- est un INGRÉDIENT EN VRAC : 1 bouteille ≈ 100 doses diluées. Le provisionner
-- comme un soft individuel est irréaliste (idem spiritueux : whisky, ricard, GET 27…).
--
-- CORRECTIF : la logique de plancher (fallback SANS historique ni profil) est
-- centralisée dans public.dotation_floor(category, family) et rendue réaliste :
--   Sirops = 1, Spiritueux = 1, Matériel = 1  (vrac / non-conso individuelle)
--   Softs/Eaux = 12 (conso individuelle, inchangé)  · Vins = 3 · Champagne = 2
--   Bière bouteille = 2 · CO2 = 1
-- Les produits AVEC historique réel (space_product_coefficients) ou profil
-- (v_profile_avg) ne sont PAS affectés — seul le plancher change.
--
-- Appelée par les 3 lecteurs/générateurs : generate_runner_dotations (board),
-- get_runner_sheet (fiches VIP/bar), get_buvette_runner (fiches buvette).
-- Effet mesuré : sirop/spiritueux sans historique 15 → 2 ; softs inchangés.

-- 1) Helper centralisé ------------------------------------------------------
create or replace function public.dotation_floor(p_category text, p_family text)
returns int language sql immutable set search_path to 'public' as $$
  -- Plancher de dotation SANS historique ni profil (réaliste "vraie vie").
  -- Les ingrédients EN VRAC (sirops, spiritueux) = 1 bouteille sert ~100 doses
  -- diluées : ne jamais les provisionner comme une conso individuelle.
  select case
    when p_category = 'Sirops'     then 1   -- vrac dilué (grenadine, menthe…)
    when p_category = 'Spiritueux' then 1   -- vrac (whisky, ricard, GET 27, lillet…)
    when p_category = 'Matériel'   then 1
    when p_family   = 'Bière / Fûts'         then 2   -- bouteilles (fûts : historique dédié)
    when p_family   = 'Gaz / Technique'      then 1   -- CO2
    when p_family   = 'Champagne'            then 2
    when p_family   = 'Vins'                 then 3
    when p_family   = 'Softs / Eau / Sirops' then 12  -- softs/eaux : conso individuelle
    else 2 end;
$$;

-- 2) generate_runner_dotations (board) --------------------------------------
CREATE OR REPLACE FUNCTION public.generate_runner_dotations(p_event_id uuid)
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
   where event_id=p_event_id and coalesce(validation_status,'brouillon')='brouillon';

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
  where es.event_id=p_event_id
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
  where es.event_id=p_event_id
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
end $function$
;


-- 3) get_runner_sheet (fiches VIP/bar) --------------------------------------
CREATE OR REPLACE FUNCTION public.get_runner_sheet(p_area_name text, p_event_id uuid, p_show_level text DEFAULT 'S'::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_levels text[]; v_space_id uuid; v_profile text; v_libelle text; v_fill numeric; v_result json;
begin
  v_levels := case upper(p_show_level)
    when 'S' then array['S'] when 'SR' then array['S','R']
    when 'SRP' then array['S','R','P'] when 'ALL' then array['S','R','P','C'] else array['S'] end;
  select space_id into v_space_id from spaces where upper(trim(space_name)) = upper(trim(p_area_name)) limit 1;
  v_profile := space_profile(p_area_name);
  select max(legacy_area_name) into v_libelle from area_product_reference where upper(trim(area_name)) = upper(trim(p_area_name));
  select coalesce(max(es.fill_ratio), 1.0) into v_fill
    from event_spaces es where es.event_id = p_event_id and es.space_id = v_space_id;
  v_fill := coalesce(v_fill, 1.0);

  select json_build_object(
    'area', p_area_name, 'libelle', coalesce(v_libelle, p_area_name),
    'event_id', p_event_id, 'show_level', upper(p_show_level), 'fill_ratio', round(v_fill,2),
    'lines', coalesce(json_agg(l order by l.family_rank, l.association_level, l.product_name), '[]'::json)
  ) into v_result
  from (
    select apr.product_family, apr.product_name, apr.association_level, apr.is_default,
      apr.product_id, bsl.depot_label, bsl.depot_type,
      round(coalesce(spc.coefficient, 1.00)::numeric, 2) as coeff,
      coalesce(spc.avg_consumption, 0) as moy_hist,
      coalesce(esl.initial_qty, 0) as stock_espace,
      ceil(
        coalesce(
          spc.avg_consumption, pa.profile_avg_conso,
          case when apr.association_level = 'S'
               then public.dotation_floor(pr.category, apr.product_family) else 0 end
        ) * 1.20 * v_fill
      )::int as a_monter,
      case when spc.avg_consumption is not null then 'reel'
           when pa.profile_avg_conso is not null then 'profil'
           when apr.association_level = 'S' then 'plancher' else 'option' end as dotation_source,
      case apr.product_family when 'Bière / Fûts' then 1 when 'Vins' then 2 when 'Champagne' then 3
        when 'Softs / Eau / Sirops' then 4 when 'Spiritueux / Apéritifs' then 5
        when 'Gaz / Technique' then 6 else 7 end as family_rank
    from area_product_reference apr
    left join products pr on pr.product_id = apr.product_id
    left join buvette_stock_locations bsl on bsl.area_name = apr.area_name and bsl.product_family = apr.product_family
    left join space_product_coefficients spc on spc.space_id = v_space_id and spc.product_id = apr.product_id
    left join v_profile_avg pa on pa.profile = v_profile and pa.product_id = apr.product_id
    left join event_stock_lines esl on esl.event_id = p_event_id and esl.product_id = apr.product_id and esl.space_id = v_space_id
    where upper(trim(apr.area_name)) = upper(trim(p_area_name)) and apr.association_level = any(v_levels)
  ) l;
  return v_result;
end $function$
;


-- 4) get_buvette_runner (fiches buvette) ------------------------------------
CREATE OR REPLACE FUNCTION public.get_buvette_runner(p_buvette_code text, p_event_id uuid, p_show_level text DEFAULT 'S'::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_levels text[]; v_space_id uuid; v_libelle text; v_r_gp numeric; v_result json;
BEGIN
  v_levels := CASE upper(p_show_level)
    WHEN 'S' THEN ARRAY['S'] WHEN 'SR' THEN ARRAY['S','R']
    WHEN 'SRP' THEN ARRAY['S','R','P'] WHEN 'ALL' THEN ARRAY['S','R','P','C'] ELSE ARRAY['S'] END;
  SELECT space_id INTO v_space_id FROM spaces
    WHERE service_type='buvette' AND upper(trim(space_name))=upper(trim(p_buvette_code)) LIMIT 1;
  SELECT max(legacy_area_name) INTO v_libelle FROM area_product_reference WHERE area_name=upper(p_buvette_code);
  v_r_gp := coalesce(event_gp_ratio(p_event_id), 1);
  SELECT json_build_object(
    'buvette_code', upper(p_buvette_code), 'libelle', v_libelle,
    'event_id', p_event_id, 'show_level', upper(p_show_level), 'ratio_grand_public', round(v_r_gp,2),
    'lines', COALESCE(json_agg(l ORDER BY l.family_rank, l.association_level, l.product_name), '[]'::json)
  ) INTO v_result
  FROM (
    SELECT apr.product_family, apr.product_name, apr.association_level, apr.is_default,
      bsl.depot_label, bsl.depot_type,
      ROUND(COALESCE(spc.coefficient, 1.00)::numeric, 2) AS coeff,
      COALESCE(spc.avg_consumption, 0) AS moy_hist,
      COALESCE(esl.initial_qty, 0) AS stock_espace,
      CEIL(
        COALESCE(
          spc.avg_consumption,
          pa.profile_avg_conso,
          CASE WHEN apr.association_level='S'
               THEN public.dotation_floor(pr.category, apr.product_family) ELSE 0 END
        ) * 1.20 * v_r_gp
      )::int AS a_monter,
      CASE WHEN spc.avg_consumption IS NOT NULL THEN 'reel'
           WHEN pa.profile_avg_conso IS NOT NULL THEN 'profil'
           WHEN apr.association_level='S' THEN 'plancher' ELSE 'option' END AS dotation_source,
      CASE apr.product_family WHEN 'Bière / Fûts' THEN 1 WHEN 'Vins' THEN 2 WHEN 'Champagne' THEN 3
        WHEN 'Softs / Eau / Sirops' THEN 4 WHEN 'Spiritueux / Apéritifs' THEN 5 WHEN 'Gaz / Technique' THEN 6 ELSE 7 END AS family_rank
    FROM area_product_reference apr
    LEFT JOIN products pr ON pr.product_id = apr.product_id
    LEFT JOIN buvette_stock_locations bsl ON bsl.area_name=apr.area_name AND bsl.product_family=apr.product_family
    LEFT JOIN space_product_coefficients spc ON spc.space_id=v_space_id AND spc.product_id=apr.product_id
    LEFT JOIN v_buvette_profile_avg pa ON pa.product_id=apr.product_id
    LEFT JOIN event_stock_lines esl ON esl.event_id=p_event_id AND esl.product_id=apr.product_id AND esl.space_id=v_space_id
    WHERE apr.area_name=upper(p_buvette_code) AND apr.association_level = ANY(v_levels)
      AND NOT (upper(p_buvette_code)<>'B8' AND apr.product_family IN ('Vins','Champagne','Spiritueux / Apéritifs'))
  ) l;
  RETURN v_result;
END $function$
;


