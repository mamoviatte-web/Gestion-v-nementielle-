-- ═══════════════════════════════════════════════════════════════════════════
-- RH Analytique — enrichissement des heures mensuelles : dimensions ESPACE et
-- STATUT d'emploi, pour le coût par espace / par statut (en plus de par mission).
--
-- Sources : zone_staff_hours (origine « espace ») + occasional_hours (« ponctuel »).
--   • espace  ← zone_staff_hours.space_id → spaces ; ponctuel = « Hors espace / ponctuel »
--   • statut  ← event_staff_preplan.staff_status via le lien fiable
--                event_staff_preplan.zone_staff_hour_id = zone_staff_hours.id
--                (ponctuel → « non_precise »)
--
-- Deux objets :
--   • rh_monthly_hours          : vue résumé (rétro-compatible : 6 colonnes
--     d'origine + `espaces` + `statuts` en agrégat lisible), grain personne × mois.
--   • rh_monthly_hours_detail   : grain personne × mois × espace × statut, pour
--     ventiler le coût par espace et par statut côté RH Analytique.
--
-- RG-003 : les deux vues passent en `security_invoker = true` → la RLS is_stade()
-- des tables sources s'applique (un anon / responsable n'obtient aucun coût), et
-- le SELECT est restreint à authenticated/service_role. La vue précédente tournait
-- avec les droits du propriétaire (postgres) et contournait la RLS : corrigé ici.
-- ═══════════════════════════════════════════════════════════════════════════

-- Détail : grain personne × mois × espace × statut
CREATE OR REPLACE VIEW public.rh_monthly_hours_detail
WITH (security_invoker = true) AS
WITH lignes AS (
  SELECT z.staff_name, z.event_id, z.role AS mission,
         COALESCE(z.hours_worked, 0) AS h, COALESCE(z.rh_cost, 0) AS c,
         COALESCE(s.space_name, '—') AS espace,
         COALESCE(p.staff_status, 'non_precise') AS statut
  FROM public.zone_staff_hours z
  LEFT JOIN public.spaces s ON s.space_id = z.space_id
  LEFT JOIN public.event_staff_preplan p ON p.zone_staff_hour_id = z.id
  UNION ALL
  SELECT o.staff_name, o.event_id, o.mission_type AS mission,
         COALESCE(o.hours_worked, 0), COALESCE(o.total_cost, 0),
         'Hors espace / ponctuel'::text, 'non_precise'::text
  FROM public.occasional_hours o
)
SELECT l.staff_name,
       to_char(COALESCE(e.event_date, CURRENT_DATE)::timestamptz, 'YYYY-MM') AS mois,
       l.espace, l.statut,
       string_agg(DISTINCT l.mission, ', ') AS missions,
       sum(l.h) AS heures,
       round(sum(l.c), 2) AS cout_ht,
       count(DISTINCT l.event_id) AS nb_evenements
FROM lignes l
LEFT JOIN public.events e ON e.event_id = l.event_id
GROUP BY l.staff_name,
         to_char(COALESCE(e.event_date, CURRENT_DATE)::timestamptz, 'YYYY-MM'),
         l.espace, l.statut;

-- Résumé rétro-compatible : colonnes d'origine + espaces + statuts
CREATE OR REPLACE VIEW public.rh_monthly_hours
WITH (security_invoker = true) AS
WITH lignes AS (
  SELECT z.staff_name, z.event_id, z.role AS mission,
         COALESCE(z.hours_worked, 0) AS h, COALESCE(z.rh_cost, 0) AS c,
         COALESCE(s.space_name, '—') AS espace,
         COALESCE(p.staff_status, 'non_precise') AS statut
  FROM public.zone_staff_hours z
  LEFT JOIN public.spaces s ON s.space_id = z.space_id
  LEFT JOIN public.event_staff_preplan p ON p.zone_staff_hour_id = z.id
  UNION ALL
  SELECT o.staff_name, o.event_id, o.mission_type AS mission,
         COALESCE(o.hours_worked, 0), COALESCE(o.total_cost, 0),
         'Hors espace / ponctuel'::text, 'non_precise'::text
  FROM public.occasional_hours o
)
SELECT l.staff_name,
       to_char(COALESCE(e.event_date, CURRENT_DATE)::timestamptz, 'YYYY-MM') AS mois,
       sum(l.h) AS heures,
       round(sum(l.c), 2) AS cout_ht,
       count(DISTINCT l.event_id) AS nb_evenements,
       string_agg(DISTINCT l.mission, ', ') AS missions,
       string_agg(DISTINCT nullif(l.espace, 'Hors espace / ponctuel'), ', ') AS espaces,
       string_agg(DISTINCT nullif(l.statut, 'non_precise'), ', ') AS statuts
FROM lignes l
LEFT JOIN public.events e ON e.event_id = l.event_id
GROUP BY l.staff_name,
         to_char(COALESCE(e.event_date, CURRENT_DATE)::timestamptz, 'YYYY-MM')
ORDER BY mois DESC, l.staff_name;

-- RG-003 : réservé au ROLE_STADE (jamais de coût à anon).
REVOKE ALL ON public.rh_monthly_hours FROM anon;
REVOKE ALL ON public.rh_monthly_hours_detail FROM anon;
GRANT SELECT ON public.rh_monthly_hours TO authenticated, service_role;
GRANT SELECT ON public.rh_monthly_hours_detail TO authenticated, service_role;
