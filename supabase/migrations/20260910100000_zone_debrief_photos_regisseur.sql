-- =====================================================================
-- RAPPORT PHOTO TERRAIN CÔTÉ RÉGISSEUR (zone séminaire)
-- ---------------------------------------------------------------------
-- Le régisseur doit pouvoir CAPTURER lui-même, depuis sa page zone, les
-- photos catégorisées (mise en place / F&B / fin d'événement) + cocher la
-- checklist terrain, afin d'anticiper toutes les photos et les rendus. La
-- vue stade (StadeDebriefView) et l'export PDF consomment déjà debrief_photos ;
-- il ne manquait que la SAISIE côté régisseur.
--
-- debrief_photos et le bucket 'debrief-photos' sont déjà ouverts au rôle anon
-- (zone publique). Il reste deux points :
--   1. exposer event_id / space_id dans get_zone_state (les composants photo
--      en ont besoin) ;
--   2. ouvrir debrief_photo_checklist au rôle anon (jusqu'ici authenticated
--      seulement) pour que la checklist soit enregistrable depuis la zone.
-- Idempotent.
-- =====================================================================

-- 1) get_zone_state : ajout event_id + space_id (additif, reste identique).
create or replace function public.get_zone_state(p_token text)
returns json language plpgsql security definer set search_path to 'public'
as $function$
DECLARE v_event UUID; v_space UUID; v_result JSON;
BEGIN
  SELECT es.event_id, es.space_id INTO v_event, v_space
  FROM event_spaces es WHERE es.access_token = p_token AND es.token_expires_at > now();
  IF v_event IS NULL THEN RETURN '{"valid": false}'::json; END IF;

  SELECT json_build_object(
    'valid', true,
    'event_id', v_event,
    'space_id', v_space,
    'event_type', (SELECT event_type FROM events WHERE event_id=v_event),
    'products', COALESCE((SELECT json_agg(json_build_object(
        'product_id', p.product_id, 'product_name', p.product_name, 'unit', p.unit, 'category', p.category)
        ORDER BY p.category, p.product_name) FROM products p WHERE p.active), '[]'::json),
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

-- 2) Checklist photo terrain : accessible au régisseur (anon) depuis la zone.
alter table debrief_photo_checklist enable row level security;
drop policy if exists zone_checklist_read on debrief_photo_checklist;
drop policy if exists zone_checklist_insert on debrief_photo_checklist;
drop policy if exists zone_checklist_update on debrief_photo_checklist;
create policy zone_checklist_read on debrief_photo_checklist for select to anon using (true);
create policy zone_checklist_insert on debrief_photo_checklist for insert to anon with check (true);
create policy zone_checklist_update on debrief_photo_checklist for update to anon using (true) with check (true);
