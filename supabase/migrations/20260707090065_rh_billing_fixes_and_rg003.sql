-- RH facturation forfait/horaire — correctifs du back-office déployé.
--
-- L'ajout de la facturation a réintroduit trois régressions :
--  1. RG-003 : le garde is_stade() a disparu de get_event_rh / rh_board /
--     rh_planning_board → les coûts fuitent vers les 16 comptes ROLE_RESPONSABLE
--     (authenticated). On le ré-applique (les coûts ne sortent qu'en ROLE_STADE).
--  2. rh_add_agent / rh_edit_agent (versions billing) réécrivent planned_hours
--     (colonne GÉNÉRÉE → erreur) et posent 'Employé' (viole le CHECK agent_role).
--     On les corrige (planned_end dérivé de p_hours, rôle coercé) en gardant la
--     logique billing_mode / forfait_amount.
--  3. Doublons de signatures rh_add_agent / rh_edit_agent (versions sans billing,
--     antérieures) → ambiguïté PostgREST. On supprime les anciennes.
-- On restaure aussi le tableau `resto` de rh_board (agents restauration
-- actionnables), perdu lors du redéploiement.

-- ── 3) Supprimer les anciennes surcharges sans billing (ambiguïté) ────────────
DROP FUNCTION IF EXISTS rh_add_agent(uuid, text, uuid, text, text, text, time without time zone, time without time zone, numeric, numeric, text);
DROP FUNCTION IF EXISTS rh_edit_agent(uuid, text, text, text, numeric, numeric, text);

-- ── 2) rh_add_agent (billing) corrigé ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION rh_add_agent(
  p_event uuid, p_pole text, p_space uuid, p_nom text, p_prenom text,
  p_role text DEFAULT 'Autre', p_start time DEFAULT '00:00', p_end time DEFAULT NULL,
  p_hours numeric DEFAULT NULL, p_rate numeric DEFAULT NULL, p_by text DEFAULT 'RH',
  p_billing_mode text DEFAULT 'horaire', p_forfait numeric DEFAULT NULL)
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
     planned_start, planned_end, hourly_rate, billing_mode, forfait_amount, status, note, created_by)
  values (p_event, p_space, case when p_space is null then coalesce(p_pole,'Autres') else null end,
     btrim(p_nom), coalesce(nullif(btrim(p_prenom),''),'-'), v_role,
     v_start, v_end, v_rate, coalesce(p_billing_mode,'horaire'), p_forfait, 'planifié',
     case when p_space is null then 'Pôle: '||coalesce(p_pole,'Autres') else null end, p_by)
  returning id into v_id;
  v_loc := rh_agent_location(p_space, p_pole, null);
  insert into rh_staff_movements (event_id, agent_id, agent_nom, agent_prenom, action, to_kind, to_ref, moved_by)
  values (p_event, v_id, btrim(p_nom), btrim(p_prenom), 'ajout',
     case when p_space is null then 'pole' else 'espace' end, v_loc, p_by);
  return json_build_object('success',true,'id',v_id);
end;
$fn$;

-- ── 2) rh_edit_agent (billing) corrigé ────────────────────────────────────────
CREATE OR REPLACE FUNCTION rh_edit_agent(
  p_agent uuid, p_nom text, p_prenom text, p_role text,
  p_hours numeric DEFAULT NULL, p_rate numeric DEFAULT NULL, p_by text DEFAULT 'RH',
  p_billing_mode text DEFAULT NULL, p_forfait numeric DEFAULT NULL)
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
    agent_nom      = btrim(p_nom),
    agent_prenom   = coalesce(nullif(btrim(p_prenom),''),'-'),
    agent_role     = case when p_role is null then agent_role else rh_coerce_role(p_role) end,
    planned_end    = case when p_hours is not null
                          then (coalesce(v_start,'00:00') + (p_hours * interval '1 hour'))::time
                          else planned_end end,
    hourly_rate    = coalesce(p_rate,hourly_rate),
    billing_mode   = coalesce(p_billing_mode,billing_mode),
    forfait_amount = case when coalesce(p_billing_mode,billing_mode)='forfait'
                          then coalesce(p_forfait,forfait_amount) else forfait_amount end,
    updated_by     = p_by
  where id=p_agent;
  insert into rh_staff_movements (event_id, agent_id, agent_nom, agent_prenom, action, detail, moved_by)
  values (v_ev, p_agent, btrim(p_nom), btrim(p_prenom), 'renommage', 'était: '||coalesce(v_old,''), p_by);
  return json_build_object('success',true);
end;
$fn$;

-- ── 1) get_event_rh : garde RG-003 (corps billing conservé) ───────────────────
CREATE OR REPLACE FUNCTION get_event_rh(p_event_id uuid)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  select case when not is_stade()
    then json_build_object('closed',false,'closed_at',null,'closed_by',null,'kpis',null,
      'par_espace','[]'::json,'par_pole','[]'::json,'agents','[]'::json)
    else (
      with u as (
        select p.id, p.space_id, s.space_name, p.status,
          p.agent_nom, p.agent_prenom, p.agent_role,
          p.billing_mode, p.forfait_amount, p.hourly_rate,
          coalesce(p.actual_hours, p.planned_hours, 0)::numeric as heures,
          rh_line_cost(p.billing_mode, p.actual_hours, p.planned_hours, p.hourly_rate, p.forfait_amount) as cout,
          rh_line_cost_prev(p.billing_mode, p.planned_hours, p.hourly_rate, p.forfait_amount) as cout_prev,
          case when p.space_id is null
               then coalesce(nullif(p.pole,''), nullif(btrim(substring(coalesce(p.note,'') from 'P.le:\s*(.*)$')),''),'Autres')
               else null end as pole
        from event_staff_preplan p
        left join spaces s on s.space_id = p.space_id
        where p.event_id = p_event_id
          and coalesce(p.status,'planifié') not in ('retiré','absent')
      ),
      pax as (select coalesce(expected_attendees,0) px from events where event_id=p_event_id),
      ev as (select rh_final_closed_at, rh_final_closed_by from events where event_id=p_event_id)
      select json_build_object(
        'closed', (select rh_final_closed_at is not null from ev),
        'closed_at', (select rh_final_closed_at from ev),
        'closed_by', (select rh_final_closed_by from ev),
        'kpis', (select json_build_object(
           'nb_agents', count(*),
           'nb_espaces', count(distinct space_name) filter (where space_name is not null),
           'total_heures', round(coalesce(sum(heures),0),1),
           'cout_rh_ht', round(coalesce(sum(cout),0),2),
           'cout_previsionnel', round(coalesce(sum(cout_prev),0),2),
           'cout_reel', round(coalesce(sum(cout),0),2),
           'nb_forfait', count(*) filter (where billing_mode='forfait'),
           'nb_horaire', count(*) filter (where billing_mode<>'forfait'),
           'cout_resto', round(coalesce(sum(cout) filter (where space_id is not null),0),2),
           'cout_hors_resto', round(coalesce(sum(cout) filter (where space_id is null),0),2),
           'cout_par_pax', (select case when px>0 then round(coalesce(sum(cout),0)/px,2) else 0 end from pax)
         ) from u),
        'par_espace', (select coalesce(json_agg(json_build_object('espace',space_name,'agents',n,'heures',h,'cout',c) order by c desc),'[]'::json)
           from (select space_name, count(*) n, round(sum(heures),1) h, round(sum(cout),2) c from u where space_id is not null group by space_name) x),
        'par_pole', (select coalesce(json_agg(json_build_object('pole',pole,'agents',n,'heures',h,'cout',c) order by c desc),'[]'::json)
           from (select pole, count(*) n, round(sum(heures),1) h, round(sum(cout),2) c from u where space_id is null group by pole) y),
        'agents', (select coalesce(json_agg(json_build_object(
            'id',id,'nom',agent_nom,'prenom',agent_prenom,'role',agent_role,
            'rattachement', coalesce(space_name,'Hors resto — '||pole),
            'billing_mode',billing_mode,'taux',hourly_rate,'forfait',forfait_amount,
            'heures',heures,'cout',round(cout,2),'cout_prev',round(cout_prev,2)) order by cout desc),'[]'::json) from u)
      )
    )
  end;
$fn$;

-- ── 1) rh_board : garde RG-003 + tableau `resto` (corps billing conservé) ──────
CREATE OR REPLACE FUNCTION rh_board(p_event uuid)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  select case when not is_stade()
    then json_build_object(
      'error','Réservé équipe stade',
      'rh', json_build_object('closed',false,'kpis',null,'par_espace','[]'::json,'par_pole','[]'::json,'agents','[]'::json),
      'hors_resto','[]'::json,'resto','[]'::json,'poles','[]'::json,'espaces','[]'::json,'mouvements','[]'::json)
    else json_build_object(
      'rh', get_event_rh(p_event),
      'hors_resto', (
        select coalesce(json_agg(json_build_object(
          'id',p.id,'nom',p.agent_nom,'prenom',p.agent_prenom,'role',p.agent_role,
          'pole',coalesce(nullif(p.pole,''), nullif(btrim(substring(coalesce(p.note,'') from 'P.le:\s*(.*)$')),''),'Autres'),
          'heures',coalesce(p.actual_hours,p.planned_hours,0),
          'billing_mode',p.billing_mode,'taux',p.hourly_rate,'forfait',p.forfait_amount,
          'cout',round(rh_line_cost(p.billing_mode,p.actual_hours,p.planned_hours,p.hourly_rate,p.forfait_amount),2),
          'status',p.status)
          order by 5,3),'[]'::json)
        from event_staff_preplan p
        where p.event_id=p_event and p.space_id is null),
      'resto', (
        select coalesce(json_agg(json_build_object(
          'id',p.id,'nom',p.agent_nom,'prenom',p.agent_prenom,'role',p.agent_role,
          'space_id',p.space_id,'space_name',s.space_name,
          'heures',coalesce(p.actual_hours,p.planned_hours,0),
          'billing_mode',p.billing_mode,'taux',p.hourly_rate,'forfait',p.forfait_amount,
          'cout',round(rh_line_cost(p.billing_mode,p.actual_hours,p.planned_hours,p.hourly_rate,p.forfait_amount),2),
          'status',p.status)
          order by s.space_name, p.agent_nom),'[]'::json)
        from event_staff_preplan p
        join spaces s on s.space_id=p.space_id
        where p.event_id=p_event and p.space_id is not null),
      'poles', (select coalesce(json_agg(distinct x.pole),'[]'::json) from (
          select coalesce(nullif(pole,''),'Autres') pole from event_staff_preplan
          where event_id=p_event and space_id is null
          union select unnest(array['Cashless','Sécurité/Mascotte','Accueil/Scanettes','Autres'])) x),
      'espaces', (select coalesce(json_agg(json_build_object('id',s.space_id,'nom',s.space_name) order by s.space_name),'[]'::json)
          from event_spaces es join spaces s on s.space_id=es.space_id where es.event_id=p_event),
      'mouvements', (select coalesce(json_agg(json_build_object(
          'at',moved_at,'action',action,'agent',coalesce(agent_prenom||' ','')||coalesce(agent_nom,''),
          'from',from_ref,'to',to_ref,'detail',detail,'by',moved_by) order by moved_at desc),'[]'::json)
          from rh_staff_movements where event_id=p_event)
    )
  end;
$fn$;

-- ── 1) rh_planning_board : garde RG-003 (corps billing/forfait-aware conservé) ─
CREATE OR REPLACE FUNCTION rh_planning_board(p_event uuid)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  select case when not is_stade()
    then json_build_object('error','Réservé équipe stade','event',null,'familles','[]'::json,'hors_resto',null)
    else (
      with base as (
        select s.space_id, s.space_name, s.space_type, s.service_type,
               space_family(s.space_name, s.space_type, s.service_type) as fam
        from event_spaces es join spaces s on s.space_id=es.space_id
        where es.event_id=p_event
      ),
      st as (
        select p.space_id,
          count(*) filter (where coalesce(p.status,'planifié') not in ('retiré','absent')) as agents,
          round(sum(coalesce(p.actual_hours,p.planned_hours,0)) filter (where coalesce(p.status,'planifié') not in ('retiré','absent')),1) as heures,
          round(sum(rh_line_cost(p.billing_mode,p.actual_hours,p.planned_hours,p.hourly_rate,p.forfait_amount)) filter (where coalesce(p.status,'planifié') not in ('retiré','absent')),2) as cout,
          count(*) filter (where p.status='pointé') as pointes
        from event_staff_preplan p where p.event_id=p_event and p.space_id is not null
        group by p.space_id
      ),
      esp as (
        select b.*, coalesce(st.agents,0) agents, coalesce(st.heures,0) heures, coalesce(st.cout,0) cout,
          case when coalesce(st.agents,0)=0 then 0 else round(100.0*coalesce(st.pointes,0)/st.agents) end as pct_pointe
        from base b left join st on st.space_id=b.space_id
      ),
      pol as (
        select coalesce(nullif(p.pole,''), nullif(btrim(substring(coalesce(p.note,'') from 'P.le:\s*(.*)$')),''),'Autres') pole,
          count(*) filter (where coalesce(p.status,'planifié') not in ('retiré','absent')) agents,
          round(sum(coalesce(p.actual_hours,p.planned_hours,0)) filter (where coalesce(p.status,'planifié') not in ('retiré','absent')),1) heures,
          round(sum(rh_line_cost(p.billing_mode,p.actual_hours,p.planned_hours,p.hourly_rate,p.forfait_amount)) filter (where coalesce(p.status,'planifié') not in ('retiré','absent')),2) cout
        from event_staff_preplan p where p.event_id=p_event and p.space_id is null group by 1
      )
      select json_build_object(
        'event', (select json_build_object('id',event_id,'nom',event_name,'date',event_date,
                    'closed', rh_final_closed_at is not null) from events where event_id=p_event),
        'familles', (
          select coalesce(json_agg(f order by f->>'ordre'),'[]'::json) from (
            select json_build_object(
              'key', fam->>'key', 'label', fam->>'label', 'ordre', (fam->>'ordre')::int,
              'totaux', json_build_object('espaces',count(*),'agents',sum(agents),
                 'heures',round(sum(heures),1),'cout',round(sum(cout),2),
                 'pct_pointe', case when sum(agents)=0 then 0 else round(100.0*sum(agents*pct_pointe/100.0)/sum(agents)) end),
              'espaces', json_agg(json_build_object('id',space_id,'nom',space_name,
                 'agents',agents,'heures',heures,'cout',cout,'pct_pointe',pct_pointe,
                 'etat', case when agents=0 then 'vide' when pct_pointe>=100 then 'complet' when pct_pointe>0 then 'en_cours' else 'planifie' end)
                 order by space_name)
            ) as f
            from esp group by fam->>'key', fam->>'label', fam->>'ordre'
          ) fam_rows
        ),
        'hors_resto', json_build_object(
          'key','horsresto','label','Hors restauration','ordre',5,
          'totaux', (select json_build_object('agents',coalesce(sum(agents),0),'heures',coalesce(round(sum(heures),1),0),'cout',coalesce(round(sum(cout),2),0)) from pol),
          'poles', (select coalesce(json_agg(json_build_object('pole',pole,'agents',agents,'heures',heures,'cout',cout) order by cout desc),'[]'::json) from pol)
        )
      )
    )
  end;
$fn$;

-- ── Grants RG-003 : retirer anon (le garde is_stade protège authenticated) ────
REVOKE EXECUTE ON FUNCTION rh_board(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION get_event_rh(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION rh_planning_board(uuid) FROM anon, public;
