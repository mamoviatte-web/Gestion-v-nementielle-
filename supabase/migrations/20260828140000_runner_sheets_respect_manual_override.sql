-- Fiches runner : respecter l'override manuel de quantité (validated_quantity)
-- ============================================================================
-- Besoin : ROLE_STADE doit pouvoir RELEVER une quantité de fiche runner jugée
-- trop faible (car reporting de stock historiquement sous-évalué par un
-- responsable). Le board (RunnerSpaceDetail → validateLine) écrivait déjà
-- validated_quantity dans runner_auto_planning, et le TRANSFERT le respectait
-- (on_runner_transmitted). MAIS les fiches affichées/imprimées l'IGNORAIENT :
--   • get_runner_pdf_data imprimait recommended_quantity / quantity_to_move ;
--   • get_runner_sheet recalculait tout depuis les coefficients, sans lire le board.
-- → l'override manuel était un cul-de-sac invisible sur la fiche.
--
-- Correctif : la quantité effective devient coalesce(validated_quantity, calcul).
-- L'override manuel (ligne « validé ») prime partout ; il survit à la
-- régénération (generate_runner_dotations ne supprime que les lignes 'brouillon'
-- et ne réécrit pas une ligne existante). Nouvelle source de dotation : 'manuel'.

-- 1) get_runner_pdf_data (PDF imprimé) --------------------------------------
CREATE OR REPLACE FUNCTION public.get_runner_pdf_data(p_event_id uuid)
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with lignes as (
    select
      s.space_name,
      coalesce(max(apr.legacy_area_name), s.space_name) as libelle,
      s.service_type,
      p.product_name,
      p.category,
      coalesce(apr.product_family,'Autres') as family,
      coalesce(bsl.depot_label,'—') as depot,
      rap.historical_avg_consumption as moy_hist,
      round(coalesce(spc.coefficient,1.0),2) as coeff,
      coalesce(rap.validated_quantity, rap.recommended_quantity) as reco,
      coalesce(rap.validated_quantity, rap.quantity_to_move) as a_monter,
      case coalesce(apr.product_family,'Autres')
        when 'Bière / Fûts' then 1 when 'Vins' then 2 when 'Champagne' then 3
        when 'Softs / Eau / Sirops' then 4 when 'Spiritueux / Apéritifs' then 5
        when 'Gaz / Technique' then 6 else 7 end as family_rank
    from runner_auto_planning rap
    join spaces s on s.space_id = rap.space_id
    join products p on p.product_id = rap.product_id
    left join area_product_reference apr
      on upper(btrim(apr.area_name)) = upper(btrim(s.space_name)) and apr.product_id = rap.product_id
    left join buvette_stock_locations bsl
      on bsl.area_name = s.space_name and bsl.product_family = apr.product_family
    left join space_product_coefficients spc
      on spc.space_id = rap.space_id and spc.product_id = rap.product_id
    where rap.event_id = p_event_id
    group by s.space_name, s.service_type, p.product_name, p.category, apr.product_family,
             bsl.depot_label, rap.historical_avg_consumption, spc.coefficient,
             rap.recommended_quantity, rap.quantity_to_move, rap.validated_quantity
  )
  select json_build_object(
    'event_id', p_event_id,
    'spaces', coalesce(json_agg(sp order by sp->>'space_name'), '[]'::json)
  )
  from (
    select json_build_object(
      'space_name', space_name,
      'libelle', min(libelle),
      'service_type', min(service_type),
      'nb_produits', count(*) filter (where a_monter > 0),
      'total_a_monter', sum(a_monter),
      'lignes', json_agg(json_build_object(
        'family', family, 'product', product_name, 'cat', category,
        'moy_hist', moy_hist, 'coeff', coeff, 'reco', reco,
        'a_monter', a_monter, 'depot', depot
      ) order by family_rank, product_name)
    ) as sp
    from lignes
    group by space_name
  ) grouped;
$function$

;

-- 2) get_runner_sheet (panneau espace / AreaRunnersPanel) -------------------
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
      coalesce(
        rap.validated_quantity,   -- override manuel ROLE_STADE prioritaire (reporting historique faible)
        ceil(
          coalesce(
            spc.avg_consumption, pa.profile_avg_conso,
            case when apr.association_level = 'S'
                 then public.dotation_floor(pr.category, apr.product_family) else 0 end
          ) * 1.20 * v_fill
        )::int
      ) as a_monter,
      case when rap.validated_quantity is not null then 'manuel'
           when spc.avg_consumption is not null then 'reel'
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
    left join runner_auto_planning rap on rap.event_id = p_event_id and rap.space_id = v_space_id and rap.product_id = apr.product_id
    where upper(trim(apr.area_name)) = upper(trim(p_area_name)) and apr.association_level = any(v_levels)
  ) l;
  return v_result;
end $function$

;
