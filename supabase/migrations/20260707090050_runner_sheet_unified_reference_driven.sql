-- 20260707090050 — Runner unifié piloté par le référentiel CDC (tous espaces).
-- Crée v_profile_avg (fallback moyenne par profil d'espace) et get_runner_sheet
-- (event-aware, cascade réel→profil→plancher socle), généralisation de
-- get_buvette_runner à VIP/Terrasses/Bodega. Aucun coût exposé (RG-003).
-- Familles au singulier « Softs / Eau / Sirops » (aligné sur les données live).

-- Vue fallback : moyenne de conso par PROFIL d'espace (généralise v_buvette_profile_avg)
create or replace view v_profile_avg as
select space_profile(s.space_name) as profile,
       spc.product_id,
       round(avg(spc.avg_consumption)::numeric, 2) as profile_avg_conso
from space_product_coefficients spc
join spaces s on s.space_id = spc.space_id
where spc.avg_consumption > 0
group by space_profile(s.space_name), spc.product_id;

-- Fonction runner unifiée, pilotée par le référentiel (area_product_reference),
-- event-aware, avec cascade de dotation (réel espace -> moyenne profil -> plancher socle).
-- Miroir de get_buvette_runner, généralisé à VIP/Terrasses/Bodega. Aucun coût exposé (RG-003).
create or replace function get_runner_sheet(
  p_area_name text, p_event_id uuid, p_show_level text default 'S'
) returns json language plpgsql security definer as $$
declare v_levels text[]; v_space_id uuid; v_profile text; v_libelle text; v_result json;
begin
  v_levels := case upper(p_show_level)
    when 'S' then array['S'] when 'SR' then array['S','R']
    when 'SRP' then array['S','R','P'] when 'ALL' then array['S','R','P','C'] else array['S'] end;

  select space_id into v_space_id from spaces
    where upper(trim(space_name)) = upper(trim(p_area_name)) limit 1;
  v_profile := space_profile(p_area_name);
  select max(legacy_area_name) into v_libelle from area_product_reference
    where upper(trim(area_name)) = upper(trim(p_area_name));

  select json_build_object(
    'area', p_area_name, 'libelle', coalesce(v_libelle, p_area_name),
    'event_id', p_event_id, 'show_level', upper(p_show_level),
    'lines', coalesce(json_agg(l order by l.family_rank, l.association_level, l.product_name), '[]'::json)
  ) into v_result
  from (
    select apr.product_family, apr.product_name, apr.association_level, apr.is_default,
      apr.product_id,
      bsl.depot_label, bsl.depot_type,
      round(coalesce(spc.coefficient, 1.00)::numeric, 2) as coeff,
      coalesce(spc.avg_consumption, 0) as moy_hist,
      coalesce(esl.initial_qty, 0) as stock_espace,
      -- Cascade : réel espace -> moyenne profil -> plancher (socle seulement)
      ceil(
        coalesce(
          spc.avg_consumption,
          pa.profile_avg_conso,
          case when apr.association_level = 'S' then
            case apr.product_family
              when 'Bière / Fûts' then 2 when 'Softs / Eau / Sirops' then 12
              when 'Gaz / Technique' then 1 else 2 end
          else 0 end
        ) * 1.20
      )::int as a_monter,
      case when spc.avg_consumption is not null then 'reel'
           when pa.profile_avg_conso is not null then 'profil'
           when apr.association_level = 'S' then 'plancher' else 'option' end as dotation_source,
      case apr.product_family when 'Bière / Fûts' then 1 when 'Vins' then 2 when 'Champagne' then 3
        when 'Softs / Eau / Sirops' then 4 when 'Spiritueux / Apéritifs' then 5
        when 'Gaz / Technique' then 6 else 7 end as family_rank
    from area_product_reference apr
    left join buvette_stock_locations bsl
      on bsl.area_name = apr.area_name and bsl.product_family = apr.product_family
    left join space_product_coefficients spc
      on spc.space_id = v_space_id and spc.product_id = apr.product_id
    left join v_profile_avg pa
      on pa.profile = v_profile and pa.product_id = apr.product_id
    left join event_stock_lines esl
      on esl.event_id = p_event_id and esl.product_id = apr.product_id and esl.space_id = v_space_id
    where upper(trim(apr.area_name)) = upper(trim(p_area_name))
      and apr.association_level = any(v_levels)
  ) l;
  return v_result;
end $$;
