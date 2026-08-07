-- 20260707090051 — Modèle de consommation piloté par l'affluence.
-- VIP/bars = capacité fixe (× fill_ratio) ; buvettes ∝ Grand Public (× ratio GP/GP_REF).
-- Réf. Vannes (GP_REF = 8500 − VIP ouverts à Vannes). Aucun coût exposé (RG-003).
-- event_gp_ratio() renvoie 1.0 si affluence non saisie (pas de zéro sur brouillon).
-- Scaling appliqué aux 3 sources : get_buvette_runner, get_runner_sheet, generate_runner_dotations.

-- ============================================================================
-- Modèle de consommation piloté par l'affluence (VIP capacité fixe / buvettes
-- proportionnelles au Grand Public). Réf. Vannes, base stade 8500.
-- ============================================================================

-- 1) Capacités : PMR = 50 (50 par terrasse PMR). Grandes Tablées / Parvis Nord
--    restent NULL (=0) — à définir/reclasser ultérieurement.
update spaces set max_pax = 50 where space_name = 'PMR' and max_pax is null;

-- 2) fill_ratio par espace activé (VIP ouvert mais non plein). Défaut 1 = plein.
alter table event_spaces add column if not exists fill_ratio numeric not null default 1.0;

-- 3) Config de référence (singleton).
create table if not exists attendance_config (
  id int primary key default 1,
  stadium_total_capacity int not null,
  reference_label text,
  reference_event_id uuid,
  reference_gp_pax int not null,
  updated_at timestamptz default now(),
  check (id = 1)
);

-- reference_gp_pax = Grand Public RÉEL à la référence = 8500 − VIP/bars ACTIVÉS à Vannes.
-- (Vannes n'ouvre pas tous les VIP → calibrage self-consistent : ratio(Vannes) = 1.0.)
insert into attendance_config (id, stadium_total_capacity, reference_label, reference_event_id, reference_gp_pax)
select 1, 8500, 'Vannes', '51efaeb9-fcb0-43b6-8f92-4a8ffb3b3a6c',
       greatest(8500 - coalesce((
         select sum(coalesce(s.max_pax,0) * coalesce(es.fill_ratio,1.0))
         from event_spaces es join spaces s on s.space_id = es.space_id
         where es.event_id = '51efaeb9-fcb0-43b6-8f92-4a8ffb3b3a6c'
           and s.service_type in ('vip','bar')
       ),0), 1)
on conflict (id) do update set
  stadium_total_capacity = excluded.stadium_total_capacity,
  reference_gp_pax       = excluded.reference_gp_pax,
  reference_event_id     = excluded.reference_event_id,
  reference_label        = excluded.reference_label,
  updated_at             = now();

update events set expected_attendees = 8500
 where event_id = '51efaeb9-fcb0-43b6-8f92-4a8ffb3b3a6c';

-- 4) Helper partagé : ratio Grand Public d'un événement (= GP_E / GP_REF).
--    Retourne 1.0 (dotations de référence) si aucune affluence saisie ou pas de config
--    → évite de zéroter les buvettes sur un match brouillon.
create or replace function event_gp_ratio(p_event_id uuid)
returns numeric language sql stable security definer set search_path to 'public' as $$
  select case
    when coalesce(cfg.reference_gp_pax,0) <= 0 then 1.0
    when coalesce(e.expected_attendees,0) <= 0 then 1.0
    else round(greatest(coalesce(e.expected_attendees,0) - v.vip_pax, 0)::numeric / cfg.reference_gp_pax, 4)
  end
  from attendance_config cfg
  left join events e on e.event_id = p_event_id
  cross join lateral (
    select coalesce(sum(coalesce(s.max_pax,0) * coalesce(es.fill_ratio,1.0)),0) as vip_pax
    from event_spaces es join spaces s on s.space_id = es.space_id
    where es.event_id = p_event_id and s.service_type in ('vip','bar')
  ) v
  where cfg.id = 1;
$$;

-- ============================================================================
-- Scaling par affluence appliqué aux 3 sources (cohérence écran + PDF) :
--   buvettes  → × ratio Grand Public (event_gp_ratio)
--   VIP/bars  → × fill_ratio de l'espace sur l'événement (défaut 1 = stable)
-- ============================================================================

-- A) Fiche buvette (écran) : dotation × ratio Grand Public
create or replace function get_buvette_runner(p_buvette_code text, p_event_id uuid, p_show_level text default 'S')
returns json language plpgsql security definer as $$
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
          CASE WHEN apr.association_level='S' THEN
            CASE apr.product_family
              WHEN 'Bière / Fûts' THEN 2 WHEN 'Softs / Eau / Sirops' THEN 12
              WHEN 'Gaz / Technique' THEN 1 ELSE 2 END
          ELSE 0 END
        ) * 1.20 * v_r_gp
      )::int AS a_monter,
      CASE WHEN spc.avg_consumption IS NOT NULL THEN 'reel'
           WHEN pa.profile_avg_conso IS NOT NULL THEN 'profil'
           WHEN apr.association_level='S' THEN 'plancher' ELSE 'option' END AS dotation_source,
      CASE apr.product_family WHEN 'Bière / Fûts' THEN 1 WHEN 'Vins' THEN 2 WHEN 'Champagne' THEN 3
        WHEN 'Softs / Eau / Sirops' THEN 4 WHEN 'Spiritueux / Apéritifs' THEN 5 WHEN 'Gaz / Technique' THEN 6 ELSE 7 END AS family_rank
    FROM area_product_reference apr
    LEFT JOIN buvette_stock_locations bsl ON bsl.area_name=apr.area_name AND bsl.product_family=apr.product_family
    LEFT JOIN space_product_coefficients spc ON spc.space_id=v_space_id AND spc.product_id=apr.product_id
    LEFT JOIN v_buvette_profile_avg pa ON pa.product_id=apr.product_id
    LEFT JOIN event_stock_lines esl ON esl.event_id=p_event_id AND esl.product_id=apr.product_id AND esl.space_id=v_space_id
    WHERE apr.area_name=upper(p_buvette_code) AND apr.association_level = ANY(v_levels)
      AND NOT (upper(p_buvette_code)<>'B8' AND apr.product_family IN ('Vins','Champagne','Spiritueux / Apéritifs'))
  ) l;
  RETURN v_result;
END $$;

-- B) Fiche espace VIP/Terrasses/Bodega (écran) : dotation × fill_ratio de l'espace
create or replace function get_runner_sheet(p_area_name text, p_event_id uuid, p_show_level text default 'S')
returns json language plpgsql security definer as $$
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
          case when apr.association_level = 'S' then
            case apr.product_family
              when 'Bière / Fûts' then 2 when 'Softs / Eau / Sirops' then 12
              when 'Gaz / Technique' then 1 else 2 end
          else 0 end
        ) * 1.20 * v_fill
      )::int as a_monter,
      case when spc.avg_consumption is not null then 'reel'
           when pa.profile_avg_conso is not null then 'profil'
           when apr.association_level = 'S' then 'plancher' else 'option' end as dotation_source,
      case apr.product_family when 'Bière / Fûts' then 1 when 'Vins' then 2 when 'Champagne' then 3
        when 'Softs / Eau / Sirops' then 4 when 'Spiritueux / Apéritifs' then 5
        when 'Gaz / Technique' then 6 else 7 end as family_rank
    from area_product_reference apr
    left join buvette_stock_locations bsl on bsl.area_name = apr.area_name and bsl.product_family = apr.product_family
    left join space_product_coefficients spc on spc.space_id = v_space_id and spc.product_id = apr.product_id
    left join v_profile_avg pa on pa.profile = v_profile and pa.product_id = apr.product_id
    left join event_stock_lines esl on esl.event_id = p_event_id and esl.product_id = apr.product_id and esl.space_id = v_space_id
    where upper(trim(apr.area_name)) = upper(trim(p_area_name)) and apr.association_level = any(v_levels)
  ) l;
  return v_result;
end $$;

-- C) Génération runner_auto_planning (PDF + validation) : scaling par segment
create or replace function generate_runner_dotations(p_event_id uuid)
returns json language plpgsql security definer set search_path to 'public' as $$
declare v_total numeric; v_vip_pax numeric; v_gp_pax numeric; v_ref_gp numeric; v_r_gp numeric; v_count int;
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
  join spaces s on s.space_id=es.space_id and s.active=true and s.space_name not in ('Buvette 1','Buvette 2')
  join area_product_reference apr
       on upper(btrim(apr.area_name))=upper(btrim(s.space_name))
      and apr.association_level='S' and apr.product_id is not null
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
    and not exists (select 1 from runner_auto_planning r
      where r.event_id=p_event_id and r.space_id=s.space_id and r.product_id=apr.product_id);

  get diagnostics v_count = row_count;
  return json_build_object('success',true,'event_id',p_event_id,
    'pax_total',v_total,'vip_pax',v_vip_pax,'grand_public_pax',v_gp_pax,
    'ratio_grand_public',round(v_r_gp,2),'lignes_generees',v_count);
end $$;
