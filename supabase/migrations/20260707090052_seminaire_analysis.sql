-- 20260707090052 — Analyse Séminaire dédiée (espaces salon/loge/bar, coût/participant).
-- event_type='séminaire' (accent) ; RG-003 : coûts réservés à ROLE_STADE (REVOKE anon).

-- ============================================================================
-- Analyse Séminaire dédiée (espaces salon/loge/bar, coût par participant).
-- event_type = 'séminaire' (AVEC accent — valeur réelle en base / CDC).
-- RG-003 : coûts réservés à ROLE_STADE (authenticated), REVOKE anon.
-- ============================================================================

create or replace view v_seminaire_analysis as
select
  e.event_id, e.event_name, e.status, e.event_date,
  coalesce(e.expected_attendees,0) as participants,
  e.cost_per_pax,
  s.space_id, s.space_name,
  space_profile(s.space_name) as profile,
  p.product_id, p.product_name, p.category,
  (esl.initial_qty + coalesce(esl.reassort_qty,0) - coalesce(esl.final_qty,0)) as conso,
  (esl.initial_qty + coalesce(esl.reassort_qty,0) - coalesce(esl.final_qty,0)) * coalesce(p.unit_price_ht,0) as cout_ht
from events e
join event_stock_lines esl on esl.event_id = e.event_id
join spaces s   on s.space_id = esl.space_id
join products p on p.product_id = esl.product_id
where e.event_type = 'séminaire'
  and coalesce(e.is_simulation,false) = false
  and space_profile(s.space_name) in ('salon','loge','wine_bar','club','bar_pub');

create or replace function get_seminaire_analysis(p_scope text default 'all')
returns json language sql security definer set search_path to 'public' as $$
  with base as (
    select * from v_seminaire_analysis
    where p_scope = 'all' or event_id::text = p_scope
  )
  select json_build_object(
    'kpis', json_build_object(
      'nb_seminaires', (select count(distinct event_id) from base),
      'participants',  (select coalesce(sum(distinct_part),0) from (
                          select distinct event_id, participants as distinct_part from base) x),
      'unites',        (select coalesce(sum(conso),0) from base),
      'cout_ht',       (select coalesce(round(sum(cout_ht)::numeric,2),0) from base),
      'cout_par_participant', (select case when sum(distinct_part)>0
                          then round(sum(c)::numeric / sum(distinct_part),2) else 0 end
                          from (select distinct event_id, participants distinct_part,
                                  (select sum(cout_ht) from base b2 where b2.event_id=b.event_id) c
                                from base b) y)
    ),
    'espaces', (select coalesce(json_agg(json_build_object(
        'space_name', space_name, 'profile', profile,
        'nb_seminaires', nb, 'unites', u, 'cout_ht', c,
        'cout_par_participant', case when part>0 then round(c::numeric/part,2) else 0 end,
        'produit_phare', phare
      ) order by c desc),'[]'::json)
      from (
        select space_name, min(profile) profile,
          count(distinct event_id) nb, sum(conso) u, round(sum(cout_ht)::numeric,2) c,
          sum(distinct participants) part,
          (array_agg(product_name order by cout_ht desc))[1] phare
        from base group by space_name
      ) sp),
    'categories', (select coalesce(json_agg(json_build_object('categorie',category,'unites',u,'cout',c)
        order by c desc),'[]'::json)
      from (select category, sum(conso) u, round(sum(cout_ht)::numeric,2) c
            from base group by category) cat),
    'par_seminaire', (select coalesce(json_agg(json_build_object(
        'event_name', event_name, 'participants', part,
        'cout_ht', c, 'cout_par_participant', case when part>0 then round(c::numeric/part,2) else 0 end,
        'facture_par_participant', cpp,
        'marge_par_participant', case when cpp is not null and part>0 then round(cpp - c::numeric/part,2) end
      ) order by c desc),'[]'::json)
      from (select event_id, min(event_name) event_name, min(participants) part,
              round(sum(cout_ht)::numeric,2) c, min(cost_per_pax) cpp
            from base group by event_id) ev)
  );
$$;

-- RG-003 : jamais aux clients anonymes ; réservé à ROLE_STADE (authenticated).
revoke all on function get_seminaire_analysis(text) from anon;
grant execute on function get_seminaire_analysis(text) to authenticated;
