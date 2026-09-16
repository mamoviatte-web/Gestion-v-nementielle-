-- =====================================================================
-- GARDE-FOU B — manque_constaté : tracer explicitement un manque dépôt
-- ---------------------------------------------------------------------
-- Quand un acheminé (sortie B+) dépasse le stock dépôt disponible, le dépôt
-- passe négatif (= le manque, déjà visible dans v_stock_audit_negatifs). On
-- ajoute EN PLUS un mouvement 'manque_constaté' (is_anomaly, SANS localisation
-- → n'affecte pas le solde dérivé, purement informatif) au moment exact, pour
-- une trace actionnable + un audit dédié. Aucun écrasement silencieux.
-- =====================================================================

-- 1) Autoriser le nouveau type de mouvement
alter table public.stock_movements drop constraint if exists stock_movements_movement_type_check;
alter table public.stock_movements add constraint stock_movements_movement_type_check
  check (movement_type = any (array[
    'entrée','sortie','réassort','retour','casse','perte','correction','inventaire',
    'entrée_fournisseur','transfert_espace','réassort_événement','retour_réutilisable',
    'consommation','perte_casse','retour_fournisseur','manque_constaté']));

-- 2) Ouverture : ajoute la trace de manque (dépôt insuffisant)
create or replace function public.on_initial_entered()
returns trigger language plpgsql set search_path to 'public'
as $function$
declare v_depot uuid; v_esp uuid; v_amont numeric; v_target int; v_delta int;
        v_is_keg boolean; v_resp text; v_avail numeric;
begin
  if (select event_type from events where event_id=NEW.event_id) = 'séminaire' then return NEW; end if;
  if exists (select 1 from stock_movements m
              where m.event_id=NEW.event_id and m.space_id=NEW.space_id
                and m.product_id=NEW.product_id and m.movement_type='transfert_espace') then
    return NEW;
  end if;

  v_resp   := coalesce(NEW.responsable_nom, 'Ouverture');
  v_target := coalesce(NEW.initial_qty, 0);
  v_depot  := (select depot_id from product_depot_routing where product_id=NEW.product_id);
  v_esp    := espace_location_of(NEW.space_id);
  v_amont  := coalesce((select current_quantity from stock_balances
                        where product_id=NEW.product_id and location_id=v_esp), 0);
  v_delta  := v_target - v_amont;
  if v_delta = 0 then return NEW; end if;
  select (product_name ilike '%Fût%') into v_is_keg from products where product_id=NEW.product_id;

  if v_depot is not null then
    select coalesce(current_quantity,0) into v_avail from stock_balances
      where product_id=NEW.product_id and location_id=v_depot;
    update stock_balances set current_quantity = current_quantity - v_delta, last_movement_at=now()
      where product_id=NEW.product_id and location_id=v_depot;
    if v_delta > 0 and coalesce(v_avail,0) < v_delta then
      insert into stock_movements (event_id, product_id, space_id, movement_type, qty, is_anomaly, responsable_nom)
        values (NEW.event_id, NEW.product_id, NEW.space_id, 'manque_constaté', v_delta - coalesce(v_avail,0), true, v_resp);
    end if;
  end if;
  if v_esp is not null then
    insert into stock_balances (product_id, location_id, current_quantity, last_movement_at, updated_by)
      values (NEW.product_id, v_esp, v_target, now(), v_resp)
      on conflict (product_id, location_id) do update
        set current_quantity=v_target, last_movement_at=now(), updated_by=v_resp;
  end if;

  if v_delta > 0 then
    insert into stock_movements (event_id, product_id, space_id, from_location_id, to_location_id, movement_type, qty, responsable_nom)
      values (NEW.event_id, NEW.product_id, NEW.space_id, v_depot, v_esp, 'sortie', v_delta, v_resp);
    if v_is_keg then
      perform reduce_keg_plein(NEW.product_id, v_delta);
      insert into keg_inventory (product_id, status, qty, volume_liters, event_id, space_id, dispatched_at, responsable_nom)
        values (NEW.product_id, 'en_espace', v_delta,
                (select volume_liters from keg_volume_standards where product_id=NEW.product_id),
                NEW.event_id, NEW.space_id, now(), v_resp);
    end if;
  else
    insert into stock_movements (event_id, product_id, space_id, from_location_id, to_location_id, movement_type, qty, responsable_nom)
      values (NEW.event_id, NEW.product_id, NEW.space_id, v_esp, v_depot, 'retour_réutilisable', -v_delta, v_resp);
  end if;
  return NEW;
end $function$;

-- 3) Réassort : même trace de manque
create or replace function public.on_reassort_updated()
returns trigger language plpgsql set search_path to 'public'
as $function$
declare v_depot uuid; v_esp uuid; v_delta int; v_is_keg boolean; v_resp text; v_avail numeric;
begin
  if (select event_type from events where event_id=NEW.event_id) = 'séminaire' then return NEW; end if;
  v_delta := coalesce(NEW.reassort_qty,0) - coalesce(OLD.reassort_qty,0);
  if v_delta <= 0 then return NEW; end if;
  v_resp  := coalesce(NEW.responsable_nom, 'Réassort');
  v_depot := (select depot_id from product_depot_routing where product_id=NEW.product_id);
  v_esp   := espace_location_of(NEW.space_id);
  select (product_name ilike '%Fût%') into v_is_keg from products where product_id=NEW.product_id;

  if v_depot is not null then
    select coalesce(current_quantity,0) into v_avail from stock_balances
      where product_id=NEW.product_id and location_id=v_depot;
    update stock_balances set current_quantity = current_quantity - v_delta, last_movement_at=now()
      where product_id=NEW.product_id and location_id=v_depot;
    if coalesce(v_avail,0) < v_delta then
      insert into stock_movements (event_id, product_id, space_id, movement_type, qty, is_anomaly, responsable_nom)
        values (NEW.event_id, NEW.product_id, NEW.space_id, 'manque_constaté', v_delta - coalesce(v_avail,0), true, v_resp);
    end if;
  end if;
  if v_esp is not null then
    insert into stock_balances (product_id, location_id, current_quantity, last_movement_at, updated_by)
      values (NEW.product_id, v_esp, v_delta, now(), v_resp)
      on conflict (product_id, location_id) do update
        set current_quantity = stock_balances.current_quantity + v_delta, last_movement_at=now(), updated_by=v_resp;
  end if;
  insert into stock_movements (event_id, product_id, space_id, from_location_id, to_location_id, movement_type, qty, responsable_nom)
    values (NEW.event_id, NEW.product_id, NEW.space_id, v_depot, v_esp, 'réassort_événement', v_delta, v_resp);
  if v_is_keg then
    perform reduce_keg_plein(NEW.product_id, v_delta);
    insert into keg_inventory (product_id, status, qty, volume_liters, event_id, space_id, dispatched_at, responsable_nom)
      values (NEW.product_id, 'en_espace', v_delta,
              (select volume_liters from keg_volume_standards where product_id=NEW.product_id),
              NEW.event_id, NEW.space_id, now(), v_resp);
  end if;
  return NEW;
end $function$;

-- 4) Audit des manques constatés
create or replace view public.v_stock_audit_manques as
select m.movement_id, m.event_id, e.event_name, m.product_id, p.product_name,
       m.space_id, s.space_name, m.qty as manque, m.responsable_nom, m.created_at
from public.stock_movements m
  left join public.events e on e.event_id = m.event_id
  left join public.products p on p.product_id = m.product_id
  left join public.spaces s on s.space_id = m.space_id
where m.movement_type = 'manque_constaté'
order by m.created_at desc;

grant select on public.v_stock_audit_manques to authenticated;
revoke select on public.v_stock_audit_manques from anon;
