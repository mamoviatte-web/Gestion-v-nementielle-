-- ═══════════════════════════════════════════════════════════════════════════
-- register_keg_reception : tracer aussi les lignes de livraison
-- (supplier_delivery_lines) en plus de keg_inventory, pour que le registre des
-- factures calcule « total reçu » et « total calculé HT » (Σ reçu×prix) — sans
-- quoi l'écart facture vs reçu serait faux (comparé à 0). Reste identique par
-- ailleurs (fûts pleins incrémentés, prix maître mis à jour, garde ROLE_STADE).
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.register_keg_reception(p_supplier text, p_date date, p_received_by text, p_invoice text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_kegs jsonb DEFAULT '[]'::jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- volume : fourni sinon standard produit sinon 0 (ex. CO2)
    v_vol := coalesce(nullif(v_line->>'volume_liters','')::numeric,
                      (select volume_liters from keg_volume_standards where product_id=v_pid),
                      0);
    insert into keg_inventory (product_id, status, qty, volume_liters, delivery_id, received_at, lot_reference, responsable_nom, notes)
    values (v_pid, 'plein', v_q, v_vol, v_id, p_date,
            nullif(v_line->>'lot',''), btrim(p_received_by), 'Réception '||btrim(p_supplier));
    -- ligne de livraison → alimente le registre (total reçu / total calculé HT)
    insert into supplier_delivery_lines (delivery_id, product_id, qty_ordered, qty_received, qty_refused, unit_price_ht, lot_number)
    values (v_id, v_pid, v_q, v_q, 0, nullif(v_line->>'unit_price_ht','')::numeric, nullif(v_line->>'lot',''));
    -- MAJ prix produit si fourni (dernier prix d'achat)
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
