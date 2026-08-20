-- ═══════════════════════════════════════════════════════════════════════════
-- Stock conservé par espace entre événements + fiche runner par-level + inventaire.
--
-- Espaces `spaces.retains_stock = true` (VIP + buvettes container Nord EST / EST
-- NORD / EST SUD) : à la clôture, le non-consommé RESTE dans l'espace et devient
-- le stock d'ouverture du match suivant ; la fiche runner ne monte que le
-- complément (cible − déjà présent). Ailleurs : retour au central, espace à 0.
--
-- Source de vérité du « stock déjà présent » = `area_stocks.current_qty` (déjà lue
-- par generate_runner_dotations). On la miroite dans stock_balances de
-- l'emplacement « — Espace » quand il existe (recale la « Qté espace » de l'UI).
-- Les 3 buvettes container n'ont pas d'emplacement stock → area_stocks seule fait foi.
-- ═══════════════════════════════════════════════════════════════════════════

-- Résout l'emplacement stock « <Espace> — Espace » d'un espace (NULL si absent).
CREATE OR REPLACE FUNCTION public._espace_location(p_space uuid)
RETURNS uuid LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT sl.id FROM public.stock_locations sl
   WHERE sl.location_type = 'espace'
     AND upper(sl.name) LIKE upper((SELECT space_name FROM public.spaces WHERE space_id = p_space)) || ' %'
   LIMIT 1;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Clôture : trigger sur event_stock_lines (saisie du final). Étend la logique
-- « fûts pleins gardés » à TOUS les produits des espaces retains_stock.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.on_stock_final_entered()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_depot uuid; v_consumed int; v_resp text; v_is_keg boolean; v_empty int;
  v_retains boolean; v_loc uuid; v_keep int;
BEGIN
  v_resp := COALESCE(NEW.responsable_nom, 'Clôture');
  v_consumed := NEW.initial_qty + COALESCE(NEW.reassort_qty,0) - NEW.final_qty;
  SELECT depot_id INTO v_depot FROM product_depot_routing WHERE product_id=NEW.product_id;
  SELECT (product_name ILIKE '%Fût%') INTO v_is_keg FROM products WHERE product_id=NEW.product_id;
  SELECT COALESCE(retains_stock,false) INTO v_retains FROM spaces WHERE space_id=NEW.space_id;

  IF v_is_keg THEN
    -- résout les fûts « en espace » de cette ligne
    DELETE FROM keg_inventory
      WHERE event_id=NEW.event_id AND space_id=NEW.space_id AND product_id=NEW.product_id AND status='en_espace';
    -- fûts VIDES physiques = consommés (+ éventuels vides/percutés déclarés)
    v_empty := GREATEST(0, v_consumed)
             + CASE WHEN NEW.product_state IN ('fût_vide','fût_percuté') THEN NEW.final_qty ELSE 0 END;
    IF v_empty > 0 THEN
      INSERT INTO keg_inventory (product_id, status, qty, volume_liters, event_id, space_id, returned_empty_at, responsable_nom)
        VALUES (NEW.product_id, 'vide', v_empty,
                (SELECT volume_liters FROM keg_volume_standards WHERE product_id=NEW.product_id),
                NEW.event_id, NEW.space_id, now(), v_resp);
    END IF;
    -- keg_summary est DÉRIVÉ (reçus−consommés−en_espace) : les fûts pleins restants
    -- restent naturellement rattachés à l'espace, conservés compris.
  ELSIF v_retains THEN
    -- ── ESPACE À STOCK CONSERVÉ : le non-consommé reste sur place ──
    v_loc := public._espace_location(NEW.space_id);
    IF NEW.product_state IN ('cassé','perdu','périmé') THEN
      v_keep := 0;  -- détruit : non conservé, tracé en perte
      IF NEW.final_qty > 0 THEN
        INSERT INTO stock_movements (event_id, product_id, space_id, movement_type, qty, is_anomaly, responsable_nom)
          VALUES (NEW.event_id, NEW.product_id, NEW.space_id, 'perte_casse', NEW.final_qty, true, v_resp);
      END IF;
    ELSE
      v_keep := GREATEST(NEW.final_qty, 0);  -- fermé/ouvert : conservé sur place
    END IF;
    -- area_stocks = stock d'ouverture du prochain event (lu par la fiche runner)
    INSERT INTO area_stocks (area_id, product_id, current_qty, initial_qty, last_updated, updated_by)
      VALUES (NEW.space_id, NEW.product_id, v_keep, v_keep, now(), v_resp)
      ON CONFLICT (area_id, product_id) DO UPDATE
        SET current_qty=EXCLUDED.current_qty, last_updated=now(), updated_by=v_resp;
    -- miroir UI : solde de l'emplacement « — Espace » si présent
    IF v_loc IS NOT NULL THEN
      INSERT INTO stock_balances (product_id, location_id, current_quantity, last_movement_at, updated_by)
        VALUES (NEW.product_id, v_loc, v_keep, now(), v_resp)
        ON CONFLICT (product_id, location_id) DO UPDATE
          SET current_quantity=v_keep, last_movement_at=now(), updated_by=v_resp;
    END IF;
  ELSE
    -- ── ESPACE NON CONSERVÉ : retour au central (comportement d'origine) ──
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
    -- l'espace repart à 0
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
END; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Inventaire espace : recale le stock réel d'un espace (traçable, daté).
-- Écrit area_stocks (lu par la fiche runner) + miroir stock_balances (UI) +
-- mouvement 'inventaire'. Réservé ROLE_STADE.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_area_inventory(
  p_space uuid, p_product uuid, p_count numeric, p_by text DEFAULT NULL, p_event uuid DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_loc uuid; v_price numeric;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT COALESCE(is_stade(),false) THEN
    RETURN json_build_object('success',false,'error','Action réservée à l''équipe stade.'); END IF;
  IF p_space IS NULL OR p_product IS NULL OR p_count IS NULL OR p_count < 0 THEN
    RETURN json_build_object('success',false,'error','Espace, produit et quantité (≥ 0) requis.'); END IF;

  -- 1) Stock physique de l'espace — source lue par la fiche runner
  INSERT INTO area_stocks (area_id, product_id, current_qty, initial_qty, last_updated, updated_by)
    VALUES (p_space, p_product, p_count, p_count, now(), p_by)
    ON CONFLICT (area_id, product_id) DO UPDATE
      SET current_qty=EXCLUDED.current_qty, last_updated=now(), updated_by=p_by;

  -- 2) Miroir UI : solde de l'emplacement « — Espace » si présent
  v_loc := public._espace_location(p_space);
  IF v_loc IS NOT NULL THEN
    INSERT INTO stock_balances (product_id, location_id, current_quantity, last_movement_at, updated_by)
      VALUES (p_product, v_loc, p_count, now(), p_by)
      ON CONFLICT (product_id, location_id) DO UPDATE
        SET current_quantity=p_count, last_movement_at=now(), updated_by=p_by;
  END IF;

  -- 3) Traçabilité (qui / quand)
  SELECT unit_price_ht INTO v_price FROM products WHERE product_id=p_product;
  INSERT INTO stock_movements (event_id, product_id, space_id, movement_type, qty, unit_price_ht, responsable_nom, event_category)
    VALUES (p_event, p_product, p_space, 'inventaire', p_count, v_price, COALESCE(p_by,'Inventaire'), 'autre');

  RETURN json_build_object('success',true,'space_id',p_space,'product_id',p_product,'compte',p_count);
END; $$;
GRANT EXECUTE ON FUNCTION public.record_area_inventory(uuid,uuid,numeric,text,uuid) TO authenticated;
