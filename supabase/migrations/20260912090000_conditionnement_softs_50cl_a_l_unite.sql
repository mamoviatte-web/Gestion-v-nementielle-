-- =====================================================================
-- CONDITIONNEMENT SOFTS 50cl → À L'UNITÉ (précision acheminement)
-- ---------------------------------------------------------------------
-- À APPLIQUER APRÈS LE MATCH DE NARBONNE (11/09). Ne change RIEN à Narbonne
-- (dont les quantités « à acheminer » ont été figées avant application).
--
-- POURQUOI (réflexion méthodologique — sur données réelles) :
--   La fiche runner arrondit « à acheminer » au conditionnement du produit
--   (arrondi_conditionnement = ceil(besoin/pack) × pack). Ces 4 softs 50cl
--   étaient en pack de 24 → forte sur-dotation des buvettes.
--
--   Analyse de la CONSO RÉELLE des 4 derniers matchs (Agen 27/08, Nice 13/08,
--   Barrage 25/05, Vannes 03/05), par espace buvette :
--     Produit               conso/espace   acheminé/espace (24 / 12 / unité)
--     Pepsi 50cl                 28,3        48 (+70%) / 36 (+27%) / 28 (0%)
--     Ice Tea 50cl               22,9        24 (+5%)  / 24 (+5%)  / 23 (0%)
--     San Pellegrino 50cl        19,7        24 (+22%) / 24 (+22%) / 20 (0%)
--     Orangina 50cl              14,6        24 (+65%) / 24 (+65%) / 15 (0%)
--
--   CONSTAT : passer à 12 ne corrige presque rien — la conso par espace est
--   comprise entre 12 et 24, donc l'arrondi retombe sur 24 (ceil(15/12)=24).
--   Seul le calcul À L'UNITÉ (pack = 1) fait coller l'acheminé au besoin issu
--   des tendances de consommation → 0% de sur-dotation, réserve préservée.
--
--   DÉCISION : conditionnement = 1 pour ces 4 softs. « à acheminer » devient
--   ceil(besoin − stock espace), sans carton fantôme. Le ROLE_STADE garde la
--   surcharge manuelle par ligne (manual_qty_to_move) pour tout cas ponctuel,
--   et packaging_qty reste ajustable au catalogue si le mode de livraison
--   change. Idempotent.
-- =====================================================================

update products
   set packaging_qty = 1
 where product_name in ('Pepsi 50cl', 'Orangina 50cl', 'Ice Tea 50cl', 'San Pellegrino 50cl')
   and coalesce(packaging_qty, 1) <> 1;

-- Contrôle (visible dans les logs d'application) : conditionnement effectif.
do $$
declare r record;
begin
  for r in
    select product_name, packaging_qty
    from products
    where product_name in ('Pepsi 50cl', 'Orangina 50cl', 'Ice Tea 50cl', 'San Pellegrino 50cl')
    order by product_name
  loop
    raise notice 'Conditionnement % = %', r.product_name, r.packaging_qty;
  end loop;
end $$;
