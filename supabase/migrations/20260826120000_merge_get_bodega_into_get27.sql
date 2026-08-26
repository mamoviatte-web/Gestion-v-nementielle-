-- Fusion produit : « Get Bodega » → « GET 27 »
-- ============================================================================
-- « Get Bodega » (2dbfe93c) et « GET 27 » (fea603fb) sont le même produit
-- (GET 27, même PU 12,21 € HT). « Get Bodega » était déjà active=false, mais il
-- restait une trace : une ligne option (niveau C) dans space_product_catalog à
-- Parvis Nord, plus 2 lignes dans la table archivée area_product_reference_deprecated.
-- On repointe ces références sur GET 27 pour qu'aucun doublon « Get Bodega »
-- n'apparaisse nulle part (catalogue, assortiment, fiches runner, exports).
-- RG-009 : pas de DELETE produit — « Get Bodega » reste active=false, historique
-- conservé mais désormais sans aucune référence vivante.
--
-- Toutes les autres tables (area_stocks, stock_balances, event_stock_lines,
-- stock_movements, coefficients, keg_*, etc.) pointaient déjà sur GET 27 (0 réf.
-- Get Bodega). space_product_catalog respecte UNIQUE(space_id, product_id) :
-- aucune collision (GET 27 absent de Parvis Nord). Idem table archivée.

do $$
declare
  v_gb  uuid := '2dbfe93c-cc73-4faf-9f31-7689bd4b8695';  -- Get Bodega (doublon)
  v_g27 uuid := 'fea603fb-7b98-49ff-a59c-6a41191aec5b';  -- GET 27 (canonique)
begin
  -- 1) space_product_catalog (UNIQUE space_id,product_id) : repoint, merge si collision
  delete from space_product_catalog a
   where a.product_id = v_gb
     and exists (select 1 from space_product_catalog b
                  where b.product_id = v_g27 and b.space_id = a.space_id);
  update space_product_catalog set product_id = v_g27 where product_id = v_gb;

  -- 2) area_product_reference_deprecated (archive figée) : repoint + renomme, merge si collision
  delete from area_product_reference_deprecated a
   where a.product_id = v_gb
     and exists (select 1 from area_product_reference_deprecated b
                  where b.product_id = v_g27 and upper(btrim(b.area_name)) = upper(btrim(a.area_name)));
  update area_product_reference_deprecated
     set product_id = v_g27, product_name = 'GET 27'
   where product_id = v_gb;

  -- 3) doublon désactivé (RG-009 : jamais de DELETE produit) — déjà active=false, on confirme
  update products set active = false where product_id = v_gb;
end $$;
