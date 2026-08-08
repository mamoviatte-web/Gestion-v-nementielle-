-- RH opérationnel : (1) durcissement RG-003 sur les lectures de coûts RH,
-- (2) ajout d'un tableau `resto` à rh_board pour rendre les agents restauration
-- aussi actionnables que les agents hors-resto (id + space_id + status).
--
-- RG-003 (non négociable) : les coûts RH ne doivent jamais être exposés à un
-- utilisateur non ROLE_STADE. Or rh_board était exécutable par anon ET
-- authenticated, et get_event_rh par authenticated (16 comptes ROLE_RESPONSABLE
-- existent) — tous deux renvoient taux/coûts. On ajoute un garde is_stade() dans
-- les deux (renvoi d'une charge sans coût pour les non-stade) et on retire le
-- droit d'exécution à anon. Les appelants internes (freeze_event_rh_cost,
-- get_match_report) ne tournent qu'en contexte stade (clôture = RG-006, export =
-- ROLE_STADE) : is_stade() y vaut true, aucun impact.

-- ── get_event_rh : garde RG-003 ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_event_rh(p_event_id uuid)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  select case when not is_stade()
    then json_build_object(
      'closed', false, 'closed_at', null, 'closed_by', null,
      'kpis', null, 'par_espace', '[]'::json, 'par_pole', '[]'::json, 'agents', '[]'::json)
    else (
      with u as (
        select p.id, p.space_id, s.space_name, p.status,
          p.agent_nom, p.agent_prenom, p.agent_role,
          coalesce(p.actual_hours, p.planned_hours, 0)::numeric as heures,
          coalesce(p.hourly_rate,0)::numeric as taux,
          coalesce(p.actual_hours, p.planned_hours, 0)::numeric * coalesce(p.hourly_rate,0)::numeric as cout,
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
            'heures',heures,'taux',taux,'cout',round(cout,2)) order by cout desc),'[]'::json) from u)
      )
    )
  end;
$fn$;

-- ── rh_board : garde RG-003 + tableau `resto` (additif) ───────────────────────
CREATE OR REPLACE FUNCTION rh_board(p_event uuid)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  select case when not is_stade()
    then json_build_object(
      'error', 'Réservé équipe stade',
      'rh', json_build_object('closed',false,'kpis',null,'par_espace','[]'::json,'par_pole','[]'::json,'agents','[]'::json),
      'hors_resto', '[]'::json, 'resto', '[]'::json, 'poles', '[]'::json, 'espaces', '[]'::json, 'mouvements', '[]'::json)
    else json_build_object(
      'rh', get_event_rh(p_event),
      'hors_resto', (
        select coalesce(json_agg(json_build_object(
          'id',p.id,'nom',p.agent_nom,'prenom',p.agent_prenom,'role',p.agent_role,
          'pole',coalesce(nullif(p.pole,''), nullif(btrim(substring(coalesce(p.note,'') from 'P.le:\s*(.*)$')),''),'Autres'),
          'heures',coalesce(p.actual_hours,p.planned_hours,0),'taux',p.hourly_rate,'status',p.status)
          order by 6,3),'[]'::json)
        from event_staff_preplan p
        where p.event_id=p_event and p.space_id is null),
      'resto', (
        select coalesce(json_agg(json_build_object(
          'id',p.id,'nom',p.agent_nom,'prenom',p.agent_prenom,'role',p.agent_role,
          'space_id',p.space_id,'space_name',s.space_name,
          'heures',coalesce(p.actual_hours,p.planned_hours,0),'taux',p.hourly_rate,'status',p.status)
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

-- ── Grants RG-003 : retirer anon (le garde is_stade protège authenticated) ────
REVOKE EXECUTE ON FUNCTION rh_board(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION get_event_rh(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION rh_board(uuid) FROM public;
REVOKE EXECUTE ON FUNCTION get_event_rh(uuid) FROM public;
