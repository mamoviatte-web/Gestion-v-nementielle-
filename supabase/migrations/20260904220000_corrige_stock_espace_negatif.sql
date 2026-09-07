-- =====================================================================
-- Correction des stocks ESPACE négatifs (plancher à 0)
-- ---------------------------------------------------------------------
-- Un stock espace négatif est impossible physiquement (sur-déduction /
-- valeur corrompue héritée). On les ramène à 0 (sans inventer de stock)
-- avec un mouvement 'correction' tracé (RG-002). Auto-scopé aux négatifs
-- (idempotent). Cas connu : Loge Est / Blanc du Seuil = -15 (héritage 07/2026).
-- =====================================================================

do $$
declare v_resp text := 'Correction stock espace négatif → plancher 0'; rec record;
begin
  for rec in
    select b.product_id, b.location_id, b.current_quantity, l.area_id as space_id
    from stock_balances b
    join stock_locations l on l.id = b.location_id
    where l.location_type = 'espace' and b.current_quantity < 0
  loop
    -- trace (RG-002) : correction du delta ramenant à 0
    insert into stock_movements(product_id, space_id, movement_type, qty, to_location_id,
        responsable_nom, is_anomaly, status)
    values (rec.product_id, rec.space_id, 'correction', abs(rec.current_quantity)::int,
        rec.location_id, v_resp, true, 'validated');

    update stock_balances
       set current_quantity = 0, last_movement_at = now(), updated_by = v_resp
     where product_id = rec.product_id and location_id = rec.location_id;
  end loop;
end $$;
