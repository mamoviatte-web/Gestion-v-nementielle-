-- =====================================================================
-- CHANTIER 3 — OPTION B+ : débit stockage = ACHEMINÉ = initial − amont
-- ---------------------------------------------------------------------
-- Modèle unifié (fini le cas particulier « gardé » à l'ouverture) :
--   À chaque saisie de stock initial/réassort d'un espace, par produit :
--     amont  = solde ESPACE courant (compteur) = résiduel avant la saisie
--     Δ      = cible − amont            (cible = initial, puis += réassort)
--     dépôt  += (amont − cible)  ⇒ débite l'acheminé (Δ>0) / récupère l'excédent (Δ<0)
--     espace  = cible                  ⇒ l'espace passe de amont → cible
--     mouvement 'sortie' (Δ>0) / 'retour_réutilisable' (Δ<0), double-entrée from/to.
--
-- Double-entrée COMPLÈTE côté espace : la clôture trace désormais la conso et le
-- retour AVEC from_location = espace ⇒ le solde espace dérivé (ancre + Σ flux)
-- colle au compteur. Le socle devient vrai pour dépôts ET espaces.
--
-- Le flag retains_stock ne gouverne plus que la CLÔTURE (le final reste en
-- espace vs retourne au dépôt), plus le débit d'ouverture.
--
-- Prérequis : chaque espace opérationnel a un emplacement 'espace'
-- (area_id renseigné) pour porter la double-entrée.
-- =====================================================================

-- ── 0. Emplacements 'espace' : backfill area_id + provision des manquants ──
update public.stock_locations sl
   set area_id = s.space_id
  from public.spaces s
 where sl.location_type = 'espace' and sl.area_id is null
   and upper(sl.name) like upper(s.space_name) || ' %';

insert into public.stock_locations (name, location_type, area_id, is_active)
select s.space_name || ' — Espace', 'espace', s.space_id, true
from public.spaces s
where s.active
  and coalesce(s.is_operational, false) = false
  and s.space_name <> 'Purge tireuses'
  and not exists (select 1 from public.stock_locations l
                  where l.area_id = s.space_id and l.location_type = 'espace');

-- ── 1. Ouverture — B+ : débit = acheminé = initial − amont (unifié) ───────
create or replace function public.on_initial_entered()
returns trigger language plpgsql set search_path to 'public'
as $function$
declare v_depot uuid; v_esp uuid; v_amont numeric; v_target int; v_delta int;
        v_is_keg boolean; v_resp text;
begin
  if (select event_type from events where event_id=NEW.event_id) = 'séminaire' then return NEW; end if;
  -- transfert inter-espace déjà géré ailleurs → ne pas re-sortir
  if exists (select 1 from stock_movements m
              where m.event_id=NEW.event_id and m.space_id=NEW.space_id
                and m.product_id=NEW.product_id and m.movement_type='transfert_espace') then
    return NEW;
  end if;

  v_resp   := coalesce(NEW.responsable_nom, 'Ouverture');
  v_target := coalesce(NEW.initial_qty, 0);
  v_depot  := (select depot_id from product_depot_routing where product_id=NEW.product_id);
  v_esp    := espace_location_of(NEW.space_id);
  -- amont = solde espace courant (résiduel avant cette saisie) ; idempotent sur édition
  v_amont  := coalesce((select current_quantity from stock_balances
                        where product_id=NEW.product_id and location_id=v_esp), 0);
  v_delta  := v_target - v_amont;
  if v_delta = 0 then return NEW; end if;
  select (product_name ilike '%Fût%') into v_is_keg from products where product_id=NEW.product_id;

  -- Dépôt : += (amont − cible) = −Δ  (débit si Δ>0, crédit excédent si Δ<0)
  if v_depot is not null then
    update stock_balances set current_quantity = current_quantity - v_delta, last_movement_at=now()
      where product_id=NEW.product_id and location_id=v_depot;
  end if;
  -- Espace : passe à la cible (double-entrée + compteur alignés)
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

-- ── 2. Réassort — B+ : acheminé additionnel = Δ réassort (unifié) ─────────
create or replace function public.on_reassort_updated()
returns trigger language plpgsql set search_path to 'public'
as $function$
declare v_depot uuid; v_esp uuid; v_delta int; v_is_keg boolean; v_resp text;
begin
  if (select event_type from events where event_id=NEW.event_id) = 'séminaire' then return NEW; end if;
  v_delta := coalesce(NEW.reassort_qty,0) - coalesce(OLD.reassort_qty,0);
  if v_delta <= 0 then return NEW; end if;
  v_resp  := coalesce(NEW.responsable_nom, 'Réassort');
  v_depot := (select depot_id from product_depot_routing where product_id=NEW.product_id);
  v_esp   := espace_location_of(NEW.space_id);
  select (product_name ilike '%Fût%') into v_is_keg from products where product_id=NEW.product_id;

  if v_depot is not null then
    update stock_balances set current_quantity = current_quantity - v_delta, last_movement_at=now()
      where product_id=NEW.product_id and location_id=v_depot;
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

-- ── 3. Clôture — inchangée SAUF double-entrée espace (from_location) ───────
create or replace function public.on_stock_final_entered()
returns trigger language plpgsql set search_path to 'public'
as $function$
DECLARE
  v_depot uuid; v_consumed int; v_resp text; v_is_keg boolean; v_empty int;
  v_retains boolean; v_loc uuid; v_keep int; v_keep_kegs boolean;
BEGIN
  IF (select event_type from events where event_id=NEW.event_id) = 'séminaire' THEN RETURN NEW; END IF;
  v_resp := COALESCE(NEW.responsable_nom, 'Clôture');
  v_consumed := NEW.initial_qty + COALESCE(NEW.reassort_qty,0) - NEW.final_qty;
  SELECT depot_id INTO v_depot FROM product_depot_routing WHERE product_id=NEW.product_id;
  SELECT (product_name ILIKE '%Fût%') INTO v_is_keg FROM products WHERE product_id=NEW.product_id;
  SELECT COALESCE(retains_stock,false), COALESCE(retain_kegs_in_espace,false)
    INTO v_retains, v_keep_kegs FROM spaces WHERE space_id=NEW.space_id;
  v_loc := espace_location_of(NEW.space_id);   -- double-entrée côté espace

  IF v_is_keg THEN
    DELETE FROM keg_inventory
      WHERE event_id=NEW.event_id AND space_id=NEW.space_id AND product_id=NEW.product_id AND status='en_espace';
    v_empty := GREATEST(0, v_consumed)
             + CASE WHEN NEW.product_state IN ('fût_vide','fût_percuté') THEN NEW.final_qty ELSE 0 END;
    IF v_empty > 0 THEN
      INSERT INTO keg_inventory (product_id, status, qty, volume_liters, event_id, space_id, returned_empty_at, responsable_nom)
        VALUES (NEW.product_id, 'vide', v_empty,
                (SELECT volume_liters FROM keg_volume_standards WHERE product_id=NEW.product_id),
                NEW.event_id, NEW.space_id, now(), v_resp);
    END IF;
    IF v_keep_kegs THEN
      v_keep := CASE WHEN NEW.product_state IN ('cassé','perdu','périmé','fût_vide','fût_percuté')
                     THEN 0 ELSE GREATEST(NEW.final_qty, 0) END;
      INSERT INTO area_stocks (area_id, product_id, current_qty, initial_qty, last_updated, updated_by)
        VALUES (NEW.space_id, NEW.product_id, v_keep, v_keep, now(), v_resp)
        ON CONFLICT (area_id, product_id) DO UPDATE
          SET current_qty=EXCLUDED.current_qty, last_updated=now(), updated_by=v_resp;
      IF v_loc IS NOT NULL THEN
        INSERT INTO stock_balances (product_id, location_id, current_quantity, last_movement_at, updated_by)
          VALUES (NEW.product_id, v_loc, v_keep, now(), v_resp)
          ON CONFLICT (product_id, location_id) DO UPDATE
            SET current_quantity=v_keep, last_movement_at=now(), updated_by=v_resp;
      END IF;
    END IF;
  ELSIF v_retains THEN
    IF NEW.product_state IN ('cassé','perdu','périmé') THEN
      v_keep := 0;
      IF NEW.final_qty > 0 THEN
        INSERT INTO stock_movements (event_id, product_id, space_id, from_location_id, movement_type, qty, is_anomaly, responsable_nom)
          VALUES (NEW.event_id, NEW.product_id, NEW.space_id, v_loc, 'perte_casse', NEW.final_qty, true, v_resp);
      END IF;
    ELSE
      v_keep := GREATEST(NEW.final_qty, 0);
    END IF;
    INSERT INTO area_stocks (area_id, product_id, current_qty, initial_qty, last_updated, updated_by)
      VALUES (NEW.space_id, NEW.product_id, v_keep, v_keep, now(), v_resp)
      ON CONFLICT (area_id, product_id) DO UPDATE
        SET current_qty=EXCLUDED.current_qty, last_updated=now(), updated_by=v_resp;
    IF v_loc IS NOT NULL THEN
      INSERT INTO stock_balances (product_id, location_id, current_quantity, last_movement_at, updated_by)
        VALUES (NEW.product_id, v_loc, v_keep, now(), v_resp)
        ON CONFLICT (product_id, location_id) DO UPDATE
          SET current_quantity=v_keep, last_movement_at=now(), updated_by=v_resp;
    END IF;
  ELSE
    IF NEW.product_state = 'fermé' AND NEW.final_qty > 0 AND v_depot IS NOT NULL THEN
      UPDATE stock_balances SET current_quantity=current_quantity+NEW.final_qty, last_movement_at=now()
        WHERE product_id=NEW.product_id AND location_id=v_depot;
      INSERT INTO stock_movements (event_id, product_id, space_id, from_location_id, to_location_id, movement_type, qty, responsable_nom)
        VALUES (NEW.event_id, NEW.product_id, NEW.space_id, v_loc, v_depot, 'retour_réutilisable', NEW.final_qty, v_resp);
    ELSIF NEW.product_state = 'ouvert' AND NEW.final_qty > 0 AND v_depot IS NOT NULL THEN
      UPDATE stock_balances SET current_quantity=current_quantity+NEW.final_qty,
          opened_quantity=COALESCE(opened_quantity,0)+NEW.final_qty, last_movement_at=now()
        WHERE product_id=NEW.product_id AND location_id=v_depot;
    ELSIF NEW.product_state IN ('cassé','perdu','périmé') AND NEW.final_qty > 0 THEN
      INSERT INTO stock_movements (event_id, product_id, space_id, from_location_id, movement_type, qty, is_anomaly, responsable_nom)
        VALUES (NEW.event_id, NEW.product_id, NEW.space_id, v_loc, 'perte_casse', NEW.final_qty, true, v_resp);
    ELSIF NEW.final_qty > 0 AND v_depot IS NOT NULL THEN
      UPDATE stock_balances SET current_quantity=current_quantity+NEW.final_qty, last_movement_at=now()
        WHERE product_id=NEW.product_id AND location_id=v_depot;
      INSERT INTO stock_movements (event_id, product_id, space_id, from_location_id, to_location_id, movement_type, qty, responsable_nom)
        VALUES (NEW.event_id, NEW.product_id, NEW.space_id, v_loc, v_depot, 'retour_réutilisable', NEW.final_qty, v_resp);
    END IF;
    INSERT INTO area_stocks (area_id, product_id, current_qty, initial_qty, last_updated, updated_by)
      VALUES (NEW.space_id, NEW.product_id, 0, 0, now(), v_resp)
      ON CONFLICT (area_id, product_id) DO UPDATE
        SET current_qty=0, last_updated=now(), updated_by=v_resp;
    IF v_loc IS NOT NULL THEN
      UPDATE stock_balances SET current_quantity=0, last_movement_at=now()
        WHERE product_id=NEW.product_id AND location_id=v_loc;
    END IF;
  END IF;

  IF v_consumed > 0 THEN
    INSERT INTO stock_movements (event_id, product_id, space_id, from_location_id, movement_type, qty, unit_price_ht, responsable_nom)
      SELECT NEW.event_id, NEW.product_id, NEW.space_id, v_loc, 'consommation', v_consumed, p.unit_price_ht, v_resp
      FROM products p WHERE p.product_id=NEW.product_id;
  END IF;
  RETURN NEW;
END; $function$;
