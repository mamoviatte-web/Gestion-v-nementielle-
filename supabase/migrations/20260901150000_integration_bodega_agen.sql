-- Intégration de la réalité de consommation de la BODEGA — match Agen
-- ============================================================================
-- Source : relevé régie Bodega (stock initial / réassort / restant par produit).
-- Les lignes Bodega d'Agen avaient un stock initial à 0 → consommation NÉGATIVE.
-- On réintègre l'initial réel (+ correction du mélange Pepsi 1L+/Max et du restant
-- San Pellegrino), recalcule conso & coût, trace chaque écart (inventaire, RG-002).
-- Puis on fixe le stock de l'ESPACE Bodega (retains_stock) = restant (les produits
-- restés dans la bodega). Événement clôturé : ajustement tracé via app.allow_adjustment.
-- Idempotent.

do $$
declare v_agen uuid := '5b999a21-25e6-4fb3-babc-d89cf69e2e27'; v_space uuid := '947acdaf-a350-4a3d-b8ca-6ed5d5f4ffb8'; v_loc uuid := '2e422ed3-c96f-4525-a59a-578c5aef9b9d'; v_resp text := 'Intégration Bodega « réalité match » Agen — régie';
begin
  if exists (select 1 from stock_movements where event_id=v_agen and space_id=v_space and movement_type='inventaire' and responsable_nom=v_resp) then
    raise notice 'Intégration Bodega Agen déjà appliquée — aucune action.'; return;
  end if;
  perform set_config('app.allow_adjustment','on', true);
  alter table event_stock_lines disable trigger trg_initial_entered;
  alter table event_stock_lines disable trigger trg_reassort_updated;
  alter table event_stock_lines disable trigger trg_stock_final_entered;
  alter table event_stock_lines disable trigger trg_guard_close_requires_opening;

  create temp table _btgt(product_id uuid, i int, r int, f int) on commit drop;
  insert into _btgt(product_id,i,r,f) values
    ('ef052c42-caec-4b2d-9f34-9f298e97383b'::uuid,8,0,0),
    ('2755c827-b791-4d8d-8e5f-12fb4c147320'::uuid,84,0,64),
    ('6cc890cc-ad92-49ce-ae90-1ab60909d92c'::uuid,30,0,14),
    ('3d4193d8-e40a-4067-98a4-c6301bb47850'::uuid,45,0,44),
    ('0c93bd1c-d70e-4945-b799-51356a00dee7'::uuid,23,0,15),
    ('1f2e1d40-f5a4-428a-ad55-3b7c4a315f28'::uuid,3,0,0),
    ('49963e86-075b-49f3-97dd-f48fcae94271'::uuid,8,0,5),
    ('118236d3-9093-41f2-ae2c-878b1ae2fe76'::uuid,7,0,2),
    ('800e26a7-5d25-4a2e-96eb-feabac36fe1a'::uuid,10,0,1),
    ('e4f25bc7-dd41-4036-aff6-877c925e1679'::uuid,35,0,6),
    ('12b21f99-f7f7-4004-bfcb-7025e145c2d8'::uuid,48,0,14),
    ('7d193944-c98c-48d6-860b-20bbc5fff904'::uuid,23,0,14),
    ('f9eee516-c6ce-4571-b8d7-a8251a8cb498'::uuid,47,0,34),
    ('271f1cdb-49c6-4bd0-a029-d5f839bfc84a'::uuid,66,0,30),
    ('4de1db33-75ff-46ae-b797-332ab925ebce'::uuid,48,0,31),
    ('40de0dac-e3e4-409f-8fef-5c87234490cc'::uuid,1,0,0),
    ('fea603fb-7b98-49ff-a59c-6a41191aec5b'::uuid,48,0,13),
    ('db3ce9c0-1e46-4cb1-a53a-5a073669f96b'::uuid,0,0,0);

  -- 1) tracer l'écart de conso AVANT MAJ (mouvement 'inventaire', RG-002)
  insert into stock_movements(event_id,product_id,space_id,movement_type,qty,responsable_nom,event_category,status)
  select v_agen, t.product_id, v_space, 'inventaire',
         abs( (t.i + t.r - t.f) - coalesce(l.consumed_qty,0) ), v_resp, 'match','validated'
  from _btgt t left join event_stock_lines l on l.event_id=v_agen and l.space_id=v_space and l.product_id=t.product_id
  where (t.i + t.r - t.f) <> coalesce(l.consumed_qty,0);

  -- 2) mettre à jour les lignes existantes
  update event_stock_lines l set initial_qty=t.i, reassort_qty=t.r, final_qty=t.f
    from _btgt t where l.event_id=v_agen and l.space_id=v_space and l.product_id=t.product_id;

  -- 3) créer les lignes absentes (ex. Pepsi bouteille 1L+)
  insert into event_stock_lines(event_id,space_id,product_id,initial_qty,reassort_qty,final_qty,responsable_nom)
  select v_agen, v_space, t.product_id, t.i, t.r, t.f, v_resp from _btgt t
  where not exists (select 1 from event_stock_lines l where l.event_id=v_agen and l.space_id=v_space and l.product_id=t.product_id);

  -- 3b) restant résiduel sur un produit sans initial (sirops = 0 sur le relevé)
  --     → remis à 0 pour éviter une consommation négative fantôme.
  update event_stock_lines l set final_qty = 0
  where l.event_id = v_agen and l.space_id = v_space
    and coalesce(l.initial_qty,0) = 0 and coalesce(l.final_qty,0) > 0
    and l.product_id not in (select product_id from _btgt);

  alter table event_stock_lines enable trigger trg_initial_entered;
  alter table event_stock_lines enable trigger trg_reassort_updated;
  alter table event_stock_lines enable trigger trg_stock_final_entered;
  alter table event_stock_lines enable trigger trg_guard_close_requires_opening;

  -- 4) produits restés dans l'ESPACE Bodega = restant (stock physique courant)
  update stock_balances b set current_quantity=t.f, last_movement_at=now(), updated_by=v_resp
    from _btgt t where b.location_id=v_loc and b.product_id=t.product_id;
  insert into stock_balances(product_id, location_id, current_quantity, updated_by)
  select t.product_id, v_loc, t.f, v_resp from _btgt t
  where not exists (select 1 from stock_balances b where b.location_id=v_loc and b.product_id=t.product_id);
  -- trace du restant en espace (RG-002)
  insert into stock_movements(event_id,product_id,space_id,movement_type,qty,to_location_id,responsable_nom,event_category,status)
  select v_agen, t.product_id, v_space, 'inventaire', t.f, v_loc, v_resp, 'match','validated' from _btgt t where t.f > 0;

  raise notice 'Intégration Bodega Agen appliquée.';
end $$;
