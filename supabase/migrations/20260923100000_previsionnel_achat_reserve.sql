-- =====================================================================
-- PRÉVISIONNEL D'ACHAT RÉSERVE (par match)
-- ---------------------------------------------------------------------
-- Relie l'échelle de consommation au niveau RÉSERVE : pour un match, la fiche
-- runner dit combien sortir de la réserve vers les espaces (« à monter »). On
-- compare cette demande totale au stock réellement en réserve → ce qu'il faut
-- COMMANDER avant le match.
--
--   à commander (produit) = max(0, Σ à_monter(espaces) − stock_réserve)
--
-- Piloté par event_runner_board.qty_to_move (donc conso projetée − reste, cf.
-- échelle de calcul 20260922160000). Coût = à_commander × prix HT (ROLE_STADE).
-- Réservé équipe stade (expose des coûts — RG-003).
-- =====================================================================

create or replace function public.reserve_procurement_forecast(p_event_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_event events%rowtype;
  v_out json;
begin
  if auth.uid() is not null and not coalesce(is_stade(), false) then
    return json_build_object('success', false, 'error', 'Réservé à l''équipe stade.');
  end if;
  select * into v_event from events where event_id = p_event_id;
  if not found then
    return json_build_object('success', false, 'error', 'Événement introuvable.');
  end if;

  with demande as (
    select b.product_id, sum(greatest(b.qty_to_move, 0)) as a_monter
    from event_runner_board b where b.event_id = p_event_id group by b.product_id
  ),
  reserve as (
    select sb.product_id, sum(sb.current_quantity) as en_reserve
    from stock_balances sb
    join stock_locations l on l.id = sb.location_id and l.location_type = 'reserve_centrale'
    group by sb.product_id
  ),
  calc as (
    select p.product_name, p.category,
           coalesce(d.a_monter, 0)::int as a_monter,
           coalesce(r.en_reserve, 0)::int as en_reserve,
           greatest(coalesce(d.a_monter, 0) - coalesce(r.en_reserve, 0), 0)::int as a_commander,
           coalesce(p.unit_price_ht, 0)::numeric as pu_ht,
           round(greatest(coalesce(d.a_monter, 0) - coalesce(r.en_reserve, 0), 0) * coalesce(p.unit_price_ht, 0), 2) as cout_ht
    from demande d
    join products p on p.product_id = d.product_id
    left join reserve r on r.product_id = d.product_id
    where coalesce(d.a_monter, 0) > 0
  )
  select json_build_object(
    'success', true,
    'event_id', p_event_id, 'event_name', v_event.event_name,
    'total_a_commander', (select coalesce(sum(a_commander), 0) from calc),
    'total_cout_ht', (select coalesce(sum(cout_ht), 0) from calc),
    'nb_produits_a_commander', (select count(*) from calc where a_commander > 0),
    'lignes', (
      select coalesce(json_agg(json_build_object(
        'product_name', product_name, 'category', category,
        'a_monter', a_monter, 'en_reserve', en_reserve, 'a_commander', a_commander,
        'pu_ht', pu_ht, 'cout_ht', cout_ht
      ) order by a_commander desc, a_monter desc), '[]'::json)
      from calc where a_commander > 0
    )
  ) into v_out;

  return v_out;
end;
$function$;

grant execute on function public.reserve_procurement_forecast(uuid) to authenticated;
