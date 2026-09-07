-- =====================================================================
-- Buvettes EST : maintien AUTOMATIQUE du stock espace à la clôture
-- (y compris les fûts pleins) — Nord EST / EST NORD / EST SUD
-- ---------------------------------------------------------------------
-- Cas exceptionnel (3 buvettes) : à chaque clôture, TOUT le stock final
-- reste dans l'espace, fûts pleins compris.
--
-- Le trigger on_stock_final_entered gère DÉJÀ le report du stock final
-- non-fût en espace pour les retains_stock. Seuls les fûts partaient au
-- circuit keg_inventory. On ajoute un marqueur précis retain_kegs_in_espace
-- (uniquement ces 3 buvettes) et on étend la branche fût pour garder les
-- fûts pleins restants dans le stock espace. Aucun autre espace impacté.
-- =====================================================================

-- 1) Marqueur précis (par défaut false → aucun autre espace touché) ----
alter table spaces add column if not exists retain_kegs_in_espace boolean default false;
comment on column spaces.retain_kegs_in_espace is
  'Exception : à la clôture, les fûts pleins restants restent dans le stock '
  'espace (au lieu du circuit keg_inventory). Réservé aux buvettes EST.';

update spaces set retain_kegs_in_espace = true
where space_name in ('Nord EST','EST NORD','EST SUD');

-- 2) Trigger de clôture : garder les fûts pleins en espace pour ces cas -
create or replace function public.on_stock_final_entered()
returns trigger
language plpgsql
set search_path to 'public'
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
    -- EXCEPTION buvettes EST : les fûts PLEINS restants restent dans le stock espace
    IF v_keep_kegs THEN
      v_keep := CASE WHEN NEW.product_state IN ('cassé','perdu','périmé','fût_vide','fût_percuté')
                     THEN 0 ELSE GREATEST(NEW.final_qty, 0) END;
      v_loc := public._espace_location(NEW.space_id);
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
    v_loc := public._espace_location(NEW.space_id);
    IF NEW.product_state IN ('cassé','perdu','périmé') THEN
      v_keep := 0;
      IF NEW.final_qty > 0 THEN
        INSERT INTO stock_movements (event_id, product_id, space_id, movement_type, qty, is_anomaly, responsable_nom)
          VALUES (NEW.event_id, NEW.product_id, NEW.space_id, 'perte_casse', NEW.final_qty, true, v_resp);
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
      INSERT INTO stock_movements (event_id, product_id, space_id, to_location_id, movement_type, qty, responsable_nom)
        VALUES (NEW.event_id, NEW.product_id, NEW.space_id, v_depot, 'retour_réutilisable', NEW.final_qty, v_resp);
    ELSIF NEW.product_state = 'ouvert' AND NEW.final_qty > 0 AND v_depot IS NOT NULL THEN
      UPDATE stock_balances SET current_quantity=current_quantity+NEW.final_qty,
          opened_quantity=COALESCE(opened_quantity,0)+NEW.final_qty, last_movement_at=now()
        WHERE product_id=NEW.product_id AND location_id=v_depot;
    ELSIF NEW.product_state IN ('cassé','perdu','périmé') AND NEW.final_qty > 0 THEN
      INSERT INTO stock_movements (event_id, product_id, space_id, movement_type, qty, is_anomaly, responsable_nom)
        VALUES (NEW.event_id, NEW.product_id, NEW.space_id, 'perte_casse', NEW.final_qty, true, v_resp);
    ELSIF NEW.final_qty > 0 AND v_depot IS NOT NULL THEN
      UPDATE stock_balances SET current_quantity=current_quantity+NEW.final_qty, last_movement_at=now()
        WHERE product_id=NEW.product_id AND location_id=v_depot;
    END IF;
    INSERT INTO area_stocks (area_id, product_id, current_qty, initial_qty, last_updated, updated_by)
      VALUES (NEW.space_id, NEW.product_id, 0, 0, now(), v_resp)
      ON CONFLICT (area_id, product_id) DO UPDATE
        SET current_qty=0, last_updated=now(), updated_by=v_resp;
    v_loc := public._espace_location(NEW.space_id);
    IF v_loc IS NOT NULL THEN
      UPDATE stock_balances SET current_quantity=0, last_movement_at=now()
        WHERE product_id=NEW.product_id AND location_id=v_loc;
    END IF;
  END IF;

  IF v_consumed > 0 THEN
    INSERT INTO stock_movements (event_id, product_id, space_id, movement_type, qty, unit_price_ht, responsable_nom)
      SELECT NEW.event_id, NEW.product_id, NEW.space_id, 'consommation', v_consumed, p.unit_price_ht, v_resp
      FROM products p WHERE p.product_id=NEW.product_id;
  END IF;
  RETURN NEW;
END; $function$;
