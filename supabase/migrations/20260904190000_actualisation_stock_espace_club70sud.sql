-- =====================================================================
-- Actualisation du stock ESPACE de Club 70 Sud = stock final Agen
-- ---------------------------------------------------------------------
-- Club 70 Sud (retains_stock) affichait un stock espace à 0 : lors de
-- l'intégration en masse d'Agen, le trigger de rétention avait été
-- désactivé → le final n'a pas été reporté en espace. On reporte le stock
-- final du dernier match (Agen) comme base de stock espace, pour fiabiliser
-- les fiches runner. Même procédure que les buvettes EST : upsert
-- stock_balances de la location espace = final + mouvement 'inventaire'
-- tracé (RG-002). Idempotent.
-- =====================================================================

do $$
declare
  v_agen uuid := '5b999a21-25e6-4fb3-babc-d89cf69e2e27';
  v_resp text := 'Actualisation espace Club 70 Sud (stock final Agen)';
  rec record; v_loc uuid;
begin
  if exists (select 1 from stock_movements where event_id=v_agen and responsable_nom=v_resp) then
    raise notice 'Actualisation Club 70 Sud déjà appliquée — aucune action.'; return;
  end if;

  for rec in
    select l.space_id, l.product_id, l.final_qty::int as f,
           coalesce(l.frozen_unit_price_ht, p.unit_price_ht) as prix
    from event_stock_lines l
    join spaces s   on s.space_id = l.space_id
    join products p on p.product_id = l.product_id
    where l.event_id = v_agen and s.space_name = 'Club 70 Sud' and l.final_qty is not null
  loop
    v_loc := espace_location_of(rec.space_id);
    if v_loc is null then continue; end if;

    insert into stock_balances(product_id, location_id, current_quantity, unit_value_ht, last_movement_at, updated_by)
    values (rec.product_id, v_loc, rec.f, rec.prix, now(), v_resp)
    on conflict (product_id, location_id) do update set
      current_quantity = excluded.current_quantity,
      unit_value_ht    = coalesce(excluded.unit_value_ht, stock_balances.unit_value_ht),
      last_movement_at = now(),
      updated_by       = v_resp;

    if rec.f > 0 then
      insert into stock_movements(event_id, product_id, space_id, movement_type, qty,
          to_location_id, responsable_nom, event_category, status)
      values (v_agen, rec.product_id, rec.space_id, 'inventaire', rec.f,
          v_loc, v_resp, 'match', 'validated');
    end if;
  end loop;
end $$;
