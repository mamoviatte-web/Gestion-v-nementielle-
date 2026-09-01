-- Fûts dans l'inventaire physique des espaces
-- ============================================================================
-- L'inventaire (onglet Stock › Inventaire) liste les produits qui ont une
-- ligne de solde (stock_balances) à l'emplacement « — Espace » du lieu compté.
-- Les fûts n'étaient présents qu'à la Réserve : ils n'apparaissaient donc PAS
-- dans le comptage d'un bar (ex. Bistrot), alors qu'ils y sont physiquement
-- tirés à la pression. On ajoute, pour chaque espace, sa VRAIE gamme de fûts
-- — déduite de l'historique réel des matchs (event_stock_lines) — au solde de
-- son emplacement espace, quantité 0 (le comptage physique renseignera le réel).
-- Idempotent : n'insère que les lignes manquantes.

insert into stock_balances(product_id, location_id, current_quantity)
select distinct hl.product_id, loc.id, 0
from (
  select l.space_id, l.product_id
  from event_stock_lines l
  join products p on p.product_id = l.product_id
  where p.unit = 'fût'
  group by l.space_id, l.product_id
  having sum(coalesce(l.initial_qty, 0)) > 0   -- fût réellement dressé au moins une fois
) hl
join stock_locations loc
  on loc.area_id = hl.space_id and loc.location_type = 'espace'
where not exists (
  select 1 from stock_balances b
  where b.product_id = hl.product_id and b.location_id = loc.id
);
