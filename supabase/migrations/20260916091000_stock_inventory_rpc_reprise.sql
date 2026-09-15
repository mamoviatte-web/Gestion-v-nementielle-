-- =====================================================================
-- STOCK — RPC de comptage physique + reprise (Chantier 2, écriture)
-- ---------------------------------------------------------------------
-- record_stock_inventory : LE geste de vérité. Un comptage physique absolu
--   ré-ancre (stock_inventory_counts) ET aligne le compteur cache
--   (stock_balances). Réservé équipe stade. Vaut pour dépôts ET espaces.
-- bootstrap_stock_anchors : reprise initiale — fige le solde compteur actuel
--   comme 1re ancre (idempotent : ne ré-ancre pas ce qui l'est déjà). Établit
--   la ligne de base propre à partir de laquelle la dérivation devient exacte.
-- =====================================================================

create or replace function public.record_stock_inventory(
  p_location uuid, p_product uuid, p_qty numeric,
  p_by text default null, p_note text default null, p_source text default 'comptage'
) returns json
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if auth.uid() is not null and not coalesce(is_stade(), false) then
    return json_build_object('success', false, 'error', 'Réservé équipe stade.');
  end if;
  if p_location is null or p_product is null or p_qty is null or p_qty < 0 then
    return json_build_object('success', false, 'error', 'Emplacement, produit et quantité (≥ 0) requis.');
  end if;

  insert into stock_inventory_counts (location_id, product_id, counted_qty, counted_by, note, source)
    values (p_location, p_product, p_qty, coalesce(p_by,'Comptage'), p_note, coalesce(p_source,'comptage'));

  insert into stock_balances (product_id, location_id, current_quantity, last_movement_at, updated_by)
    values (p_product, p_location, p_qty, now(), coalesce(p_by,'Comptage'))
    on conflict (product_id, location_id) do update
      set current_quantity = excluded.current_quantity,
          last_movement_at = now(), updated_by = excluded.updated_by;

  return json_build_object('success', true, 'location', p_location, 'product', p_product, 'qty', p_qty);
end $function$;

-- Comptage en lot pour UN emplacement : p_counts = [{product_id, qty}]
create or replace function public.record_stock_inventory_batch(
  p_location uuid, p_counts jsonb, p_by text default null, p_note text default null
) returns json
language plpgsql security definer set search_path to 'public'
as $function$
declare v_item jsonb; v_ok int := 0; v_res json;
begin
  if auth.uid() is not null and not coalesce(is_stade(), false) then
    return json_build_object('success', false, 'error', 'Réservé équipe stade.');
  end if;
  if p_counts is null or jsonb_typeof(p_counts) <> 'array' then
    return json_build_object('success', false, 'error', 'Comptage attendu : tableau [{product_id, qty}].');
  end if;
  for v_item in select * from jsonb_array_elements(p_counts) loop
    v_res := record_stock_inventory(p_location,
               nullif(v_item->>'product_id','')::uuid,
               (v_item->>'qty')::numeric,
               coalesce(p_by,'Comptage'), p_note, 'comptage');
    if coalesce((v_res->>'success')::boolean, false) then v_ok := v_ok + 1; end if;
  end loop;
  return json_build_object('success', true, 'comptes_enregistres', v_ok);
end $function$;

-- Reprise initiale : fige le compteur actuel comme 1re ancre là où il n'y en a pas.
create or replace function public.bootstrap_stock_anchors(p_by text default 'reprise_initiale')
returns json
language plpgsql security definer set search_path to 'public'
as $function$
declare v_n int;
begin
  if auth.uid() is not null and not coalesce(is_stade(), false) then
    return json_build_object('success', false, 'error', 'Réservé équipe stade.');
  end if;
  insert into stock_inventory_counts (location_id, product_id, counted_qty, counted_by, note, source)
  select sb.location_id, sb.product_id, greatest(sb.current_quantity,0), p_by,
         'Reprise : solde compteur figé comme ancre initiale', 'reprise_initiale'
  from stock_balances sb
  where not exists (select 1 from stock_inventory_counts c
                    where c.location_id=sb.location_id and c.product_id=sb.product_id);
  get diagnostics v_n = row_count;
  return json_build_object('success', true, 'ancres_creees', v_n);
end $function$;

grant execute on function public.record_stock_inventory(uuid,uuid,numeric,text,text,text) to authenticated;
grant execute on function public.record_stock_inventory_batch(uuid,jsonb,text,text) to authenticated;
grant execute on function public.bootstrap_stock_anchors(text) to authenticated;
