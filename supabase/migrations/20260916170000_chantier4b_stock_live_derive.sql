-- =====================================================================
-- CHANTIER 4b — bascule des lectures vers le DÉRIVÉ (source de vérité ledger)
-- ---------------------------------------------------------------------
-- stock_live_balance (lue par DepotsTab, alertes, santé) sommait le COMPTEUR
-- (stock_balances.current_quantity). On la repointe sur le DÉRIVÉ du socle
-- (v_stock_ledger_balance.derived_qty = ancre + Σ flux) → l'appli lit désormais
-- la vérité du journal, pas le cache mutable.
--
-- Impact mesuré : identique partout SAUF les 6 anomalies déjà signalées (qui
-- affichent leur valeur ledger, à résoudre par comptage). Perf ~30 ms.
-- Corrige aussi un BUG LATENT : les filtres de dépôt sont bornés à
-- location_type='reserve_centrale' → le filtre « %EST% » n'attrape plus les
-- espaces « EST NORD/SUD — Espace », etc.
-- =====================================================================

create or replace view public.stock_live_balance as
select
  p.product_id, p.product_name, p.category, p.unit, p.unit_price_ht, p.min_stock,
  sum(lb.derived_qty) filter (where lb.location_type='reserve_centrale' and lb.location_name ilike 'AUC%')  as qty_auc,
  sum(lb.derived_qty) filter (where lb.location_type='reserve_centrale' and lb.location_name ilike '%EST%') as qty_est,
  sum(lb.derived_qty) filter (where lb.location_type='reserve_centrale' and lb.location_name ilike '%Fût%') as qty_futs,
  coalesce(sum(lb.derived_qty) filter (where lb.location_type='reserve_centrale'), 0) as qty_total_depot,
  coalesce((select sum(esl.initial_qty + coalesce(esl.reassort_qty,0))
            from event_stock_lines esl join events e on e.event_id=esl.event_id
            where esl.product_id=p.product_id and e.status='en_cours' and esl.final_qty is null), 0) as qty_in_event,
  coalesce(sum(lb.derived_qty) filter (where lb.location_type='reserve_centrale'), 0) * coalesce(p.unit_price_ht,0) as valeur_depot_ht,
  case
    when coalesce(sum(lb.derived_qty) filter (where lb.location_type='reserve_centrale'),0) = 0 then 'rupture'
    when p.min_stock is not null and p.min_stock > 0
         and coalesce(sum(lb.derived_qty) filter (where lb.location_type='reserve_centrale'),0) < p.min_stock::numeric then 'critique'
    else 'ok'
  end as alert_status,
  pdr.depot_name as source_depot
from products p
  left join v_stock_ledger_balance lb on lb.product_id = p.product_id
  left join product_depot_routing pdr on pdr.product_id = p.product_id
where p.active = true and coalesce(p.track_central_stock, true)
group by p.product_id, p.product_name, p.category, p.unit, p.unit_price_ht, p.min_stock, pdr.depot_name
order by p.category, p.product_name;
