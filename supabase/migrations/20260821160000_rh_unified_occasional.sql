-- KPI RH opérationnels : intégrer les prestations ponctuelles (manutention /
-- runner / logistique) dans rh_unified, en plus du staff par espace
-- (zone_staff_hours) et des responsables (schedules).
--
-- Ces prestations sont « hors espace » (occasional_hours n'a pas de space_id) :
--  • elles remontent dans les KPI par ÉVÉNEMENT (rh_event_kpis) et par AGENT
--    (rh_agents_cumul) — heures + coût inclus ;
--  • elles sont EXCLUES du tableau de ratios PAR ESPACE (rh_espace_ratios), qui
--    ne concerne que les agents rattachés à un espace.
--
-- Aucune colonne ne change : simple CREATE OR REPLACE (dépendances préservées).
-- rh_unified est déjà sans filtre de type d'événement → séminaires inclus.

CREATE OR REPLACE VIEW public.rh_unified AS
 SELECT e.event_id, e.event_name, e.event_type, e.event_date,
    COALESCE(e.expected_attendees, 0) AS pax_count,
    s.space_id, s.space_name, space_profile(s.space_name) AS service_type,
    zsh.staff_name AS agent_nom, COALESCE(zsh.role, 'Agent'::text) AS agent_role,
    zsh.arrival_time AS heure_arrivee, zsh.departure_time AS heure_depart,
    COALESCE(zsh.break_minutes, 0) AS pause_min,
    zsh.hours_worked AS heures_travaillees, 0::numeric AS heures_sup,
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
 SELECT e.event_id, e.event_name, e.event_type, e.event_date,
    COALESCE(e.expected_attendees, 0) AS pax_count,
    s.space_id, s.space_name, space_profile(s.space_name) AS service_type,
    sch.staff_name AS agent_nom, COALESCE(sch.role, 'Responsable espace'::text) AS agent_role,
    sch.planned_arrival AS heure_arrivee,
    COALESCE(sch.actual_departure, sch.planned_departure) AS heure_depart,
    0 AS pause_min,
    COALESCE(sch.computed_hours,
        CASE
            WHEN sch.planned_departure IS NOT NULL AND sch.planned_arrival IS NOT NULL THEN round(EXTRACT(epoch FROM sch.planned_departure - sch.planned_arrival) / 3600::numeric +
            CASE WHEN sch.planned_departure < sch.planned_arrival THEN 24 ELSE 0 END::numeric, 2)
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
 SELECT e.event_id, e.event_name, e.event_type, e.event_date,
    COALESCE(e.expected_attendees, 0) AS pax_count,
    NULL::uuid AS space_id, 'Hors espace / ponctuel'::text AS space_name, 'hors_espace'::text AS service_type,
    o.staff_name AS agent_nom, COALESCE(NULLIF(o.mission_type, ''), 'Ponctuel'::text) AS agent_role,
    o.start_time AS heure_arrivee, o.end_time AS heure_depart, 0 AS pause_min,
    COALESCE(o.hours_worked, 0::numeric) AS heures_travaillees, 0::numeric AS heures_sup,
    COALESCE(o.hourly_rate, 0::numeric) AS taux_horaire,
    COALESCE(o.total_cost, 0::numeric) AS cout_rh,
    false AS confirme_agent, false AS confirme_manager,
    'occasional'::text AS source
   FROM occasional_hours o
     JOIN events e ON e.event_id = o.event_id
  WHERE (e.status = ANY (ARRAY['clôturé'::text, 'archivé'::text, 'en_cours'::text])) AND o.staff_name IS NOT NULL;

-- rh_espace_ratios : ne garder que les agents rattachés à un espace (exclut les
-- prestations hors-espace nouvellement présentes dans rh_unified).
CREATE OR REPLACE VIEW public.rh_espace_ratios AS
 SELECT r.event_id, r.event_name, r.event_type, r.event_date,
    r.space_id, r.space_name, r.service_type, r.pax_count,
    count(DISTINCT r.agent_nom) AS nb_agents,
    round(avg(r.heures_travaillees), 2) AS moy_heures,
    round(COALESCE(sum(r.cout_rh), 0::numeric), 2) AS cout_rh,
    CASE WHEN r.pax_count > 0 THEN round(count(DISTINCT r.agent_nom)::numeric * 100.0 / r.pax_count::numeric, 2) ELSE NULL::numeric END AS ratio_actuel,
    c.cible_ratio,
    CASE WHEN r.pax_count > 0 THEN round((count(DISTINCT r.agent_nom)::numeric * 100.0 / r.pax_count::numeric - c.cible_ratio) / c.cible_ratio * 100::numeric, 0) ELSE NULL::numeric END AS ecart_pct,
    CASE
        WHEN r.pax_count IS NULL OR r.pax_count = 0 THEN 'inconnu'::text
        WHEN (count(DISTINCT r.agent_nom)::numeric * 100.0 / r.pax_count::numeric) >= (c.cible_ratio * 0.9) THEN 'ok'::text
        WHEN (count(DISTINCT r.agent_nom)::numeric * 100.0 / r.pax_count::numeric) >= (c.cible_ratio * 0.7) THEN 'sous-staffé'::text
        ELSE 'critique'::text
    END AS statut_staffing
   FROM rh_unified r
     LEFT JOIN LATERAL ( SELECT
                CASE r.service_type
                    WHEN 'salon'::text THEN 3.0 WHEN 'loge'::text THEN 3.5 WHEN 'bar_pub'::text THEN 2.5
                    WHEN 'wine_bar'::text THEN 2.0 WHEN 'club'::text THEN 2.5 WHEN 'pmr'::text THEN 1.5
                    WHEN 'bodega'::text THEN 2.0 WHEN 'terrasse'::text THEN 1.5 WHEN 'buvette'::text THEN 4.0
                    ELSE 2.0
                END AS cible_ratio) c ON true
  WHERE r.space_id IS NOT NULL
  GROUP BY r.event_id, r.event_name, r.event_type, r.event_date, r.space_id, r.space_name, r.service_type, r.pax_count, c.cible_ratio;
