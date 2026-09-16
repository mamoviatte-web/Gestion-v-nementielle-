-- =====================================================================
-- v_depot_balance_derived — solde DÉRIVÉ par dépôt, enrichi produit
-- ---------------------------------------------------------------------
-- Surface de lecture des cartes & tables dépôt (useDepots) alignée sur le
-- ledger : current_quantity = derived_qty (ancre + Σ flux), pas le compteur.
-- Un dépôt = reserve_centrale. Prix produit exposé → RG-003 : équipe stade.
-- =====================================================================

create or replace view public.v_depot_balance_derived as
select
  lb.location_id,
  lb.location_name,
  lb.product_id,
  p.product_name,
  p.category,
  p.unit,
  lb.derived_qty            as current_quantity,
  p.unit_price_ht           as unit_value_ht
from public.v_stock_ledger_balance lb
  join public.products p on p.product_id = lb.product_id
where lb.location_type = 'reserve_centrale'
  and p.active
  and coalesce(p.track_central_stock, true);

grant select on public.v_depot_balance_derived to authenticated;
revoke select on public.v_depot_balance_derived from anon;
