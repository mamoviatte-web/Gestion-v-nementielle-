-- =============================================================================
-- PROPOSITION (NON APPLIQUÉE EN PROD SANS VALIDATION HUMAINE) — Régie Stock
-- Échelle de conso v3.1 : pondération par la COUVERTURE DE CONFIGURATION du match
-- -----------------------------------------------------------------------------
-- Contexte / preuve chiffrée (voir rapport regie_stock_controle.md, objectif 4.2) :
--   Les matchs à configuration réduite (Australie : 10 espaces ouverts, Nice : 9)
--   polluent la base de conso des espaces qui y étaient ouverts, et le plus récent
--   (Australie) entre à poids récence = 1.0. Exemple : Nord OUEST Cristaline projeté
--   à un besoin ~179 alors que la conso réelle EN CONFIG PLEINE 8500 est 89 (Narbonne)
--   / 126 (Agen). Pour un événement cible en config pleine (Aurillac, 25 espaces),
--   c'est une sur-dotation ~40 %.
--
-- Correctif : pondérer chaque match historique par sa couverture relative à la cible
--   cw = LEAST(1, n_espaces_clôturés_du_match / n_espaces_activés_de_la_cible)
--   poids total = 0.6^rang (récence) * cw (représentativité de configuration).
--   => AVANT/APRÈS Nord OUEST Cristaline : moyenne base 143.5 -> 128.2 ; besoin ~179 -> ~150.
--
-- GARDE-FOUS : bornes marge [0.10;0.28] et élasticité [0.7;1.5] STRICTEMENT INCHANGÉES.
--   Base absolue, récence 0.6^rang, gammes exclusives, déduction area_stock, loges :
--   inchangés. Aucune re-projection linéaire par affluence.
--
-- SÉCURITÉ DE DÉPLOIEMENT : fonction A/B SÉPARÉE (runner_demand_scale_cfg), la v3
--   `runner_demand_scale` n'est PAS remplacée. Permet comparaison avant tout basculement.
--   Idempotent (CREATE OR REPLACE). N'appliquer qu'après validation humaine (protocole
--   APPLICATION EN BASE de la charte régie-stock).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.runner_demand_scale_cfg(p_event_id uuid, p_space_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(space_id uuid, product_id uuid, space_name text, product_name text, category text, n_matchs integer, intensite_kpax numeric, cv numeric, marge numeric, conso_dernier integer, conso_projetee integer, besoin integer, area_stock integer, a_monter integer, is_loge boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with params as (
    select coalesce(expected_attendees, 0)::numeric as pax from events where event_id = p_event_id
  ),
  -- Nombre d'espaces activés pour l'événement CIBLE (référence de config pleine).
  target_cfg as (
    select greatest(count(distinct space_id), 1)::numeric as target_spaces
    from event_spaces where event_id = p_event_id
  ),
  -- Couverture de configuration de chaque match historique clôturé.
  match_cfg as (
    select esl.event_id, count(distinct esl.space_id)::numeric as match_spaces
    from event_stock_lines esl
    join events e on e.event_id = esl.event_id and e.event_type = 'match'
      and lower(coalesce(e.status, '')) in ('clôturé', 'cloture', 'archivé', 'archive')
      and coalesce(e.expected_attendees, 0) > 0
    where esl.final_qty is not null
    group by esl.event_id
  ),
  loges as (select array[
    'a96044d1-9ab0-45d0-85eb-73672df6ab82',
    '673b6e4e-0f5a-406f-9029-c35b25a38103',
    '8be2956e-a379-4e8e-a3eb-65401bac3c56'
  ]::uuid[] as ids),
  prod_group as (
    select p.product_id,
           case when coalesce(g.allow_multiple, true) = false then g.id else null end as excl_group
    from products p left join product_selection_groups g on g.id = p.selection_group_id
  ),
  base_lines as (
    select esl.space_id, esl.product_id, e.event_id, e.event_date, e.expected_attendees::numeric as pax,
           (esl.initial_qty + coalesce(esl.reassort_qty, 0) - esl.final_qty)::numeric as conso,
           -- couverture de config, bornée à 1 (un match plus large que la cible ne sur-pondère pas)
           least(1.0, coalesce(mc.match_spaces, tc.target_spaces) / tc.target_spaces) as cw
    from event_stock_lines esl
    join events e on e.event_id = esl.event_id and e.event_type = 'match'
      and lower(coalesce(e.status, '')) in ('clôturé', 'cloture', 'archivé', 'archive')
      and e.event_id <> p_event_id and coalesce(e.expected_attendees, 0) > 0
    cross join target_cfg tc
    left join match_cfg mc on mc.event_id = e.event_id
    where esl.final_qty is not null
      and (esl.initial_qty + coalesce(esl.reassort_qty, 0) - esl.final_qty) >= 0
  ),
  -- Consommation au niveau GAMME (par espace, gamme exclusive, match) — cw hérité du match.
  gamme_lines as (
    select bl.space_id, pg.excl_group, bl.event_date, max(bl.pax) as pax,
           sum(bl.conso) as conso, max(bl.cw) as cw
    from base_lines bl
    join prod_group pg on pg.product_id = bl.product_id
    where pg.excl_group is not null
    group by bl.space_id, pg.excl_group, bl.event_date
  ),
  hist as (
    select bl.space_id, bl.product_id, bl.event_date, bl.pax, bl.conso, bl.cw
    from base_lines bl
    join prod_group pg on pg.product_id = bl.product_id
    where pg.excl_group is null
    union all
    select gl.space_id, pg.product_id, gl.event_date, gl.pax, gl.conso, gl.cw
    from gamme_lines gl
    join prod_group pg on pg.excl_group = gl.excl_group
  ),
  ranked as (
    select space_id, product_id, conso, pax, event_date, cw,
           row_number() over (partition by space_id, product_id order by event_date desc) as rk,
           count(*)     over (partition by space_id, product_id) as n
    from hist
  ),
  wt as (
    -- poids = récence 0.6^rang * couverture de configuration
    select space_id, product_id, n, conso, pax, (power(0.6, rk - 1) * cw)::numeric as w,
           first_value(conso) over (partition by space_id, product_id order by event_date desc) as conso_dernier
    from ranked
  ),
  agg as (
    select space_id, product_id, max(n) as n, max(conso_dernier) as conso_dernier,
           sum(w * conso) / nullif(sum(w), 0) as avg_conso,
           sum(w * pax)   / nullif(sum(w), 0) as avg_pax,
           sum(w * conso * conso) / nullif(sum(w), 0) as e_c2
    from wt group by space_id, product_id
  ),
  scaled as (
    select space_id, product_id, n, conso_dernier, avg_conso, avg_pax,
           case when avg_conso > 0 then sqrt(greatest(e_c2 - avg_conso * avg_conso, 0)) / avg_conso else 0 end as cv
    from agg
  ),
  model as (
    select s.*,
      case when b.service_type = 'buvette' then 0.30
           when b.service_type = 'bar'     then 0.40
           when b.service_type = 'vip'     then 0.60
           else 0.50 end as elasticite,
      least(0.28, greatest(0.10,
        0.10 + 0.18 * s.cv + case when s.n < 2 then 0.12 when s.n < 3 then 0.06 else 0 end)) as marge,
      b.space_name, b.product_name, b.category, b.area_stock, b.product_id as bpid, b.space_id as bsid,
      (b.space_id = any(lg.ids)) as is_loge
    from event_runner_board b
    cross join loges lg
    left join scaled s on s.space_id = b.space_id and s.product_id = b.product_id
    where b.event_id = p_event_id and (p_space_id is null or b.space_id = p_space_id)
  )
  select
    m.bsid, m.bpid, m.space_name, m.product_name, m.category,
    coalesce(m.n, 0) as n_matchs,
    round(coalesce(m.avg_conso, 0), 1) as intensite_kpax,
    round(coalesce(m.cv, 0), 2) as cv,
    round(coalesce(m.marge, 0), 3) as marge,
    coalesce(m.conso_dernier, 0)::int as conso_dernier,
    case when m.avg_conso is not null then
      round(m.avg_conso * least(1.5, greatest(0.7, power((pp.pax / nullif(m.avg_pax, 0)), m.elasticite))))::int
      else 0 end as conso_projetee,
    case when m.avg_conso is not null then
      ceil(m.avg_conso * least(1.5, greatest(0.7, power((pp.pax / nullif(m.avg_pax, 0)), m.elasticite))) * (1 + m.marge))::int
      else null end as besoin,
    coalesce(m.area_stock, 0)::int as area_stock,
    case when m.avg_conso is not null then
      greatest(0, ceil(m.avg_conso * least(1.5, greatest(0.7, power((pp.pax / nullif(m.avg_pax, 0)), m.elasticite))) * (1 + m.marge))::int - coalesce(m.area_stock, 0))
      else null end as a_monter,
    m.is_loge
  from model m
  cross join params pp;
$function$;

-- Vérification A/B suggérée (lecture seule, à exécuter AVANT toute bascule) :
--   select v3.space_name, v3.product_name, v3.besoin as besoin_v3, cfg.besoin as besoin_cfg
--   from runner_demand_scale('<AURILLAC>') v3
--   join runner_demand_scale_cfg('<AURILLAC>') cfg
--     on cfg.space_id = v3.space_id and cfg.product_id = v3.product_id
--   where v3.besoin is distinct from cfg.besoin
--   order by (v3.besoin - cfg.besoin) desc;
