-- =====================================================================
-- POINT 1 — CLÔTURE IDEMPOTENTE : le stock final devient corrigeable
-- ---------------------------------------------------------------------
-- Avant : on_stock_final_entered ne se déclenchait qu'à la 1re saisie du final
-- (null→valeur). Corriger le final ensuite enregistrait la valeur mais NE
-- recalculait PAS la bascule (conso / retour dépôt).
--
-- Après : le trigger se déclenche à CHAQUE changement de final. La fonction
-- fait un REVERSE-AND-REAPPLY uniforme :
--   1. si édition (OLD.final non nul) → annule les mouvements de clôture de la
--      ligne (retour_réutilisable / consommation / perte_casse) en inversant
--      leur impact solde via leur from/to, les supprime, et retire les fûts
--      'vide' de cette clôture ;
--   2. ré-applique la clôture avec le NOUVEAU final (logique inchangée).
-- Résultat : corriger un final recalcule proprement conso, retour dépôt, solde
-- espace et vides fûts — sans double-compte. Idempotent.
-- L'ouverture et le réassort étaient déjà corrigeables (triggers incrémentaux).
-- =====================================================================

create or replace function public.on_stock_final_entered()
returns trigger language plpgsql set search_path to 'public'
as $function$
DECLARE
  v_depot uuid; v_consumed int; v_resp text; v_is_keg boolean; v_empty int;
  v_retains boolean; v_loc uuid; v_keep int; v_keep_kegs boolean; m record;
BEGIN
  IF (select event_type from events where event_id=NEW.event_id) = 'séminaire' THEN RETURN NEW; END IF;
  v_resp := COALESCE(NEW.responsable_nom, 'Clôture');
  v_consumed := NEW.initial_qty + COALESCE(NEW.reassort_qty,0) - NEW.final_qty;
  SELECT depot_id INTO v_depot FROM product_depot_routing WHERE product_id=NEW.product_id;
  SELECT (product_name ILIKE '%Fût%') INTO v_is_keg FROM products WHERE product_id=NEW.product_id;
  SELECT COALESCE(retains_stock,false), COALESCE(retain_kegs_in_espace,false)
    INTO v_retains, v_keep_kegs FROM spaces WHERE space_id=NEW.space_id;
  v_loc := espace_location_of(NEW.space_id);

  -- ── ÉTAPE 1 : REVERSE (uniquement si correction d'un final déjà saisi) ──
  IF OLD.final_qty IS NOT NULL THEN
    -- Recompute système d'une clôture EN COURS : on remplace ses mouvements par
    -- les corrigés (audit_logs trace chaque suppression). Autorisation locale.
    perform set_config('app.allow_movement_delete', 'on', true);
    FOR m IN
      SELECT movement_id, from_location_id, to_location_id, qty
      FROM stock_movements
      WHERE event_id=NEW.event_id AND space_id=NEW.space_id AND product_id=NEW.product_id
        AND movement_type IN ('retour_réutilisable','consommation','perte_casse')
    LOOP
      IF m.to_location_id IS NOT NULL THEN
        UPDATE stock_balances SET current_quantity = current_quantity - m.qty, last_movement_at=now()
          WHERE product_id=NEW.product_id AND location_id=m.to_location_id;
      END IF;
      IF m.from_location_id IS NOT NULL THEN
        UPDATE stock_balances SET current_quantity = current_quantity + m.qty, last_movement_at=now()
          WHERE product_id=NEW.product_id AND location_id=m.from_location_id;
      END IF;
    END LOOP;
    DELETE FROM stock_movements
     WHERE event_id=NEW.event_id AND space_id=NEW.space_id AND product_id=NEW.product_id
       AND movement_type IN ('retour_réutilisable','consommation','perte_casse');
    IF v_is_keg THEN
      DELETE FROM keg_inventory
       WHERE event_id=NEW.event_id AND space_id=NEW.space_id AND product_id=NEW.product_id AND status='vide';
    END IF;
  END IF;

  -- ── ÉTAPE 2 : REAPPLIQUER avec le nouveau final ────────────────────────
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

-- Le trigger se déclenche désormais à CHAQUE changement de final (pas seulement null→valeur)
drop trigger if exists trg_stock_final_entered on public.event_stock_lines;
create trigger trg_stock_final_entered
  after update on public.event_stock_lines
  for each row
  when (new.final_qty is not null and (old.final_qty is distinct from new.final_qty))
  execute function public.on_stock_final_entered();
