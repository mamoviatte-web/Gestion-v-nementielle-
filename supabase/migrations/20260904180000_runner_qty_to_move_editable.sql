-- =====================================================================
-- Fiches runner : rendre « À acheminer » (quantity_to_move) éditable
-- ---------------------------------------------------------------------
-- L'utilisateur ROLE_STADE peut ajuster la quantité à acheminer par ligne
-- (event/space/product) ; la valeur est persistée dans runner_auto_planning
-- et se reflète immédiatement dans la vue event_runner_board (et le total
-- de la carte via event_runner_space_summary). Le coût estimé est recalculé.
-- Réservé ROLE_STADE (RG-003, écran admin).
-- =====================================================================

create or replace function public.set_runner_qty_to_move(
  p_event_id uuid, p_space_id uuid, p_product_id uuid, p_qty int)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
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
     set quantity_to_move  = p_qty,
         estimated_cost_ht = p_qty * coalesce(v_price, 0),
         updated_at        = now()
   where event_id = p_event_id and space_id = p_space_id and product_id = p_product_id;

  if not found then
    return json_build_object('success', false, 'error', 'not_found');
  end if;
  return json_build_object('success', true, 'qty', p_qty);
end $function$;

grant execute on function public.set_runner_qty_to_move(uuid, uuid, uuid, int) to authenticated;
