-- RG-003 : rh_planning_board renvoie des coûts RH (cout par espace / famille /
-- pôle) mais était exécutable par anon ET authenticated sans garde. On ajoute un
-- garde is_stade() (renvoi d'une charge « réservé » pour les non-stade) et on
-- retire l'exécution à anon. L'écran « Planning RH Match » est ROLE_STADE.

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
          round(sum(coalesce(p.actual_hours,p.planned_hours,0)*coalesce(p.hourly_rate,0)) filter (where coalesce(p.status,'planifié') not in ('retiré','absent')),2) as cout,
          count(*) filter (where p.status='pointé') as pointes,
          count(*) filter (where coalesce(p.status,'planifié') not in ('retiré','absent','pointé')) as restants
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
          round(sum(coalesce(p.actual_hours,p.planned_hours,0)*coalesce(p.hourly_rate,0)) filter (where coalesce(p.status,'planifié') not in ('retiré','absent')),2) cout
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

REVOKE EXECUTE ON FUNCTION rh_planning_board(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION rh_planning_board(uuid) FROM public;
