-- CDC V7 — réintégration Cristaline 50cl (+ FADA Blanche PMR) au référentiel
-- ============================================================================
-- Audit zone par zone du référentiel area_product_reference contre le cahier
-- des charges V7 (CDC_StockPilot_MD_V7_Produits_VIP_vs_Buvettes.pdf, section 3).
--
-- Constat : le référentiel DB était un SOUS-ENSEMBLE strict du CDC (0 produit
-- en trop). Les seuls écarts réels, tous niveaux confondus (S/R/C/P) :
--   • Cristaline 50cl absente de 9 espaces où le CDC l'inclut pourtant dans les
--     softs standard — supprimée à tort par l'ancien override « format 50cl
--     absent des VIP/bars ». C'est la cause de l'écart constaté sur les Club 70
--     (Sud n'affichait pas d'eau alors que le CDC la prévoit).
--   • PMR : FADA Blanche Bouteille manquante (retirée avec l'ancien alias
--     « FADA BLANCHE BTL » ; le produit actif équivalent doit être présent).
--
-- Les produits « Autres / À qualifier » (Schweppes, Whisky, San Pellegrino
-- bouteille, Vittel, Pastis, Corona, FADA IPA/Abricot…) NE sont PAS des erreurs :
-- ils existent déjà au niveau R (récurrent/conditionnel), conforme à la règle
-- CDC « option contrôlée par configuration de l'événement ». On n'y touche pas.
--
-- Zones CDC prévoyant Cristaline 50cl : Club 70 Nord/Sud, Bistrot, Wine bar
-- Nord/Sud, PMR (générées via référentiel) + Loge Est / Ouest Nord / Ouest Sud
-- (fiche pilotée par loge_dotations où Cristalline figure déjà ; ajout ici pour
-- cohérence de la page Assortiment, sans impact sur la génération runner).
--
-- Additif et idempotent (NOT EXISTS) : aucune suppression, aucun doublon.

-- Cristaline 50cl (softs) → niveau S dans les 9 espaces.
insert into area_product_reference
  (area_name, area_group, product_name, product_family, association_level, product_id, cdc_version)
select z.area_name, 'VIP', 'Cristaline 50cl', 'Softs / Eau / Sirops', 'S',
       '271f1cdb-49c6-4bd0-a029-d5f839bfc84a'::uuid, 'V7'
from (values
  ('Club 70 Nord'), ('Club 70 Sud'), ('Bistrot'),
  ('Wine bar Nord'), ('Wine bar Sud'), ('PMR'),
  ('Loge Est'), ('Loge Ouest Nord'), ('Loge Ouest Sud')
) as z(area_name)
where not exists (
  select 1 from area_product_reference r
  where upper(btrim(r.area_name)) = upper(btrim(z.area_name))
    and r.product_id = '271f1cdb-49c6-4bd0-a029-d5f839bfc84a'::uuid
);

-- PMR : FADA Blanche Bouteille (bière FADA) → niveau S.
insert into area_product_reference
  (area_name, area_group, product_name, product_family, association_level, product_id, cdc_version)
select 'PMR', 'VIP', 'FADA Blanche Bouteille', 'Bière / Fûts', 'S',
       '1ed609ab-e199-4f77-ac11-5ed69bf11a14'::uuid, 'V7'
where not exists (
  select 1 from area_product_reference r
  where upper(btrim(r.area_name)) = 'PMR'
    and r.product_id = '1ed609ab-e199-4f77-ac11-5ed69bf11a14'::uuid
);
