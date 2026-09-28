-- =====================================================================
-- SÉMINAIRES — PRÉ-SÉLECTION DE LA BONNE SOURCE DÉPÔT À LA SAISIE
-- ---------------------------------------------------------------------
-- CONSTAT (simulation clôtures SONEPAR/Altrad, cf. protocole agent) : à la
-- saisie de consommation séminaire, la source n'était pas choisie → repli sur
-- « Sur place — <espace> », qui n'a pas le stock des produits de dépôt (fûts,
-- softs) → anomalies `short>0` (SONEPAR Fût BUD, Pepsi ×6, San Pellegrino ×4).
--
-- VÉRITÉ MÉTIER : la bonne source d'un produit = son DÉPÔT ROUTÉ, table
-- `product_depot_routing` (per-PRODUIT, pas per-catégorie : ex. Bières 8 AUC /
-- 10 Stockage Fûts ; Soft 13 AUC / 2 Stock EST). Seul ce routage est correct.
--
-- CE CORRECTIF (3 volets) :
--   1. `zone_product_depots(p_token)` : expose le dépôt routé par produit à
--      l'UI zone (pour PRÉ-SÉLECTIONNER la source exacte à la saisie). Gated
--      par token (comme get_zone_state), aucun prix (RG-003).
--   2. `submit_zone_seminar_consumption` : FILET — si la ligne n'a pas de
--      source explicite, on stocke le dépôt routé du produit (au lieu de NULL
--      → fallback espace). Reproduction EXACTE de la version live + ce coalesce.
--   3. `on_seminaire_closed` : FILET de clôture — chaîne de repli enrichie :
--      source explicite → dépôt routé → espace sur place. Reproduction EXACTE
--      de la version live + le dépôt inséré avant l'espace.
--
-- Le régisseur garde la main (peut changer la source pré-sélectionnée). Le
-- plancher 0 + l'anomalie restent le signal honnête si une source réelle
-- manque de stock — jamais d'invention. RG-001/002/003 respectés.
-- =====================================================================

-- ── 1) Routage dépôt par produit, pour la pré-sélection UI ────────────
create or replace function public.zone_product_depots(p_token text)
returns json
language sql
security definer
set search_path to 'public'
as $$
  select coalesce(json_agg(json_build_object(
           'product_id', p.product_id,
           'depot_id',   pdr.depot_id
         )), '[]'::json)
  from products p
  join product_depot_routing pdr on pdr.product_id = p.product_id
  where p.active
    and exists (select 1 from event_spaces es
                 where es.access_token = p_token and es.token_expires_at > now());
$$;
grant execute on function public.zone_product_depots(text) to anon, authenticated;

comment on function public.zone_product_depots(text) is
  'Dépôt routé (product_depot_routing) par produit, pour pré-sélectionner la '
  'bonne source à la saisie de consommation séminaire (zone régisseur, token).';


-- ── 2) FILET saisie : défaut source = dépôt routé du produit ──────────
-- Reproduction EXACTE de la version live + coalesce vers le dépôt routé quand
-- la ligne n'a pas de source explicite (au lieu de NULL → fallback espace).
create or replace function public.submit_zone_seminar_consumption(p_token text, p_responsible_name text, p_lines jsonb)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_event uuid; v_space uuid; v_status text; v_line jsonb; v_cnt int := 0;
  closed_pat text[] := array['clôturé','cloture','clôturée','archivé','archive'];
begin
  select es.event_id, es.space_id into v_event, v_space
  from event_spaces es
  where es.access_token = p_token and es.token_expires_at > now();
  if v_event is null then
    return json_build_object('success', false, 'error', 'token_invalid');
  end if;
  if length(coalesce(p_responsible_name,'')) < 2 then         -- RG-001
    return json_build_object('success', false, 'error', 'name_required');
  end if;
  select lower(coalesce(status,'')) into v_status from events where event_id = v_event;
  if v_status = any(closed_pat) then
    return json_build_object('success', false, 'error', 'event_closed');
  end if;

  -- Saisie « remplaçante » : on repart propre pour cet espace
  delete from event_stock_lines where event_id = v_event and space_id = v_space;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    if coalesce((v_line->>'consumed_qty')::int, 0) <= 0 then continue; end if;
    insert into event_stock_lines (
      event_id, space_id, product_id, initial_qty, reassort_qty, final_qty,
      source_location_id, responsable_nom, submitted_at)
    values (
      v_event, v_space, (v_line->>'product_id')::uuid,
      (v_line->>'consumed_qty')::int, 0, 0,
      -- FILET : source explicite sinon dépôt routé du produit (jamais NULL si routé)
      coalesce(
        nullif(v_line->>'source_location_id','')::uuid,
        (select depot_id from product_depot_routing where product_id = (v_line->>'product_id')::uuid)
      ),
      p_responsible_name, now());
    v_cnt := v_cnt + 1;
  end loop;

  return json_build_object('success', true, 'lignes', v_cnt);
end $function$;


-- ── 3) FILET clôture : repli source → dépôt routé → espace ────────────
-- Reproduction EXACTE de la version live + le dépôt routé inséré AVANT le
-- fallback espace dans la résolution de la source.
create or replace function public.on_seminaire_closed()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  rec record; v_loc uuid; v_avail int; v_short int;
  closed_pat text[] := array['clôturé','cloture','clôturée','archivé','archive'];
begin
  if NEW.event_type <> 'séminaire' then return NEW; end if;
  -- uniquement à la TRANSITION vers un état clôturé
  if not ( lower(coalesce(NEW.status,'')) = any(closed_pat)
           and lower(coalesce(OLD.status,'')) <> all(closed_pat) ) then
    return NEW;
  end if;
  -- idempotence : déjà piloté ?
  if exists (select 1 from stock_movements
             where event_id=NEW.event_id and responsable_nom='Auto — pilote stock séminaire') then
    return NEW;
  end if;

  for rec in
    select l.space_id, l.product_id, l.consumed_qty::int as consumed, l.source_location_id
    from event_stock_lines l
    where l.event_id=NEW.event_id and coalesce(l.consumed_qty,0) > 0
  loop
    -- source choisie par le régisseur, sinon dépôt routé du produit,
    -- sinon l'espace sur place (dernier fallback)
    v_loc := coalesce(
               rec.source_location_id,
               (select depot_id from product_depot_routing where product_id=rec.product_id),
               espace_location_of(rec.space_id));
    if v_loc is null then continue; end if;
    select current_quantity::int into v_avail from stock_balances
      where product_id=rec.product_id and location_id=v_loc;
    if v_avail is null then
      insert into stock_balances(product_id, location_id, current_quantity, updated_by)
        values (rec.product_id, v_loc, 0, 'Séminaire '||NEW.event_name);
      v_avail := 0;
    end if;
    v_short := greatest(0, rec.consumed - v_avail);
    -- source −= consommation, plancher à 0
    update stock_balances
       set current_quantity = greatest(0, current_quantity - rec.consumed),
           last_movement_at = now(), updated_by = 'Séminaire '||NEW.event_name
     where product_id=rec.product_id and location_id=v_loc;
    -- traçabilité (RG-002) ; is_anomaly=true si stockage insuffisant (alerte)
    insert into stock_movements(event_id, product_id, space_id, from_location_id, movement_type,
        qty, is_anomaly, responsable_nom, event_category, status)
      values (NEW.event_id, rec.product_id, rec.space_id, v_loc, 'consommation',
        rec.consumed, (v_short > 0), 'Auto — pilote stock séminaire', 'seminaire', 'validated');
  end loop;
  return NEW;
end $function$;

-- ── VÉRIFICATION (lecture) ────────────────────────────────────────────
-- select public.zone_product_depots('<token>');  -- mapping produit→dépôt
-- select case when pg_get_functiondef('on_seminaire_closed'::regproc)
--        like '%product_depot_routing%' then 'filet clôture OK' end;
-- =====================================================================
