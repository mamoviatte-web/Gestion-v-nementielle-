-- =====================================================================
-- FAILLE « LIVE = DERNIER MATCH » — GARDE-FOU + RÉPARATION + PROTOCOLE CLÔTURE
-- ---------------------------------------------------------------------
-- FAILLE RÉVÉLÉE : derive_and_apply_espace_finals a été appliquée sur Australie
-- (2026-09-19), match ANTÉRIEUR à Aurillac (2026-09-25). Le trigger de clôture
-- on_stock_final_entered met à jour le stock LIVE (area_stocks / stock_balances
-- espace / keg_inventory) SANS condition de récence → il a RÉGRESSÉ le live de
-- 3 couples espace×produit qui devaient refléter Aurillac (dernier match) :
--     EST NORD · Fût Goose Island IPA : live 1  → doit être 2  (final Aurillac)
--     EST SUD  · Fût Hoegaarden Blanche: live 0 → doit être 3  (final Aurillac)
--     Nord EST · Fût Hoegaarden Blanche: live 1 → doit être 0  (final Aurillac)
-- (Les 4 autres lignes dérivées Australie n'ont PAS régressé : valeurs identiques
--  au dernier match, ou espaces non conservés = 0 dans les deux cas.)
-- Les finals Australie dérivés (final_is_derived=true) restent OK comme HISTORIQUE.
--
-- PRINCIPE DE VÉRITÉ : le stock LIVE d'un espace (area_stocks + stock_balances
-- espace) doit refléter le DERNIER match clôturé où ce couple a un final. Un
-- final saisi/dérivé sur un match ANTÉRIEUR ne doit JAMAIS toucher le live —
-- seulement l'historique (la ligne event_stock_lines).
--
-- CE QUE FAIT CETTE MIGRATION (idempotente, aucune écriture prod ici) :
--   1. on_stock_final_entered : GARDE-FOU RÉCENCE — pour un match ANTÉRIEUR au
--      dernier match clôturé (par espace×produit), on stocke le final HISTORIQUE
--      et on RETOURNE sans muter le live. Comportement normal (clôture du dernier
--      match) strictement inchangé.
--   2. reanchor_espace_live_to_last_match(p_space_id, p_product_id, p_dry_run) :
--      opérateur de RÉPARATION sanctionné, ré-ancre area_stocks + stock_balances
--      espace sur le final du DERNIER match clôturé, PUIS réaligne keg_inventory
--      (reconcile_keg_inventory_to_truth). Scope SÛR par défaut = uniquement les
--      couples clobberés par une dérivation antérieure (footprint du bug).
--   3. reconcile_event_closure(p_event_id, p_by, p_dry_run) : RPC unique de
--      clôture qui orchestre la réconciliation de bout en bout (voir MISSION 2).
-- =====================================================================


-- ── 1) GARDE-FOU RÉCENCE dans le trigger de clôture ───────────────────
create or replace function public.on_stock_final_entered()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
DECLARE
  v_depot uuid; v_consumed int; v_resp text; v_is_keg boolean; v_empty int;
  v_retains boolean; v_loc uuid; v_keep int; v_keep_kegs boolean; m record;
  v_is_match boolean;
BEGIN
  IF (select event_type from events where event_id=NEW.event_id) = 'séminaire' THEN RETURN NEW; END IF;

  -- ── GARDE-FOU RÉCENCE : le stock LIVE ne reflète QUE le dernier match ──
  -- Si NEW est un match ANTÉRIEUR à un autre match clôturé ayant déjà un final
  -- pour ce couple espace×produit, on conserve le final HISTORIQUE (la ligne)
  -- mais on NE TOUCHE PAS au live (area_stocks / stock_balances / keg_inventory /
  -- mouvements). Empêche toute régression du live par une saisie/dérivation d'un
  -- match passé. La clôture du dernier match reste inchangée (aucun match plus récent).
  v_is_match := (select event_type from events where event_id=NEW.event_id) = 'match';
  IF v_is_match AND EXISTS (
    SELECT 1
    FROM event_stock_lines esl2
    JOIN events e2 ON e2.event_id = esl2.event_id
     AND e2.event_type = 'match'
     AND lower(coalesce(e2.status,'')) IN ('clôturé','cloture','archivé','archive')
    WHERE esl2.space_id = NEW.space_id
      AND esl2.product_id = NEW.product_id
      AND esl2.event_id <> NEW.event_id
      AND esl2.final_qty IS NOT NULL
      AND e2.event_date > (SELECT event_date FROM events WHERE event_id = NEW.event_id)
  ) THEN
    RETURN NEW;   -- match antérieur → historique conservé, LIVE inchangé
  END IF;

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
      -- Espace NON CONSERVÉ : fûts tirés depuis la réserve centrale, jamais stockés
      -- dans l'espace. Les pleins restants repartent en stockage fûts → solde espace = 0.
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


-- ── 2) RÉPARATION : ré-ancrage du live sur le dernier match ───────────
--  Scope SÛR par défaut = uniquement les couples espace×produit clobberés par une
--  dérivation ANTÉRIEURE (final_is_derived posé sur un match plus ancien que le
--  dernier match à final). Scope explicite possible via p_space_id + p_product_id.
--  N'agit QUE là où le live diffère de la cible → idempotent (rejeu = 0 changement).
create or replace function public.reanchor_espace_live_to_last_match(
  p_space_id   uuid    default null,
  p_product_id uuid    default null,
  p_dry_run    boolean default true
) returns json
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_by text := 'Ré-ancrage live → dernier match (réparation)';
  v_rows json; v_applied int := 0; r record;
begin
  if auth.uid() is not null and not coalesce(is_stade(), false) then
    return json_build_object('success', false, 'error', 'Action réservée à l''équipe stade.');
  end if;

  create temporary table if not exists _reanchor_tmp (space_id uuid, product_id uuid) on commit drop;
  truncate _reanchor_tmp;

  insert into _reanchor_tmp (space_id, product_id)
  select distinct z.space_id, z.product_id from (
    -- footprint du bug : couple ayant un final dérivé sur un match antérieur au dernier match à final
    select da.space_id, da.product_id
    from (select distinct space_id, product_id from event_stock_lines where final_is_derived = true) da
    where exists (
      select 1 from event_stock_lines e_l
      join events ev on ev.event_id = e_l.event_id and ev.event_type='match'
        and lower(coalesce(ev.status,'')) in ('clôturé','cloture','archivé','archive')
      where e_l.space_id = da.space_id and e_l.product_id = da.product_id and e_l.final_qty is not null
        and ev.event_date > (
          select max(ev2.event_date) from event_stock_lines e2
          join events ev2 on ev2.event_id = e2.event_id
          where e2.space_id = da.space_id and e2.product_id = da.product_id and e2.final_is_derived = true)
    )
    union all
    -- scope explicite : couple précis fourni par l'opérateur
    select p_space_id, p_product_id where p_space_id is not null and p_product_id is not null
  ) z
  where (p_space_id is null or z.space_id = p_space_id)
    and (p_product_id is null or z.product_id = p_product_id);

  -- Cible = final du DERNIER match clôturé, routé selon retain/keg (= ce qui doit
  -- physiquement RESTER en espace après le dernier match).
  with last as (
    select distinct on (esl.space_id, esl.product_id)
      esl.space_id, esl.product_id, esl.final_qty, esl.product_state, e.event_name
    from event_stock_lines esl
    join _reanchor_tmp t on t.space_id = esl.space_id and t.product_id = esl.product_id
    join events e on e.event_id = esl.event_id and e.event_type='match'
      and lower(coalesce(e.status,'')) in ('clôturé','cloture','archivé','archive')
    where esl.final_qty is not null
    order by esl.space_id, esl.product_id, e.event_date desc
  ),
  cible as (
    select l.space_id, l.product_id, s.space_name, p.product_name, l.event_name dernier_match,
      case when p.product_name ilike '%Fût%' and not coalesce(s.retain_kegs_in_espace,false) then 0
           when p.product_name not ilike '%Fût%' and not coalesce(s.retains_stock,false) then 0
           when l.product_state in ('cassé','perdu','périmé','fût_vide','fût_percuté') then 0
           else greatest(coalesce(l.final_qty,0),0) end as desired_live
    from last l join spaces s on s.space_id=l.space_id join products p on p.product_id=l.product_id
  )
  select json_agg(json_build_object(
      'espace', c.space_name, 'produit', c.product_name, 'dernier_match', c.dernier_match,
      'live_avant', coalesce(a.current_qty,0), 'live_apres', c.desired_live
    ) order by c.space_name, c.product_name)
  into v_rows
  from cible c
  left join area_stocks a on a.area_id=c.space_id and a.product_id=c.product_id
  where coalesce(a.current_qty,0) <> c.desired_live;

  if coalesce(p_dry_run, true) then
    return json_build_object('success', true, 'mode', 'dry_run',
      'couples_a_corriger', coalesce(v_rows,'[]'::json),
      'note', 'Aucune écriture. Relancer avec p_dry_run := false pour appliquer.');
  end if;

  -- APPLICATION : recalage d'inventaire (photo), même classe que
  -- reconcile_non_retained_keg_espace / finalize_event_espace_stocks.
  for r in
    with last as (
      select distinct on (esl.space_id, esl.product_id)
        esl.space_id, esl.product_id, esl.final_qty, esl.product_state
      from event_stock_lines esl
      join _reanchor_tmp t on t.space_id = esl.space_id and t.product_id = esl.product_id
      join events e on e.event_id = esl.event_id and e.event_type='match'
        and lower(coalesce(e.status,'')) in ('clôturé','cloture','archivé','archive')
      where esl.final_qty is not null
      order by esl.space_id, esl.product_id, e.event_date desc
    )
    select l.space_id, l.product_id,
      case when p.product_name ilike '%Fût%' and not coalesce(s.retain_kegs_in_espace,false) then 0
           when p.product_name not ilike '%Fût%' and not coalesce(s.retains_stock,false) then 0
           when l.product_state in ('cassé','perdu','périmé','fût_vide','fût_percuté') then 0
           else greatest(coalesce(l.final_qty,0),0) end as desired_live,
      espace_location_of(l.space_id) as loc
    from last l join spaces s on s.space_id=l.space_id join products p on p.product_id=l.product_id
  loop
    update area_stocks set current_qty = r.desired_live, initial_qty = r.desired_live,
           last_updated = now(), updated_by = v_by
     where area_id = r.space_id and product_id = r.product_id
       and coalesce(current_qty,0) <> r.desired_live;
    if found then v_applied := v_applied + 1; end if;

    if r.loc is not null then
      update stock_balances set current_quantity = r.desired_live, last_movement_at = now(), updated_by = v_by
       where product_id = r.product_id and location_id = r.loc
         and coalesce(current_quantity,0) <> r.desired_live;
    end if;
  end loop;

  -- Réaligne le registre unité keg_inventory sur area_stocks (autorité).
  perform public.reconcile_keg_inventory_to_truth(null);

  return json_build_object('success', true, 'mode', 'applied',
    'couples_corriges', v_applied, 'detail', coalesce(v_rows,'[]'::json));
end;
$fn$;

grant execute on function public.reanchor_espace_live_to_last_match(uuid, uuid, boolean) to authenticated;


-- ── 3) RPC UNIQUE DE CLÔTURE (orchestration — MISSION 2) ──────────────
--  Navigue chaque espace et chaque zone de dépôt, réconcilie à partir du consommé
--  vs ce qui doit RESTER, en respectant récence (live=dernier match), retain/non-retain,
--  et sans rien inventer côté dépôts (ancrages périmés signalés, pas corrigés).
create or replace function public.reconcile_event_closure(
  p_event_id uuid,
  p_by       text    default 'Clôture (réconciliation)',
  p_dry_run  boolean default true
) returns json
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_status text; v_type text;
  v_derive json; v_nonret_keg json; v_nonret json; v_keginv json; v_reanchor json;
  v_anchors json; v_audit json;
begin
  if auth.uid() is not null and not coalesce(is_stade(), false) then
    return json_build_object('success', false, 'error', 'Action réservée à l''équipe stade.');
  end if;
  select lower(coalesce(status,'')), event_type into v_status, v_type from events where event_id = p_event_id;
  if not found then return json_build_object('success', false, 'error', 'Événement introuvable.'); end if;
  if v_type <> 'match' then return json_build_object('success', false, 'error', 'Réservé aux matchs.'); end if;
  if v_status not in ('clôturé','cloture','archivé','archive') then
    return json_build_object('success', false, 'error', 'Événement non clôturé.');
  end if;

  -- ÉTAPE A (espaces) — dériver les finals manquants/aberrants (dry ou apply).
  v_derive := public.derive_and_apply_espace_finals(p_event_id, p_by, p_dry_run);

  -- Signaux dépôts (LECTURE — jamais d'invention) : ancrages fûts périmés.
  select json_agg(a) into v_anchors from public.keg_central_anchor_status() a where a.ancrage_perime;
  -- Audit clôture fûts (LECTURE).
  v_audit := public.audit_keg_closure(p_event_id);

  if coalesce(p_dry_run, true) then
    return json_build_object('success', true, 'mode', 'dry_run', 'event_id', p_event_id,
      'A_espaces_derivation', v_derive,
      'B_depots_ancrages_perimes', coalesce(v_anchors, '[]'::json),
      'C_audit_futs', v_audit,
      'note', 'Aucune écriture. Relancer avec p_dry_run := false pour appliquer les étapes A→D.');
  end if;

  -- ÉTAPE B (espaces non conservés) → live espace = 0 (fûts puis non-fûts).
  v_nonret_keg := public.reconcile_non_retained_keg_espace(p_event_id);
  v_nonret     := public.reconcile_non_retained_espace(p_event_id);

  -- ÉTAPE C (registre) — keg_inventory réaligné sur area_stocks (autorité).
  v_keginv := public.reconcile_keg_inventory_to_truth(p_event_id);

  -- ÉTAPE D (filet récence) — répare tout live clobberé par une dérivation antérieure.
  v_reanchor := public.reanchor_espace_live_to_last_match(null, null, false);

  -- Ré-audit + signaux après application.
  v_audit := public.audit_keg_closure(p_event_id);
  select json_agg(a) into v_anchors from public.keg_central_anchor_status() a where a.ancrage_perime;

  return json_build_object('success', true, 'mode', 'applied', 'event_id', p_event_id,
    'A_espaces_derivation', v_derive,
    'B_non_conserves_futs', v_nonret_keg, 'B_non_conserves_stock', v_nonret,
    'C_registre_keg', v_keginv, 'D_reancrage_live', v_reanchor,
    'audit_futs', v_audit,
    'depots_ancrages_perimes', coalesce(v_anchors, '[]'::json),
    'note', 'Réconciliation appliquée. Les ancrages dépôts périmés exigent un comptage physique (record_keg_count) — jamais inventé.');
end;
$fn$;

grant execute on function public.reconcile_event_closure(uuid, text, boolean) to authenticated;

-- =====================================================================
-- BRANCHEMENT (à valider par l'humain — PAS d'auto par défaut) :
--   • Bouton ROLE_STADE sur la fiche de clôture « Réconcilier la clôture » :
--       select reconcile_event_closure('<event>', 'M. Viatte', true);   -- revue
--       select reconcile_event_closure('<event>', 'M. Viatte', false);  -- application
--   • Auto en fin de finalize_event_espace_stocks : OPTION désactivée par défaut
--     (à n'activer qu'après plusieurs cycles de validation manuelle) :
--       -- perform reconcile_event_closure(p_event_id, 'Clôture (auto)', false);
-- =====================================================================
