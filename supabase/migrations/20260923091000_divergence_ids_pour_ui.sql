-- =====================================================================
-- reserve_stock_divergence : expose product_id / reserve_id pour l'UI
-- (bouton « Recaler » → reconcile_reserve_count(product, …, reserve)).
-- =====================================================================
drop function if exists public.reserve_stock_divergence();

create or replace function public.reserve_stock_divergence()
returns table(
  reserve_id uuid, reserve_name text, product_id uuid, product_name text, category text,
  stored numeric, ledger_implied numeric, ecart numeric, negatif boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with res as (
    select id, name from stock_locations where location_type = 'reserve_centrale'
  ),
  mv as (
    select m.product_id, r.id as res_id,
           sum(case when m.to_location_id = r.id then m.qty else 0 end)
         - sum(case when m.from_location_id = r.id then m.qty else 0 end) as implied
    from stock_movements m
    join res r on r.id = m.to_location_id or r.id = m.from_location_id
    group by m.product_id, r.id
  ),
  bal as (
    select sb.product_id, sb.location_id as res_id, sb.current_quantity as stored
    from stock_balances sb join res r on r.id = sb.location_id
  )
  select r.id, r.name, p.product_id, p.product_name, p.category,
         coalesce(b.stored, 0), coalesce(m.implied, 0),
         coalesce(b.stored, 0) - coalesce(m.implied, 0) as ecart,
         coalesce(b.stored, 0) < 0 as negatif
  from res r
  join products p on true
  left join bal b on b.res_id = r.id and b.product_id = p.product_id
  left join mv  m on m.res_id = r.id and m.product_id = p.product_id
  where coalesce(b.stored, 0) <> 0 or coalesce(m.implied, 0) <> 0
  order by (coalesce(b.stored,0) < 0) desc, abs(coalesce(b.stored,0) - coalesce(m.implied,0)) desc;
$function$;

grant execute on function public.reserve_stock_divergence() to authenticated;
