-- =====================================================================
-- FÛTS EN INVENTAIRE ESPACE — REMISE À ZÉRO DES ESPACES « NON CONSERVÉS »
-- ---------------------------------------------------------------------
-- Constat (match Narbonne, espaces VIP + buvettes + Bodega) : le solde
-- « fûts » de l'emplacement ESPACE reste faux après la clôture.
--   • Salon Sud     : BUD = 2, LEFFE = 1  → c'est le STOCK FINAL conservé à tort
--   • Nord OUEST    : BUD = 10            → c'est le DISPATCH INITIAL jamais soldé
-- Deux valeurs fausses différentes, une seule vérité : la bonne valeur est 0.
--
-- MODÈLE MÉTIER (ce qui doit être « gardé » vs « ramené en stockage fûts ») :
--   Un fût dans un salon VIP / bar / buvette n'est PAS stocké dans l'espace :
--   il est tiré à la pression depuis la RÉSERVE FÛTS centrale (chambre froide).
--   En fin de match :
--     – fût percuté / vide → repart en VIDE (consigne) → keg_inventory 'vide' ;
--     – fût plein non entamé → RAMENÉ en stockage fûts central (réserve).
--   Dans les deux cas, l'espace ne CONSERVE aucun fût → solde espace = 0.
--   Seuls les espaces marqués `retain_kegs_in_espace = true` (buvettes EST avec
--   cave dédiée) gardent leurs fûts sur place d'un match à l'autre.
--
-- DÉFAUT DE CODE (source du bug) : dans on_stock_final_entered(), la branche
-- « fût » n'écrit le solde espace QUE si `retain_kegs_in_espace` est vrai.
-- Il manquait le `ELSE` : quand l'espace ne conserve pas ses fûts, RIEN ne
-- remettait le solde espace à 0. Seul le lot de clôture finalize_event_espace_
-- stocks() le faisait — et seulement pour les espaces retains_stock=true, et
-- seulement à l'instant du passage « clôturé ». D'où :
--   – toute saisie/correction de final APRÈS clôture laissait un fût fantôme ;
--   – les buvettes retains_stock=false (que finalize ignore) n'étaient JAMAIS
--     recalées → le dispatch initial restait affiché.
-- Conséquence : la fiche runner du match suivant lit ce solde espace faux et
-- SOUS-transmet les fûts (croit qu'il en reste sur place).
--
-- CORRECTIF (solidification de bout en bout : clôture → recalage → fiche runner)
--   1. on_stock_final_entered : ajoute le ELSE → espace (area_stocks +
--      stock_balances) = 0 pour tout fût d'un espace non conservé, à CHAQUE
--      saisie/correction de final (plus seulement à la clôture).
--   2. reconcile_non_retained_keg_espace(p_event_id) : opérateur de recalage
--      qui force à 0 tous les soldes fûts espace des espaces non conservés
--      (global si p_event_id NULL, sinon limité aux espaces du match). ROLE_STADE.
--   3. finalize_event_espace_stocks appelle (2) en fin de clôture → filet de
--      sécurité qui couvre AUSSI les buvettes retains_stock=false.
--   4. Recalage immédiat du parc existant (dérive Narbonne) via (2) global.
--
-- RG-002 : recalage d'inventaire (photo de fin de match), pas un mouvement de
-- stock — au même titre que le recalage espaces déjà en place à la clôture.
-- =====================================================================

-- ── 2) Opérateur de recalage des fûts espace non conservés ────────────
create or replace function public.reconcile_non_retained_keg_espace(p_event_id uuid default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_by   text := 'Recalage fûts (retour stockage central)';
  v_sb   int := 0;
  v_area int := 0;
begin
  if auth.uid() is not null and not coalesce(is_stade(), false) then
    return json_build_object('success', false, 'error', 'Action réservée à l''équipe stade.');
  end if;

  -- Solde LIVE de l'emplacement ESPACE (source de la fiche runner).
  with cible as (
    select sb.product_id, sb.location_id
    from stock_balances sb
    join stock_locations loc on loc.id = sb.location_id and loc.location_type = 'espace'
    join spaces s on s.space_id = loc.area_id and coalesce(s.retain_kegs_in_espace, false) = false
    join products p on p.product_id = sb.product_id and p.unit = 'fût'
    where coalesce(sb.current_quantity, 0) <> 0
      and (p_event_id is null
           or loc.area_id in (select space_id from event_spaces where event_id = p_event_id))
  )
  update stock_balances sb
     set current_quantity = 0, last_movement_at = now(), updated_by = v_by
    from cible c
   where sb.product_id = c.product_id and sb.location_id = c.location_id;
  get diagnostics v_sb = row_count;

  -- Base des dotations (area_stocks) : idem, sinon la génération runner
  -- réutiliserait ce socle fantôme.
  with cible as (
    select a.area_id, a.product_id
    from area_stocks a
    join spaces s on s.space_id = a.area_id and coalesce(s.retain_kegs_in_espace, false) = false
    join products p on p.product_id = a.product_id and p.unit = 'fût'
    where coalesce(a.current_qty, 0) <> 0
      and (p_event_id is null
           or a.area_id in (select space_id from event_spaces where event_id = p_event_id))
  )
  update area_stocks a
     set current_qty = 0, initial_qty = 0, last_updated = now(), updated_by = v_by
    from cible c
   where a.area_id = c.area_id and a.product_id = c.product_id;
  get diagnostics v_area = row_count;

  return json_build_object('success', true, 'event_id', p_event_id,
    'soldes_espace_recales', v_sb, 'socles_dotation_recales', v_area);
end;
$function$;

grant execute on function public.reconcile_non_retained_keg_espace(uuid) to authenticated;

-- ── 1) Correctif du chemin LIVE par ligne : on_stock_final_entered ────
-- Ajout du ELSE manquant dans la branche fût : espace = 0 quand l'espace ne
-- conserve pas ses fûts (tirés depuis la réserve centrale, jamais stockés).
create or replace function public.on_stock_final_entered()
 returns trigger
 language plpgsql
 set search_path to 'public'
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
      -- Espace À CAVE DÉDIÉE (buvettes EST) : garde ses fûts pleins sur place.
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
    ELSE
      -- Espace NON CONSERVÉ (VIP, bars, buvettes hors EST) : les fûts sont tirés
      -- depuis la réserve centrale et ne sont JAMAIS stockés dans l'espace. Les
      -- pleins restants repartent en stockage fûts central → solde espace = 0.
      INSERT INTO area_stocks (area_id, product_id, current_qty, initial_qty, last_updated, updated_by)
        VALUES (NEW.space_id, NEW.product_id, 0, 0, now(), v_resp)
        ON CONFLICT (area_id, product_id) DO UPDATE
          SET current_qty=0, initial_qty=0, last_updated=now(), updated_by=v_resp;
      IF v_loc IS NOT NULL THEN
        INSERT INTO stock_balances (product_id, location_id, current_quantity, last_movement_at, updated_by)
          VALUES (NEW.product_id, v_loc, 0, now(), v_resp)
          ON CONFLICT (product_id, location_id) DO UPDATE
            SET current_quantity=0, last_movement_at=now(), updated_by=v_resp;
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

-- ── 3) La clôture appelle le recalage fûts (couvre AUSSI retains_stock=false) ──
create or replace function public.finalize_event_espace_stocks(p_event_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  v_loc uuid;
  v_keep int;
  v_is_keg boolean;
  v_spaces int := 0;
  v_lines int := 0;
  v_by text := 'Clôture (recalage espaces)';
  v_keg json;
begin
  if auth.uid() is not null and not coalesce(is_stade(), false) then
    return json_build_object('success', false, 'error', 'Action réservée à l''équipe stade.');
  end if;

  for r in
    select esl.space_id, esl.product_id, esl.final_qty, esl.product_state,
           coalesce(s.retain_kegs_in_espace, false) as keep_kegs,
           (p.product_name ilike '%Fût%') as is_keg
    from event_stock_lines esl
    join spaces s on s.space_id = esl.space_id and coalesce(s.retains_stock, false) = true
    join products p on p.product_id = esl.product_id
    where esl.event_id = p_event_id and esl.final_qty is not null
  loop
    v_is_keg := r.is_keg;
    if r.product_state in ('cassé', 'perdu', 'périmé') then
      v_keep := 0;
    elsif v_is_keg and (not r.keep_kegs or r.product_state in ('fût_vide', 'fût_percuté')) then
      v_keep := 0;                       -- fûts non gardés en espace / vides
    else
      v_keep := greatest(coalesce(r.final_qty, 0), 0);
    end if;

    insert into area_stocks (area_id, product_id, current_qty, initial_qty, last_updated, updated_by)
    values (r.space_id, r.product_id, v_keep, v_keep, now(), v_by)
    on conflict (area_id, product_id) do update
      set current_qty = excluded.current_qty, initial_qty = excluded.initial_qty,
          last_updated = now(), updated_by = v_by;

    v_loc := espace_location_of(r.space_id);
    if v_loc is not null then
      insert into stock_balances (product_id, location_id, current_quantity, last_movement_at, updated_by)
      values (r.product_id, v_loc, v_keep, now(), v_by)
      on conflict (product_id, location_id) do update
        set current_quantity = excluded.current_quantity, last_movement_at = now(), updated_by = v_by;
    end if;

    v_lines := v_lines + 1;
  end loop;

  -- Filet de sécurité fûts : zéro pour TOUT espace non conservé du match
  -- (y compris les buvettes retains_stock=false que la boucle ci-dessus ignore).
  v_keg := reconcile_non_retained_keg_espace(p_event_id);

  select count(distinct esl.space_id) into v_spaces
  from event_stock_lines esl
  join spaces s on s.space_id = esl.space_id and coalesce(s.retains_stock, false) = true
  where esl.event_id = p_event_id and esl.final_qty is not null;

  return json_build_object('success', true, 'event_id', p_event_id,
    'espaces_recales', v_spaces, 'lignes_recalees', v_lines, 'futs', v_keg);
end;
$function$;

grant execute on function public.finalize_event_espace_stocks(uuid) to authenticated;

-- ── 4) Recalage immédiat du parc existant (dérive Narbonne & autres) ──
select public.reconcile_non_retained_keg_espace(null);
