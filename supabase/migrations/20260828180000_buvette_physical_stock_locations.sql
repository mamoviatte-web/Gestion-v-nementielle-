-- Emplacements de stockage 'espace' pour les buvettes physiques
-- ============================================================================
-- Le sélecteur « Stocks · Par espace » liste les stock_locations de type 'espace'.
-- Les buvettes PHYSIQUES (Nord EST, EST NORD, EST SUD, Nord OUEST, Parvis Nord,
-- SUD EST/OUEST, Virage…, Buvette Toinou) n'en avaient pas → absentes de la liste,
-- alors que les deux SLOTS SUPERVISEURS (Buvette 1 / Buvette 2), qui ne stockent
-- rien, y figuraient. On corrige : un emplacement 'espace' par buvette physique,
-- et désactivation des emplacements des slots superviseurs (0 solde, 0 mouvement).

-- 1) Créer l'emplacement 'espace' manquant de chaque buvette physique active.
insert into stock_locations (name, location_type, area_id, is_active)
select s.space_name || ' — Espace', 'espace', s.space_id, true
from spaces s
where s.service_type = 'buvette'
  and coalesce(s.is_supervisor_slot, false) = false
  and s.active
  and not exists (
    select 1 from stock_locations sl
     where sl.area_id = s.space_id and sl.location_type = 'espace');

-- 2) Désactiver les emplacements 'espace' des slots superviseurs (Buvette 1/2) :
--    ce ne sont pas des lieux de stockage. useStockLocations filtre is_active=true.
update stock_locations sl
   set is_active = false
  from spaces s
 where sl.area_id = s.space_id
   and sl.location_type = 'espace'
   and coalesce(s.is_supervisor_slot, false) = true;
