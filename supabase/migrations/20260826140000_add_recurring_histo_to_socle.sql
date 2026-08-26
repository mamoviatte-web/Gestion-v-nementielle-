-- Ajout au socle des 3 manques récurrents (historique fiable hors assortiment)
-- ============================================================================
-- Après recalcul des coefficients, le runner est strictement piloté par le
-- référentiel (règle « le référentiel pilote l'assortiment »). 3 produits avec
-- historique récurrent (≥2 matchs) étaient consommés mais absents du socle de
-- leur espace : on les intègre au référentiel (niveau S), avec leur conso réelle,
-- pour qu'ils soient montés au bon volume. Les autres produits mono-match restent
-- écartés (bruit).
--   Corona            → Bistrot     (55.5/match, 2 matchs)
--   Schweppes         → Bistrot     (20.5/match, 2 matchs)
--   San Pellegrino    → Salon Nord  (16/match, 4 matchs, fiabilité élevée)

insert into space_product_catalog
  (space_id, product_id, membership_level, association_level, product_family,
   is_default, is_reference, avg_consumption, coefficient, confidence_level,
   cdc_version, active, source)
values
  ('23bfbb9c-622f-473c-b8eb-139863ad3562','7cb29594-1f7b-4cb3-8df9-3728124fcd54',
   'socle','S','Bière / Fûts',        true,true,55.50,1.00,'faible','histo_gap',true,'histo_gap'),
  ('23bfbb9c-622f-473c-b8eb-139863ad3562','8b33ceba-1945-4539-b5c8-142820504554',
   'socle','S','Softs / Eau / Sirops',true,true,20.50,1.28,'faible','histo_gap',true,'histo_gap'),
  ('4d6ca50a-2b59-4b5a-9551-66a73f10ea2c','08c46d8d-5566-4046-b372-8f437e5e7cce',
   'socle','S','Softs / Eau / Sirops',true,true,16.00,0.51,'élevé','histo_gap',true,'histo_gap')
on conflict (space_id, product_id) do update
  set membership_level='socle', association_level='S', is_reference=true, active=true,
      avg_consumption=excluded.avg_consumption, updated_at=now();
