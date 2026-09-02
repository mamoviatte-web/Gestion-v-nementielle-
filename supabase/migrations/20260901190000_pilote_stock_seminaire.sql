-- Pilote de stock — SÉMINAIRES : la consommation décrémente le stockage de l'espace
-- ============================================================================
-- Modèle métier (retours régisseurs) : sur la partie SÉMINAIRE, un espace tire
-- ses produits de SON PROPRE stockage (emplacement « — Espace »), pas de la
-- réserve. Après la clôture du séminaire, le stockage de l'espace est mis à jour
-- automatiquement : espace −= consommation (le restant reste en place).
-- Choix validés : « espace −= consommation » ; stock insuffisant → plancher à 0
-- + alerte (vue seminaire_stock_shortfalls). La partie MATCH est inchangée.
--
-- 1) Les 3 déclencheurs de cycle de vie (départ/réassort/retour côté réserve+fûts)
--    sont neutralisés POUR LES SÉMINAIRES (garde en tête de fonction). Les matchs
--    conservent exactement leur comportement.
-- 2) Nouveau déclencheur à la clôture d'un séminaire : décrément de l'espace.
-- Idempotent (l'unicité est portée par le mouvement traceur 'Auto — pilote stock séminaire').

-- ── 1) Garde « séminaire » sur les déclencheurs réserve/fûts ────────────────

CREATE OR REPLACE FUNCTION public.on_initial_entered()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
declare v_depot uuid; v_to uuid; v_delta int; v_is_keg boolean; v_retains boolean;
begin
  -- SÉMINAIRE : stock piloté par l'espace (voir on_seminaire_closed), pas la réserve.
  if (select event_type from events where event_id=NEW.event_id) = 'séminaire' then return NEW; end if;
  v_delta := coalesce(NEW.initial_qty,0) - coalesce(OLD.initial_qty,0);
  if v_delta <= 0 then return NEW; end if;
  if exists (select 1 from stock_movements m
              where m.event_id=NEW.event_id and m.space_id=NEW.space_id
                and m.product_id=NEW.product_id and m.movement_type='transfert_espace') then
    return NEW;
  end if;
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
end $function$;

CREATE OR REPLACE FUNCTION public.on_reassort_updated()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE v_depot uuid; v_to uuid; v_delta int; v_is_keg boolean;
BEGIN
  IF (select event_type from events where event_id=NEW.event_id) = 'séminaire' THEN RETURN NEW; END IF;
  v_delta := COALESCE(NEW.reassort_qty,0) - COALESCE(OLD.reassort_qty,0);
  IF v_delta <= 0 THEN RETURN NEW; END IF;
  SELECT depot_id INTO v_depot FROM product_depot_routing WHERE product_id=NEW.product_id;
  IF v_depot IS NULL THEN RETURN NEW; END IF;
  v_to := espace_location_of(NEW.space_id);
  UPDATE stock_balances SET current_quantity=GREATEST(0, current_quantity - v_delta), last_movement_at=now()
    WHERE product_id=NEW.product_id AND location_id=v_depot;
  INSERT INTO stock_movements (event_id, product_id, space_id, from_location_id, to_location_id, movement_type, qty, responsable_nom)
    VALUES (NEW.event_id, NEW.product_id, NEW.space_id, v_depot, v_to, 'réassort_événement', v_delta,
            COALESCE(NEW.responsable_nom, 'Réassort'));
  SELECT product_name ILIKE '%Fût%' INTO v_is_keg FROM products WHERE product_id=NEW.product_id;
  IF v_is_keg THEN
    PERFORM reduce_keg_plein(NEW.product_id, v_delta);
    INSERT INTO keg_inventory (product_id, status, qty, volume_liters, event_id, space_id, dispatched_at, responsable_nom)
      VALUES (NEW.product_id, 'en_espace', v_delta,
              (SELECT volume_liters FROM keg_volume_standards WHERE product_id=NEW.product_id),
              NEW.event_id, NEW.space_id, now(), COALESCE(NEW.responsable_nom,'Réassort'));
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.on_stock_final_entered()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE
  v_depot uuid; v_consumed int; v_resp text; v_is_keg boolean; v_empty int;
  v_retains boolean; v_loc uuid; v_keep int;
BEGIN
  -- SÉMINAIRE : retour/consommation gérés par on_seminaire_closed (espace), pas ici.
  IF (select event_type from events where event_id=NEW.event_id) = 'séminaire' THEN RETURN NEW; END IF;
  v_resp := COALESCE(NEW.responsable_nom, 'Clôture');
  v_consumed := NEW.initial_qty + COALESCE(NEW.reassort_qty,0) - NEW.final_qty;
  SELECT depot_id INTO v_depot FROM product_depot_routing WHERE product_id=NEW.product_id;
  SELECT (product_name ILIKE '%Fût%') INTO v_is_keg FROM products WHERE product_id=NEW.product_id;
  SELECT COALESCE(retains_stock,false) INTO v_retains FROM spaces WHERE space_id=NEW.space_id;

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

-- ── 2) Clôture séminaire → décrément du stockage de l'espace ────────────────

CREATE OR REPLACE FUNCTION public.on_seminaire_closed()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  rec record; v_loc uuid; v_avail int; v_short int;
  closed_pat text[] := array['clôturé','cloture','clôturée','archivé','archive'];
begin
  if NEW.event_type <> 'séminaire' then return NEW; end if;
  -- uniquement à la TRANSITION vers un état clôturé
  if not ( lower(coalesce(NEW.status,'')) = any(closed_pat)
           and lower(coalesce(OLD.status,'')) <> all(closed_pat) ) then
    return NEW;
  end if;
  -- idempotence : déjà piloté ?
  if exists (select 1 from stock_movements
             where event_id=NEW.event_id and responsable_nom='Auto — pilote stock séminaire') then
    return NEW;
  end if;

  for rec in
    select l.space_id, l.product_id, l.consumed_qty::int as consumed
    from event_stock_lines l
    where l.event_id=NEW.event_id and coalesce(l.consumed_qty,0) > 0
  loop
    v_loc := espace_location_of(rec.space_id);
    if v_loc is null then continue; end if;
    select current_quantity::int into v_avail from stock_balances
      where product_id=rec.product_id and location_id=v_loc;
    if v_avail is null then
      insert into stock_balances(product_id, location_id, current_quantity, updated_by)
        values (rec.product_id, v_loc, 0, 'Séminaire '||NEW.event_name);
      v_avail := 0;
    end if;
    v_short := greatest(0, rec.consumed - v_avail);
    -- espace −= consommation, plancher à 0
    update stock_balances
       set current_quantity = greatest(0, current_quantity - rec.consumed),
           last_movement_at = now(), updated_by = 'Séminaire '||NEW.event_name
     where product_id=rec.product_id and location_id=v_loc;
    -- traçabilité (RG-002) ; is_anomaly=true si stockage insuffisant (alerte)
    insert into stock_movements(event_id, product_id, space_id, from_location_id, movement_type,
        qty, is_anomaly, responsable_nom, event_category, status)
      values (NEW.event_id, rec.product_id, rec.space_id, v_loc, 'consommation',
        rec.consumed, (v_short > 0), 'Auto — pilote stock séminaire', 'seminaire', 'validated');
  end loop;
  return NEW;
end $function$;

DROP TRIGGER IF EXISTS trg_seminaire_stock_close ON public.events;
CREATE TRIGGER trg_seminaire_stock_close
  AFTER UPDATE OF status ON public.events
  FOR EACH ROW EXECUTE FUNCTION on_seminaire_closed();

-- ── 3) Vue d'alerte : stockage espace insuffisant sur un séminaire ──────────

CREATE OR REPLACE VIEW public.seminaire_stock_shortfalls AS
SELECT m.event_id, e.event_name, e.event_date,
       m.space_id, s.space_name,
       m.product_id, p.product_name,
       m.qty AS consommation, m.created_at
FROM stock_movements m
JOIN events e   ON e.event_id = m.event_id
JOIN spaces s   ON s.space_id = m.space_id
JOIN products p ON p.product_id = m.product_id
WHERE m.responsable_nom = 'Auto — pilote stock séminaire' AND m.is_anomaly = true;
