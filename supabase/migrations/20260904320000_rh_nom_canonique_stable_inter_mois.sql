-- =====================================================================
-- RH ANALYTIQUE — NOM AFFICHÉ CANONIQUE STABLE ENTRE LES MOIS
-- ---------------------------------------------------------------------
-- La fusion des doublons (20260904310000) choisissait le nom affiché par
-- (clé personne × mois) : une même personne pouvait donc s'afficher
-- « KHENNOUS Abdel » en septembre et « Abdel KHENNOUS » en août (variante
-- présente dans les données de chaque mois). Cosmétique mais déroutant.
--
-- Correctif : le nom affiché est choisi UNE fois par personne (clé), sur
-- l'ensemble des sources et des mois → affichage stable partout. On garde la
-- règle de lisibilité (casse mixte > avec espace > plus long > alphabétique).
-- Idempotent.
-- =====================================================================

create or replace view rh_monthly_hours as
with lignes as (
  select z.staff_name, z.event_id, z.role as mission, z.payment_type,
         coalesce(z.hours_worked,0::numeric) as h, coalesce(z.rh_cost,0::numeric) as c,
         coalesce(s.space_name,'—') as espace, coalesce(p.staff_status,'non_precise') as statut
  from zone_staff_hours z
  left join spaces s on s.space_id=z.space_id
  left join event_staff_preplan p on p.zone_staff_hour_id=z.id
  union all
  select sch.staff_name, sch.event_id,
         coalesce(nullif(sch.mission_type,''), sch.role, 'Responsable espace') as mission,
         sch.contract_type as payment_type,
         coalesce(sch.computed_hours, case when sch.planned_departure is not null and sch.planned_arrival is not null
             then round(extract(epoch from sch.planned_departure - sch.planned_arrival)/3600::numeric
                  + case when sch.planned_departure < sch.planned_arrival then 24 else 0 end::numeric, 2)
             else 0::numeric end) as h,
         coalesce(sch.computed_hours, case when sch.planned_departure is not null and sch.planned_arrival is not null
             then round(extract(epoch from sch.planned_departure - sch.planned_arrival)/3600::numeric
                  + case when sch.planned_departure < sch.planned_arrival then 24 else 0 end::numeric, 2)
             else 0::numeric end) * coalesce(sch.hourly_rate,0::numeric) as c,
         coalesce(s.space_name,'—') as espace, 'non_precise' as statut
  from schedules sch left join spaces s on s.space_id=sch.space_id
  where sch.staff_name is not null
  union all
  select o.staff_name, o.event_id, o.mission_type as mission, o.payment_type,
         coalesce(o.hours_worked,0::numeric) as h, coalesce(o.total_cost,0::numeric) as c,
         'Hors espace / ponctuel' as espace, 'non_precise' as statut
  from occasional_hours o
),
canon as (   -- nom affiché canonique : UN par personne (clé), sur toutes les lignes
  select public.rh_person_key(staff_name) as k,
         (array_agg(staff_name order by
            (staff_name ~ '[a-z]')::int desc, (staff_name ~ ' ')::int desc,
            length(staff_name) desc, staff_name))[1] as display_name
  from lignes
  group by public.rh_person_key(staff_name)
)
select
  cn.display_name as staff_name,
  to_char(coalesce(e.event_date, current_date)::timestamptz,'YYYY-MM') as mois,
  coalesce(nullif(string_agg(distinct l.payment_type,'/'),''),'non défini') as type_paiement,
  sum(l.h) as heures,
  round(sum(l.c),2) as cout_ht,
  count(distinct l.event_id) as nb_evenements,
  string_agg(distinct l.mission, ', ') as missions,
  string_agg(distinct nullif(l.espace,'Hors espace / ponctuel'), ', ') as espaces,
  string_agg(distinct nullif(l.statut,'non_precise'), ', ') as statuts
from lignes l
join canon cn on cn.k = public.rh_person_key(l.staff_name)
left join events e on e.event_id=l.event_id
group by cn.display_name, (to_char(coalesce(e.event_date, current_date)::timestamptz,'YYYY-MM'))
order by (to_char(coalesce(e.event_date, current_date)::timestamptz,'YYYY-MM')) desc, 1;
