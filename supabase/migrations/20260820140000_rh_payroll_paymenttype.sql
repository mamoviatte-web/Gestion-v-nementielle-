-- ═══════════════════════════════════════════════════════════════════════════
-- RH — Récapitulatif de paie mensuel (DAF) : type de paiement par agent.
--
-- Deux circuits de paiement (caractéristique de l'agent, ajustable) :
--   • 'franchise' → à FACTURER (nom en rouge dans l'export)
--   • 'contrat'   → à intégrer en PAIE (nom en vert)
--
-- Cette migration :
--   1. Capture dans le dépôt la colonne payment_type (ajoutée hors-dépôt en base)
--      sur zone_staff_hours + occasional_hours, avec CHECK (idempotent).
--   2. Reconstruit rh_monthly_hours en SUR-ENSEMBLE : type_paiement (paie) +
--      espaces / statuts (analytique) — rétro-compatible (colonnes ajoutées en fin).
--   3. RESTAURE security_invoker=true + grants (RG-003) : la reconstruction
--      hors-dépôt de la vue avait fait sauter security_invoker → un anon pouvait de
--      nouveau lire les coûts. On re-verrouille : RLS is_stade() appliquée, anon exclu.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Colonne payment_type (idempotent) + CHECK
ALTER TABLE public.zone_staff_hours  ADD COLUMN IF NOT EXISTS payment_type TEXT;
ALTER TABLE public.occasional_hours  ADD COLUMN IF NOT EXISTS payment_type TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zone_staff_hours_payment_type_check') THEN
    ALTER TABLE public.zone_staff_hours
      ADD CONSTRAINT zone_staff_hours_payment_type_check
      CHECK (payment_type IN ('franchise', 'contrat'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'occasional_hours_payment_type_check') THEN
    ALTER TABLE public.occasional_hours
      ADD CONSTRAINT occasional_hours_payment_type_check
      CHECK (payment_type IN ('franchise', 'contrat'));
  END IF;
END $$;

-- 2) + 3) Vue résumé : type_paiement + espaces/statuts, RG-003 re-verrouillé
CREATE OR REPLACE VIEW public.rh_monthly_hours
WITH (security_invoker = true) AS
WITH lignes AS (
  SELECT z.staff_name, z.event_id, z.role AS mission, z.payment_type,
         COALESCE(z.hours_worked, 0) AS h, COALESCE(z.rh_cost, 0) AS c,
         COALESCE(s.space_name, '—') AS espace,
         COALESCE(p.staff_status, 'non_precise') AS statut
  FROM public.zone_staff_hours z
  LEFT JOIN public.spaces s ON s.space_id = z.space_id
  LEFT JOIN public.event_staff_preplan p ON p.zone_staff_hour_id = z.id
  UNION ALL
  SELECT o.staff_name, o.event_id, o.mission_type AS mission, o.payment_type,
         COALESCE(o.hours_worked, 0), COALESCE(o.total_cost, 0),
         'Hors espace / ponctuel'::text, 'non_precise'::text
  FROM public.occasional_hours o
)
SELECT l.staff_name,
       to_char(COALESCE(e.event_date, CURRENT_DATE)::timestamptz, 'YYYY-MM') AS mois,
       COALESCE(nullif(string_agg(DISTINCT l.payment_type, '/'), ''), 'non défini') AS type_paiement,
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

REVOKE ALL ON public.rh_monthly_hours FROM anon;
GRANT SELECT ON public.rh_monthly_hours TO authenticated, service_role;
