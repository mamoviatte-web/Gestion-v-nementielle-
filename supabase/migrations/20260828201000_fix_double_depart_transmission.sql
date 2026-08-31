-- Correctif : éviter le double départ quand la transmission runner (transfert_espace)
-- a déjà débité le dépôt et pré-rempli initial_qty. on_initial_entered ne débite
-- QUE l'ouverture "directe" (sans transmission préalable pour ce couple).
create or replace function public.on_initial_entered() returns trigger
  language plpgsql set search_path to 'public' as $fn$
declare v_depot uuid; v_to uuid; v_delta int; v_is_keg boolean; v_retains boolean;
begin
  v_delta := coalesce(NEW.initial_qty,0) - coalesce(OLD.initial_qty,0);
  if v_delta <= 0 then return NEW; end if;
  -- Départ déjà fait par la transmission runner (transfert_espace) → ne pas doubler.
  if exists (select 1 from stock_movements m
              where m.event_id=NEW.event_id and m.space_id=NEW.space_id
                and m.product_id=NEW.product_id and m.movement_type='transfert_espace') then
    return NEW;
  end if;
  -- Espace à stock conservé : ouverture = report (area_stocks), pas une sortie dépôt.
  select coalesce(retains_stock,false) into v_retains from spaces where space_id=NEW.space_id;
  if v_retains then return NEW; end if;
  select depot_id into v_depot from product_depot_routing where product_id=NEW.product_id;
  if v_depot is null then return NEW; end if;
  v_to := espace_location_of(NEW.space_id);
  update stock_balances set current_quantity=greatest(0, current_quantity - v_delta), last_movement_at=now()
    where product_id=NEW.product_id and location_id=v_depot;
  insert into stock_movements (event_id, product_id, space_id, from_location_id, to_location_id, movement_type, qty, responsable_nom)
    values (NEW.event_id, NEW.product_id, NEW.space_id, v_depot, v_to, 'sortie', v_delta, coalesce(NEW.responsable_nom,'Ouverture'));
  select product_name ilike '%Fût%' into v_is_keg from products where product_id=NEW.product_id;
  if v_is_keg then
    perform reduce_keg_plein(NEW.product_id, v_delta);
    insert into keg_inventory (product_id, status, qty, volume_liters, event_id, space_id, dispatched_at, responsable_nom)
      values (NEW.product_id, 'en_espace', v_delta,
              (select volume_liters from keg_volume_standards where product_id=NEW.product_id),
              NEW.event_id, NEW.space_id, now(), coalesce(NEW.responsable_nom,'Ouverture'));
  end if;
  return NEW;
end $fn$;
