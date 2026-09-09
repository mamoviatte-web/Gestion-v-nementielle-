-- =====================================================================
-- FICHES RUNNER — (A) « À ACHEMINER » PAR GAMME DE VIN + (B) NETTOYAGE
-- ---------------------------------------------------------------------
-- (A) GAMME DE VIN — le besoin d'une couleur (blanc / rouge / rosé /
--     champagne) est consolidé sur UN produit primaire (déjà fait par
--     generate_runner_dotations). MAIS le « à acheminer » ne déduisait que
--     le stock espace DE CE produit précis, pas de toute la gamme couleur.
--     Ex. Salon Sud : Rouge Grand Boise besoin 41, à acheminer 41 alors que
--     25 Rouge Paradis (même gamme rouge) sont déjà en espace → doit être 16.
--     Correctif : pour un produit d'une gamme EXCLUSIVE (allow_multiple=false,
--     ex. les vins par couleur), le stock espace pris en compte = SOMME de la
--     gamme dans l'espace. On ne monte donc que le complément, sur le produit
--     défini. Les softs/spiritueux hors gamme exclusive : inchangés.
--
-- (B) NETTOYAGE — retrait des produits ajoutés par ma régularisation qui
--     n'ont rien à faire dans ces espaces : formats 50cl (buvette) en salon
--     VIP et doublon « Ricard aux Herbes » (Ricard classique déjà présent).
--     Choix utilisateur : uniquement 50cl + Ricard aux Herbes, sur tous les
--     espaces concernés. Les autres régularisations (Schweppes, Lillet, sirop)
--     sont conservées. Espace = 0 sur ces lignes → retrait propre.
--   Idempotent.
-- =====================================================================

-- ---------------------------------------------------------------------
-- (A) event_runner_board : « à acheminer » net du stock espace de la GAMME
-- ---------------------------------------------------------------------
create or replace view event_runner_board as
with espace as (   -- stock espace LIVE par produit
  select l.area_id as space_id, b.product_id, sum(b.current_quantity) as qty
  from stock_balances b
  join stock_locations l on l.id = b.location_id
  where l.location_type = 'espace'
  group by l.area_id, b.product_id
),
espace_gamme as (  -- stock espace LIVE agrégé par gamme EXCLUSIVE (ex. couleur de vin)
  select l.area_id as space_id, pr.selection_group_id, sum(b.current_quantity) as qty
  from stock_balances b
  join stock_locations l on l.id = b.location_id and l.location_type = 'espace'
  join products pr on pr.product_id = b.product_id
  join product_selection_groups g on g.id = pr.selection_group_id and g.allow_multiple = false
  group by l.area_id, pr.selection_group_id
),
plan as (
  select
    rap.event_id, rap.space_id, rap.product_id,
    coalesce(rap.validated_quantity, rap.recommended_quantity) as needed_qty,
    -- stock espace effectif : gamme exclusive → somme couleur, sinon produit seul
    coalesce(case when g.id is not null then eg.qty else esp.qty end, 0::numeric) as area_stock_live,
    rap.manual_qty_to_move,
    arrondi_conditionnement(
      greatest(
        coalesce(rap.validated_quantity, rap.recommended_quantity)::numeric
        - coalesce(case when g.id is not null then eg.qty else esp.qty end, 0::numeric),
        0::numeric),
      coalesce(p.packaging_qty, 1)
    ) as auto_qty,
    rap.validation_status, rap.alert_type, rap.consumption_reference,
    p.product_name, p.category, p.unit_price_ht
  from runner_auto_planning rap
  join event_spaces es on es.event_id = rap.event_id and es.space_id = rap.space_id
  join spaces s2 on s2.space_id = rap.space_id
  left join products p on p.product_id = rap.product_id
  left join product_selection_groups g on g.id = p.selection_group_id and g.allow_multiple = false
  left join espace esp on esp.space_id = rap.space_id and esp.product_id = rap.product_id
  left join espace_gamme eg on eg.space_id = rap.space_id and eg.selection_group_id = p.selection_group_id
),
eff as (
  select plan.*, greatest(coalesce(plan.manual_qty_to_move, plan.auto_qty), 0) as qty_to_move
  from plan
),
reserve as (
  select b.product_id, sum(b.current_quantity) as reserve_qty
  from stock_balances b
  join stock_locations l on l.id = b.location_id
  where l.location_type = 'reserve_centrale'
  group by b.product_id
),
demand as (
  select eff.event_id, eff.product_id, sum(greatest(eff.qty_to_move, 0)) as event_demand
  from eff
  group by eff.event_id, eff.product_id
)
select
  e.event_id, e.space_id, s.space_name,
  case when s.service_type = any (array['buvette'::text, 'bar'::text]) then 'Buvettes'::text else 'VIP'::text end as family,
  s.service_type, e.product_id, e.product_name, e.category,
  e.needed_qty,
  greatest(e.qty_to_move, 0) as qty_to_move,
  e.area_stock_live::integer as area_stock,
  coalesce(res.reserve_qty, 0::numeric) as reserve_qty,
  coalesce(dem.event_demand, 0::bigint) as event_demand,
  round(greatest(e.qty_to_move, 0)::numeric * coalesce(e.unit_price_ht, 0::numeric), 2) as cost_ht,
  e.validation_status, e.alert_type,
  coalesce(res.reserve_qty, 0::numeric) >= coalesce(dem.event_demand, 0::bigint)::numeric as stock_sufficient_live,
  greatest(coalesce(dem.event_demand, 0::bigint)::numeric - coalesce(res.reserve_qty, 0::numeric), 0::numeric) as shortfall_qty,
  coalesce(e.consumption_reference, 0::numeric) as consumption_reference
from eff e
join spaces s on s.space_id = e.space_id
left join reserve res on res.product_id = e.product_id
left join demand dem on dem.event_id = e.event_id and dem.product_id = e.product_id;

-- ---------------------------------------------------------------------
-- (B) Nettoyage : retrait des 50cl (buvette) et doublon Ricard aux Herbes
--     ajoutés par la régularisation — dans tous les espaces concernés.
-- ---------------------------------------------------------------------
-- 1) fiches runner en cours (brouillon) : retirer ces lignes
delete from runner_auto_planning r
 using space_product_catalog c, products p
 where c.product_id = r.product_id and c.space_id = r.space_id and p.product_id = c.product_id
   and c.source = 'régularisation hors-carte V1.1' and c.active = true
   and (p.product_name ilike '%50cl%' or p.product_name = 'Ricard aux Herbes')
   and coalesce(r.validation_status, 'brouillon') = 'brouillon';

-- 2) lignes de solde espace à 0 (évite un re-flag hors-carte après retrait carte)
delete from stock_balances b
 using stock_locations l, space_product_catalog c, products p
 where b.location_id = l.id and l.location_type = 'espace'
   and c.space_id = l.area_id and c.product_id = b.product_id and p.product_id = c.product_id
   and c.source = 'régularisation hors-carte V1.1' and c.active = true
   and (p.product_name ilike '%50cl%' or p.product_name = 'Ricard aux Herbes')
   and b.current_quantity = 0;

-- 3) carte (socle) : retrait définitif (en dernier, les DELETE ci-dessus le référencent)
delete from space_product_catalog c
 using products p
 where p.product_id = c.product_id
   and c.source = 'régularisation hors-carte V1.1'
   and (p.product_name ilike '%50cl%' or p.product_name = 'Ricard aux Herbes');
