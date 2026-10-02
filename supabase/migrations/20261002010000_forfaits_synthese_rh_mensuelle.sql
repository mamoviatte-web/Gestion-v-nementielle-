-- Forfaits RH dans la synthèse mensuelle : ajoute une branche UNION « forfaits »
-- (event_rh_forfaits) aux vues RH agrégées, pour que les montants forfaitaires
-- (freelance / manutention) remontent dans la synthèse RH mensuelle, les exports
-- DAF (RH Analytique) et les KPI Staff & RH → Séminaires. Forfait = 0 h, coût =
-- amount_ht, circuit = catégorie (freelance/manutention/autre) → ventilé dans le
-- bloc « autres » de la partition paie (déjà exhaustive). Idempotent (CREATE OR REPLACE).


create or replace view rh_monthly_hours as
 WITH lignes AS (
         SELECT z.staff_name,
            z.event_id,
            z.role AS mission,
            z.payment_type,
            COALESCE(z.hours_worked, 0::numeric) AS h,
            COALESCE(z.rh_cost, 0::numeric) AS c,
            COALESCE(s.space_name, '—'::text) AS espace,
            COALESCE(p.staff_status, 'non_precise'::text) AS statut
           FROM zone_staff_hours z
             LEFT JOIN spaces s ON s.space_id = z.space_id
             LEFT JOIN event_staff_preplan p ON p.zone_staff_hour_id = z.id
        UNION ALL
         SELECT sch.staff_name,
            sch.event_id,
            COALESCE(NULLIF(sch.mission_type, ''::text), sch.role, 'Responsable espace'::text) AS mission,
            sch.contract_type AS payment_type,
            COALESCE(sch.computed_hours,
                CASE
                    WHEN sch.planned_departure IS NOT NULL AND sch.planned_arrival IS NOT NULL THEN round(EXTRACT(epoch FROM sch.planned_departure - sch.planned_arrival) / 3600::numeric +
                    CASE
                        WHEN sch.planned_departure < sch.planned_arrival THEN 24
                        ELSE 0
                    END::numeric, 2)
                    ELSE 0::numeric
                END) AS h,
            COALESCE(sch.computed_hours,
                CASE
                    WHEN sch.planned_departure IS NOT NULL AND sch.planned_arrival IS NOT NULL THEN round(EXTRACT(epoch FROM sch.planned_departure - sch.planned_arrival) / 3600::numeric +
                    CASE
                        WHEN sch.planned_departure < sch.planned_arrival THEN 24
                        ELSE 0
                    END::numeric, 2)
                    ELSE 0::numeric
                END) * COALESCE(sch.hourly_rate, 0::numeric) AS c,
            COALESCE(s.space_name, '—'::text) AS espace,
            'non_precise'::text AS statut
           FROM schedules sch
             LEFT JOIN spaces s ON s.space_id = sch.space_id
          WHERE sch.staff_name IS NOT NULL
        UNION ALL
         SELECT o.staff_name,
            o.event_id,
            o.mission_type AS mission,
            o.payment_type,
            COALESCE(o.hours_worked, 0::numeric) AS h,
            COALESCE(o.total_cost, 0::numeric) AS c,
            'Hors espace / ponctuel'::text AS espace,
            'non_precise'::text AS statut
           FROM occasional_hours o
        UNION ALL
         SELECT f.label AS staff_name,
            f.event_id,
            'Forfait '::text || f.category AS mission,
            f.category AS payment_type,
            0::numeric AS h,
            COALESCE(f.amount_ht, 0::numeric) AS c,
            'Hors espace / ponctuel'::text AS espace,
            'non_precise'::text AS statut
           FROM event_rh_forfaits f
        ), canon AS (
         SELECT rh_person_key(lignes.staff_name) AS k,
            (array_agg(lignes.staff_name ORDER BY ((lignes.staff_name ~ '[a-z]'::text)::integer) DESC, ((lignes.staff_name ~ ' '::text)::integer) DESC, (length(lignes.staff_name)) DESC, lignes.staff_name))[1] AS display_name
           FROM lignes
          GROUP BY (rh_person_key(lignes.staff_name))
        )
 SELECT cn.display_name AS staff_name,
    to_char(COALESCE(e.event_date, CURRENT_DATE)::timestamp with time zone, 'YYYY-MM'::text) AS mois,
    COALESCE(NULLIF(string_agg(DISTINCT l.payment_type, '/'::text), ''::text), 'non défini'::text) AS type_paiement,
    sum(l.h) AS heures,
    round(sum(l.c), 2) AS cout_ht,
    count(DISTINCT l.event_id) AS nb_evenements,
    string_agg(DISTINCT l.mission, ', '::text) AS missions,
    string_agg(DISTINCT NULLIF(l.espace, 'Hors espace / ponctuel'::text), ', '::text) AS espaces,
    string_agg(DISTINCT NULLIF(l.statut, 'non_precise'::text), ', '::text) AS statuts
   FROM lignes l
     JOIN canon cn ON cn.k = rh_person_key(l.staff_name)
     LEFT JOIN events e ON e.event_id = l.event_id
  GROUP BY cn.display_name, (to_char(COALESCE(e.event_date, CURRENT_DATE)::timestamp with time zone, 'YYYY-MM'::text))
  ORDER BY (to_char(COALESCE(e.event_date, CURRENT_DATE)::timestamp with time zone, 'YYYY-MM'::text)) DESC, cn.display_name;


create or replace view rh_monthly_hours_detail as
 WITH lignes AS (
         SELECT z.staff_name,
            z.event_id,
            z.role AS mission,
            COALESCE(z.hours_worked, 0::numeric) AS h,
            COALESCE(z.rh_cost, 0::numeric) AS c,
            COALESCE(s.space_name, '—'::text) AS espace,
            COALESCE(p.staff_status, 'non_precise'::text) AS statut
           FROM zone_staff_hours z
             LEFT JOIN spaces s ON s.space_id = z.space_id
             LEFT JOIN event_staff_preplan p ON p.zone_staff_hour_id = z.id
        UNION ALL
         SELECT sch.staff_name,
            sch.event_id,
            COALESCE(NULLIF(sch.mission_type, ''::text), sch.role, 'Responsable espace'::text) AS mission,
            COALESCE(sch.computed_hours,
                CASE
                    WHEN sch.planned_departure IS NOT NULL AND sch.planned_arrival IS NOT NULL THEN round(EXTRACT(epoch FROM sch.planned_departure - sch.planned_arrival) / 3600::numeric +
                    CASE
                        WHEN sch.planned_departure < sch.planned_arrival THEN 24
                        ELSE 0
                    END::numeric, 2)
                    ELSE 0::numeric
                END) AS h,
            COALESCE(sch.computed_hours,
                CASE
                    WHEN sch.planned_departure IS NOT NULL AND sch.planned_arrival IS NOT NULL THEN round(EXTRACT(epoch FROM sch.planned_departure - sch.planned_arrival) / 3600::numeric +
                    CASE
                        WHEN sch.planned_departure < sch.planned_arrival THEN 24
                        ELSE 0
                    END::numeric, 2)
                    ELSE 0::numeric
                END) * COALESCE(sch.hourly_rate, 0::numeric) AS c,
            COALESCE(s.space_name, '—'::text) AS espace,
            'non_precise'::text AS statut
           FROM schedules sch
             LEFT JOIN spaces s ON s.space_id = sch.space_id
          WHERE sch.staff_name IS NOT NULL
        UNION ALL
         SELECT o.staff_name,
            o.event_id,
            o.mission_type AS mission,
            COALESCE(o.hours_worked, 0::numeric) AS h,
            COALESCE(o.total_cost, 0::numeric) AS c,
            'Hors espace / ponctuel'::text AS espace,
            'non_precise'::text AS statut
           FROM occasional_hours o
        UNION ALL
         SELECT f.label AS staff_name,
            f.event_id,
            'Forfait '::text || f.category AS mission,
            0::numeric AS h,
            COALESCE(f.amount_ht, 0::numeric) AS c,
            'Hors espace / ponctuel'::text AS espace,
            'non_precise'::text AS statut
           FROM event_rh_forfaits f
        )
 SELECT l.staff_name,
    to_char(COALESCE(e.event_date, CURRENT_DATE)::timestamp with time zone, 'YYYY-MM'::text) AS mois,
    l.espace,
    l.statut,
    string_agg(DISTINCT l.mission, ', '::text) AS missions,
    sum(l.h) AS heures,
    round(sum(l.c), 2) AS cout_ht,
    count(DISTINCT l.event_id) AS nb_evenements
   FROM lignes l
     LEFT JOIN events e ON e.event_id = l.event_id
  GROUP BY l.staff_name, (to_char(COALESCE(e.event_date, CURRENT_DATE)::timestamp with time zone, 'YYYY-MM'::text)), l.espace, l.statut;


create or replace view rh_monthly_event_detail as
 WITH lignes AS (
         SELECT z.staff_name,
            z.event_id,
            'Service espace'::text AS nature,
            z.payment_type,
            COALESCE(z.hours_worked, 0::numeric) AS h,
            COALESCE(z.rh_cost, 0::numeric) AS c,
            COALESCE(s.space_name, '—'::text) AS espace,
            false AS operationnel
           FROM zone_staff_hours z
             LEFT JOIN spaces s ON s.space_id = z.space_id
        UNION ALL
         SELECT sch.staff_name,
            sch.event_id,
            COALESCE(NULLIF(sch.mission_type, ''::text), sch.role, 'Responsable espace'::text) AS nature,
            sch.contract_type AS payment_type,
            COALESCE(sch.computed_hours,
                CASE
                    WHEN sch.planned_departure IS NOT NULL AND sch.planned_arrival IS NOT NULL THEN round(EXTRACT(epoch FROM sch.planned_departure - sch.planned_arrival) / 3600::numeric +
                    CASE
                        WHEN sch.planned_departure < sch.planned_arrival THEN 24
                        ELSE 0
                    END::numeric, 2)
                    ELSE 0::numeric
                END) AS h,
            COALESCE(sch.computed_hours,
                CASE
                    WHEN sch.planned_departure IS NOT NULL AND sch.planned_arrival IS NOT NULL THEN round(EXTRACT(epoch FROM sch.planned_departure - sch.planned_arrival) / 3600::numeric +
                    CASE
                        WHEN sch.planned_departure < sch.planned_arrival THEN 24
                        ELSE 0
                    END::numeric, 2)
                    ELSE 0::numeric
                END) * COALESCE(sch.hourly_rate, 0::numeric) AS c,
            COALESCE(s.space_name, '—'::text) AS espace,
            false AS operationnel
           FROM schedules sch
             LEFT JOIN spaces s ON s.space_id = sch.space_id
          WHERE sch.staff_name IS NOT NULL
        UNION ALL
         SELECT o.staff_name,
            o.event_id,
            initcap(o.mission_type) AS nature,
            o.payment_type,
            COALESCE(o.hours_worked, 0::numeric) AS h,
            COALESCE(o.total_cost, 0::numeric) AS c,
            'Hors espace / ponctuel'::text AS espace,
            o.mission_type = ANY (ARRAY['montage'::text, 'livraison'::text, 'manutention'::text, 'demontage'::text, 'preparation'::text]) AS operationnel
           FROM occasional_hours o
        UNION ALL
         SELECT f.label AS staff_name,
            f.event_id,
            'Forfait '::text || f.category AS nature,
            f.category AS payment_type,
            0::numeric AS h,
            COALESCE(f.amount_ht, 0::numeric) AS c,
            'Hors espace / ponctuel'::text AS espace,
            f.category = 'manutention'::text AS operationnel
           FROM event_rh_forfaits f
        ), canon AS (
         SELECT rh_person_key(lignes.staff_name) AS k,
            (array_agg(lignes.staff_name ORDER BY ((lignes.staff_name ~ '[a-z]'::text)::integer) DESC, ((lignes.staff_name ~ ' '::text)::integer) DESC, (length(lignes.staff_name)) DESC, lignes.staff_name))[1] AS display_name
           FROM lignes
          GROUP BY (rh_person_key(lignes.staff_name))
        )
 SELECT cn.display_name AS staff_name,
    to_char(COALESCE(e.event_date, CURRENT_DATE)::timestamp with time zone, 'YYYY-MM'::text) AS mois,
        CASE
            WHEN l.operationnel THEN 'Opérationnel'::text
            WHEN e.event_type = 'match'::text THEN 'Match'::text
            WHEN e.event_type = 'séminaire'::text THEN 'Séminaire'::text
            WHEN e.event_type = 'cocktail'::text THEN 'Cocktail'::text
            WHEN e.event_type = 'réception_vip'::text THEN 'Réception VIP'::text
            WHEN e.event_type = 'événement_partenaire'::text THEN 'Événement partenaire'::text
            WHEN e.event_type = 'réunion'::text THEN 'Réunion'::text
            WHEN e.event_type = 'autre'::text THEN 'Autre'::text
            WHEN e.event_type IS NOT NULL THEN initcap(e.event_type)
            ELSE 'Autre'::text
        END AS categorie,
    l.event_id,
    COALESCE(e.event_name, '(sans événement)'::text) AS event_name,
    e.event_date,
    l.nature,
    l.espace,
    COALESCE(NULLIF(string_agg(DISTINCT l.payment_type, '/'::text), ''::text), 'non défini'::text) AS payment_type,
    round(sum(l.h), 1) AS heures,
    round(sum(l.c), 2) AS cout_ht
   FROM lignes l
     JOIN canon cn ON cn.k = rh_person_key(l.staff_name)
     LEFT JOIN events e ON e.event_id = l.event_id
  GROUP BY cn.display_name, (to_char(COALESCE(e.event_date, CURRENT_DATE)::timestamp with time zone, 'YYYY-MM'::text)), (
        CASE
            WHEN l.operationnel THEN 'Opérationnel'::text
            WHEN e.event_type = 'match'::text THEN 'Match'::text
            WHEN e.event_type = 'séminaire'::text THEN 'Séminaire'::text
            WHEN e.event_type = 'cocktail'::text THEN 'Cocktail'::text
            WHEN e.event_type = 'réception_vip'::text THEN 'Réception VIP'::text
            WHEN e.event_type = 'événement_partenaire'::text THEN 'Événement partenaire'::text
            WHEN e.event_type = 'réunion'::text THEN 'Réunion'::text
            WHEN e.event_type = 'autre'::text THEN 'Autre'::text
            WHEN e.event_type IS NOT NULL THEN initcap(e.event_type)
            ELSE 'Autre'::text
        END), l.event_id, e.event_name, e.event_date, l.nature, l.espace
 HAVING round(sum(l.h), 1) <> 0::numeric OR round(sum(l.c), 2) <> 0::numeric;


create or replace view rh_person_event_shift as
 WITH lignes AS (
         SELECT z.staff_name,
            z.event_id,
            z.space_id,
            COALESCE(NULLIF(z.role, ''::text), 'Service espace'::text) AS nature,
            z.payment_type,
            z.arrival_time AS arrivee,
            z.departure_time AS depart,
            NULL::date AS work_date,
            COALESCE(z.hours_worked, 0::numeric) AS h,
            COALESCE(z.rh_cost, 0::numeric) AS c,
            COALESCE(s.space_name, '—'::text) AS espace,
            false AS operationnel
           FROM zone_staff_hours z
             LEFT JOIN spaces s ON s.space_id = z.space_id
        UNION ALL
         SELECT sch.staff_name,
            sch.event_id,
            sch.space_id,
            COALESCE(NULLIF(sch.mission_type, ''::text), sch.role, 'Responsable espace'::text) AS nature,
            sch.contract_type AS payment_type,
            sch.planned_arrival AS arrivee,
            COALESCE(sch.actual_departure, sch.planned_departure) AS depart,
            NULL::date AS work_date,
            COALESCE(sch.computed_hours,
                CASE
                    WHEN sch.planned_departure IS NOT NULL AND sch.planned_arrival IS NOT NULL THEN round(EXTRACT(epoch FROM sch.planned_departure - sch.planned_arrival) / 3600::numeric +
                    CASE
                        WHEN sch.planned_departure < sch.planned_arrival THEN 24
                        ELSE 0
                    END::numeric, 2)
                    ELSE 0::numeric
                END) AS h,
            COALESCE(sch.computed_hours,
                CASE
                    WHEN sch.planned_departure IS NOT NULL AND sch.planned_arrival IS NOT NULL THEN round(EXTRACT(epoch FROM sch.planned_departure - sch.planned_arrival) / 3600::numeric +
                    CASE
                        WHEN sch.planned_departure < sch.planned_arrival THEN 24
                        ELSE 0
                    END::numeric, 2)
                    ELSE 0::numeric
                END) * COALESCE(sch.hourly_rate, 0::numeric) AS c,
            COALESCE(s.space_name, '—'::text) AS espace,
            false AS operationnel
           FROM schedules sch
             LEFT JOIN spaces s ON s.space_id = sch.space_id
          WHERE sch.staff_name IS NOT NULL
        UNION ALL
         SELECT o.staff_name,
            o.event_id,
            NULL::uuid AS space_id,
            initcap(o.mission_type) AS nature,
            o.payment_type,
            o.start_time AS arrivee,
            o.end_time AS depart,
            o.work_date,
            COALESCE(o.hours_worked, 0::numeric) AS h,
            COALESCE(o.total_cost, 0::numeric) AS c,
            'Hors espace / ponctuel'::text AS espace,
            o.mission_type = ANY (ARRAY['montage'::text, 'livraison'::text, 'manutention'::text, 'demontage'::text, 'preparation'::text]) AS operationnel
           FROM occasional_hours o
        UNION ALL
         SELECT f.label AS staff_name,
            f.event_id,
            NULL::uuid AS space_id,
            'Forfait '::text || f.category AS nature,
            f.category AS payment_type,
            NULL::time without time zone AS arrivee,
            NULL::time without time zone AS depart,
            NULL::date AS work_date,
            0::numeric AS h,
            COALESCE(f.amount_ht, 0::numeric) AS c,
            'Hors espace / ponctuel'::text AS espace,
            f.category = 'manutention'::text AS operationnel
           FROM event_rh_forfaits f
        ), canon AS (
         SELECT rh_person_key(lignes.staff_name) AS k,
            (array_agg(lignes.staff_name ORDER BY ((lignes.staff_name ~ '[a-z]'::text)::integer) DESC, ((lignes.staff_name ~ ' '::text)::integer) DESC, (length(lignes.staff_name)) DESC, lignes.staff_name))[1] AS display_name
           FROM lignes
          GROUP BY (rh_person_key(lignes.staff_name))
        )
 SELECT cn.display_name AS staff_name,
    to_char(COALESCE(e.event_date, CURRENT_DATE)::timestamp with time zone, 'YYYY-MM'::text) AS mois,
        CASE
            WHEN l.operationnel THEN 'Opérationnel'::text
            WHEN e.event_type = 'match'::text THEN 'Match'::text
            WHEN e.event_type = 'séminaire'::text THEN 'Séminaire'::text
            WHEN e.event_type = 'cocktail'::text THEN 'Cocktail'::text
            WHEN e.event_type = 'réception_vip'::text THEN 'Réception VIP'::text
            WHEN e.event_type = 'événement_partenaire'::text THEN 'Événement partenaire'::text
            WHEN e.event_type = 'réunion'::text THEN 'Réunion'::text
            WHEN e.event_type = 'autre'::text THEN 'Autre'::text
            WHEN e.event_type IS NOT NULL THEN initcap(e.event_type)
            ELSE 'Autre'::text
        END AS categorie,
    l.event_id,
    COALESCE(e.event_name, '(sans événement)'::text) AS event_name,
    e.event_date,
    COALESCE(l.work_date, e.event_date) AS jour,
    l.nature,
    l.espace,
    to_char(l.arrivee::interval, 'HH24:MI'::text) AS arrivee,
    to_char(l.depart::interval, 'HH24:MI'::text) AS depart,
    COALESCE(NULLIF(l.payment_type, ''::text), 'non défini'::text) AS payment_type,
    round(l.h, 2) AS heures,
    round(l.c, 2) AS cout_ht
   FROM lignes l
     JOIN canon cn ON cn.k = rh_person_key(l.staff_name)
     LEFT JOIN events e ON e.event_id = l.event_id
  WHERE round(l.h, 2) <> 0::numeric OR round(l.c, 2) <> 0::numeric;


create or replace view rh_unified as
 SELECT e.event_id,
    e.event_name,
    e.event_type,
    e.event_date,
    COALESCE(e.expected_attendees, 0) AS pax_count,
    s.space_id,
    s.space_name,
    space_profile(s.space_name) AS service_type,
    zsh.staff_name AS agent_nom,
    COALESCE(zsh.role, 'Agent'::text) AS agent_role,
    zsh.arrival_time AS heure_arrivee,
    zsh.departure_time AS heure_depart,
    COALESCE(zsh.break_minutes, 0) AS pause_min,
    zsh.hours_worked AS heures_travaillees,
    0::numeric AS heures_sup,
    COALESCE(zsh.hourly_rate, 0::numeric) AS taux_horaire,
    COALESCE(zsh.rh_cost, 0::numeric) AS cout_rh,
    COALESCE(zsh.confirmed_by_staff, false) AS confirme_agent,
    COALESCE(zsh.confirmed_by_manager, false) AS confirme_manager,
    'zone_staff'::text AS source
   FROM zone_staff_hours zsh
     JOIN events e ON e.event_id = zsh.event_id
     JOIN spaces s ON s.space_id = zsh.space_id
  WHERE (e.status = ANY (ARRAY['clôturé'::text, 'archivé'::text, 'en_cours'::text])) AND s.active = true
UNION ALL
 SELECT e.event_id,
    e.event_name,
    e.event_type,
    e.event_date,
    COALESCE(e.expected_attendees, 0) AS pax_count,
    s.space_id,
    s.space_name,
    space_profile(s.space_name) AS service_type,
    sch.staff_name AS agent_nom,
    COALESCE(sch.role, 'Responsable espace'::text) AS agent_role,
    sch.planned_arrival AS heure_arrivee,
    COALESCE(sch.actual_departure, sch.planned_departure) AS heure_depart,
    0 AS pause_min,
    COALESCE(sch.computed_hours,
        CASE
            WHEN sch.planned_departure IS NOT NULL AND sch.planned_arrival IS NOT NULL THEN round(EXTRACT(epoch FROM sch.planned_departure - sch.planned_arrival) / 3600::numeric +
            CASE
                WHEN sch.planned_departure < sch.planned_arrival THEN 24
                ELSE 0
            END::numeric, 2)
            ELSE NULL::numeric
        END) AS heures_travaillees,
    COALESCE(sch.overtime_hours, 0::numeric) AS heures_sup,
    COALESCE(sch.hourly_rate, 0::numeric) AS taux_horaire,
    COALESCE(sch.computed_hours, 0::numeric) * COALESCE(sch.hourly_rate, 0::numeric) AS cout_rh,
    COALESCE(sch.confirmed_by_staff, false) AS confirme_agent,
    COALESCE(sch.confirmed_by_manager, false) AS confirme_manager,
    'schedule'::text AS source
   FROM schedules sch
     JOIN events e ON e.event_id = sch.event_id
     JOIN spaces s ON s.space_id = sch.space_id
  WHERE (e.status = ANY (ARRAY['clôturé'::text, 'archivé'::text, 'en_cours'::text])) AND s.active = true AND sch.staff_name IS NOT NULL
UNION ALL
 SELECT e.event_id,
    e.event_name,
    e.event_type,
    e.event_date,
    COALESCE(e.expected_attendees, 0) AS pax_count,
    NULL::uuid AS space_id,
    'Hors espace / ponctuel'::text AS space_name,
    'hors_espace'::text AS service_type,
    o.staff_name AS agent_nom,
    COALESCE(NULLIF(o.mission_type, ''::text), 'Ponctuel'::text) AS agent_role,
    o.start_time AS heure_arrivee,
    o.end_time AS heure_depart,
    0 AS pause_min,
    COALESCE(o.hours_worked, 0::numeric) AS heures_travaillees,
    0::numeric AS heures_sup,
    COALESCE(o.hourly_rate, 0::numeric) AS taux_horaire,
    COALESCE(o.total_cost, 0::numeric) AS cout_rh,
    false AS confirme_agent,
    false AS confirme_manager,
    'occasional'::text AS source
   FROM occasional_hours o
     JOIN events e ON e.event_id = o.event_id
  WHERE (e.status = ANY (ARRAY['clôturé'::text, 'archivé'::text, 'en_cours'::text])) AND o.staff_name IS NOT NULL
UNION ALL
 SELECT e.event_id,
    e.event_name,
    e.event_type,
    e.event_date,
    COALESCE(e.expected_attendees, 0) AS pax_count,
    NULL::uuid AS space_id,
    'Hors espace / ponctuel'::text AS space_name,
    'hors_espace'::text AS service_type,
    f.label AS agent_nom,
    'Forfait '::text || f.category AS agent_role,
    NULL::time without time zone AS heure_arrivee,
    NULL::time without time zone AS heure_depart,
    0 AS pause_min,
    0::numeric AS heures_travaillees,
    0::numeric AS heures_sup,
    0::numeric AS taux_horaire,
    COALESCE(f.amount_ht, 0::numeric) AS cout_rh,
    false AS confirme_agent,
    false AS confirme_manager,
    'forfait'::text AS source
   FROM event_rh_forfaits f
     JOIN events e ON e.event_id = f.event_id
  WHERE e.status = ANY (ARRAY['clôturé'::text, 'archivé'::text, 'en_cours'::text]);
