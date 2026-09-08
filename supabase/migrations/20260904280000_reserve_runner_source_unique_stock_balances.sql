-- =====================================================================
-- FICHES RUNNER — RÉSERVE = SOURCE UNIQUE stock_balances (tous services)
-- ---------------------------------------------------------------------
-- PROBLÈME : sur la fiche runner, la colonne RÉSERVE des FÛTS ne
-- s'actualisait pas comme le reste. Cause : event_runner_board lisait la
-- réserve depuis stock_balances pour tous les produits SAUF les fûts, pour
-- lesquels il lisait un registre parallèle (keg_true_balance). Ce registre
-- n'avait pas capté la livraison Montaner (fûts entrés via register_delivery
-- avant le correctif) → il affichait 62 Fût BUD / 28 LEFFE alors que le
-- stockage réel (stock_balances = keg_summary = vue Stockage Fûts) était
-- 100 / 51. Les vins/spiritueux/softs, eux, lisaient déjà stock_balances et
-- étaient donc corrects.
--
-- SOLUTION OPÉRATIONNELLE — CHEMIN UNIQUE :
--   stock_balances devient LA source de vérité de la réserve pour TOUS les
--   services, alimentée par TOUTES les entrées (réception livraison, inventaire
--   réserve, inventaire espace) et lue directement par la fiche runner.
--   1) event_runner_board.reserve_qty = somme stock_balances(reserve_centrale)
--      pour tout produit — plus de cas particulier fûts.
--   2) record_keg_count (inventaire fûts) répercute désormais le comptage dans
--      stock_balances (au stockage cible du produit) + mouvement 'inventaire'
--      tracé → l'inventaire fûts impacte directement la fiche runner.
--   keg_inventory / keg_summary restent le détail de cycle de vie des fûts
--   (pleins / en espace / vides / retour), aligné sur stock_balances.
--   Idempotent.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) event_runner_board : réserve lue depuis stock_balances pour TOUS
-- ---------------------------------------------------------------------
create or replace view event_runner_board as
with espace as (
  select l.area_id as space_id, b.product_id, sum(b.current_quantity) as qty
  from stock_balances b
  join stock_locations l on l.id = b.location_id
  where l.location_type = 'espace'
  group by l.area_id, b.product_id
),
plan as (
  select rap.event_id, rap.space_id, rap.product_id,
    coalesce(rap.validated_quantity, rap.recommended_quantity) as needed_qty,
    coalesce(esp.qty, 0::numeric) as area_stock_live,
    rap.manual_qty_to_move,
    arrondi_conditionnement(greatest(coalesce(rap.validated_quantity, rap.recommended_quantity)::numeric - coalesce(esp.qty, 0::numeric), 0::numeric), coalesce(p.packaging_qty, 1)) as auto_qty,
    rap.validation_status, rap.alert_type, rap.consumption_reference,
    p.product_name, p.category, p.unit_price_ht
  from runner_auto_planning rap
  join event_spaces es on es.event_id = rap.event_id and es.space_id = rap.space_id
  join spaces s2 on s2.space_id = rap.space_id
  left join products p on p.product_id = rap.product_id
  left join espace esp on esp.space_id = rap.space_id and esp.product_id = rap.product_id
),
eff as (
  select plan.*, greatest(coalesce(plan.manual_qty_to_move, plan.auto_qty), 0) as qty_to_move
  from plan
),
reserve as (   -- SOURCE UNIQUE : stock_balances(reserve_centrale), tous produits
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

-- ---------------------------------------------------------------------
-- 2) record_keg_count : l'inventaire fûts alimente aussi stock_balances
--    (au stockage cible du produit) → impact direct sur la fiche runner.
-- ---------------------------------------------------------------------
create or replace function public.record_keg_count(p_product uuid, p_full integer, p_by text default null, p_note text default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_loc uuid; v_old numeric; v_price numeric;
begin
  if auth.uid() is not null and not coalesce(is_stade(),false) then
    return json_build_object('success',false,'error','Réservé équipe stade.'); end if;
  if p_product is null or p_full is null or p_full < 0 then
    return json_build_object('success',false,'error','Produit et quantité (>=0) requis.'); end if;

  -- comptage physique (baseline keg_summary)
  insert into keg_inventory_counts (product_id, counted_full, counted_by, note)
  values (p_product, p_full, p_by, p_note);

  -- répercussion dans stock_balances au stockage cible (fûts → Stockage Fûts)
  v_loc := public.storage_target_for_delivery(p_product);
  if v_loc is not null then
    select coalesce(sum(current_quantity),0) into v_old from stock_balances where product_id=p_product and location_id=v_loc;
    select unit_price_ht into v_price from products where product_id=p_product;

    insert into stock_balances (product_id, location_id, current_quantity, unit_value_ht, last_movement_at, updated_by)
    values (p_product, v_loc, p_full, v_price, now(), coalesce(p_by,'Inventaire fûts'))
    on conflict (product_id, location_id) do update
      set current_quantity = excluded.current_quantity,
          unit_value_ht    = coalesce(excluded.unit_value_ht, stock_balances.unit_value_ht),
          last_movement_at = now(), updated_by = excluded.updated_by;

    -- trace RG-002 : écart d'inventaire
    insert into stock_movements (product_id, qty, movement_type, to_location_id, unit_price_ht, responsable_nom, event_category)
    values (p_product, (p_full - v_old)::int, 'inventaire', v_loc, v_price, coalesce(p_by,'Inventaire fûts'), 'autre');
  end if;

  return json_build_object('success',true,'product_id',p_product,'counted_full',p_full);
end $function$;
