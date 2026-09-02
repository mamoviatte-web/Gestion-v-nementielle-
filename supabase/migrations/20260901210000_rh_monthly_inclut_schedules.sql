-- Synthèse RH mensuelle : inclure le canal « schedules » (horaires planifiés)
-- ============================================================================
-- Transmission RH — correctif. La vue rh_monthly_hours (synthèse mensuelle /
-- suivi global) n'agrégeait que zone_staff_hours + occasional_hours : le canal
-- « schedules » (staff planifié par espace — l'essentiel des horaires MATCH, et
-- une partie des séminaires) était PERDU dans les synthèses mensuelles alors
-- qu'il compte bien dans les KPI d'événement (rh_unified). On ajoute la 3ᵉ
-- branche pour aligner le mensuel sur l'événementiel (source unifiée cohérente).

CREATE OR REPLACE VIEW public.rh_monthly_hours AS
 WITH lignes AS (
         -- 1) Staff par espace (zone_staff_hours)
         SELECT z.staff_name, z.event_id, z.role AS mission, z.payment_type,
            COALESCE(z.hours_worked, 0::numeric) AS h,
            COALESCE(z.rh_cost, 0::numeric) AS c,
            COALESCE(s.space_name, '—'::text) AS espace,
            COALESCE(p.staff_status, 'non_precise'::text) AS statut
           FROM zone_staff_hours z
             LEFT JOIN spaces s ON s.space_id = z.space_id
             LEFT JOIN event_staff_preplan p ON p.zone_staff_hour_id = z.id
        UNION ALL
         -- 2) Horaires planifiés (schedules) — AJOUT : aligne le mensuel sur rh_unified
         SELECT sch.staff_name, sch.event_id,
            COALESCE(NULLIF(sch.mission_type, ''::text), sch.role, 'Responsable espace'::text) AS mission,
            sch.contract_type AS payment_type,
            COALESCE(sch.computed_hours,
              CASE WHEN sch.planned_departure IS NOT NULL AND sch.planned_arrival IS NOT NULL
                THEN round(EXTRACT(epoch FROM sch.planned_departure - sch.planned_arrival) / 3600::numeric
                     + CASE WHEN sch.planned_departure < sch.planned_arrival THEN 24 ELSE 0 END::numeric, 2)
                ELSE 0::numeric END) AS h,
            COALESCE(sch.computed_hours,
              CASE WHEN sch.planned_departure IS NOT NULL AND sch.planned_arrival IS NOT NULL
                THEN round(EXTRACT(epoch FROM sch.planned_departure - sch.planned_arrival) / 3600::numeric
                     + CASE WHEN sch.planned_departure < sch.planned_arrival THEN 24 ELSE 0 END::numeric, 2)
                ELSE 0::numeric END) * COALESCE(sch.hourly_rate, 0::numeric) AS c,
            COALESCE(s.space_name, '—'::text) AS espace,
            'non_precise'::text AS statut
           FROM schedules sch
             LEFT JOIN spaces s ON s.space_id = sch.space_id
          WHERE sch.staff_name IS NOT NULL
        UNION ALL
         -- 3) Ponctuel / hors espace (occasional_hours) — runner, logistique, régisseur ponctuel
         SELECT o.staff_name, o.event_id, o.mission_type AS mission, o.payment_type,
            COALESCE(o.hours_worked, 0::numeric) AS h,
            COALESCE(o.total_cost, 0::numeric) AS c,
            'Hors espace / ponctuel'::text AS espace,
            'non_precise'::text AS statut
           FROM occasional_hours o
        )
 SELECT l.staff_name,
    to_char(COALESCE(e.event_date, CURRENT_DATE)::timestamp with time zone, 'YYYY-MM'::text) AS mois,
    COALESCE(NULLIF(string_agg(DISTINCT l.payment_type, '/'::text), ''::text), 'non défini'::text) AS type_paiement,
    sum(l.h) AS heures,
    round(sum(l.c), 2) AS cout_ht,
    count(DISTINCT l.event_id) AS nb_evenements,
    string_agg(DISTINCT l.mission, ', '::text) AS missions,
    string_agg(DISTINCT NULLIF(l.espace, 'Hors espace / ponctuel'::text), ', '::text) AS espaces,
    string_agg(DISTINCT NULLIF(l.statut, 'non_precise'::text), ', '::text) AS statuts
   FROM lignes l
     LEFT JOIN events e ON e.event_id = l.event_id
  GROUP BY l.staff_name, (to_char(COALESCE(e.event_date, CURRENT_DATE)::timestamp with time zone, 'YYYY-MM'::text))
  ORDER BY (to_char(COALESCE(e.event_date, CURRENT_DATE)::timestamp with time zone, 'YYYY-MM'::text)) DESC, l.staff_name;

-- Même correctif sur le détail mensuel (rh_monthly_hours_detail).
CREATE OR REPLACE VIEW public.rh_monthly_hours_detail AS
 WITH lignes AS (
         SELECT z.staff_name, z.event_id, z.role AS mission,
            COALESCE(z.hours_worked, 0::numeric) AS h, COALESCE(z.rh_cost, 0::numeric) AS c,
            COALESCE(s.space_name, '—'::text) AS espace,
            COALESCE(p.staff_status, 'non_precise'::text) AS statut
           FROM zone_staff_hours z
             LEFT JOIN spaces s ON s.space_id = z.space_id
             LEFT JOIN event_staff_preplan p ON p.zone_staff_hour_id = z.id
        UNION ALL
         SELECT sch.staff_name, sch.event_id,
            COALESCE(NULLIF(sch.mission_type, ''::text), sch.role, 'Responsable espace'::text) AS mission,
            COALESCE(sch.computed_hours,
              CASE WHEN sch.planned_departure IS NOT NULL AND sch.planned_arrival IS NOT NULL
                THEN round(EXTRACT(epoch FROM sch.planned_departure - sch.planned_arrival) / 3600::numeric
                     + CASE WHEN sch.planned_departure < sch.planned_arrival THEN 24 ELSE 0 END::numeric, 2)
                ELSE 0::numeric END) AS h,
            COALESCE(sch.computed_hours,
              CASE WHEN sch.planned_departure IS NOT NULL AND sch.planned_arrival IS NOT NULL
                THEN round(EXTRACT(epoch FROM sch.planned_departure - sch.planned_arrival) / 3600::numeric
                     + CASE WHEN sch.planned_departure < sch.planned_arrival THEN 24 ELSE 0 END::numeric, 2)
                ELSE 0::numeric END) * COALESCE(sch.hourly_rate, 0::numeric) AS c,
            COALESCE(s.space_name, '—'::text) AS espace, 'non_precise'::text AS statut
           FROM schedules sch LEFT JOIN spaces s ON s.space_id = sch.space_id
          WHERE sch.staff_name IS NOT NULL
        UNION ALL
         SELECT o.staff_name, o.event_id, o.mission_type AS mission,
            COALESCE(o.hours_worked, 0::numeric) AS h, COALESCE(o.total_cost, 0::numeric) AS c,
            'Hors espace / ponctuel'::text AS espace, 'non_precise'::text AS statut
           FROM occasional_hours o
        )
 SELECT l.staff_name,
    to_char(COALESCE(e.event_date, CURRENT_DATE)::timestamp with time zone, 'YYYY-MM'::text) AS mois,
    l.espace, l.statut,
    string_agg(DISTINCT l.mission, ', '::text) AS missions,
    sum(l.h) AS heures, round(sum(l.c), 2) AS cout_ht,
    count(DISTINCT l.event_id) AS nb_evenements
   FROM lignes l LEFT JOIN events e ON e.event_id = l.event_id
  GROUP BY l.staff_name, (to_char(COALESCE(e.event_date, CURRENT_DATE)::timestamp with time zone, 'YYYY-MM'::text)), l.espace, l.statut;
