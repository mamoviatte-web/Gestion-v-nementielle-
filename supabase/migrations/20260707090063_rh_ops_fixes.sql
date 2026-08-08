-- RH opérationnel — correctifs des RPC de saisie (bloquants).
--
-- Deux bugs empêchaient toute saisie :
--  1. planned_hours est une COLONNE GÉNÉRÉE (planned_end - planned_start) : on ne
--     peut ni l'insérer ni la mettre à jour. rh_add_agent l'insérait,
--     rh_edit_agent la modifiait → « cannot insert/update generated column ».
--     Fix : ne plus toucher planned_hours ; dériver planned_end depuis p_hours
--     (planned_hours se recalcule alors automatiquement).
--  2. agent_role a un CHECK strict (8 valeurs) ; rh_add_agent posait 'Employé'
--     par défaut → violation de contrainte. Fix : rh_coerce_role() ramène toute
--     valeur vers l'enum (défaut 'Autre').

-- Helper : normalise un rôle libre vers l'enum agent_role.
CREATE OR REPLACE FUNCTION rh_coerce_role(p_role text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  select case
    when p_role = any(array['Serveur','Chef de rang','Barman','Agent de sécurité',
                            'Runner','Hôte / Hôtesse','Responsable espace','Autre']) then p_role
    when p_role ilike '%respo%'                       then 'Responsable espace'
    when p_role ilike '%hotesse%' or p_role ilike '%h_te%' then 'Hôte / Hôtesse'
    when p_role ilike '%serveur%'                     then 'Serveur'
    when p_role ilike '%barman%'                      then 'Barman'
    when p_role ilike '%runner%'                      then 'Runner'
    when p_role ilike '%securit%' or p_role ilike '%s_curit%' then 'Agent de sécurité'
    else 'Autre'
  end;
$$;

-- rh_add_agent : plus de planned_hours, planned_end dérivé de p_hours, rôle coercé.
CREATE OR REPLACE FUNCTION rh_add_agent(
  p_event uuid, p_pole text, p_space uuid, p_nom text, p_prenom text,
  p_role text DEFAULT 'Autre', p_start time DEFAULT '00:00', p_end time DEFAULT NULL,
  p_hours numeric DEFAULT NULL, p_rate numeric DEFAULT NULL, p_by text DEFAULT 'RH')
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
declare v_id uuid; v_rate numeric; v_loc text; v_role text; v_start time; v_end time;
begin
  if not is_stade() then return json_build_object('success',false,'error','Réservé équipe stade'); end if;
  perform rh_assert_open(p_event);
  if length(btrim(coalesce(p_nom,''))) < 1 then return json_build_object('success',false,'error','Nom requis'); end if;
  v_role  := rh_coerce_role(p_role);
  v_rate  := coalesce(p_rate, case when v_role = 'Responsable espace' then 12 else 16.5 end);
  v_start := coalesce(p_start,'00:00');
  v_end   := coalesce(p_end, case when p_hours is not null then (v_start + (p_hours * interval '1 hour'))::time else null end);
  insert into event_staff_preplan (event_id, space_id, pole, agent_nom, agent_prenom, agent_role,
     planned_start, planned_end, hourly_rate, status, note, created_by)
  values (p_event, p_space, case when p_space is null then coalesce(p_pole,'Autres') else null end,
     btrim(p_nom), coalesce(nullif(btrim(p_prenom),''),'-'), v_role,
     v_start, v_end, v_rate, 'planifié',
     case when p_space is null then 'Pôle: '||coalesce(p_pole,'Autres') else null end, p_by)
  returning id into v_id;
  v_loc := rh_agent_location(p_space, p_pole, null);
  insert into rh_staff_movements (event_id, agent_id, agent_nom, agent_prenom, action, to_kind, to_ref, moved_by)
  values (p_event, v_id, btrim(p_nom), btrim(p_prenom), 'ajout',
     case when p_space is null then 'pole' else 'espace' end, v_loc, p_by);
  return json_build_object('success',true,'id',v_id);
end;
$fn$;

-- rh_edit_agent : plus de planned_hours, heures via planned_end, rôle coercé.
CREATE OR REPLACE FUNCTION rh_edit_agent(
  p_agent uuid, p_nom text, p_prenom text, p_role text,
  p_hours numeric DEFAULT NULL, p_rate numeric DEFAULT NULL, p_by text DEFAULT 'RH')
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
declare v_ev uuid; v_old text; v_start time;
begin
  if not is_stade() then return json_build_object('success',false,'error','Réservé équipe stade'); end if;
  select event_id, agent_prenom||' '||agent_nom, planned_start into v_ev, v_old, v_start
  from event_staff_preplan where id=p_agent;
  if v_ev is null then return json_build_object('success',false,'error','Agent introuvable'); end if;
  perform rh_assert_open(v_ev);
  update event_staff_preplan set
    agent_nom    = btrim(p_nom),
    agent_prenom = coalesce(nullif(btrim(p_prenom),''),'-'),
    agent_role   = case when p_role is null then agent_role else rh_coerce_role(p_role) end,
    planned_end  = case when p_hours is not null
                        then (coalesce(v_start,'00:00') + (p_hours * interval '1 hour'))::time
                        else planned_end end,
    hourly_rate  = coalesce(p_rate,hourly_rate),
    updated_by   = p_by
  where id=p_agent;
  insert into rh_staff_movements (event_id, agent_id, agent_nom, agent_prenom, action, detail, moved_by)
  values (v_ev, p_agent, btrim(p_nom), btrim(p_prenom), 'renommage', 'était: '||coalesce(v_old,''), p_by);
  return json_build_object('success',true);
end;
$fn$;
