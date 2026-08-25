-- Fusion produit : « Bière en verre » → « BUD bouteille 33cl »
-- ============================================================================
-- « Bière en verre » (f7ba17a8) et « BUD bouteille 33cl » (792eefa4) sont le
-- même produit (bière bouteille, même PU 1,36 € HT). On fusionne le doublon
-- dans BUD : repointage de toutes les références, transfert du stock, puis
-- désactivation de Bière en verre (RG-009 : pas de DELETE produit, active=false,
-- historique conservé). Le doublon disparaît de toutes les listes (catalogue,
-- assortiment, fiches runner, stock responsable/réserve, coefficients…).
--
-- Stock transféré : stock_balances réserve 344 (Bière en verre) + 840 (BUD)
-- = 1184 ; area_stocks à 0 partout. stock_movements repointés (UPDATE autorisé,
-- traçabilité RG-002 préservée ; la suppression de mouvement reste bloquée).
-- Toutes les fusions gèrent les contraintes d'unicité (merge si collision).

do $$
declare
  v_bev uuid := 'f7ba17a8-26ab-410d-a012-8a1825bd4430';  -- Bière en verre
  v_bud uuid := '792eefa4-2c85-4fdb-8c16-93873c61fbbb';  -- BUD bouteille 33cl
begin
  -- 1) stock_balances (UNIQUE product,location) : somme sur localisation partagée
  update stock_balances b
     set current_quantity = b.current_quantity + x.q
    from (select location_id, current_quantity q from stock_balances where product_id = v_bev) x
   where b.product_id = v_bud and b.location_id = x.location_id;
  delete from stock_balances a
   where a.product_id = v_bev
     and exists (select 1 from stock_balances b where b.product_id = v_bud and b.location_id = a.location_id);
  update stock_balances set product_id = v_bud where product_id = v_bev;

  -- 2) area_stocks (UNIQUE area,product) : somme sur espace partagé, repoint sinon
  update area_stocks a
     set current_qty = a.current_qty + x.cq, initial_qty = a.initial_qty + x.iq
    from (select area_id, current_qty cq, initial_qty iq from area_stocks where product_id = v_bev) x
   where a.product_id = v_bud and a.area_id = x.area_id;
  delete from area_stocks a
   where a.product_id = v_bev
     and exists (select 1 from area_stocks b where b.product_id = v_bud and b.area_id = a.area_id);
  update area_stocks set product_id = v_bud where product_id = v_bev;

  -- 3) area_product_reference (UNIQUE area_name,product_name) : repoint + renomme
  delete from area_product_reference a
   where a.product_id = v_bev
     and exists (select 1 from area_product_reference b
                  where b.product_id = v_bud and upper(btrim(b.area_name)) = upper(btrim(a.area_name)));
  update area_product_reference
     set product_id = v_bud, product_name = 'BUD bouteille 33cl'
   where product_id = v_bev;

  -- 4) loge_dotations (UNIQUE space,loge_label,product_label) : repoint + renomme
  delete from loge_dotations a
   where a.product_id = v_bev
     and exists (select 1 from loge_dotations b
                  where b.product_id = v_bud and b.space_id = a.space_id and b.loge_label = a.loge_label);
  update loge_dotations
     set product_id = v_bud, product_label = 'BUD bouteille 33cl'
   where product_id = v_bev;

  -- 5) space_product_coefficients (UNIQUE space,product)
  delete from space_product_coefficients a
   where a.product_id = v_bev
     and exists (select 1 from space_product_coefficients b where b.product_id = v_bud and b.space_id = a.space_id);
  update space_product_coefficients set product_id = v_bud where product_id = v_bev;

  -- 6) consumption_analytics (UNIQUE space,product,event_type)
  delete from consumption_analytics a
   where a.product_id = v_bev
     and exists (select 1 from consumption_analytics b
                  where b.product_id = v_bud and b.space_id = a.space_id and b.event_type = a.event_type);
  update consumption_analytics set product_id = v_bud where product_id = v_bev;

  -- 7) event_stock_lines (UNIQUE event,space,product)
  delete from event_stock_lines a
   where a.product_id = v_bev
     and exists (select 1 from event_stock_lines b
                  where b.product_id = v_bud and b.event_id = a.event_id and b.space_id = a.space_id);
  update event_stock_lines set product_id = v_bud where product_id = v_bev;

  -- 8) runner_auto_planning (UNIQUE event,space,product)
  delete from runner_auto_planning a
   where a.product_id = v_bev
     and exists (select 1 from runner_auto_planning b
                  where b.product_id = v_bud and b.event_id = a.event_id and b.space_id = a.space_id);
  update runner_auto_planning set product_id = v_bud where product_id = v_bev;

  -- 9) tables sans contrainte d'unicité sur le produit : repoint direct
  update runner_templates       set product_id = v_bud where product_id = v_bev;
  update inventory_counts        set product_id = v_bud where product_id = v_bev;
  update supplier_delivery_lines set product_id = v_bud where product_id = v_bev;
  update stock_movements         set product_id = v_bud where product_id = v_bev; -- UPDATE autorisé (RG-002)

  -- 10) product_depot_routing (PK product_id) : BUD garde son routage, on retire BEV
  delete from product_depot_routing where product_id = v_bev;

  -- 11) désactivation du doublon (RG-009 : jamais de DELETE produit)
  update products set active = false where product_id = v_bev;
end $$;
