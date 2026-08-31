-- Restreindre le stockage 'espace' des buvettes à Nord EST / EST NORD / EST SUD
-- ============================================================================
-- Correctif de 20260828180000 : seules Nord EST, EST NORD et EST SUD conservent du
-- stock (retains_stock=true) et ont donc un emplacement 'espace'. Les autres
-- buvettes ne conservent PAS (retains_stock=false) : à la clôture, leur reliquat
-- repart DIRECTEMENT au dépôt (trigger on_stock_final_entered) — elles n'ont pas
-- besoin d'emplacement de stockage. On retire les 8 emplacements créés en trop
-- (aucun solde, aucun mouvement).
delete from stock_locations sl
 using spaces s
 where sl.area_id = s.space_id
   and sl.location_type = 'espace'
   and s.service_type = 'buvette'
   and coalesce(s.is_supervisor_slot, false) = false
   and s.space_name not in ('Nord EST', 'EST NORD', 'EST SUD');
