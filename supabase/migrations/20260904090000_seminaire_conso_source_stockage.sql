-- =====================================================================
-- Séminaires — saisie « consommation seule » avec source de stockage
-- ---------------------------------------------------------------------
-- Contexte : lors d'un séminaire, peu de boissons sont consommées. On
-- remplace la saisie initial/final par une saisie orientée CONSOMMATION,
-- groupée par famille, où le régisseur choisit PAR LIGNE la source de
-- stockage d'où la boisson a été prélevée (AUC / Cave EST / Stockage Fûts
-- ou « sur place » = l'espace du séminaire). Le retrait de stock s'exécute
-- automatiquement à la CLÔTURE (ROLE_STADE), depuis la source choisie.
--
-- Choix produit (validés) :
--   • source par ligne (manuel)   • retrait à la clôture ROLE_STADE
--   • consommation seule (mappée en initial=conso / final=0 pour garder le
--     reporting F&B intact : consumed_qty = initial + reassort − final).
-- =====================================================================

-- 1) Colonne source de stockage sur la ligne de stock -----------------
alter table event_stock_lines
  add column if not exists source_location_id uuid references stock_locations(id);

comment on column event_stock_lines.source_location_id is
  'Séminaire : emplacement de stockage d''où la consommation est prélevée '
  '(réserve AUC / Cave EST / Stockage Fûts / espace sur place). '
  'NULL → fallback espace sur place (comportement match).';

-- 2) Clôture séminaire : déduire depuis la SOURCE choisie -------------
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
    -- source choisie par le régisseur, sinon l'espace sur place (fallback)
    v_loc := coalesce(rec.source_location_id, espace_location_of(rec.space_id));
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

-- 3) RPC de saisie « consommation séminaire » (page régisseur) --------
-- Remplace la consommation de l'espace : efface puis réinsère les lignes
-- fournies (initial=conso, réassort=0, final=0 → consumed_qty = conso).
create or replace function public.submit_zone_seminar_consumption(
  p_token text, p_responsible_name text, p_lines jsonb)
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
      nullif(v_line->>'source_location_id','')::uuid, p_responsible_name, now());
    v_cnt := v_cnt + 1;
  end loop;

  return json_build_object('success', true, 'lignes', v_cnt);
end $function$;

grant execute on function public.submit_zone_seminar_consumption(text, text, jsonb) to anon, authenticated;

-- 4) get_zone_state étendu : event_type, sources de stockage, conso ----
create or replace function public.get_zone_state(p_token text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE v_event UUID; v_space UUID; v_result JSON;
BEGIN
  SELECT es.event_id, es.space_id INTO v_event, v_space
  FROM event_spaces es WHERE es.access_token = p_token AND es.token_expires_at > now();
  IF v_event IS NULL THEN RETURN '{"valid": false}'::json; END IF;

  SELECT json_build_object(
    'valid', true,
    'event_type', (SELECT event_type FROM events WHERE event_id=v_event),
    'products', COALESCE((SELECT json_agg(json_build_object(
        'product_id', p.product_id, 'product_name', p.product_name, 'unit', p.unit, 'category', p.category)
        ORDER BY p.category, p.product_name) FROM products p WHERE p.active), '[]'::json),
    -- Sources de stockage proposées au régisseur (sur place + 3 dépôts)
    'storage_sources', COALESCE((
      SELECT json_agg(json_build_object('id', s.id, 'label', s.label) ORDER BY s.ord)
      FROM (
        SELECT espace_location_of(v_space) AS id,
               'Sur place — ' || (SELECT space_name FROM spaces WHERE space_id=v_space) AS label, 0 AS ord
        WHERE espace_location_of(v_space) IS NOT NULL
        UNION ALL
        SELECT l.id, l.name AS label,
               CASE WHEN l.name ILIKE 'Stockage F%' THEN 3
                    WHEN l.name ILIKE '%EST%' THEN 2 ELSE 1 END AS ord
        FROM stock_locations l
        WHERE l.location_type='reserve_centrale' AND l.is_active
      ) s), '[]'::json),
    'stock_lines', COALESCE((SELECT json_agg(json_build_object(
        'product_id', sl.product_id, 'initial_qty', sl.initial_qty, 'reassort_qty', sl.reassort_qty,
        'final_qty', sl.final_qty, 'consumed_qty', sl.consumed_qty,
        'source_location_id', sl.source_location_id, 'product_state', sl.product_state))
        FROM event_stock_lines sl WHERE sl.event_id = v_event AND sl.space_id = v_space), '[]'::json),
    'arrival', (SELECT space_actual_arrival FROM event_spaces WHERE event_id=v_event AND space_id=v_space),
    'departure', (SELECT space_actual_departure FROM event_spaces WHERE event_id=v_event AND space_id=v_space),
    'staff_name', (SELECT staff_name FROM schedules
        WHERE event_id=v_event AND space_id=v_space AND declared_by_self
        ORDER BY self_declared_at DESC NULLS LAST LIMIT 1),
    'planned_start', (SELECT start_time FROM events WHERE event_id=v_event),
    'debrief', (SELECT json_build_object(
        'efficacite', d.efficacite, 'stocks_suffisants', d.stocks_suffisants,
        'besoins_materiel', d.besoins_materiel, 'suggestions_generales', d.suggestions_generales,
        'photo_urls', d.photo_urls, 'submitted_at', d.submitted_at,
        'overall_rating', d.overall_rating, 'service_score', d.service_score,
        'cleaning_score', d.cleaning_score, 'cleaning_before_ok', d.cleaning_before_ok,
        'cleaning_after_ok', d.cleaning_after_ok, 'cleaning_issues', d.cleaning_issues,
        'cleaning_comment', d.cleaning_comment,
        'technical_score', d.technical_score, 'tech_fridge_ok', d.tech_fridge_ok,
        'tech_equipment_ok', d.tech_equipment_ok, 'tech_lighting_ok', d.tech_lighting_ok,
        'tech_plumbing_ok', d.tech_plumbing_ok, 'tech_hvac_ok', d.tech_hvac_ok,
        'tech_issues', d.tech_issues, 'technical_comment', d.technical_comment,
        'has_urgent_issue', d.has_urgent_issue, 'urgent_issue_detail', d.urgent_issue_detail)
        FROM debriefs d WHERE d.event_id=v_event AND d.space_id=v_space),
    'status', json_build_object(
      'initial', EXISTS(SELECT 1 FROM event_stock_lines WHERE event_id=v_event AND space_id=v_space),
      'final', EXISTS(SELECT 1 FROM event_stock_lines WHERE event_id=v_event AND space_id=v_space AND final_qty IS NOT NULL),
      'consumption', EXISTS(SELECT 1 FROM event_stock_lines WHERE event_id=v_event AND space_id=v_space AND coalesce(consumed_qty,0) > 0),
      'schedule', EXISTS(SELECT 1 FROM event_spaces WHERE event_id=v_event AND space_id=v_space AND (space_actual_arrival IS NOT NULL OR space_actual_departure IS NOT NULL)),
      'debrief', EXISTS(SELECT 1 FROM debriefs WHERE event_id=v_event AND space_id=v_space AND submitted_at IS NOT NULL))
  ) INTO v_result;
  RETURN v_result;
END; $function$;
