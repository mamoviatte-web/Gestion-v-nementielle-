-- ═══════════════════════════════════════════════════════════════════════════
-- staff_hors_event.sql — Personnel intervenant HORS événement (manutention,
-- nettoyage, technique, reporting, sécurité, logistique, prestataires…).
-- Forfait OU taux horaire ; heures & coût générés ; analytics intégrés.
--
-- ⚠ RÉCONCILIATION SCHÉMA / SÉCURITÉ :
--   • RLS via le helper existant is_stade() (cohérent avec le reste du projet),
--     plutôt qu'un test inline sur auth.jwt() (fragile selon la structure des
--     claims). RG-003 : ces données de coût restent réservées à ROLE_STADE.
--   • Politique idempotente (DROP POLICY IF EXISTS avant CREATE).
--   • Les vues exposent des COÛTS → security_invoker = on pour que la RLS de la
--     table s'applique (sinon une vue « definer » les exposerait à tous).
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staff_hors_event (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  agent_nom      TEXT NOT NULL,
  agent_prenom   TEXT NOT NULL,
  agent_role     TEXT NOT NULL DEFAULT 'Autre' CHECK (agent_role IN (
    'Manutention', 'Nettoyage', 'Technique / Maintenance',
    'Reporting / Admin', 'Sécurité', 'Logistique',
    'Prestataire externe', 'Autre'
  )),

  societe        TEXT,

  work_date      DATE NOT NULL,
  start_time     TIME,
  end_time       TIME,
  hours_worked   DECIMAL(5,2) GENERATED ALWAYS AS (
    CASE WHEN end_time IS NOT NULL AND start_time IS NOT NULL
      THEN ROUND((EXTRACT(EPOCH FROM (end_time - start_time)) / 3600)::numeric, 2)
      ELSE NULL END
  ) STORED,

  remun_type     TEXT NOT NULL DEFAULT 'horaire' CHECK (remun_type IN ('horaire', 'forfait')),
  hourly_rate    DECIMAL(8,2),
  forfait_amount DECIMAL(10,2),

  cost_ht        DECIMAL(10,2) GENERATED ALWAYS AS (
    CASE
      WHEN remun_type = 'forfait' THEN forfait_amount
      WHEN remun_type = 'horaire' AND hourly_rate IS NOT NULL
        AND end_time IS NOT NULL AND start_time IS NOT NULL
      THEN ROUND((EXTRACT(EPOCH FROM (end_time - start_time)) / 3600 * hourly_rate)::numeric, 2)
      ELSE NULL END
  ) STORED,

  description    TEXT,
  bon_commande   TEXT,

  validated_by   TEXT,
  validated_at   TIMESTAMPTZ,

  created_by     TEXT NOT NULL DEFAULT 'admin',
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE staff_hors_event ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stade_all_hors_event ON staff_hors_event;
CREATE POLICY stade_all_hors_event ON staff_hors_event
  FOR ALL TO authenticated
  USING (is_stade()) WITH CHECK (is_stade());

CREATE INDEX IF NOT EXISTS idx_she_date    ON staff_hors_event (work_date DESC);
CREATE INDEX IF NOT EXISTS idx_she_role    ON staff_hors_event (agent_role);
CREATE INDEX IF NOT EXISTS idx_she_societe ON staff_hors_event (societe);

CREATE OR REPLACE FUNCTION she_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_she_updated ON staff_hors_event;
CREATE TRIGGER trg_she_updated
  BEFORE UPDATE ON staff_hors_event
  FOR EACH ROW EXECUTE FUNCTION she_updated_at();

-- ── Vues analytiques (security_invoker → RLS appliquée, RG-003) ──────────────
CREATE OR REPLACE VIEW she_kpis AS
SELECT
  COUNT(*)                                        AS total_interventions,
  COUNT(DISTINCT agent_nom || agent_prenom)       AS total_agents,
  COUNT(DISTINCT societe)                          AS total_societes,
  COALESCE(SUM(hours_worked), 0)                  AS total_heures,
  COALESCE(SUM(cost_ht), 0)                       AS total_cout_ht,
  COALESCE(AVG(hours_worked), 0)                  AS moy_heures_intervention,
  COUNT(*) FILTER (WHERE remun_type = 'forfait')  AS nb_forfaits,
  COUNT(*) FILTER (WHERE remun_type = 'horaire')  AS nb_horaires,
  MIN(work_date)                                   AS premiere_intervention,
  MAX(work_date)                                   AS derniere_intervention
FROM staff_hors_event;

CREATE OR REPLACE VIEW she_by_month AS
SELECT
  DATE_TRUNC('month', work_date)             AS mois,
  TO_CHAR(work_date, 'Mon YYYY')             AS mois_label,
  COUNT(*)                                    AS nb_interventions,
  COUNT(DISTINCT agent_nom || agent_prenom)  AS nb_agents,
  SUM(hours_worked)                          AS total_heures,
  SUM(cost_ht)                               AS total_cout_ht
FROM staff_hors_event
GROUP BY DATE_TRUNC('month', work_date), TO_CHAR(work_date, 'Mon YYYY')
ORDER BY mois;

CREATE OR REPLACE VIEW she_by_role AS
SELECT
  agent_role,
  societe,
  COUNT(*)          AS nb_interventions,
  SUM(hours_worked) AS total_heures,
  SUM(cost_ht)      AS total_cout_ht,
  AVG(hourly_rate)  AS taux_moyen
FROM staff_hors_event
GROUP BY agent_role, societe
ORDER BY total_cout_ht DESC NULLS LAST;

ALTER VIEW she_kpis    SET (security_invoker = on);
ALTER VIEW she_by_month SET (security_invoker = on);
ALTER VIEW she_by_role  SET (security_invoker = on);

GRANT SELECT ON she_kpis, she_by_month, she_by_role TO authenticated;
REVOKE SELECT ON she_kpis, she_by_month, she_by_role FROM anon;
