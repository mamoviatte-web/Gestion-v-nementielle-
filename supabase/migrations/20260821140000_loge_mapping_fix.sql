-- Fiche runner Loges — correctifs de mapping (confirmés côté métier).
--
-- 1) Blocs OUEST : le fichier source nomme les deux blocs « PAGNOL » et
--    « GALICE ». Mapping validé :
--        PAGNOL  → Loge Ouest Sud   (8be2956e-…)
--        GALICE  → Loge Ouest Nord  (673b6e4e-…)
--    L'import initial avait pris la convention inverse ; on échange donc les
--    deux space_id (via un placeholder temporaire pour éviter toute collision
--    sur UNIQUE(space_id, loge_label, product_label)).
--
-- 2) « Bière bouteille » (dotation Loge Est) = produit catalogue
--    « Bière en verre » → on rattache le product_id (croisement avec le stock).

begin;

-- 1) Swap PAGNOL (Ouest Nord → Ouest Sud) ⇄ GALICE (Ouest Sud → Ouest Nord)
update loge_dotations
   set space_id = '00000000-0000-0000-0000-000000000000'
 where space_id = '673b6e4e-0f5a-406f-9029-c35b25a38103';           -- ex-Ouest Nord (PAGNOL)

update loge_dotations
   set space_id = '673b6e4e-0f5a-406f-9029-c35b25a38103'
 where space_id = '8be2956e-a379-4e8e-a3eb-65401bac3c56';           -- GALICE → Ouest Nord

update loge_dotations
   set space_id = '8be2956e-a379-4e8e-a3eb-65401bac3c56'
 where space_id = '00000000-0000-0000-0000-000000000000';           -- PAGNOL → Ouest Sud

-- 2) Rattachement du produit générique au catalogue
update loge_dotations
   set product_id = 'f7ba17a8-26ab-410d-a012-8a1825bd4430'          -- Bière en verre
 where product_id is null
   and product_label = 'Bière bouteille';

commit;
