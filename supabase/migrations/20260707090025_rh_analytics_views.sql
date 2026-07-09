-- ═══════════════════════════════════════════════════════════════════════════
-- rh_analytics_views.sql — Vues RH unifiées pour la page Staff & RH.
--
-- ⚠ Adaptations au schéma réel (le SQL du prompt visait des colonnes absentes) :
--   • events.expected_attendees (pas pax_count).
--   • schedules : staff_name (pas employee_name/responsable_nom),
--     planned_arrival/planned_departure/actual_departure (pas start/end_time),
--     computed_hours (heures déjà calculées, gestion minuit), overtime_hours,
--     confirmed_by_staff/manager, declared_by_self. PAS de break_minutes ni
--     contract_hours.
--   • zone_staff_hours : colonnes conformes (arrival_time, departure_time,
--     break_minutes, hours_worked, hourly_rate, rh_cost, confirmed_*).
--   • Le « profil » d'espace pour les cibles de staffing vient de
--     space_profile(space_name) (salon/loge/bar_pub/…), pas de service_type.
--   • rh_unified = UNION des deux sources (et NON un double LEFT JOIN qui
--     produirait un produit cartésien agent×agent par espace).
--   • RG-003 : ces vues exposent des coûts → réservées à authenticated.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW rh_unified AS
-- Source 1 : heures saisies en zone (matchs)
SELECT
  e.event_id, e.event_name, e.event_type, e.event_date,
  COALESCE(e.expected_attendees, 0)          AS pax_count,
  s.space_id, s.space_name,
  space_profile(s.space_name)                AS service_type,
  zsh.staff_name                             AS agent_nom,
  COALESCE(zsh.role, 'Agent')                AS agent_role,
  zsh.arrival_time                           AS heure_arrivee,
  zsh.departure_time                         AS heure_depart,
  COALESCE(zsh.break_minutes, 0)             AS pause_min,
  zsh.hours_worked                           AS heures_travaillees,
  0::DECIMAL                                 AS heures_sup,
  COALESCE(zsh.hourly_rate, 0)               AS taux_horaire,
  COALESCE(zsh.rh_cost, 0)                   AS cout_rh,
  COALESCE(zsh.confirmed_by_staff, false)    AS confirme_agent,
  COALESCE(zsh.confirmed_by_manager, false)  AS confirme_manager,
  'zone_staff'                               AS source
FROM zone_staff_hours zsh
JOIN events e ON e.event_id = zsh.event_id
JOIN spaces s ON s.space_id = zsh.space_id
WHERE e.status IN ('clôturé', 'archivé', 'en_cours') AND s.active = true

UNION ALL

-- Source 2 : planning staff (schedules)
SELECT
  e.event_id, e.event_name, e.event_type, e.event_date,
  COALESCE(e.expected_attendees, 0),
  s.space_id, s.space_name,
  space_profile(s.space_name),
  sch.staff_name,
  COALESCE(sch.role, 'Responsable espace'),
  sch.planned_arrival,
  COALESCE(sch.actual_departure, sch.planned_departure),
  0,
  COALESCE(
    sch.computed_hours,
    CASE WHEN sch.planned_departure IS NOT NULL AND sch.planned_arrival IS NOT NULL
      THEN ROUND((EXTRACT(EPOCH FROM (sch.planned_departure - sch.planned_arrival)) / 3600
        + CASE WHEN sch.planned_departure < sch.planned_arrival THEN 24 ELSE 0 END)::DECIMAL, 2)
      ELSE NULL END
  ),
  COALESCE(sch.overtime_hours, 0),
  COALESCE(sch.hourly_rate, 0),
  COALESCE(sch.computed_hours, 0) * COALESCE(sch.hourly_rate, 0),
  COALESCE(sch.confirmed_by_staff, false),
  COALESCE(sch.confirmed_by_manager, false),
  'schedule'
FROM schedules sch
JOIN events e ON e.event_id = sch.event_id
JOIN spaces s ON s.space_id = sch.space_id
WHERE e.status IN ('clôturé', 'archivé', 'en_cours') AND s.active = true
  AND sch.staff_name IS NOT NULL;

-- ── KPIs par événement ──────────────────────────────────────────────────────
CREATE OR REPLACE VIEW rh_event_kpis AS
SELECT
  event_id, event_name, event_type, event_date, pax_count,
  COUNT(DISTINCT agent_nom)                                  AS nb_agents,
  COUNT(DISTINCT space_id)                                   AS nb_espaces,
  ROUND(AVG(heures_travaillees), 2)                          AS moy_heures_agent,
  ROUND(COALESCE(SUM(heures_travaillees), 0), 1)             AS total_heures,
  ROUND(COALESCE(SUM(cout_rh), 0), 2)                        AS total_cout_rh,
  ROUND(100.0 * COUNT(*) FILTER (WHERE confirme_agent AND confirme_manager)
        / NULLIF(COUNT(*), 0), 0)                            AS taux_confirmation_pct,
  ROUND(COALESCE(SUM(heures_sup), 0), 1)                     AS total_heures_sup,
  CASE WHEN pax_count > 0
    THEN ROUND(COUNT(DISTINCT agent_nom) * 100.0 / pax_count, 2)
    ELSE NULL END                                            AS ratio_agents_100pax
FROM rh_unified
GROUP BY event_id, event_name, event_type, event_date, pax_count;

-- ── Ratios staffing par espace (cible selon profil) ─────────────────────────
CREATE OR REPLACE VIEW rh_espace_ratios AS
SELECT
  r.event_id, r.event_name, r.event_type, r.event_date,
  r.space_id, r.space_name, r.service_type, r.pax_count,
  COUNT(DISTINCT r.agent_nom)                                AS nb_agents,
  ROUND(AVG(r.heures_travaillees), 2)                        AS moy_heures,
  ROUND(COALESCE(SUM(r.cout_rh), 0), 2)                      AS cout_rh,
  CASE WHEN r.pax_count > 0
    THEN ROUND(COUNT(DISTINCT r.agent_nom) * 100.0 / r.pax_count, 2)
    ELSE NULL END                                            AS ratio_actuel,
  c.cible_ratio,
  CASE WHEN r.pax_count > 0
    THEN ROUND((COUNT(DISTINCT r.agent_nom) * 100.0 / r.pax_count - c.cible_ratio)
               / c.cible_ratio * 100, 0)
    ELSE NULL END                                            AS ecart_pct,
  CASE
    WHEN r.pax_count IS NULL OR r.pax_count = 0 THEN 'inconnu'
    WHEN COUNT(DISTINCT r.agent_nom) * 100.0 / r.pax_count >= c.cible_ratio * 0.9 THEN 'ok'
    WHEN COUNT(DISTINCT r.agent_nom) * 100.0 / r.pax_count >= c.cible_ratio * 0.7 THEN 'sous-staffé'
    ELSE 'critique'
  END                                                        AS statut_staffing
FROM rh_unified r
LEFT JOIN LATERAL (SELECT CASE r.service_type
    WHEN 'salon' THEN 3.0 WHEN 'loge' THEN 3.5 WHEN 'bar_pub' THEN 2.5
    WHEN 'wine_bar' THEN 2.0 WHEN 'club' THEN 2.5 WHEN 'pmr' THEN 1.5
    WHEN 'bodega' THEN 2.0 WHEN 'terrasse' THEN 1.5 WHEN 'buvette' THEN 4.0
    ELSE 2.0 END AS cible_ratio) c ON true
GROUP BY r.event_id, r.event_name, r.event_type, r.event_date,
         r.space_id, r.space_name, r.service_type, r.pax_count, c.cible_ratio;

-- ── Cumul par agent ─────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW rh_agents_cumul AS
SELECT
  agent_nom, agent_role,
  COUNT(DISTINCT event_id)                                   AS nb_evenements,
  COUNT(DISTINCT space_id)                                   AS nb_espaces_differents,
  ROUND(COALESCE(SUM(heures_travaillees), 0), 1)            AS total_heures_cumul,
  ROUND(AVG(heures_travaillees), 2)                          AS moy_heures_par_evt,
  ROUND(COALESCE(SUM(cout_rh), 0), 2)                        AS total_cout_cumul,
  MAX(event_date)                                            AS dernier_evt,
  ROUND(100.0 * COUNT(*) FILTER (WHERE confirme_agent) / NULLIF(COUNT(*), 0), 0) AS taux_confirmation_pct,
  ROUND(COALESCE(SUM(heures_sup), 0), 1)                     AS total_heures_sup
FROM rh_unified
GROUP BY agent_nom, agent_role;

-- ── RG-003 : coûts réservés à ROLE_STADE (authenticated), jamais anon ───────
GRANT SELECT ON rh_unified, rh_event_kpis, rh_espace_ratios, rh_agents_cumul TO authenticated;
REVOKE SELECT ON rh_unified, rh_event_kpis, rh_espace_ratios, rh_agents_cumul FROM anon;
