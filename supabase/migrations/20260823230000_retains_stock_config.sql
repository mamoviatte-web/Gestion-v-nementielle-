-- Espaces à stock conservé (retains_stock) — configuration métier
-- ============================================================================
-- Règle exploitant : dans certains espaces, le stock boissons NON consommé
-- reste sur place à la clôture (il ne repart pas au dépôt) ; il devient le stock
-- d'ouverture du prochain événement. Partout ailleurs, le reste repart
-- automatiquement en mouvement vers le dépôt de stockage destiné.
--
-- La logique est déjà implémentée dans on_stock_final_entered (branche
-- v_retains). Ici on ALIGNE le drapeau retains_stock sur la liste métier.
--
-- Espaces à stock conservé (retains_stock = true) :
--   Bodega, Salon Nord, Salon Sud, Loge Est, Loge Ouest Nord, Loge Ouest Sud,
--   Bistrot, Club 70 Nord, Club 70 Sud, Comptoir, Le Pub, Wine bar Nord, Wine bar Sud,
--   + buvettes Nord EST, EST NORD, EST SUD.
-- Tous les autres espaces : retains_stock = false (retour dépôt automatique).

-- 1) Active la conservation sur la liste métier (les 8 déjà à true sont idempotents).
update spaces set retains_stock = true
 where space_name in (
   'Bodega', 'Salon Nord', 'Salon Sud',
   'Loge Est', 'Loge Ouest Nord', 'Loge Ouest Sud',
   'Bistrot', 'Club 70 Nord', 'Club 70 Sud', 'Comptoir', 'Le Pub',
   'Wine bar Nord', 'Wine bar Sud',
   'Nord EST', 'EST NORD', 'EST SUD'
 );

-- 2) Garantit le retour dépôt (false) partout ailleurs.
update spaces set retains_stock = false
 where space_name not in (
   'Bodega', 'Salon Nord', 'Salon Sud',
   'Loge Est', 'Loge Ouest Nord', 'Loge Ouest Sud',
   'Bistrot', 'Club 70 Nord', 'Club 70 Sud', 'Comptoir', 'Le Pub',
   'Wine bar Nord', 'Wine bar Sud',
   'Nord EST', 'EST NORD', 'EST SUD'
 )
 and coalesce(retains_stock, false) is distinct from false;
