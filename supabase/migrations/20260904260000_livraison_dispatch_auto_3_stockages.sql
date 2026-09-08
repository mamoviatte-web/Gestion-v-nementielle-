-- =====================================================================
-- LIVRAISONS — DISPATCH AUTOMATIQUE VERS LES 3 POINTS DE STOCKAGE
-- ---------------------------------------------------------------------
-- PROBLÈME : une livraison est enregistrée sur UN dépôt (en-tête
-- supplier_deliveries.location_id) et le trigger update_balance_on_delivery
-- créditait CE dépôt pour TOUTES les lignes. Résultat : une réception saisie
-- sur AUC y gardait des produits qui appartiennent à un stockage unique
-- (fûts, cave vins/spiritueux) au lieu d'être ventilés.
--
-- RÈGLE MÉTIER (3 points clés de stockage, tous reserve_centrale) :
--   • Fûts (unit 'fût' / « Fût … »)          → « Stockage Fûts »
--   • Vins & Spiritueux                       → « Stock EST » (cave)
--   • Tout le reste (Softs, Sirops, Bières    → « AUC » (réserve générale)
--     bouteille, Matériel)
--
-- SOLUTION DURABLE :
--   1) helper storage_target_for_delivery(product) = le stockage unique cible
--      (résolu par nom, robuste), avec repli sur le dépôt d'en-tête si le
--      stockage cible est absent/inactif ;
--   2) le trigger de livraison crédite le solde + journalise l'entrée
--      fournisseur SUR LE STOCKAGE CIBLE (dispatch auto, RG-002) ;
--   3) réconciliation unique du stock déjà mal rangé (réception Montaner du
--      08/09 : fûts + vins/spiritueux restés en AUC) → transféré vers son
--      stockage unique, mouvement 'correction' tracé (RG-002).
--   Idempotent.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Helper : stockage cible unique d'un produit à la livraison
-- ---------------------------------------------------------------------
create or replace function public.storage_target_for_delivery(p_product uuid)
returns uuid
language sql
stable
set search_path to 'public'
as $$
  with p as (select product_name, category, unit from products where product_id = p_product)
  select l.id
  from p
  join lateral (
    select case
      when lower(p.unit) = 'fût' or p.product_name ilike 'Fût %' then 'futs'
      when p.category in ('Vins','Spiritueux')                    then 'est'
      else 'auc'
    end as bucket
  ) b on true
  join stock_locations l
    on l.location_type = 'reserve_centrale' and l.is_active = true
   and (
     (b.bucket = 'futs' and l.name ilike 'Stockage F%')
     or (b.bucket = 'est' and l.name ilike 'Stock EST%')
     or (b.bucket = 'auc' and l.name ilike 'AUC%')
   )
  limit 1;
$$;

-- ---------------------------------------------------------------------
-- 2) Trigger de livraison : crédite le STOCKAGE CIBLE (dispatch auto)
-- ---------------------------------------------------------------------
create or replace function public.update_balance_on_delivery()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare v_header uuid; v_received_by text; v_target uuid;
begin
  select location_id, received_by into v_header, v_received_by
  from supplier_deliveries where id = NEW.delivery_id;

  -- dispatch automatique : stockage unique du produit, repli sur l'en-tête
  v_target := coalesce(public.storage_target_for_delivery(NEW.product_id), v_header);

  insert into stock_movements (product_id, to_location_id, movement_type, qty, unit_price_ht, responsable_nom, is_anomaly)
  values (NEW.product_id, v_target, 'entrée_fournisseur', NEW.qty_received, NEW.unit_price_ht, coalesce(v_received_by,'Livraison'), false);

  insert into stock_balances (product_id, location_id, current_quantity, unit_value_ht, last_movement_at)
  values (NEW.product_id, v_target, NEW.qty_received, NEW.unit_price_ht, now())
  on conflict (product_id, location_id) do update
    set current_quantity = stock_balances.current_quantity + NEW.qty_received,
        unit_value_ht = coalesce(EXCLUDED.unit_value_ht, stock_balances.unit_value_ht),
        last_movement_at = now();
  return NEW;
end; $$;

-- ---------------------------------------------------------------------
-- 3) Réconciliation : ramène le stock mal rangé vers son stockage unique
-- ---------------------------------------------------------------------
do $$
declare
  v_resp text := 'Dispatch livraison → stockage unique (réconciliation)';
  rec record; v_target uuid; v_val numeric;
begin
  for rec in
    select b.product_id, b.location_id as from_loc, b.current_quantity::numeric as q,
           b.unit_value_ht, p.product_name
    from stock_balances b
    join stock_locations l on l.id = b.location_id and l.location_type = 'reserve_centrale'
    join products p on p.product_id = b.product_id
    where b.current_quantity <> 0
      and public.storage_target_for_delivery(b.product_id) is distinct from b.location_id
      and public.storage_target_for_delivery(b.product_id) is not null
  loop
    v_target := public.storage_target_for_delivery(rec.product_id);
    if v_target is null or v_target = rec.from_loc then continue; end if;

    -- trace RG-002 : transfert réserve → réserve (correction de dispatch)
    insert into stock_movements(product_id, movement_type, qty, from_location_id, to_location_id,
        unit_price_ht, responsable_nom, is_anomaly, status)
    values (rec.product_id, 'correction', rec.q::int, rec.from_loc, v_target,
        rec.unit_value_ht, v_resp, false, 'validated');

    -- crédite le stockage cible (fusion), en conservant la valorisation
    insert into stock_balances(product_id, location_id, current_quantity, unit_value_ht, last_movement_at, updated_by)
    values (rec.product_id, v_target, rec.q, rec.unit_value_ht, now(), v_resp)
    on conflict (product_id, location_id) do update
      set current_quantity = stock_balances.current_quantity + rec.q,
          unit_value_ht = coalesce(stock_balances.unit_value_ht, EXCLUDED.unit_value_ht),
          last_movement_at = now(),
          updated_by = v_resp;

    -- vide la source
    update stock_balances
       set current_quantity = 0, last_movement_at = now(), updated_by = v_resp
     where product_id = rec.product_id and location_id = rec.from_loc;
  end loop;
end $$;
