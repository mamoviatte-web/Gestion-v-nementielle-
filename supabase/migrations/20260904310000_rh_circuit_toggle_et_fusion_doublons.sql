-- =====================================================================
-- RH ANALYTIQUE — (1) TOGGLE CIRCUIT RÉPARÉ + (2) FUSION DES DOUBLONS NOMS
-- ---------------------------------------------------------------------
-- (1) TOGGLE FRANCHISE/CONTRAT — impossible à changer sur certaines
--     personnes : set_staff_payment_circuit mettait à jour occasional_hours
--     et zone_staff_hours mais PAS schedules (horaires responsable espace).
--     Les personnes dont les heures viennent de schedules (ex. HUGO PASCAL,
--     18,5 h) ne basculaient donc jamais. En plus, le rapprochement se faisait
--     par nom EXACT → un doublon proche cassait la correspondance.
--
-- (2) DOUBLONS DE NOMS — la vue groupait par staff_name EXACT : « Hugo PASCAL »
--     / « HUGO PASCAL », « Haroun Meramria » / « Haroun MERAMRIA »,
--     « ABDEL KHENNOUS » / « KHENNOUS Abdel » (ordre inversé) apparaissaient
--     en lignes séparées, heures éclatées.
--
-- SOLUTION DURABLE :
--   • rh_person_key(nom) = clé canonique (unaccent + MAJ + ponctuation retirée
--     + jetons TRIÉS) → insensible à la casse, aux accents et à l'ordre
--     prénom/nom. Table staff_alias pour piloter à la main les cas flous/fautes
--     de frappe que la normalisation ne rattrape pas.
--   • rh_monthly_hours groupe par cette clé (heures cumulées sur UNE personne),
--     affiche la variante la plus lisible.
--   • set_staff_payment_circuit rapproche par cette clé sur les 3 sources
--     (occasional_hours, zone_staff_hours, schedules) → bascule fiable partout.
--   Idempotent.
-- =====================================================================

create extension if not exists unaccent;

-- ---------------------------------------------------------------------
-- Table d'alias manuels (cas flous / fautes de frappe) — pilotable
-- ---------------------------------------------------------------------
create table if not exists staff_alias (
  variant_key   text primary key,   -- rh_name_key(nom variante)
  canonical_key text not null,       -- clé cible (rh_name_key du nom retenu)
  note          text,
  created_at    timestamptz default now()
);

-- Clé brute normalisée : unaccent + MAJUSCULES + jetons alphabétiques triés
create or replace function public.rh_name_key(p text)
returns text language sql stable as $$
  select coalesce((
    select string_agg(tok, ' ' order by tok)
    from regexp_split_to_table(
      btrim(regexp_replace(upper(unaccent(coalesce(p, ''))), '[^A-Z]+', ' ', 'g')),
      '\s+') as tok
    where tok <> ''
  ), '');
$$;

-- Clé personne = alias manuel si défini, sinon clé normalisée
create or replace function public.rh_person_key(p text)
returns text language sql stable as $$
  select coalesce(
    (select a.canonical_key from staff_alias a where a.variant_key = public.rh_name_key(p)),
    public.rh_name_key(p)
  );
$$;

-- ---------------------------------------------------------------------
-- schedules : colonne base_hourly_rate (réversibilité du taux, comme les
-- deux autres sources) pour le basculement franchise/contrat
-- ---------------------------------------------------------------------
alter table schedules add column if not exists base_hourly_rate numeric;

-- ---------------------------------------------------------------------
-- (1) set_staff_payment_circuit : rapproche par clé personne sur 3 sources
-- ---------------------------------------------------------------------
create or replace function public.set_staff_payment_circuit(p_staff text, p_mois text, p_type text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_key text := public.rh_person_key(p_staff);
begin
  if not is_stade() then raise exception 'Réservé ROLE_STADE'; end if;
  if p_type not in ('franchise','contrat') then raise exception 'Type de circuit invalide : %', p_type; end if;

  -- Heures ponctuelles / hors espace
  update occasional_hours o
     set base_hourly_rate = coalesce(o.base_hourly_rate, o.hourly_rate),
         hourly_rate = case when p_type='contrat' then 18 else coalesce(o.base_hourly_rate, o.hourly_rate) end,
         payment_type = p_type
   where public.rh_person_key(o.staff_name) = v_key
     and to_char(coalesce((select e.event_date from events e where e.event_id=o.event_id), o.work_date)::timestamptz,'YYYY-MM') = p_mois;

  -- Heures en zone (matchs / séminaires)
  update zone_staff_hours z
     set base_hourly_rate = coalesce(z.base_hourly_rate, z.hourly_rate),
         hourly_rate = case when p_type='contrat' then 18 else coalesce(z.base_hourly_rate, z.hourly_rate) end,
         payment_type = p_type
   where public.rh_person_key(z.staff_name) = v_key
     and to_char(coalesce((select e.event_date from events e where e.event_id=z.event_id), current_date)::timestamptz,'YYYY-MM') = p_mois;

  -- Horaires responsable espace (schedules) — source oubliée jusqu'ici
  update schedules sch
     set base_hourly_rate = coalesce(sch.base_hourly_rate, sch.hourly_rate),
         hourly_rate = case when p_type='contrat' then 18 else coalesce(sch.base_hourly_rate, sch.hourly_rate) end,
         contract_type = p_type
   where public.rh_person_key(sch.staff_name) = v_key
     and to_char(coalesce((select e.event_date from events e where e.event_id=sch.event_id), current_date)::timestamptz,'YYYY-MM') = p_mois;
end $function$;

-- ---------------------------------------------------------------------
-- (2) rh_monthly_hours : groupe par personne canonique (heures cumulées)
-- ---------------------------------------------------------------------
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
)
select
  -- nom affiché : variante la plus lisible (casse mixte > avec espace > longue)
  (array_agg(l.staff_name order by
     (l.staff_name ~ '[a-z]')::int desc, (l.staff_name ~ ' ')::int desc,
     length(l.staff_name) desc, l.staff_name))[1] as staff_name,
  to_char(coalesce(e.event_date, current_date)::timestamptz,'YYYY-MM') as mois,
  coalesce(nullif(string_agg(distinct l.payment_type,'/'),''),'non défini') as type_paiement,
  sum(l.h) as heures,
  round(sum(l.c),2) as cout_ht,
  count(distinct l.event_id) as nb_evenements,
  string_agg(distinct l.mission, ', ') as missions,
  string_agg(distinct nullif(l.espace,'Hors espace / ponctuel'), ', ') as espaces,
  string_agg(distinct nullif(l.statut,'non_precise'), ', ') as statuts
from lignes l
left join events e on e.event_id=l.event_id
group by public.rh_person_key(l.staff_name), (to_char(coalesce(e.event_date, current_date)::timestamptz,'YYYY-MM'))
order by (to_char(coalesce(e.event_date, current_date)::timestamptz,'YYYY-MM')) desc, 1;
