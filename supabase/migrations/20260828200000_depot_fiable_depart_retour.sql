-- Dépôt fiable & pilotable : départ à l'ouverture, retour unique, contrôle départs/retours
-- ============================================================================
-- Constat (match Agen) : le dépôt ne "bouclait" pas.
--   • DÉPART : dispatch_event_stock se déclenchait au passage en_cours, AVANT la
--     saisie des stocks initiaux → il tournait à vide et se marquait "fait" →
--     aucune sortie dépôt au lancement.
--   • RETOUR : compté DEUX fois (on_stock_final_entered 'retour_réutilisable' +
--     return_event_stock 'retour', même réserve) → dépôt crédité en double.
--   • RÉASSORT : déjà correct (on_reassort_updated débite la réserve par ligne).
--
-- Correctif : on aligne TOUT sur le modèle par-ligne (fiable, "temps réel") :
--   1. Départ à l'OUVERTURE : nouveau trigger on_initial_entered — débite la réserve
--      du stock initial (espaces NON conservés ; les espaces à stock conservé ont
--      un report area_stocks, déjà décompté). Miroir exact de on_reassort_updated.
--   2. Retour UNIQUE : on_stock_final_entered reste la seule source (par ligne) ;
--      dispatch_event_stock et return_event_stock sont retirés du cycle de vie
--      (timing cassé + doublon). Net dépôt = −(initial+réassort−final) = −consommé.
--   3. Garde-fou : get_event_stock_flow(event) pour contrôler départs/retours.

-- 1) DÉPART à l'ouverture (miroir de on_reassort_updated) --------------------
create or replace function public.on_initial_entered() returns trigger
  language plpgsql set search_path to 'public' as $fn$
declare v_depot uuid; v_to uuid; v_delta int; v_is_keg boolean; v_retains boolean;
begin
  v_delta := coalesce(NEW.initial_qty,0) - coalesce(OLD.initial_qty,0);
  if v_delta <= 0 then return NEW; end if;
  -- Espace à stock conservé : l'ouverture = report (area_stocks), pas une sortie dépôt.
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

drop trigger if exists trg_initial_entered on event_stock_lines;
create trigger trg_initial_entered before insert or update of initial_qty on event_stock_lines
  for each row execute function public.on_initial_entered();

-- 2) Retirer le dispatch/return événement (timing cassé + doublon) -----------
create or replace function public.trg_event_stock_lifecycle() returns trigger
  language plpgsql set search_path to 'public' as $fn$
begin
  -- Départ ET retour sont désormais gérés PAR LIGNE (on_initial_entered,
  -- on_reassort_updated, on_stock_final_entered). Plus de dispatch/return
  -- au niveau événement (se déclenchaient au mauvais moment / en double).
  return new;
end $fn$;

-- Garde-fou : réconciliation départs/retours par événement ------------------
-- Garde-fou : contrôle des départs / retours dépôt par événement
create or replace function public.get_event_stock_flow(p_event uuid)
returns json language plpgsql security definer set search_path to 'public' as $fn$
declare v json;
begin
  with mv as (
    select m.product_id,
           sum(m.qty) filter (where m.movement_type='sortie')               as depart,
           sum(m.qty) filter (where m.movement_type='réassort_événement')   as reassort,
           sum(m.qty) filter (where m.movement_type in ('retour','retour_réutilisable')) as retour,
           count(*)   filter (where m.movement_type in ('retour','retour_réutilisable')) as nb_retours
      from stock_movements m where m.event_id = p_event group by m.product_id
  ),
  cons as (
    select esl.product_id,
           sum(greatest(coalesce(esl.consumed_qty,0),0)) as conso,
           bool_or(coalesce(s.retains_stock,false))       as any_retenu
      from event_stock_lines esl join spaces s on s.space_id=esl.space_id
     where esl.event_id=p_event and esl.final_qty is not null group by esl.product_id
  ),
  j as (
    select p.product_name, p.category,
           coalesce(mv.depart,0) depart, coalesce(mv.reassort,0) reassort,
           coalesce(cons.conso,0) conso, coalesce(mv.retour,0) retour,
           coalesce(mv.nb_retours,0) nb_retours, coalesce(cons.any_retenu,false) retenu
      from cons full join mv on mv.product_id=cons.product_id
      join products p on p.product_id=coalesce(cons.product_id, mv.product_id)
  )
  select json_build_object(
    'event_id', p_event,
    'resume', json_build_object(
      'depart_total', coalesce(sum(depart),0), 'reassort_total', coalesce(sum(reassort),0),
      'conso_total', coalesce(sum(conso),0), 'retour_total', coalesce(sum(retour),0),
      'anomalies', count(*) filter (where
           (not retenu and conso>0 and depart=0)          -- départ manquant
        or (nb_retours>1)                                 -- retour compté plusieurs fois
        or (not retenu and retour > depart+reassort))     -- retour > sorti (dépôt gonflé)
    ),
    'anomalies', coalesce(json_agg(json_build_object(
        'produit', product_name, 'depart', depart, 'reassort', reassort,
        'conso', conso, 'retour', retour,
        'probleme', case
          when not retenu and conso>0 and depart=0 then 'départ dépôt manquant'
          when nb_retours>1 then 'retour compté '||nb_retours||'×'
          when not retenu and retour > depart+reassort then 'retour > sorti (dépôt gonflé)'
          else null end
      ) order by product_name) filter (where
           (not retenu and conso>0 and depart=0) or (nb_retours>1)
        or (not retenu and retour > depart+reassort)), '[]'::json)
  ) into v from j;
  return v;
end $fn$;
grant execute on function public.get_event_stock_flow(uuid) to authenticated;
