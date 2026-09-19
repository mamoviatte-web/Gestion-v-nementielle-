-- =====================================================================
-- CLÔTURE → MISE À JOUR AUTOMATIQUE DES STOCKS ESPACES (produits restants)
-- ---------------------------------------------------------------------
-- Problème constaté (match Narbonne) : à la clôture, sur plusieurs espaces
-- « à stock conservé » (Bodega, Bistrot, Loges, bars…), le stock RESTANT
-- (final_qty) n'était pas répercuté sur le solde de l'espace. Résultat :
--   - vue « Stocks · Par espace » : Qté espace = 0 alors qu'il reste du stock ;
--   - fiche runner du match suivant : colonne ESPACE = 0 → tout est « à
--     acheminer » alors qu'une partie est déjà sur place.
-- La colonne ESPACE de event_runner_board lit le solde LIVE de la
-- stock-location « espace » : recaler ce solde suffit à corriger la fiche.
--
-- Solution :
--   1. finalize_event_espace_stocks(p_event) : pour chaque espace conservant
--      son stock, cale le solde espace (area_stocks + stock_balances) sur le
--      RESTANT réel de la clôture (final_qty), en respectant l'état produit
--      (cassé/perdu/périmé → 0) et les fûts (gardés seulement si
--      retain_kegs_in_espace). Idempotent : si un final est corrigé, relancer
--      recale tout → « le reste suit ». Réservé ROLE_STADE.
--   2. Le trigger de cycle de vie de l'événement l'appelle AUTOMATIQUEMENT au
--      passage en statut « clôturé » (matchs) → mise à jour automatique des
--      espaces en liaison, sans action supplémentaire.
--
-- Ne crée pas de mouvement (RG-002) : c'est un RECALAGE d'inventaire de fin
-- de match (photo du restant), au même titre que le trigger par ligne
-- on_stock_final_entered qui écrit déjà area_stocks/stock_balances en direct.
-- =====================================================================

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
begin
  if auth.uid() is not null and not coalesce(is_stade(), false) then
    return json_build_object('success', false, 'error', 'Action réservée à l''équipe stade.');
  end if;

  -- Parcourt les espaces « à stock conservé » liés à l'événement, ligne par ligne.
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
    -- Restant réellement conservé dans l'espace (photo de clôture).
    if r.product_state in ('cassé', 'perdu', 'périmé') then
      v_keep := 0;
    elsif v_is_keg and (not r.keep_kegs or r.product_state in ('fût_vide', 'fût_percuté')) then
      v_keep := 0;                       -- fûts non gardés en espace / vides
    else
      v_keep := greatest(coalesce(r.final_qty, 0), 0);
    end if;

    -- area_stocks (base des dotations à la génération).
    insert into area_stocks (area_id, product_id, current_qty, initial_qty, last_updated, updated_by)
    values (r.space_id, r.product_id, v_keep, v_keep, now(), v_by)
    on conflict (area_id, product_id) do update
      set current_qty = excluded.current_qty, initial_qty = excluded.initial_qty,
          last_updated = now(), updated_by = v_by;

    -- stock_balances de la stock-location « espace » (source LIVE de la fiche runner).
    v_loc := espace_location_of(r.space_id);
    if v_loc is not null then
      insert into stock_balances (product_id, location_id, current_quantity, last_movement_at, updated_by)
      values (r.product_id, v_loc, v_keep, now(), v_by)
      on conflict (product_id, location_id) do update
        set current_quantity = excluded.current_quantity, last_movement_at = now(), updated_by = v_by;
    end if;

    v_lines := v_lines + 1;
  end loop;

  select count(distinct esl.space_id) into v_spaces
  from event_stock_lines esl
  join spaces s on s.space_id = esl.space_id and coalesce(s.retains_stock, false) = true
  where esl.event_id = p_event_id and esl.final_qty is not null;

  return json_build_object('success', true, 'event_id', p_event_id,
    'espaces_recales', v_spaces, 'lignes_recalees', v_lines);
end;
$function$;

grant execute on function public.finalize_event_espace_stocks(uuid) to authenticated;

-- ── Auto-exécution à la clôture (mise à jour automatique des espaces) ──
create or replace function public.trg_event_stock_lifecycle()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  -- Départ ET retour sont gérés PAR LIGNE (on_initial_entered,
  -- on_reassort_updated, on_stock_final_entered).
  -- À la clôture d'un match, on recale en plus le solde des espaces « à stock
  -- conservé » sur le restant réel (filet de sécurité + cohérence fiche runner
  -- suivante). Idempotent, sans mouvement.
  if new.status = 'clôturé'
     and coalesce(old.status, '') is distinct from 'clôturé'
     and coalesce(new.event_type, 'match') <> 'séminaire' then
    perform finalize_event_espace_stocks(new.event_id);
  end if;
  return new;
end $function$;
