-- Fige les prix des fûts FADA du relevé régie sur l'événement Agen
-- ============================================================================
-- Le coût de consommation se calcule avec frozen_unit_price_ht en priorité
-- (auto_compute_line_cost). On fige les prix fûts EXACTS de la feuille Bodega
-- sur les lignes d'Agen, pour que le bilan reflète la valorisation de la régie.
-- Le trigger recalcule automatiquement consumption_cost_ht. Idempotent.
-- NB : le total peut différer de la feuille car celle-ci comportait une erreur
-- de calcul sur la ligne « FUTS VP FADA » (total figé au prix unitaire au lieu
-- de prix × quantité) ; l'appli applique prix × conso, ce qui est correct.

do $$
begin
  perform set_config('app.allow_adjustment','on', true);
  update event_stock_lines l
     set frozen_unit_price_ht = v.price
  from (values
    ('0c93bd1c-d70e-4945-b799-51356a00dee7'::uuid, 101.04::numeric),  -- Fût FADA Blonde
    ('1f2e1d40-f5a4-428a-ad55-3b7c4a315f28'::uuid, 101.04),           -- Fût VP Fada
    ('49963e86-075b-49f3-97dd-f48fcae94271'::uuid, 79.74),            -- Fût FADA Blanche
    ('118236d3-9093-41f2-ae2c-878b1ae2fe76'::uuid, 85.02),            -- Fût FADA IPA
    ('6bfd0e99-178d-43d4-a9c4-285363997106'::uuid, 75.42)             -- Fût FADA Abricot
  ) as v(product_id, price)
  where l.event_id = '5b999a21-25e6-4fb3-babc-d89cf69e2e27'
    and l.product_id = v.product_id
    and l.frozen_unit_price_ht is distinct from v.price;
end $$;
