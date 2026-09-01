-- Assortiment espace complet = historique réel (bars & VIP)
-- ============================================================================
-- L'inventaire physique liste les produits ayant une ligne de solde à
-- l'emplacement « — Espace » du lieu. Pour que chaque bar / loge / salon puisse
-- pointer TOUT ce qu'il détient réellement, on complète le solde de chaque
-- emplacement espace avec l'ensemble des produits qu'il a effectivement stockés
-- en match (event_stock_lines, initial > 0), quantité 0 quand la ligne manque.
-- Le comptage physique renseignera le réel. Idempotent (n'ajoute que le manquant).
-- Terrasses reste vide : aucun historique de stock (servi depuis un autre point).

insert into stock_balances(product_id, location_id, current_quantity)
select distinct hl.product_id, loc.id, 0
from (
  select l.space_id, l.product_id
  from event_stock_lines l
  join products p on p.product_id = l.product_id
  group by l.space_id, l.product_id
  having sum(coalesce(l.initial_qty, 0)) > 0
) hl
join stock_locations loc
  on loc.area_id = hl.space_id and loc.location_type = 'espace'
join spaces s
  on s.space_id = hl.space_id and s.space_type in ('Bar', 'VIP')
where not exists (
  select 1 from stock_balances b
  where b.product_id = hl.product_id and b.location_id = loc.id
);
