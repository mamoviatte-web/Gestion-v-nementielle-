-- =====================================================================
-- LIVRAISONS — LES FÛTS ALIMENTENT LE CIRCUIT KEG (visuel + quantités justes)
-- ---------------------------------------------------------------------
-- CONSTAT : le stock des fûts vit dans DEUX registres qui doivent se
-- refléter :
--   • keg_inventory / keg_summary  → LE registre métier des fûts (vue
--     « Stockage Fûts » : pleins / en espace / vides, dispatch, purge,
--     inventaire, détail à l'unité) ;
--   • stock_balances(Stockage Fûts) → le miroir de valorisation (cockpit).
-- La réception « fûts » dédiée (register_keg_reception) écrit bien les DEUX.
-- MAIS une livraison saisie via la modale générique (register_delivery) ne
-- créditait que stock_balances → les fûts reçus (livraison Montaner : 78 Fût
-- BUD, 38 LEFFE…) n'apparaissaient PAS dans la vue Stockage Fûts (keg_summary
-- montrait encore 18 BUD) alors que le cockpit montrait 100.
--
-- CORRECTIF :
--   1) register_delivery alimente désormais AUSSI keg_inventory ('plein')
--      pour toute ligne « fût » — même mécanisme que register_keg_reception.
--      → les prochaines livraisons de fûts apparaissent immédiatement dans
--        leur stockage, à l'unité, avec la bonne quantité (miroir intact).
--   2) Réconciliation de l'existant : on aligne la vue fûts (keg_summary) sur
--      le stock réellement reçu et valorisé (stock_balances Stockage Fûts) via
--      le mécanisme natif d'inventaire fûts (record_keg_count) — la VALEUR
--      n'est pas déplacée, seule la vue métier rattrape les réceptions.
--   3) Nettoyage : suppression des lignes de solde « fantômes » à 0 laissées
--      dans un dépôt qui n'est pas le stockage cible du produit (fûts /
--      vins / spiritueux restés listés à 0 dans AUC) → chaque produit
--      n'apparaît plus que dans son stockage unique.
--   Idempotent.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) register_delivery : alimente keg_inventory pour les lignes « fût »
-- ---------------------------------------------------------------------
create or replace function public.register_delivery(
  p_supplier text, p_date date, p_location uuid, p_received_by text,
  p_invoice text default null, p_notes text default null, p_lines jsonb default '[]'::jsonb)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid; v_line jsonb; v_total numeric := 0; v_n int := 0;
  v_pid uuid; v_q numeric; v_is_keg boolean; v_vol numeric;
begin
  if not is_stade() then return json_build_object('success',false,'error','Réservé équipe stade'); end if;
  if p_supplier is null or p_date is null or p_location is null or coalesce(btrim(p_received_by),'')='' then
    return json_build_object('success',false,'error','Fournisseur, date, dépôt et réceptionnaire requis'); end if;
  if coalesce(jsonb_array_length(p_lines),0) = 0 then
    return json_build_object('success',false,'error','Au moins un produit reçu est requis'); end if;

  insert into supplier_deliveries (delivery_date, supplier_name, location_id, invoice_ref, received_by, status, notes)
  values (p_date, btrim(p_supplier), p_location, nullif(btrim(p_invoice),''), btrim(p_received_by), 'reçu', nullif(btrim(p_notes),''))
  returning id into v_id;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_pid := (v_line->>'product_id')::uuid;
    v_q   := coalesce((v_line->>'qty_received')::numeric,0);
    if v_pid is null or v_q <= 0 then
      continue;  -- ignore les lignes vides
    end if;

    insert into supplier_delivery_lines (delivery_id, product_id, qty_ordered, qty_received, qty_refused, unit_price_ht, lot_number, expiry_date, notes)
    values (v_id, v_pid,
      nullif(v_line->>'qty_ordered','')::numeric, v_q,
      nullif(v_line->>'qty_refused','')::numeric,
      nullif(v_line->>'unit_price_ht','')::numeric,
      nullif(v_line->>'lot_number',''),
      nullif(v_line->>'expiry_date','')::date,
      nullif(v_line->>'notes',''));

    -- FÛT : alimente aussi le registre métier des fûts (keg_inventory 'plein'),
    -- comme register_keg_reception. Le trigger de ligne crédite déjà
    -- stock_balances(Stockage Fûts) via storage_target_for_delivery → miroir.
    select (lower(unit)='fût' or product_name ilike 'Fût %') into v_is_keg from products where product_id=v_pid;
    if coalesce(v_is_keg,false) then
      v_vol := coalesce((select volume_liters from keg_volume_standards where product_id=v_pid), 0);
      -- received_at = now() (moment de saisie) : garantit que la réception est
      -- postérieure à tout comptage physique du même jour (sinon keg_summary,
      -- qui n'agrège que les réceptions APRÈS le dernier comptage, l'ignorerait).
      insert into keg_inventory (product_id, status, qty, volume_liters, delivery_id, received_at, responsable_nom, notes)
      values (v_pid, 'plein', v_q::int, v_vol, v_id, now(), btrim(p_received_by), 'Réception '||btrim(p_supplier));
    end if;

    v_total := v_total + v_q * coalesce((v_line->>'unit_price_ht')::numeric,0);
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    delete from supplier_deliveries where id=v_id;
    return json_build_object('success',false,'error','Aucune ligne valide (quantité reçue > 0 requise)');
  end if;

  return json_build_object('success',true,'delivery_id',v_id,'nb_lignes',v_n,'total_ht',round(v_total,2));
end; $function$;

-- ---------------------------------------------------------------------
-- 1bis) register_keg_reception : received_at = now() (même raison)
-- ---------------------------------------------------------------------
create or replace function public.register_keg_reception(
  p_supplier text, p_date date, p_received_by text, p_invoice text default null,
  p_notes text default null, p_kegs jsonb default '[]'::jsonb)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_depot uuid := '936472cf-25c7-43d3-bbd4-23a809906d82'; -- Stockage Fûts
  v_id uuid; v_line jsonb; v_n int := 0; v_qty int := 0; v_vol numeric; v_pid uuid; v_q int;
begin
  if not is_stade() then return json_build_object('success',false,'error','Réservé équipe stade'); end if;
  if p_supplier is null or p_date is null or coalesce(btrim(p_received_by),'')='' then
    return json_build_object('success',false,'error','Fournisseur, date et réceptionnaire requis'); end if;
  if coalesce(jsonb_array_length(p_kegs),0)=0 then
    return json_build_object('success',false,'error','Au moins un fût/CO2 requis'); end if;

  insert into supplier_deliveries (delivery_date, supplier_name, location_id, invoice_ref, received_by, status, notes)
  values (p_date, btrim(p_supplier), v_depot, nullif(btrim(p_invoice),''), btrim(p_received_by), 'reçu',
          coalesce(nullif(btrim(p_notes),''),'Réception fûts'))
  returning id into v_id;

  for v_line in select value from jsonb_array_elements(p_kegs) loop
    v_pid := (v_line->>'product_id')::uuid;
    v_q := coalesce((v_line->>'qty')::int,0);
    if v_pid is null or v_q <= 0 then continue; end if;
    v_vol := coalesce(nullif(v_line->>'volume_liters','')::numeric,
                      (select volume_liters from keg_volume_standards where product_id=v_pid), 0);
    insert into keg_inventory (product_id, status, qty, volume_liters, delivery_id, received_at, lot_reference, responsable_nom, notes)
    values (v_pid, 'plein', v_q, v_vol, v_id, now(),
            nullif(v_line->>'lot',''), btrim(p_received_by), 'Réception '||btrim(p_supplier));
    insert into supplier_delivery_lines (delivery_id, product_id, qty_ordered, qty_received, qty_refused, unit_price_ht, lot_number)
    values (v_id, v_pid, v_q, v_q, 0, nullif(v_line->>'unit_price_ht','')::numeric, nullif(v_line->>'lot',''));
    if nullif(v_line->>'unit_price_ht','') is not null then
      update products set unit_price_ht=(v_line->>'unit_price_ht')::numeric where product_id=v_pid;
    end if;
    v_n := v_n + 1; v_qty := v_qty + v_q;
  end loop;

  if v_n = 0 then
    delete from supplier_deliveries where id=v_id;
    return json_build_object('success',false,'error','Aucun fût valide (qty > 0 requise)');
  end if;

  return json_build_object('success',true,'delivery_id',v_id,'nb_produits',v_n,'nb_futs',v_qty);
end $function$;

-- ---------------------------------------------------------------------
-- 2) Réconciliation : aligne keg_summary sur stock_balances(Stockage Fûts)
--    (rattrape les fûts reçus via register_delivery, ex. livraison Montaner)
--    → mécanisme natif d'inventaire fûts, la valeur n'est pas déplacée.
-- ---------------------------------------------------------------------
do $$
declare rec record; v_res json;
begin
  for rec in
    select p.product_id, p.product_name,
           coalesce(sb.qty,0)::int as sb_qty,
           coalesce(ks.pleins,0)::int as keg_pleins
    from products p
    join (
      select b.product_id, sum(b.current_quantity) as qty
      from stock_balances b
      join stock_locations l on l.id=b.location_id and l.name ilike 'Stockage F%'
      group by b.product_id
    ) sb on sb.product_id = p.product_id
    left join keg_summary ks on ks.product_id = p.product_id
    where (p.product_name ilike 'Fût %' or lower(p.unit)='fût')
      and coalesce(sb.qty,0)::int is distinct from coalesce(ks.pleins,0)::int
  loop
    -- fixe le comptage physique = stock valorisé réel → keg_summary rattrape
    select public.record_keg_count(rec.product_id, rec.sb_qty,
      'Réconciliation livraison→fûts', 'Alignement vue Stockage Fûts sur stock reçu') into v_res;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3) Nettoyage des lignes de solde « fantômes » (0) hors stockage cible
--    → chaque produit n'apparaît plus que dans son stockage unique.
-- ---------------------------------------------------------------------
do $$
declare rec record;
begin
  for rec in
    select b.product_id, b.location_id
    from stock_balances b
    join stock_locations l on l.id = b.location_id and l.location_type = 'reserve_centrale'
    where b.current_quantity = 0
      and public.storage_target_for_delivery(b.product_id) is not null
      and public.storage_target_for_delivery(b.product_id) is distinct from b.location_id
  loop
    delete from stock_balances where product_id = rec.product_id and location_id = rec.location_id;
  end loop;
end $$;
