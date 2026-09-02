-- Fige les prix des fûts FADA (relevé régie) sur TOUS les matchs
-- ============================================================================
-- Étend la valorisation figée des fûts FADA — déjà posée sur Agen — à
-- l'ensemble des matchs (Nice, Vannes, Barrage…), pour une valorisation
-- homogène. Les lignes fûts de ces matchs étaient figées aux anciens prix
-- catalogue ; on les remplace par les prix officiels du relevé régie.
-- Le coût de consommation est recalculé par auto_compute_line_cost.
-- Événements clôturés : le figement du prix ne déclenche pas le verrou de
-- clôture (qui ne porte que sur initial/réassort/final) ; app.allow_adjustment
-- posé par sécurité. Idempotent.

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
  join events e on e.event_type = 'match'
  where l.event_id = e.event_id
    and l.product_id = v.product_id
    and l.frozen_unit_price_ht is distinct from v.price;
end $$;
