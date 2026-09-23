-- =====================================================================
-- SANTÉ DU STOCK — VALORISATION & COUVERTURE (matchs de couverture)
-- ---------------------------------------------------------------------
-- Aucune visibilité n'existait sur la valeur du stock (~48 k€ HT) ni sur le
-- risque de rupture. On calcule, sur le STOCK TOTAL (réserve + espaces — les
-- soldes espace étant comptés physiquement, donc fiables) :
--
--   couverture (matchs) = stock_total / conso_moyenne_par_match
--   statut : rupture (<1) · tendu (1–2) · sain (2–5) · surstock (>5)
--
-- + valorisation par catégorie (stock × prix HT). ROLE_STADE (valeurs, RG-003).
-- Complément du prévisionnel d'achat (par match) : ici, vue générale du parc.
-- =====================================================================

create or replace function public.stock_health_overview()
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_out json;
begin
  if auth.uid() is not null and not coalesce(is_stade(), false) then
    return json_build_object('success', false, 'error', 'Réservé à l''équipe stade.');
  end if;

  with stk as (
    select product_id, sum(current_quantity) as tot
    from stock_balances where current_quantity > 0 group by product_id
  ),
  conso as (
    select l.product_id,
           avg(nullif(l.initial_qty + coalesce(l.reassort_qty, 0) - l.final_qty, 0)) as conso_moy
    from event_stock_lines l
    join events e on e.event_id = l.event_id and e.event_type = 'match'
      and lower(coalesce(e.status, '')) in ('clôturé', 'cloture', 'archivé', 'archive')
    where l.final_qty is not null and (l.initial_qty + coalesce(l.reassort_qty, 0) - l.final_qty) > 0
    group by l.product_id
  ),
  cov as (
    select p.product_id, p.product_name, p.category,
           round(coalesce(c.conso_moy, 0), 1) as conso_moy,
           coalesce(s.tot, 0)::int as stock_total,
           case when coalesce(c.conso_moy, 0) > 0
                then round(coalesce(s.tot, 0) / c.conso_moy, 1) else null end as couverture
    from conso c
    join products p on p.product_id = c.product_id and coalesce(p.active, true)
    left join stk s on s.product_id = c.product_id
    where coalesce(c.conso_moy, 0) > 0
  ),
  classed as (
    select *, case
        when couverture is null then 'rupture'
        when couverture < 1 then 'rupture'
        when couverture < 2 then 'tendu'
        when couverture <= 5 then 'sain'
        else 'surstock' end as statut
    from cov
  )
  select json_build_object(
    'success', true,
    'valeur_totale_ht', (
      select round(coalesce(sum(sb.current_quantity * coalesce(p.unit_price_ht, 0)), 0), 0)
      from stock_balances sb join products p on p.product_id = sb.product_id where sb.current_quantity > 0
    ),
    'valorisation', (
      select coalesce(json_agg(json_build_object(
        'category', category, 'valeur_ht', valeur_ht, 'unites', unites) order by valeur_ht desc), '[]'::json)
      from (
        select p.category,
               round(sum(sb.current_quantity * coalesce(p.unit_price_ht, 0)), 0) as valeur_ht,
               sum(sb.current_quantity)::int as unites
        from stock_balances sb join products p on p.product_id = sb.product_id
        where sb.current_quantity > 0 group by p.category
      ) v
    ),
    'resume', json_build_object(
      'rupture',  (select count(*) from classed where statut = 'rupture'),
      'tendu',    (select count(*) from classed where statut = 'tendu'),
      'sain',     (select count(*) from classed where statut = 'sain'),
      'surstock', (select count(*) from classed where statut = 'surstock')
    ),
    'alertes', (
      select coalesce(json_agg(json_build_object(
        'product_name', product_name, 'category', category, 'conso_moy', conso_moy,
        'stock_total', stock_total, 'couverture', couverture, 'statut', statut
      ) order by coalesce(couverture, -1) asc, conso_moy desc), '[]'::json)
      from classed where statut in ('rupture', 'tendu', 'surstock')
    )
  ) into v_out;

  return v_out;
end;
$function$;

grant execute on function public.stock_health_overview() to authenticated;
