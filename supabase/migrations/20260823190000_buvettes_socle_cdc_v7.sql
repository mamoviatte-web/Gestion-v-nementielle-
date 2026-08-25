-- Buvettes B1–B9 — socle (niveau S) aligné sur le CDC V7 (section 6)
-- ============================================================================
-- Audit des 9 buvettes (mapping CDC §5 : B1=Nord OUEST, B2=Nord EST, B3=EST
-- NORD, B4=EST SUD, B5=Virage SUD EST, B6=SUD EST, B7=SUD OUEST, B8=Virage SUD
-- OUEST, B9=Virage OUEST) contre la grille CDC §6.
--
-- Constat : AUCUN produit du CDC n'est réellement absent — mais plusieurs
-- produits que le CDC place dans le SOCLE (affiché par défaut) n'étaient qu'au
-- niveau R/P en base, donc non montés d'office par la génération (bloc SOCLE =
-- niveau S uniquement). On les PROMEUT au niveau S. Aucune suppression : les
-- compléments (sirop citron/menthe, etc.) restent autorisés.
--
-- Promotions R/P → S (produit présent au CDC dans le socle de la buvette) :
--   B2 Nord EST        : Sirop de pêche
--   B3 EST NORD        : Sirop de grenadine
--   B6 SUD EST         : CO2, Sirop de grenadine
--   B8 Virage SUD OUEST: Orangina 50cl, San Pellegrino 50cl, Lillet Blanc,
--                        Sirop de grenadine, Sirop de pêche
--   B9 Virage OUEST    : Sirop de grenadine
-- (B1, B4, B5, B7 : socle déjà conforme.)

update area_product_reference a
   set association_level = 'S', updated_at = now()
  from products p
 where a.product_id = p.product_id
   and a.association_level <> 'S'
   and (
        (upper(btrim(a.area_name))='NORD EST'         and p.product_name='Sirop de pêche')
     or (upper(btrim(a.area_name))='EST NORD'         and p.product_name='Sirop de grenadine')
     or (upper(btrim(a.area_name))='SUD EST'          and p.product_name in ('CO2','Sirop de grenadine'))
     or (upper(btrim(a.area_name))='VIRAGE SUD OUEST' and p.product_name in ('Orangina 50cl','San Pellegrino 50cl','Lillet Blanc','Sirop de grenadine','Sirop de pêche'))
     or (upper(btrim(a.area_name))='VIRAGE OUEST'     and p.product_name='Sirop de grenadine')
   );
