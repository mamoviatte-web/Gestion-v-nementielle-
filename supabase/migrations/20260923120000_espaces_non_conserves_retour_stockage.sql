-- =====================================================================
-- CHEMINEMENT PRODUITS — ESPACES NON CONSERVÉS : RETOUR EN STOCKAGE (espace = 0)
-- ---------------------------------------------------------------------
-- Rappel du cheminement (base validée) :
--   • retains_stock = TRUE  → l'espace CONSERVE son stock d'un match à l'autre
--     (salons VIP, bars, buvettes EST à cave). La dotation soustrait ce stock.
--   • retains_stock = FALSE → l'espace NE CONSERVE RIEN : tout le matériel est
--     RAMENÉ EN STOCKAGE après l'événement (buvettes Nord OUEST, SUD, Virages,
--     Parvis, Toinou…). Il repart donc de ZÉRO à chaque match → la dotation
--     doit transmettre le BESOIN COMPLET, sans jamais décompter l'espace.
--
-- Défaut constaté (fiche runner Nord OUEST) : un stock résiduel traînait dans
-- l'emplacement ESPACE de ces buvettes (ex. Orangina 48, Pepsi 48…) et venait
-- se soustraire du « à acheminer » → dotation sous-transmise, blocage.
--
-- Le correctif 20260922110000 ne traitait que les FÛTS. On généralise à TOUS les
-- produits pour les espaces retains_stock = false :
--
--   reconcile_non_retained_espace(event?) : remet à 0 le solde espace (et le
--     socle area_stocks) de TOUS les produits des espaces qui ne conservent pas
--     leur stock. Global si event NULL, sinon limité aux espaces du match.
--   finalize_event_espace_stocks l'appelle à la clôture (filet + cohérence
--     fiche runner suivante).
--
-- Recalage d'inventaire (photo de fin de match), pas un mouvement : cohérent
-- avec le retour-en-stockage déjà géré ligne à ligne à la clôture.
-- =====================================================================

create or replace function public.reconcile_non_retained_espace(p_event_id uuid default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_by   text := 'Retour stockage (espace non conservé)';
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
    join spaces s on s.space_id = loc.area_id
         and coalesce(s.retains_stock, false) = false
         and coalesce(s.active, true)
    where coalesce(sb.current_quantity, 0) <> 0
      and (p_event_id is null
           or loc.area_id in (select space_id from event_spaces where event_id = p_event_id))
  )
  update stock_balances sb
     set current_quantity = 0, last_movement_at = now(), updated_by = v_by
    from cible c
   where sb.product_id = c.product_id and sb.location_id = c.location_id;
  get diagnostics v_sb = row_count;

  -- Socle des dotations (area_stocks).
  with cible as (
    select a.area_id, a.product_id
    from area_stocks a
    join spaces s on s.space_id = a.area_id
         and coalesce(s.retains_stock, false) = false
         and coalesce(s.active, true)
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

grant execute on function public.reconcile_non_retained_espace(uuid) to authenticated;

-- ── La clôture appelle aussi ce recalage (tous produits, espaces non conservés) ──
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
  v_esp json;
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
      v_keep := 0;
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

  -- Filets de sécurité : fûts des espaces sans cave + TOUS produits des espaces
  -- non conservés (retour en stockage → espace = 0).
  v_keg := reconcile_non_retained_keg_espace(p_event_id);
  v_esp := reconcile_non_retained_espace(p_event_id);

  select count(distinct esl.space_id) into v_spaces
  from event_stock_lines esl
  join spaces s on s.space_id = esl.space_id and coalesce(s.retains_stock, false) = true
  where esl.event_id = p_event_id and esl.final_qty is not null;

  return json_build_object('success', true, 'event_id', p_event_id,
    'espaces_recales', v_spaces, 'lignes_recalees', v_lines, 'futs', v_keg, 'espaces_non_conserves', v_esp);
end;
$function$;

grant execute on function public.finalize_event_espace_stocks(uuid) to authenticated;

-- ── Recalage immédiat du parc existant (corrige la fiche runner en direct) ──
select public.reconcile_non_retained_espace(null);
