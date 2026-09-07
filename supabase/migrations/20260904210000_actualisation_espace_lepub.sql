-- =====================================================================
-- Actualisation du stock ESPACE de Le Pub = stock final Agen
-- ---------------------------------------------------------------------
-- Le Pub (retains_stock) portait un stock espace résiduel « QA-INV2 »
-- (Perrier 5) daté du 21/08, ANTÉRIEUR au match Agen (27/08) et non mis à
-- jour depuis (intégration Agen en masse, trigger de rétention désactivé)
-- → valeur de test périmée. On reporte le stock final (hors fûts) d'Agen
-- comme base de stock espace. Mouvement 'inventaire' tracé (RG-002).
-- Idempotent (sentinelle par responsable_nom).
-- =====================================================================

do $$
declare
  v_agen uuid := '5b999a21-25e6-4fb3-babc-d89cf69e2e27';
  v_pub  uuid := 'aad36e50-255a-4845-8d54-42e5eee453bf';   -- Le Pub
  v_resp text := 'Actualisation espace Le Pub (stock final Agen — reliquat QA périmé)';
  v_loc uuid; rec record;
begin
  if exists (select 1 from stock_movements where event_id=v_agen and responsable_nom=v_resp) then
    raise notice 'Actualisation Le Pub déjà appliquée — aucune action.'; return;
  end if;
  v_loc := espace_location_of(v_pub);
  if v_loc is null then return; end if;

  for rec in
    select l.product_id, l.final_qty::int as f,
           coalesce(l.frozen_unit_price_ht, p.unit_price_ht) as prix
    from event_stock_lines l
    join products p on p.product_id = l.product_id
    where l.event_id = v_agen and l.space_id = v_pub and l.final_qty is not null
      and p.product_name not ilike 'Fût %'
  loop
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
      values (v_agen, rec.product_id, v_pub, 'inventaire', rec.f,
          v_loc, v_resp, 'match', 'validated');
    end if;
  end loop;
end $$;
