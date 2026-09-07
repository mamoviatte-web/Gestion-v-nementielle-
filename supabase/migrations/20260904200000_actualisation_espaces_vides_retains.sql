-- =====================================================================
-- Actualisation des espaces retains_stock VIDES = stock final dernier match
-- ---------------------------------------------------------------------
-- Certains espaces qui conservent leur stock (retains_stock) affichaient un
-- stock espace à 0 (reset « en attente d'inventaire » + intégrations en masse
-- avec trigger de rétention désactivé). On reporte, pour CHAQUE espace
-- retains_stock actuellement vide, le stock final (hors fûts) de son dernier
-- match clôturé comme base de stock espace.
--
-- Auto-scopé : ne touche QUE les espaces dont le stock espace est nul → une
-- fois peuplés ils ne sont plus vides (idempotent). Fûts exclus (circuit
-- keg_inventory), sauf les 3 buvettes EST déjà traitées séparément.
-- Chaque report tracé (mouvement 'inventaire', RG-002).
-- =====================================================================

do $$
declare
  v_resp text := 'Actualisation base stock espace (stock final dernier match)';
  sp record; ln record; v_ev uuid;
begin
  for sp in
    select s.space_id, s.space_name, l.id as loc
    from spaces s
    join stock_locations l on l.area_id = s.space_id and l.location_type = 'espace'
    where s.retains_stock = true
      and coalesce((select sum(b.current_quantity) from stock_balances b where b.location_id = l.id), 0) = 0
  loop
    -- dernier événement clôturé avec stock final pour cet espace
    select l2.event_id into v_ev
    from event_stock_lines l2
    join events e on e.event_id = l2.event_id
    where l2.space_id = sp.space_id and l2.final_qty is not null
      and lower(e.status) in ('clôturé','cloture','clôturée','archivé','archive')
    order by e.event_date desc
    limit 1;
    if v_ev is null then continue; end if;

    for ln in
      select l3.product_id, l3.final_qty::int as f,
             coalesce(l3.frozen_unit_price_ht, p.unit_price_ht) as prix
      from event_stock_lines l3
      join products p on p.product_id = l3.product_id
      where l3.event_id = v_ev and l3.space_id = sp.space_id
        and l3.final_qty is not null
        and p.product_name not ilike 'Fût %'      -- fûts hors espace (keg_inventory)
    loop
      insert into stock_balances(product_id, location_id, current_quantity, unit_value_ht, last_movement_at, updated_by)
      values (ln.product_id, sp.loc, ln.f, ln.prix, now(), v_resp)
      on conflict (product_id, location_id) do update set
        current_quantity = excluded.current_quantity,
        unit_value_ht    = coalesce(excluded.unit_value_ht, stock_balances.unit_value_ht),
        last_movement_at = now(),
        updated_by       = v_resp;

      if ln.f > 0 then
        insert into stock_movements(event_id, product_id, space_id, movement_type, qty,
            to_location_id, responsable_nom, event_category, status)
        values (v_ev, ln.product_id, sp.space_id, 'inventaire', ln.f,
            sp.loc, v_resp, 'match', 'validated');
      end if;
    end loop;
  end loop;
end $$;
