-- ═══════════════════════════════════════════════════════════════════════════
-- RH poste de travail — B1 (suite) : get_event_rh enrichi.
--
-- Ajouts par rapport à la version précédente :
--   • ventilation `par_statut` (salarié / auto-entrepreneur / bénévole / franchise)
--   • coût bénévole forcé à 0 € (cout ET cout_prev) — un bénévole ne facture pas
--   • `staff_status` remonté sur chaque agent
-- Reste réservé à ROLE_STADE (RG-003) : la branche non-stade ne renvoie aucun coût.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_event_rh(p_event_id uuid)
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when not is_stade()
    then json_build_object('closed',false,'closed_at',null,'closed_by',null,'kpis',null,
      'par_espace','[]'::json,'par_pole','[]'::json,'par_statut','[]'::json,'agents','[]'::json)
    else (
      with u as (
        -- Agents planifiés (espaces + hors-resto)
        select p.id, p.space_id, s.space_name, p.status,
          p.agent_nom, p.agent_prenom, p.agent_role,
          p.billing_mode, p.forfait_amount, p.hourly_rate,
          coalesce(p.actual_hours, p.planned_hours, 0)::numeric as heures,
          case when p.staff_status='benevole' then 0 else rh_line_cost(p.billing_mode, p.actual_hours, p.planned_hours, p.hourly_rate, p.forfait_amount) end as cout,
          case when p.staff_status='benevole' then 0 else rh_line_cost_prev(p.billing_mode, p.planned_hours, p.hourly_rate, p.forfait_amount) end as cout_prev,
          case when p.space_id is null
               then coalesce(nullif(p.pole,''), nullif(btrim(substring(coalesce(p.note,'') from 'P.le:\s*(.*)$')),''),'Autres')
               else null end as pole,
          null::date as prep_date, p.staff_status
        from event_staff_preplan p
        left join spaces s on s.space_id = p.space_id
        where p.event_id = p_event_id
          and coalesce(p.status,'planifié') not in ('retiré','absent')

        union all

        -- Prestations ponctuelles datées (Runner / logistique de préparation)
        select o.id, null::uuid, null::text, 'planifié',
          o.staff_name, ''::text, coalesce(o.mission_type,'Runner'),
          'horaire'::text, null::numeric, o.hourly_rate,
          coalesce(o.hours_worked,0)::numeric as heures,
          coalesce(o.total_cost, o.hours_worked*o.hourly_rate, 0)::numeric as cout,
          coalesce(o.total_cost, o.hours_worked*o.hourly_rate, 0)::numeric as cout_prev,
          'Runner (prépa)'::text as pole,
          o.work_date as prep_date, null::text as staff_status
        from occasional_hours o
        where o.event_id = p_event_id
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
           'cout_runner_prepa', round(coalesce(sum(cout) filter (where pole='Runner (prépa)'),0),2),
           'cout_par_pax', (select case when px>0 then round(coalesce(sum(cout),0)/px,2) else 0 end from pax)
         ) from u),
        'par_espace', (select coalesce(json_agg(json_build_object('espace',space_name,'agents',n,'heures',h,'cout',c) order by c desc),'[]'::json)
           from (select space_name, count(*) n, round(sum(heures),1) h, round(sum(cout),2) c from u where space_id is not null group by space_name) x),
        'par_pole', (select coalesce(json_agg(json_build_object('pole',pole,'agents',n,'heures',h,'cout',c) order by c desc),'[]'::json)
           from (select pole, count(*) n, round(sum(heures),1) h, round(sum(cout),2) c from u where space_id is null group by pole) y),
        'par_statut', (select coalesce(json_agg(json_build_object('statut',coalesce(staff_status,'non_precise'),'agents',n,'heures',h,'cout',c) order by c desc),'[]'::json) from (select staff_status, count(*) n, round(sum(heures),1) h, round(sum(cout),2) c from u group by staff_status) z),
        'agents', (select coalesce(json_agg(json_build_object(
            'id',id,'nom',agent_nom,'prenom',agent_prenom,'role',agent_role,'statut',staff_status,
            'rattachement', coalesce(space_name,'Hors resto — '||pole),
            'date', prep_date,
            'billing_mode',billing_mode,'taux',hourly_rate,'forfait',forfait_amount,
            'heures',heures,'cout',round(cout,2),'cout_prev',round(cout_prev,2)) order by cout desc),'[]'::json) from u)
      )
    )
  end;
$function$

