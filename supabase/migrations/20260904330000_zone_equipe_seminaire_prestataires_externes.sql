-- =====================================================================
-- AXE 1 — HORAIRES ÉQUIPE / PRESTATAIRES EXTERNES CÔTÉ RÉGISSEUR SÉMINAIRE
-- ---------------------------------------------------------------------
-- Sur les MATCHS, le responsable saisit toute son équipe (get/upsert/delete/
-- confirm_zone_staff_hour → zone_staff_hours), via un jeton match
-- (match_access_sessions). Côté SÉMINAIRE, le régisseur passe par un jeton
-- zone différent (event_spaces.access_token) et ne pouvait saisir que SES
-- propres horaires.
--
-- Solution durable & non intrusive : un résolveur de session qui accepte les
-- DEUX types de jeton, réutilisé par les 4 RPC existantes → le régisseur
-- séminaire dispose du MÊME outil d'équipe que les matchs, alimentant les mêmes
-- charges RH (zone_staff_hours). Ajout d'un indicateur « prestataire externe ».
-- Le flux match reste strictement identique. Idempotent.
-- =====================================================================

-- Indicateur prestataire externe (traiteur, sécurité, technique… hors staff club)
alter table zone_staff_hours add column if not exists is_external boolean default false;

-- Résolveur : jeton match OU jeton zone séminaire → (event, space canonique, nom)
create or replace function public.zone_resolve_session(p_token text)
returns table(event_id uuid, space_id uuid, staff_name text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select mas.event_id, zone_canonical_space(mas.space_id), mas.staff_name
  from match_access_sessions mas
  where mas.session_token = p_token and mas.is_active = true
  union all
  select es.event_id, zone_canonical_space(es.space_id), es.space_responsible_name
  from event_spaces es
  where es.access_token = p_token and es.token_expires_at > now()
    and not exists (select 1 from match_access_sessions m where m.session_token = p_token and m.is_active = true)
  limit 1;
$function$;

-- ------- upsert : ajout / édition d'un membre (avec prestataire externe) -------
create or replace function public.upsert_zone_staff_member(
  p_token text, p_staff_id uuid, p_staff_name text, p_role text,
  p_arrival_time time, p_departure_time time,
  p_break_minutes integer default 0, p_notes text default null,
  p_is_external boolean default false)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_e uuid; v_s uuid; v_mgr text; v_id uuid;
begin
  select event_id, space_id, staff_name into v_e, v_s, v_mgr from public.zone_resolve_session(p_token);
  if v_e is null then return json_build_object('success', false, 'error', 'Session invalide'); end if;
  if length(trim(coalesce(p_staff_name, ''))) < 2 then return json_build_object('success', false, 'error', 'Nom requis'); end if;

  if p_staff_id is null then
    insert into zone_staff_hours (event_id, space_id, staff_name, role, arrival_time, departure_time, break_minutes, notes, entered_by, is_external)
    values (v_e, v_s, initcap(trim(p_staff_name)), p_role, p_arrival_time, p_departure_time, coalesce(p_break_minutes, 0), p_notes, v_mgr, coalesce(p_is_external, false))
    returning id into v_id;
  else
    update zone_staff_hours set staff_name = initcap(trim(p_staff_name)), role = p_role,
      arrival_time = p_arrival_time, departure_time = p_departure_time, break_minutes = coalesce(p_break_minutes, 0),
      notes = p_notes, is_external = coalesce(p_is_external, is_external), updated_at = now()
    where id = p_staff_id and event_id = v_e and space_id = v_s returning id into v_id;
    if v_id is null then return json_build_object('success', false, 'error', 'Agent introuvable'); end if;
  end if;
  return json_build_object('success', true, 'id', v_id);
end; $function$;

-- ------- delete -------
create or replace function public.delete_zone_staff_member(p_token text, p_staff_id uuid)
returns json language plpgsql security definer set search_path to 'public'
as $function$
declare v_e uuid; v_s uuid;
begin
  select event_id, space_id into v_e, v_s from public.zone_resolve_session(p_token);
  if v_e is null then return json_build_object('success', false, 'error', 'Session invalide'); end if;
  delete from zone_staff_hours where id = p_staff_id and event_id = v_e and space_id = v_s;
  return json_build_object('success', true);
end; $function$;

-- ------- confirm (staff / manager) -------
create or replace function public.confirm_zone_staff_hour(p_token text, p_staff_id uuid, p_type text)
returns json language plpgsql security definer set search_path to 'public'
as $function$
declare v_e uuid; v_s uuid;
begin
  select event_id, space_id into v_e, v_s from public.zone_resolve_session(p_token);
  if v_e is null then return json_build_object('success', false, 'error', 'Session invalide'); end if;
  if p_type = 'staff' then
    update zone_staff_hours set confirmed_by_staff = not confirmed_by_staff, updated_at = now()
     where id = p_staff_id and event_id = v_e and space_id = v_s;
  elsif p_type = 'manager' then
    update zone_staff_hours set confirmed_by_manager = not confirmed_by_manager, updated_at = now()
     where id = p_staff_id and event_id = v_e and space_id = v_s;
  end if;
  return json_build_object('success', true);
end; $function$;

-- ------- list (inclut is_external) -------
create or replace function public.get_zone_staff_hours(p_token text)
returns json language plpgsql security definer set search_path to 'public'
as $function$
declare v_e uuid; v_s uuid;
begin
  select event_id, space_id into v_e, v_s from public.zone_resolve_session(p_token);
  if v_e is null then return json_build_object('success', false, 'error', 'Session invalide'); end if;
  return json_build_object(
    'success', true,
    'staff', (
      select coalesce(json_agg(json_build_object(
        'id', h.id, 'staff_name', h.staff_name, 'role', h.role,
        'arrival_time', h.arrival_time, 'departure_time', h.departure_time,
        'break_minutes', h.break_minutes, 'hours_worked', h.hours_worked, 'rh_cost', h.rh_cost,
        'confirmed_by_staff', h.confirmed_by_staff, 'confirmed_by_manager', h.confirmed_by_manager,
        'is_external', h.is_external, 'notes', h.notes) order by h.is_external, h.role, h.staff_name), '[]'::json)
      from zone_staff_hours h where h.event_id = v_e and h.space_id = v_s),
    'summary', (
      select json_build_object('total_staff', count(*), 'total_hours', coalesce(sum(h.hours_worked), 0),
        'total_rh_cost', coalesce(sum(h.rh_cost), 0),
        'all_confirmed', coalesce(bool_and(h.confirmed_by_staff and h.confirmed_by_manager), false))
      from zone_staff_hours h where h.event_id = v_e and h.space_id = v_s)
  );
end; $function$;
