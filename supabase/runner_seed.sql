-- =====================================================================
-- Seed du module Runner — stocks espaces + historique (Vannes)
-- À exécuter APRÈS runner_module.sql.
-- =====================================================================

-- Stocks initiaux dans les espaces (données terrain)
insert into area_stocks (area_id, product_id, current_qty, initial_qty)
select s.space_id, p.product_id,
  case
    when s.access_code = 'SN2026'  and p.product_name = 'Mumm Cordon Rouge'  then 4
    when s.access_code = 'SN2026'  and p.product_name = 'Fût BUD'            then 1
    when s.access_code = 'SN2026'  and p.product_name = 'Whisky Jameson'     then 2
    when s.access_code = 'BV12026' and p.product_name = 'Pepsi bouteille'    then 24
    when s.access_code = 'BV12026' and p.product_name = 'Cristaline 50cl'    then 48
    else 0
  end,
  0
from spaces s, products p
where s.access_code in ('SN2026','SS2026','BV12026')
  and p.product_name in (
    'Mumm Cordon Rouge','Mumm Blanc de Blanc','Fût BUD','Fût LEFFE',
    'Whisky Jameson','Lillet Blanc','Pepsi bouteille','Cristaline 50cl')
on conflict (area_id, product_id) do nothing;

-- Historique de consommation depuis l'événement archivé « vs Vannes »
insert into event_consumptions
  (event_id, space_id, product_id, initial_stock, restock_qty, final_stock,
   unit_price_ht, event_type, expected_attendance, weather_type)
select e.event_id, sl.space_id, sl.product_id,
  sl.initial_qty, sl.reassort_qty, coalesce(sl.final_qty,0),
  p.unit_price_ht, e.event_type, e.expected_attendees, 'normal'
from event_stock_lines sl
join events e on e.event_id = sl.event_id
join products p on p.product_id = sl.product_id
where e.event_name = 'Provence Rugby vs Vannes'
on conflict (event_id, space_id, product_id) do nothing;
