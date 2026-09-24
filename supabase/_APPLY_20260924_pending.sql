-- ═══════════════════════════════════════════════════════════════════
-- MIGRATIONS EN ATTENTE (2026-09-24) — à coller dans Supabase → SQL Editor → Run.
-- Bundle rejouable (idempotent). Contient :
--   1) Séminaire — eaux Vittel/St-Pé cohérentes + conso Altrad ENDEL 23/09
--   2) Vue RH fine rh_person_event_shift (jour + horaires pour l'export DAF)
-- Après exécution : rien d'autre à faire, l'appli lit ces objets directement.
-- ═══════════════════════════════════════════════════════════════════

-- =====================================================================
-- SÉMINAIRE — EAUX « VITTEL » & « ST-PÉ » : CATALOGUE COHÉRENT + CONSO
-- ---------------------------------------------------------------------
-- Les régisseurs séminaire ne retrouvaient pas « Vittel » ni « St Pé » dans
-- la suggestion de consommation :
--   • « Vittel » n'existait qu'en « Vittel verre » (unité 'verre'), incohérent
--     pour une conso séminaire comptée en BOUTEILLES ;
--   • « St Pé » n'existait pas sous ce nom — c'est le nom d'usage de la
--     San Pellegrino (eau gazeuse). Recherché « St Pé », le produit n'apparaît pas.
-- get_zone_state propose déjà TOUS les produits actifs : le problème est donc le
-- NOMMAGE. On normalise les deux eaux pour qu'elles soient reconnues (et la
-- recherche régisseur devient insensible aux accents/tirets côté front).
--
-- Idempotent : ciblé par product_id (stable), rejouable sans effet de bord.
-- =====================================================================

-- 1) « Vittel verre » → « Vittel » (bouteille)
update public.products
set product_name = 'Vittel', unit = 'btl'
where product_id = '922c8f3c-4274-49a0-8870-e331c87d857f';

-- 2) « San Pellegrino bouteille » → « San Pellegrino (St-Pé) » (nom d'usage régie)
update public.products
set product_name = 'San Pellegrino (St-Pé)'
where product_id = '08c46d8d-5566-4046-b372-8f437e5e7cce';

-- ---------------------------------------------------------------------
-- 3) Conso F&B du séminaire Altrad ENDEL du 23/09 (Salon Sud) :
--    7 Vittel + 8 St-Pé, prélevées « sur place ». La ligne Pepsi déjà saisie
--    est PRÉSERVÉE (upsert additif, contrairement à la saisie régie qui
--    remplace). Modèle conso séminaire : initial_qty = consommé, final_qty = 0
--    → consumed_qty (généré) = quantité consommée. RG-001 : responsable tracé.
-- ---------------------------------------------------------------------
do $$
declare
  v_event uuid := 'c2072f9f-231f-413b-8ae3-0f92eb162829'; -- Altrad ENDEL 2026-09-23
  v_space uuid := 'f52ece0b-bfaf-4a76-b280-720f158ba470'; -- Salon Sud
  v_src   uuid := 'd7cfd5c8-651f-4bdc-9441-47ea83b422b4'; -- « sur place » (espace)
  v_resp  text := '21B0FC';                                -- régie (attribution existante)
  v_vittel uuid := '922c8f3c-4274-49a0-8870-e331c87d857f';
  v_stpe   uuid := '08c46d8d-5566-4046-b372-8f437e5e7cce';
begin
  -- Ne rien faire si l'événement a été clôturé/archivé entre-temps.
  if exists (
    select 1 from public.events
    where event_id = v_event
      and lower(coalesce(status, '')) not in ('clôturé','cloture','clôturée','archivé','archive')
  ) then
    insert into public.event_stock_lines
      (event_id, space_id, product_id, initial_qty, reassort_qty, final_qty,
       source_location_id, responsable_nom, submitted_at)
    values
      (v_event, v_space, v_vittel, 7, 0, 0, v_src, v_resp, now()),
      (v_event, v_space, v_stpe,   8, 0, 0, v_src, v_resp, now())
    on conflict (event_id, space_id, product_id) do update
      set initial_qty        = excluded.initial_qty,
          reassort_qty       = 0,
          final_qty          = 0,
          source_location_id = excluded.source_location_id,
          responsable_nom    = excluded.responsable_nom,
          submitted_at       = now();
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────

-- =====================================================================
-- RH — DÉTAIL FIN PAR SHIFT (JOUR PRÉSENT + HORAIRES) POUR CHAQUE PERSONNE
-- ---------------------------------------------------------------------
-- rh_monthly_event_detail donne UNE ligne par personne × événement × nature
-- (heures/coût agrégés) : suffisant pour rattacher la charge à un événement,
-- mais il PERD le « détail du jour présent » que chaque source porte pourtant
-- (heure d'arrivée / départ, date de travail réelle du montage la veille…).
--
-- Cette vue éclate les MÊMES 3 sources (zone_staff_hours + schedules +
-- occasional_hours) en UNE ligne par SHIFT, en conservant :
--   • le lien événement (event_id → lien profond vers la fiche dans l'appli),
--   • la tâche confiée (nature / poste),
--   • le JOUR réellement presté (occasional : work_date ; sinon date de l'évt),
--   • les HORAIRES du shift (arrivée → départ),
--   • l'espace, le circuit de paiement, les heures et le coût.
--
-- Formules heures/coût et canonisation de nom IDENTIQUES à rh_monthly_hours /
-- rh_monthly_event_detail → la somme des shifts d'une personne = son total au
-- récap (réconciliation garantie). Le « mois » reste celui de l'ÉVÉNEMENT (comme
-- rh_monthly_event_detail) pour rester réconcilié, tandis que « jour » porte la
-- date réellement prestée. Lignes à 0 h et 0 € exclues (on ne détaille que ce
-- qui coûte).
--
-- RG-003 : coûts → réservé à authenticated (jamais anon).
-- =====================================================================

create or replace view public.rh_person_event_shift as
with lignes as (
  -- Source 1 : heures de zone (service en espace, matchs & séminaires)
  select
    z.staff_name,
    z.event_id,
    z.space_id,
    coalesce(nullif(z.role, ''::text), 'Service espace'::text)   as nature,
    z.payment_type,
    z.arrival_time                                               as arrivee,
    z.departure_time                                             as depart,
    null::date                                                   as work_date,
    coalesce(z.hours_worked, 0::numeric)                         as h,
    coalesce(z.rh_cost, 0::numeric)                              as c,
    coalesce(s.space_name, '—'::text)                            as espace,
    false                                                        as operationnel
  from zone_staff_hours z
    left join spaces s on s.space_id = z.space_id

  union all

  -- Source 2 : planning staff (responsables d'espace, encadrement)
  select
    sch.staff_name,
    sch.event_id,
    sch.space_id,
    coalesce(nullif(sch.mission_type, ''::text), sch.role, 'Responsable espace'::text) as nature,
    sch.contract_type                                           as payment_type,
    sch.planned_arrival                                         as arrivee,
    coalesce(sch.actual_departure, sch.planned_departure)      as depart,
    null::date                                                 as work_date,
    coalesce(sch.computed_hours,
      case when sch.planned_departure is not null and sch.planned_arrival is not null
        then round(extract(epoch from sch.planned_departure - sch.planned_arrival) / 3600::numeric +
          case when sch.planned_departure < sch.planned_arrival then 24 else 0 end::numeric, 2)
        else 0::numeric end)                                   as h,
    coalesce(sch.computed_hours,
      case when sch.planned_departure is not null and sch.planned_arrival is not null
        then round(extract(epoch from sch.planned_departure - sch.planned_arrival) / 3600::numeric +
          case when sch.planned_departure < sch.planned_arrival then 24 else 0 end::numeric, 2)
        else 0::numeric end) * coalesce(sch.hourly_rate, 0::numeric) as c,
    coalesce(s.space_name, '—'::text)                          as espace,
    false                                                      as operationnel
  from schedules sch
    left join spaces s on s.space_id = sch.space_id
  where sch.staff_name is not null

  union all

  -- Source 3 : heures ponctuelles (runner / montage / livraison)
  select
    o.staff_name,
    o.event_id,
    null::uuid                                                 as space_id,
    initcap(o.mission_type)                                    as nature,
    o.payment_type,
    o.start_time                                               as arrivee,
    o.end_time                                                 as depart,
    o.work_date                                                as work_date,
    coalesce(o.hours_worked, 0::numeric)                       as h,
    coalesce(o.total_cost, 0::numeric)                         as c,
    'Hors espace / ponctuel'::text                             as espace,
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
  coalesce(l.work_date, e.event_date)                       as jour,
  l.nature,
  l.espace,
  to_char(l.arrivee, 'HH24:MI')                             as arrivee,
  to_char(l.depart,  'HH24:MI')                             as depart,
  coalesce(nullif(l.payment_type, ''::text), 'non défini') as payment_type,
  round(l.h, 2)                                             as heures,
  round(l.c, 2)                                             as cout_ht
from lignes l
  join canon cn on cn.k = rh_person_key(l.staff_name)
  left join events e on e.event_id = l.event_id
where round(l.h, 2) <> 0 or round(l.c, 2) <> 0;

-- RG-003 : coûts réservés à ROLE_STADE (authenticated), jamais anon
grant select on public.rh_person_event_shift to authenticated;
revoke select on public.rh_person_event_shift from anon;
