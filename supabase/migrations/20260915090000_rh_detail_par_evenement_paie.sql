-- =====================================================================
-- RH — DÉTAIL PAR ÉVÉNEMENT POUR JUSTIFICATION DES CHARGES DE PAIE
-- ---------------------------------------------------------------------
-- Le récap de paie (rh_monthly_hours) donne UNE ligne par personne/mois :
-- suffisant pour le virement, insuffisant pour JUSTIFIER la charge. Le DAF
-- doit pouvoir rattacher chaque heure payée à un événement précis et à sa
-- nature de charge :
--   • Match          (event_type = 'match')
--   • Séminaire      (event_type = 'séminaire')
--   • Opérationnel   (montage / livraison — besoin hors service, rattaché
--                     à un événement mais facturé comme prestation support)
--
-- Cette vue éclate les mêmes 3 sources que rh_monthly_hours
-- (zone_staff_hours + schedules + occasional_hours) en UNE ligne par
-- personne × événement × nature, en réutilisant EXACTEMENT les mêmes
-- formules d'heures/coût et la même canonisation de nom (rh_person_key) →
-- la somme du détail d'une personne = son total au récap (réconciliation
-- garantie). Les lignes sans charge ni heure (assignations à 0) sont
-- exclues : on ne justifie que ce qui coûte.
--
-- RG-003 : coûts → réservé à authenticated (jamais anon).
-- =====================================================================

create or replace view public.rh_monthly_event_detail as
with lignes as (
  -- Source 1 : heures de zone (service en espace, matchs & séminaires)
  select
    z.staff_name,
    z.event_id,
    'Service espace'::text                                   as nature,
    z.payment_type,
    coalesce(z.hours_worked, 0::numeric)                     as h,
    coalesce(z.rh_cost, 0::numeric)                          as c,
    coalesce(s.space_name, '—'::text)                        as espace,
    false                                                    as operationnel
  from zone_staff_hours z
    left join spaces s on s.space_id = z.space_id

  union all

  -- Source 2 : planning staff (responsables d'espace, encadrement)
  select
    sch.staff_name,
    sch.event_id,
    coalesce(nullif(sch.mission_type, ''::text), sch.role, 'Responsable espace'::text) as nature,
    sch.contract_type                                        as payment_type,
    coalesce(sch.computed_hours,
      case when sch.planned_departure is not null and sch.planned_arrival is not null
        then round(extract(epoch from sch.planned_departure - sch.planned_arrival) / 3600::numeric +
          case when sch.planned_departure < sch.planned_arrival then 24 else 0 end::numeric, 2)
        else 0::numeric end)                                 as h,
    coalesce(sch.computed_hours,
      case when sch.planned_departure is not null and sch.planned_arrival is not null
        then round(extract(epoch from sch.planned_departure - sch.planned_arrival) / 3600::numeric +
          case when sch.planned_departure < sch.planned_arrival then 24 else 0 end::numeric, 2)
        else 0::numeric end) * coalesce(sch.hourly_rate, 0::numeric) as c,
    coalesce(s.space_name, '—'::text)                        as espace,
    false                                                    as operationnel
  from schedules sch
    left join spaces s on s.space_id = sch.space_id
  where sch.staff_name is not null

  union all

  -- Source 3 : heures ponctuelles (runner / montage / livraison)
  --   montage & livraison = besoin OPÉRATIONNEL ; runner = service de l'évt.
  select
    o.staff_name,
    o.event_id,
    initcap(o.mission_type)                                  as nature,
    o.payment_type,
    coalesce(o.hours_worked, 0::numeric)                     as h,
    coalesce(o.total_cost, 0::numeric)                       as c,
    'Hors espace / ponctuel'::text                           as espace,
    (o.mission_type = any (array['montage','livraison','manutention','demontage','preparation'])) as operationnel
  from occasional_hours o
),
canon as (
  select
    rh_person_key(staff_name) as k,
    (array_agg(staff_name order by
      ((staff_name ~ '[a-z]'::text)::integer) desc,
      ((staff_name ~ ' '::text)::integer) desc,
      (length(staff_name)) desc,
      staff_name))[1] as display_name
  from lignes
  group by rh_person_key(staff_name)
)
-- Libellé de catégorie — couvre TOUS les event_type autorisés par le schéma
-- (match, séminaire, cocktail, réception_vip, événement_partenaire, réunion,
-- autre). Le besoin OPÉRATIONNEL (montage/livraison) prime sur le type d'évt.
-- Ainsi un futur cocktail/réception ne tombe plus silencieusement dans « Autre ».
select
  cn.display_name                                            as staff_name,
  to_char(coalesce(e.event_date, current_date)::timestamptz, 'YYYY-MM') as mois,
  case
    when l.operationnel                          then 'Opérationnel'
    when e.event_type = 'match'                  then 'Match'
    when e.event_type = 'séminaire'              then 'Séminaire'
    when e.event_type = 'cocktail'               then 'Cocktail'
    when e.event_type = 'réception_vip'          then 'Réception VIP'
    when e.event_type = 'événement_partenaire'   then 'Événement partenaire'
    when e.event_type = 'réunion'                then 'Réunion'
    when e.event_type = 'autre'                  then 'Autre'
    when e.event_type is not null                then initcap(e.event_type)
    else 'Autre'
  end                                                        as categorie,
  l.event_id,
  coalesce(e.event_name, '(sans événement)')                as event_name,
  e.event_date,
  l.nature,
  l.espace,
  coalesce(nullif(string_agg(distinct l.payment_type, '/'::text), ''::text), 'non défini') as payment_type,
  round(sum(l.h), 1)                                         as heures,
  round(sum(l.c), 2)                                         as cout_ht
from lignes l
  join canon cn on cn.k = rh_person_key(l.staff_name)
  left join events e on e.event_id = l.event_id
group by cn.display_name,
  to_char(coalesce(e.event_date, current_date)::timestamptz, 'YYYY-MM'),
  (case
    when l.operationnel                          then 'Opérationnel'
    when e.event_type = 'match'                  then 'Match'
    when e.event_type = 'séminaire'              then 'Séminaire'
    when e.event_type = 'cocktail'               then 'Cocktail'
    when e.event_type = 'réception_vip'          then 'Réception VIP'
    when e.event_type = 'événement_partenaire'   then 'Événement partenaire'
    when e.event_type = 'réunion'                then 'Réunion'
    when e.event_type = 'autre'                  then 'Autre'
    when e.event_type is not null                then initcap(e.event_type)
    else 'Autre'
  end),
  l.event_id, e.event_name, e.event_date, l.nature, l.espace
having round(sum(l.h), 1) <> 0 or round(sum(l.c), 2) <> 0;

-- RG-003 : coûts réservés à ROLE_STADE (authenticated), jamais anon
grant select on public.rh_monthly_event_detail to authenticated;
revoke select on public.rh_monthly_event_detail from anon;
