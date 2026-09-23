-- =====================================================================
-- ÉCHELLE DE CONSO v2 — CONSO ABSOLUE + ÉLASTICITÉ D'AFFLUENCE AMORTIE
-- ---------------------------------------------------------------------
-- Défaut v1 (constaté buvettes, ex. Pepsi Nord EST) : la conso était
-- normalisée « pour 1000 spectateurs » puis RE-PROJETÉE LINÉAIREMENT sur
-- l'affluence. Or une buvette sert une ZONE de capacité fixe : elle consomme
-- ~la même quantité quelle que soit l'affluence TOTALE du stade. Les matchs à
-- faible affluence (Nice 4000, Australie 5500) produisaient une intensité/1000
-- énorme (8,0-8,2 pour Pepsi), et la projeter sur 8500 gonflait le besoin à
-- 53 → 66, alors que la conso réelle max est 45. Sur-dotation ~1,5-2,5×.
--
-- v2 — besoin fondé sur la CONSO RÉELLE :
--   base   = moyenne des consos absolues des matchs clôturés, pondérée récence
--            (0.6^rang) → « ce qui se consomme vraiment ».
--   affluence = facteur AMORTI (élasticité < 1), relatif à l'affluence moyenne
--            des matchs de l'historique, borné [0.7 ; 1.5] :
--            facteur = clamp((pax_prochain / pax_moyen_hist) ^ élasticité)
--            élasticité : buvette 0.30 · bar 0.40 · VIP/salon 0.60 · autre 0.50.
--            (une buvette est zone-bound → peu sensible à l'affluence totale ;
--             un salon VIP l'est davantage.)
--   marge  = sécurité MODESTE : 10 % + 18 %·cv + bonus petit échantillon,
--            bornée [10 % ; 28 %] (au lieu de 45 % en v1).
--   besoin = ceil(base × facteur_affluence × (1 + marge)).
--
-- Résultat attendu (Pepsi Nord EST) : base ~38, facteur ~1.07, marge ~0.14
--   → besoin ~47 (couvre le max réel 45), au lieu de 66. Cohérent, non excessif.
-- Loges inchangées (dotation fixe). Signature & colonnes inchangées.
-- =====================================================================

create or replace function public.runner_demand_scale(p_event_id uuid, p_space_id uuid default null)
returns table(
  space_id uuid, product_id uuid, space_name text, product_name text, category text,
  n_matchs int, intensite_kpax numeric, cv numeric, marge numeric,
  conso_dernier int, conso_projetee int, besoin int, area_stock int, a_monter int, is_loge boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with params as (
    select coalesce(expected_attendees, 0)::numeric as pax from events where event_id = p_event_id
  ),
  loges as (select array[
    'a96044d1-9ab0-45d0-85eb-73672df6ab82',
    '673b6e4e-0f5a-406f-9029-c35b25a38103',
    '8be2956e-a379-4e8e-a3eb-65401bac3c56'
  ]::uuid[] as ids),
  hist as (
    select esl.space_id, esl.product_id, e.event_date,
           (esl.initial_qty + coalesce(esl.reassort_qty, 0) - esl.final_qty)::numeric as conso,
           e.expected_attendees::numeric as pax
    from event_stock_lines esl
    join events e on e.event_id = esl.event_id and e.event_type = 'match'
      and lower(coalesce(e.status, '')) in ('clôturé', 'cloture', 'archivé', 'archive')
      and e.event_id <> p_event_id and coalesce(e.expected_attendees, 0) > 0
    where esl.final_qty is not null
      and (esl.initial_qty + coalesce(esl.reassort_qty, 0) - esl.final_qty) >= 0
  ),
  ranked as (
    select space_id, product_id, conso, pax, event_date,
           row_number() over (partition by space_id, product_id order by event_date desc) as rk,
           count(*)     over (partition by space_id, product_id) as n
    from hist
  ),
  wt as (
    select space_id, product_id, n, conso, pax, power(0.6, rk - 1)::numeric as w,
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
    round(coalesce(m.avg_conso, 0), 1) as intensite_kpax,          -- désormais : conso moyenne absolue
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

grant execute on function public.runner_demand_scale(uuid, uuid) to authenticated;
