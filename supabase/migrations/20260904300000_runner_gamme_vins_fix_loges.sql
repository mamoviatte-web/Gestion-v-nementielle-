-- =====================================================================
-- FICHES RUNNER — GAMME DE VIN : NE PAS DOUBLE-COMPTER DANS LES LOGES
-- ---------------------------------------------------------------------
-- Le netting « par gamme couleur » (20260904290000) déduit le stock espace de
-- TOUTE la couleur. Correct quand la couleur est consolidée sur UNE seule ligne
-- (salons / bars). MAIS les LOGES portent une dotation FIXE par produit : elles
-- ont plusieurs vins de la même couleur en lignes distinctes (ex. Loge Est :
-- Blanc Montaurone + Blanc Galinière). Chaque ligne soustrayait alors le même
-- stock espace de la couleur → double comptage (Loge Est blanc : espace 6
-- déduit 2 fois → à acheminer 17 au lieu de 23).
--
-- CORRECTIF : le netting par gamme ne s'applique que si la couleur n'a QU'UNE
-- ligne runner dans l'espace (cas consolidé, vins interchangeables). Dès qu'il
-- y a plusieurs lignes de la même couleur (dotation loge explicite par produit),
-- on revient au stock espace DU PRODUIT — chaque vin de loge est un produit
-- précis. Idempotent.
-- =====================================================================

create or replace view event_runner_board as
with espace as (
  select l.area_id as space_id, b.product_id, sum(b.current_quantity) as qty
  from stock_balances b
  join stock_locations l on l.id = b.location_id
  where l.location_type = 'espace'
  group by l.area_id, b.product_id
),
espace_gamme as (
  select l.area_id as space_id, pr.selection_group_id, sum(b.current_quantity) as qty
  from stock_balances b
  join stock_locations l on l.id = b.location_id and l.location_type = 'espace'
  join products pr on pr.product_id = b.product_id
  join product_selection_groups g on g.id = pr.selection_group_id and g.allow_multiple = false
  group by l.area_id, pr.selection_group_id
),
gamme_count as (   -- nb de lignes runner de cette gamme exclusive dans (event, espace)
  select rap.event_id, rap.space_id, p.selection_group_id, count(*) as n
  from runner_auto_planning rap
  join products p on p.product_id = rap.product_id
  join product_selection_groups g on g.id = p.selection_group_id and g.allow_multiple = false
  group by rap.event_id, rap.space_id, p.selection_group_id
),
plan as (
  select
    rap.event_id, rap.space_id, rap.product_id,
    coalesce(rap.validated_quantity, rap.recommended_quantity) as needed_qty,
    -- netting gamme UNIQUEMENT si couleur non éclatée (1 ligne) ; sinon produit
    coalesce(case when g.id is not null and gc.n = 1 then eg.qty else esp.qty end, 0::numeric) as area_stock_live,
    rap.manual_qty_to_move,
    arrondi_conditionnement(
      greatest(
        coalesce(rap.validated_quantity, rap.recommended_quantity)::numeric
        - coalesce(case when g.id is not null and gc.n = 1 then eg.qty else esp.qty end, 0::numeric),
        0::numeric),
      coalesce(p.packaging_qty, 1)
    ) as auto_qty,
    rap.validation_status, rap.alert_type, rap.consumption_reference,
    p.product_name, p.category, p.unit_price_ht
  from runner_auto_planning rap
  join event_spaces es on es.event_id = rap.event_id and es.space_id = rap.space_id
  join spaces s2 on s2.space_id = rap.space_id
  left join products p on p.product_id = rap.product_id
  left join product_selection_groups g on g.id = p.selection_group_id and g.allow_multiple = false
  left join gamme_count gc on gc.event_id = rap.event_id and gc.space_id = rap.space_id and gc.selection_group_id = p.selection_group_id
  left join espace esp on esp.space_id = rap.space_id and esp.product_id = rap.product_id
  left join espace_gamme eg on eg.space_id = rap.space_id and eg.selection_group_id = p.selection_group_id
),
eff as (
  select plan.*, greatest(coalesce(plan.manual_qty_to_move, plan.auto_qty), 0) as qty_to_move
  from plan
),
reserve as (
  select b.product_id, sum(b.current_quantity) as reserve_qty
  from stock_balances b
  join stock_locations l on l.id = b.location_id
  where l.location_type = 'reserve_centrale'
  group by b.product_id
),
demand as (
  select eff.event_id, eff.product_id, sum(greatest(eff.qty_to_move, 0)) as event_demand
  from eff
  group by eff.event_id, eff.product_id
)
select
  e.event_id, e.space_id, s.space_name,
  case when s.service_type = any (array['buvette'::text, 'bar'::text]) then 'Buvettes'::text else 'VIP'::text end as family,
  s.service_type, e.product_id, e.product_name, e.category,
  e.needed_qty,
  greatest(e.qty_to_move, 0) as qty_to_move,
  e.area_stock_live::integer as area_stock,
  coalesce(res.reserve_qty, 0::numeric) as reserve_qty,
  coalesce(dem.event_demand, 0::bigint) as event_demand,
  round(greatest(e.qty_to_move, 0)::numeric * coalesce(e.unit_price_ht, 0::numeric), 2) as cost_ht,
  e.validation_status, e.alert_type,
  coalesce(res.reserve_qty, 0::numeric) >= coalesce(dem.event_demand, 0::bigint)::numeric as stock_sufficient_live,
  greatest(coalesce(dem.event_demand, 0::bigint)::numeric - coalesce(res.reserve_qty, 0::numeric), 0::numeric) as shortfall_qty,
  coalesce(e.consumption_reference, 0::numeric) as consumption_reference
from eff e
join spaces s on s.space_id = e.space_id
left join reserve res on res.product_id = e.product_id
left join demand dem on dem.event_id = e.event_id and dem.product_id = e.product_id;
