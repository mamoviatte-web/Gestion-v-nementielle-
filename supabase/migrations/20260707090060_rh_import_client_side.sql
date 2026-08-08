-- 20260707090060 — Import émargement RH côté client : RPC bulk token-gated.
-- Nécessaire car RLS active (le planificateur RH est anonyme + token) et le RPC
-- par agent existant ne porte ni note (pôle) ni space_id NULL. Valide le rôle
-- (contrainte CHECK) → 'Autre' par défaut ; status='planifié' (accent, CHECK).
create or replace function rh_import_agents_by_token(p_token text, p_agents jsonb)
returns json language plpgsql security definer set search_path to 'public' as $$
declare v_event uuid; v_rh text; v_ins int := 0; a jsonb; v_role text; v_start time; v_end time;
begin
  select event_id, rh_nom into v_event, v_rh from rh_sessions
    where session_token = p_token and is_active = true;
  if v_event is null then return json_build_object('success', false, 'error', 'Session invalide'); end if;

  -- Anti-doublon : purger l'import précédent de CET événement (jamais les saisies manuelles).
  delete from event_staff_preplan where event_id = v_event and created_by = 'Import émargement';

  for a in select * from jsonb_array_elements(p_agents) loop
    v_role := a->>'role';
    if v_role is null or v_role not in
       ('Serveur','Chef de rang','Barman','Agent de sécurité','Runner','Hôte / Hôtesse','Responsable espace','Autre')
    then v_role := 'Autre'; end if;

    begin v_start := (a->>'start')::time; exception when others then v_start := time '00:00'; end;
    begin v_end := (a->>'end')::time; exception when others then v_end := null; end;

    insert into event_staff_preplan (event_id, space_id, agent_nom, agent_prenom, agent_role,
      planned_start, planned_end, hourly_rate, status, note, created_by)
    values (
      v_event,
      nullif(a->>'space_id','')::uuid,
      coalesce(nullif(btrim(a->>'nom'),''),'Agent'),
      coalesce(nullif(btrim(a->>'prenom'),''),'-'),
      v_role,
      coalesce(v_start, time '00:00'),
      v_end,
      nullif(a->>'rate','')::numeric,
      'planifié',
      nullif(a->>'note',''),
      'Import émargement');
    v_ins := v_ins + 1;
  end loop;
  return json_build_object('success', true, 'inserted', v_ins);
end $$;
grant execute on function rh_import_agents_by_token(text, jsonb) to anon, authenticated;

-- Agents hors restauration (space_id NULL) groupés par pôle + total d'agents.
create or replace function rh_get_hors_resto_by_token(p_token text)
returns json language plpgsql security definer set search_path to 'public' as $$
declare v_event uuid;
begin
  select event_id into v_event from rh_sessions where session_token = p_token and is_active = true;
  if v_event is null then return json_build_object('success', false, 'error', 'Session invalide'); end if;
  return json_build_object(
    'success', true,
    'total_agents', (select count(*) from event_staff_preplan where event_id = v_event),
    'poles', (
      select coalesce(json_agg(json_build_object('pole', pole, 'agents', n, 'heures', h, 'liste', liste) order by n desc), '[]'::json)
      from (
        select coalesce(nullif(split_part(note, 'Pôle: ', 2), ''), 'Autres') pole,
               count(*) n, round(sum(coalesce(planned_hours, 0)), 1) h,
               json_agg(json_build_object('nom', agent_nom, 'prenom', agent_prenom, 'role', agent_role, 'heures', planned_hours) order by agent_nom) liste
        from event_staff_preplan where event_id = v_event and space_id is null
        group by 1
      ) g)
  );
end $$;
grant execute on function rh_get_hors_resto_by_token(text) to anon, authenticated;
