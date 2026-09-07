-- =====================================================================
-- COORDINATION STOCKS ⇄ FICHES RUNNER — SOURCE UNIQUE DE VÉRITÉ
-- ---------------------------------------------------------------------
-- PROBLÈME (durable, structurel) :
--   Le stock ESPACE existait dans DEUX tables désynchronisées —
--     • stock_balances (location_type='espace')  ← source réelle, alimentée
--       par la clôture (on_stock_final_entered), les séminaires, les
--       inventaires et l'affichage « Par espace » ;
--     • area_stocks (area_id/product_id/current_qty) ← mirroir hérité, lu
--       par le générateur de fiches runner (generate_runner_dotations) et
--       le board (colonne figée initial_area_stock).
--   Mes actualisations d'espace n'écrivaient que stock_balances → area_stocks
--   restait périmé (ex. Comptoir/Club70 Sud/Le Pub/Loge Ouest Sud = 0 alors
--   que l'espace réel a du stock ; Nord EST = 179 vs 47 réels). Résultat :
--   la fiche runner affichait ESPACE=0 et sur-calculait « à acheminer ».
--
-- SOLUTION DURABLE = SOURCE UNIQUE :
--   stock_balances(espace) devient l'UNIQUE source de vérité du stock espace.
--   1) Le board runner lit le stock espace EN DIRECT depuis stock_balances
--      (plus de snapshot figé) → ESPACE toujours à jour, quelle que soit la
--      date de génération de la fiche.
--   2) « À acheminer » recalculé EN DIRECT = arrondi_carton(besoin − espace),
--      avec possibilité d'override manuel persistant (manual_qty_to_move).
--   3) area_stocks devient un simple mirroir maintenu AUTOMATIQUEMENT par
--      trigger depuis stock_balances → ne peut plus jamais diverger (le
--      générateur et la fiche loge lisent donc des valeurs cohérentes).
--   Idempotent, ré-exécutable.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Override manuel persistant sur « à acheminer »
-- ---------------------------------------------------------------------
alter table runner_auto_planning
  add column if not exists manual_qty_to_move integer;

comment on column runner_auto_planning.manual_qty_to_move is
  'Override manuel ROLE_STADE de la quantité à acheminer (NULL = valeur auto calculée en direct). Réinitialisé à la régénération de la fiche.';

-- ---------------------------------------------------------------------
-- 2) Helper : stock espace LIVE (source unique = stock_balances espace)
-- ---------------------------------------------------------------------
create or replace function public.espace_stock_qty(p_space uuid, p_product uuid)
returns integer
language sql
stable
set search_path to 'public'
as $$
  select coalesce(sum(b.current_quantity), 0)::int
  from stock_balances b
  join stock_locations l on l.id = b.location_id
  where l.location_type = 'espace' and l.area_id = p_space and b.product_id = p_product;
$$;

-- ---------------------------------------------------------------------
-- 3) Board runner : ESPACE live + à acheminer recalculé en direct
-- ---------------------------------------------------------------------
create or replace view event_runner_board as
with espace as (   -- stock espace LIVE (source unique)
  select l.area_id as space_id, b.product_id, sum(b.current_quantity)::numeric as qty
  from stock_balances b
  join stock_locations l on l.id = b.location_id
  where l.location_type = 'espace'
  group by l.area_id, b.product_id
),
plan as (
  select
    rap.event_id, rap.space_id, rap.product_id,
    coalesce(rap.validated_quantity, rap.recommended_quantity) as needed_qty,
    coalesce(esp.qty, 0) as area_stock_live,
    rap.manual_qty_to_move,
    -- à acheminer AUTO = besoin − stock espace live, arrondi au conditionnement
    arrondi_conditionnement(
      greatest(coalesce(rap.validated_quantity, rap.recommended_quantity) - coalesce(esp.qty, 0), 0),
      coalesce(p.packaging_qty, 1)
    ) as auto_qty,
    rap.validation_status, rap.alert_type, rap.consumption_reference,
    p.product_name, p.category, p.unit_price_ht
  from runner_auto_planning rap
  join event_spaces es on es.event_id = rap.event_id and es.space_id = rap.space_id
  join spaces s2 on s2.space_id = rap.space_id
  left join products p on p.product_id = rap.product_id
  left join espace esp on esp.space_id = rap.space_id and esp.product_id = rap.product_id
),
eff as (
  select *, greatest(coalesce(manual_qty_to_move, auto_qty), 0) as qty_to_move
  from plan
),
reserve as (
  select p_1.product_id,
         case when ktb.product_id is not null then ktb.pleins_theoriques::numeric
              else coalesce(sb.reserve_qty, 0::numeric) end as reserve_qty
  from products p_1
  left join keg_true_balance ktb on ktb.product_id = p_1.product_id
  left join (
    select b.product_id, sum(b.current_quantity) as reserve_qty
    from stock_balances b
    join stock_locations l on l.id = b.location_id
    where l.location_type = 'reserve_centrale'::text
    group by b.product_id
  ) sb on sb.product_id = p_1.product_id
  where ktb.product_id is not null or sb.product_id is not null
),
demand as (
  select event_id, product_id, sum(greatest(qty_to_move, 0)) as event_demand
  from eff
  group by event_id, product_id
)
select
  e.event_id,
  e.space_id,
  s.space_name,
  case when s.service_type = any (array['buvette'::text, 'bar'::text]) then 'Buvettes'::text
       else 'VIP'::text end as family,
  s.service_type,
  e.product_id,
  e.product_name,
  e.category,
  e.needed_qty,
  greatest(e.qty_to_move, 0) as qty_to_move,
  e.area_stock_live::int as area_stock,
  coalesce(res.reserve_qty, 0::numeric) as reserve_qty,
  coalesce(dem.event_demand, 0::bigint) as event_demand,
  round(greatest(e.qty_to_move, 0)::numeric * coalesce(e.unit_price_ht, 0::numeric), 2) as cost_ht,
  e.validation_status,
  e.alert_type,
  coalesce(res.reserve_qty, 0::numeric) >= coalesce(dem.event_demand, 0::bigint)::numeric as stock_sufficient_live,
  greatest(coalesce(dem.event_demand, 0::bigint)::numeric - coalesce(res.reserve_qty, 0::numeric), 0::numeric) as shortfall_qty,
  coalesce(e.consumption_reference, 0::numeric) as consumption_reference
from eff e
join spaces s on s.space_id = e.space_id
left join reserve res on res.product_id = e.product_id
left join demand dem on dem.event_id = e.event_id and dem.product_id = e.product_id;

-- ---------------------------------------------------------------------
-- 4) RPC override manuel : écrit manual_qty_to_move (persistant)
-- ---------------------------------------------------------------------
create or replace function public.set_runner_qty_to_move(
  p_event_id uuid, p_space_id uuid, p_product_id uuid, p_qty integer)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_price numeric;
begin
  if not is_stade() then
    return json_build_object('success', false, 'error', 'forbidden');
  end if;
  if p_qty is null or p_qty < 0 then
    return json_build_object('success', false, 'error', 'invalid_qty');
  end if;

  select unit_price_ht into v_price from products where product_id = p_product_id;

  update runner_auto_planning
     set manual_qty_to_move = p_qty,                 -- override persistant
         quantity_to_move   = p_qty,                 -- miroir (compat historique)
         estimated_cost_ht  = p_qty * coalesce(v_price, 0),
         updated_at         = now()
   where event_id = p_event_id and space_id = p_space_id and product_id = p_product_id;

  if not found then
    return json_build_object('success', false, 'error', 'not_found');
  end if;
  return json_build_object('success', true, 'qty', p_qty);
end $$;

-- ---------------------------------------------------------------------
-- 5) area_stocks = mirroir AUTO de stock_balances(espace) — anti-divergence
-- ---------------------------------------------------------------------
-- Recalcule area_stocks pour un (espace, produit) à partir de la somme
-- stock_balances(espace). SECURITY DEFINER : les clôtures ROLE_RESPONSABLE
-- déclenchent la synchro sans buter sur la RLS d'area_stocks.
create or replace function public.sync_area_stock_from_balances(p_space uuid, p_product uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_qty int;
begin
  if p_space is null or p_product is null then return; end if;
  select coalesce(sum(b.current_quantity), 0)::int into v_qty
  from stock_balances b
  join stock_locations l on l.id = b.location_id
  where l.location_type = 'espace' and l.area_id = p_space and b.product_id = p_product;

  insert into area_stocks(area_id, product_id, current_qty, last_updated, updated_by)
  values (p_space, p_product, v_qty, now(), 'sync stock_balances→area_stocks')
  on conflict (area_id, product_id) do update
     set current_qty = excluded.current_qty,
         last_updated = now(),
         updated_by   = 'sync stock_balances→area_stocks';
end $$;

create or replace function public.trg_sync_area_stock()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_area uuid; v_product uuid;
begin
  -- ne réagit qu'aux mouvements sur une location de type 'espace'
  if tg_op = 'DELETE' then
    select l.area_id into v_area from stock_locations l where l.id = old.location_id and l.location_type = 'espace';
    v_product := old.product_id;
  else
    select l.area_id into v_area from stock_locations l where l.id = new.location_id and l.location_type = 'espace';
    v_product := new.product_id;
  end if;
  if v_area is not null and v_product is not null then
    perform public.sync_area_stock_from_balances(v_area, v_product);
  end if;
  return null;
end $$;

drop trigger if exists trg_stock_balances_sync_area on stock_balances;
create trigger trg_stock_balances_sync_area
  after insert or update or delete on stock_balances
  for each row execute function public.trg_sync_area_stock();

-- ---------------------------------------------------------------------
-- 6) Backfill unique : réaligne area_stocks sur stock_balances(espace)
--    (répare la divergence actuelle Comptoir/Club70 Sud/Le Pub/Nord EST…)
-- ---------------------------------------------------------------------
do $$
declare rec record;
begin
  for rec in
    select l.area_id as space_id, b.product_id
    from stock_balances b
    join stock_locations l on l.id = b.location_id
    where l.location_type = 'espace'
    group by l.area_id, b.product_id
  loop
    perform public.sync_area_stock_from_balances(rec.space_id, rec.product_id);
  end loop;
  -- espaces présents dans area_stocks mais absents de stock_balances(espace) → 0
  for rec in
    select a.area_id as space_id, a.product_id
    from area_stocks a
    where not exists (
      select 1 from stock_balances b
      join stock_locations l on l.id = b.location_id
      where l.location_type = 'espace' and l.area_id = a.area_id and b.product_id = a.product_id
    ) and a.current_qty <> 0
  loop
    perform public.sync_area_stock_from_balances(rec.space_id, rec.product_id);
  end loop;
end $$;
