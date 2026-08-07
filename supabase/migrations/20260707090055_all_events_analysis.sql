-- 20260707090055 — Analyse « Tous événements » (matchs + séminaires agrégés,
-- dissociables par événement clôturé). Vue event_consumption_report généralisée +
-- get_all_analysis (même contrat que get_match_analysis) + get_events_list('tous').
-- RG-003 : coûts jamais exposés à anon/PUBLIC (REVOKE).

-- ============================================================================
-- Analyse « Tous événements » : agrège matchs + séminaires, dissociable par
-- événement clôturé. Même contrat JSON que get_match_analysis.
-- ============================================================================

-- Vue de conso généralisée (tous event_type ; LEFT JOIN event_spaces = robuste).
create or replace view event_consumption_report as
select e.event_id, e.event_name, e.event_date, e.event_type, e.status, e.expected_attendees,
  case when s.service_type='buvette' then 'Grand Public'
       when s.service_type='vip' then 'VIP' else 'Bar' end as consumption_category,
  s.space_id, s.space_name, s.service_type, s.max_pax, es.expected_pax,
  p.product_id, p.product_name, p.category, p.unit, p.unit_price_ht,
  esl.initial_qty, coalesce(esl.reassort_qty,0) as reassort_qty, esl.final_qty,
  (esl.initial_qty + coalesce(esl.reassort_qty,0) - coalesce(esl.final_qty,0)) as consumed_qty,
  case when esl.final_qty is not null and p.unit_price_ht is not null
       then ((esl.initial_qty + coalesce(esl.reassort_qty,0) - esl.final_qty)::numeric * p.unit_price_ht)
       else null end as cost_ht
from event_stock_lines esl
join events e   on e.event_id  = esl.event_id
join spaces s   on s.space_id  = esl.space_id
join products p on p.product_id = esl.product_id
left join event_spaces es on es.event_id = e.event_id and es.space_id = s.space_id;

-- RG-003 : la vue porte des coûts → pas d'accès anonyme direct.
revoke all on event_consumption_report from anon;
revoke all on event_consumption_report from public;

-- Fonction d'analyse tous événements (contrat identique à get_match_analysis).
create or replace function get_all_analysis(p_scope text default 'all')
returns json language sql security definer set search_path to 'public' as $function$
  with base as (
    select * from event_consumption_report
    where status in ('clôturé','archivé')
      and (p_scope='all' or event_id::text = p_scope)
  )
  select json_build_object(
    'scope', p_scope,
    'nb_matchs', (select count(distinct event_id) from base),
    'kpis', json_build_object(
      'unites_consommees', coalesce((select sum(consumed_qty) from base),0),
      'produits_actifs', (select count(distinct product_id) from base where consumed_qty>0),
      'cout_ht', coalesce((select round(sum(cost_ht)::numeric,2) from base),0),
      'taux_retour_moyen', (select case when sum(initial_qty+coalesce(reassort_qty,0))>0
          then round(100.0*sum(coalesce(final_qty,0))/sum(initial_qty+coalesce(reassort_qty,0)),1) else 0 end from base),
      'buvette_active', (select json_build_object('code',space_name,'unites',round(sum(consumed_qty)))
          from base where service_type='buvette' group by space_name order by sum(consumed_qty) desc limit 1)
    ),
    'buvettes', (select coalesce(json_agg(json_build_object(
        'code',space_name,'nb_events',nb,'total_consumed',tc,'total_cost',cc,'top_produit',tp) order by space_name),'[]'::json)
      from (select space_name, count(distinct event_id) nb, round(sum(consumed_qty)) tc,
              round(sum(cost_ht)::numeric,2) cc, (array_agg(product_name order by consumed_qty desc))[1] tp
            from base where service_type='buvette' group by space_name) b),
    'categories', (select coalesce(json_agg(json_build_object('categorie',category,'unites',u) order by u desc),'[]'::json)
      from (select category, round(sum(consumed_qty)) u from base group by category) c),
    'classement', (select coalesce(json_agg(json_build_object(
        'product_name',product_name,'category',category,'total_consumed',tc,
        'taux_retour', case when si>0 then round(100.0*sf/si,0) else 0 end,
        'cout_unitaire', pu, 'nb_events', nb) order by tc desc),'[]'::json)
      from (select product_name, min(category) category, round(sum(consumed_qty)) tc,
              sum(coalesce(final_qty,0)) sf, sum(initial_qty+coalesce(reassort_qty,0)) si,
              max(unit_price_ht) pu, count(distinct event_id) nb
            from base group by product_name) r)
  );
$function$;
revoke execute on function get_all_analysis(text) from public;
revoke execute on function get_all_analysis(text) from anon;
grant  execute on function get_all_analysis(text) to authenticated;

-- get_events_list : ajouter 'tous'/'all' (tous les événements clôturés, tous types).
create or replace function get_events_list(p_type text default 'match')
returns json language sql security definer set search_path to 'public' as $function$
  select coalesce(json_agg(json_build_object(
    'event_id', event_id, 'event_name', event_name, 'event_date', event_date) order by event_date desc),'[]'::json)
  from events
  where status in ('clôturé','archivé')
    and case
      when lower(p_type) in ('tous','all')        then true
      when lower(p_type) in ('seminaire','séminaire') then event_type = 'séminaire'
      else event_type = p_type
    end;
$function$;
