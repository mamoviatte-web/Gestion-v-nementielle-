-- =====================================================================
-- RÉSERVE CENTRALE — RÉCONCILIATION PAR COMPTAGE & RAPPORT DE DIVERGENCE
-- ---------------------------------------------------------------------
-- Constat (investigation Orangina 50cl) : le solde stocké de la réserve et le
-- grand livre des mouvements ont DIVERGÉ (Orangina : ledger −226 vs stocké −13).
-- Cause : le solde est piloté par les comptages physiques (SET absolu), mais
-- ces comptages n'émettaient pas toujours un mouvement → le ledger ne reflète
-- plus le solde (trou RG-002 sur le chemin inventaire), et des dispatches ont pu
-- pousser un solde sous 0 (impossible physiquement — Orangina −13).
--
--   reconcile_reserve_count(product, counted, by, reason[, reserve])
--     Cale le solde d'un produit en réserve sur un COMPTAGE PHYSIQUE et émet le
--     mouvement 'inventaire' correspondant (delta), pour que ledger = solde.
--     → source de vérité = le comptage ; trace RG-002 garantie. ROLE_STADE.
--
--   reserve_stock_divergence()
--     Rapport (lecture seule) : par (réserve, produit), solde stocké vs solde
--     impliqué par le ledger, écart, et drapeau négatif. Rend l'investigation
--     permanente pour toute la réserve (pas seulement l'Orangina).
-- =====================================================================

create or replace function public.reconcile_reserve_count(
  p_product_id uuid,
  p_counted_qty numeric,
  p_by text,
  p_reason text default null,
  p_reserve_id uuid default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_res uuid;
  v_before numeric;
  v_delta numeric;
begin
  if auth.uid() is not null and not coalesce(is_stade(), false) then
    return json_build_object('success', false, 'error', 'Réservé à l''équipe stade.');
  end if;
  if p_counted_qty is null or p_counted_qty < 0 then
    return json_build_object('success', false, 'error', 'Quantité comptée invalide (doit être ≥ 0).');
  end if;
  if coalesce(btrim(p_by), '') = '' then
    return json_build_object('success', false, 'error', 'Auteur du comptage obligatoire (traçabilité).');
  end if;

  -- Réserve cible : celle passée en paramètre, sinon celle où le produit a déjà
  -- un solde, sinon la Réserve générale.
  v_res := coalesce(
    p_reserve_id,
    (select sb.location_id from stock_balances sb
       join stock_locations l on l.id = sb.location_id and l.location_type = 'reserve_centrale'
      where sb.product_id = p_product_id order by abs(coalesce(sb.current_quantity,0)) desc limit 1),
    (select id from stock_locations where location_type = 'reserve_centrale' and name ilike 'AUC%' limit 1),
    (select id from stock_locations where location_type = 'reserve_centrale' order by name limit 1)
  );
  if v_res is null then
    return json_build_object('success', false, 'error', 'Aucune réserve centrale trouvée.');
  end if;

  select coalesce(current_quantity, 0) into v_before
    from stock_balances where product_id = p_product_id and location_id = v_res;
  v_before := coalesce(v_before, 0);
  v_delta := p_counted_qty - v_before;

  -- Mouvement tracé (RG-002) : le comptage émet un 'inventaire' pour le delta.
  if v_delta <> 0 then
    insert into stock_movements(product_id, movement_type, qty, from_location_id, to_location_id,
                                responsable_nom, is_anomaly, event_category, status)
    values (p_product_id, 'inventaire', abs(v_delta),
            case when v_delta < 0 then v_res else null end,
            case when v_delta > 0 then v_res else null end,
            p_by, (v_before < 0), 'autre', 'validated');
  end if;

  -- Cale le solde sur le comptage physique (source de vérité).
  insert into stock_balances(product_id, location_id, current_quantity, last_movement_at, updated_by)
  values (p_product_id, v_res, p_counted_qty, now(), p_by)
  on conflict (product_id, location_id) do update
    set current_quantity = excluded.current_quantity, last_movement_at = now(), updated_by = p_by;

  return json_build_object('success', true, 'reserve_id', v_res,
    'solde_avant', v_before, 'compte', p_counted_qty, 'delta', v_delta,
    'motif', coalesce(p_reason, 'Comptage physique réserve'));
end;
$function$;

grant execute on function public.reconcile_reserve_count(uuid, numeric, text, text, uuid) to authenticated;

-- ── Rapport de divergence ledger vs solde (lecture seule) ─────────────
create or replace function public.reserve_stock_divergence()
returns table(
  reserve_name text, product_name text, category text,
  stored numeric, ledger_implied numeric, ecart numeric, negatif boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with res as (
    select id, name from stock_locations where location_type = 'reserve_centrale'
  ),
  mv as (
    select m.product_id, r.id as res_id,
           sum(case when m.to_location_id = r.id then m.qty else 0 end)
         - sum(case when m.from_location_id = r.id then m.qty else 0 end) as implied
    from stock_movements m
    join res r on r.id = m.to_location_id or r.id = m.from_location_id
    group by m.product_id, r.id
  ),
  bal as (
    select sb.product_id, sb.location_id as res_id, sb.current_quantity as stored
    from stock_balances sb join res r on r.id = sb.location_id
  )
  select r.name, p.product_name, p.category,
         coalesce(b.stored, 0), coalesce(m.implied, 0),
         coalesce(b.stored, 0) - coalesce(m.implied, 0) as ecart,
         coalesce(b.stored, 0) < 0 as negatif
  from res r
  join products p on true
  left join bal b on b.res_id = r.id and b.product_id = p.product_id
  left join mv  m on m.res_id = r.id and m.product_id = p.product_id
  where coalesce(b.stored, 0) <> 0 or coalesce(m.implied, 0) <> 0
  order by (coalesce(b.stored,0) < 0) desc, abs(coalesce(b.stored,0) - coalesce(m.implied,0)) desc;
$function$;

grant execute on function public.reserve_stock_divergence() to authenticated;
