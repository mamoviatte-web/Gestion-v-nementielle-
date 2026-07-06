-- ═══════════════════════════════════════════════════════════════════
-- MIGRATIONS EN ATTENTE — à coller dans Supabase → SQL Editor → Run.
-- Ordre : occasional_hours (bloc 4) → get_event_costs (bloc 2) → seminar_report.
-- Idempotent (CREATE IF NOT EXISTS / OR REPLACE). Généré le 2026-07-06.
-- ═══════════════════════════════════════════════════════════════════

-- ╔═══ 1/3 · occasional_hours + agent_hours_cumulative ═══╗
-- ═══════════════════════════════════════════════════════════════════
-- Heures occasionnelles (mise en place, etc.) + vue cumulative par agent.
-- À APPLIQUER via MCP. RLS is_stade(). compute_actual_hours gère le minuit.
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS occasional_hours (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID REFERENCES events(event_id) ON DELETE CASCADE,
  staff_name   TEXT NOT NULL,
  mission_type TEXT NOT NULL DEFAULT 'mise_en_place'
               CHECK (mission_type IN ('mise_en_place','débarrassage','logistique','nettoyage','technique','sécurité','autre')),
  work_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  start_time   TIME,
  end_time     TIME,
  hours_worked DECIMAL(6,2) NOT NULL,
  hourly_rate  DECIMAL(8,2),
  total_cost   DECIMAL(10,2) GENERATED ALWAYS AS (hours_worked * COALESCE(hourly_rate, 0)) STORED,
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE occasional_hours ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stade_occ ON occasional_hours;
CREATE POLICY stade_occ ON occasional_hours FOR ALL TO authenticated
  USING (is_stade()) WITH CHECK (is_stade());

-- Vue cumulative : plannings (schedules) + heures occasionnelles.
CREATE OR REPLACE VIEW agent_hours_cumulative WITH (security_invoker = true) AS
  SELECT
    sc.staff_name, sc.role AS mission, e.event_name, e.event_date, e.event_type, e.event_id,
    'planifié' AS source,
    compute_actual_hours(sc.planned_arrival, sc.actual_departure) AS hours_worked,
    sc.hourly_rate,
    CASE WHEN sc.hourly_rate IS NOT NULL AND sc.actual_departure IS NOT NULL
      THEN compute_actual_hours(sc.planned_arrival, sc.actual_departure) * sc.hourly_rate END AS total_cost
  FROM schedules sc JOIN events e ON e.event_id = sc.event_id
  WHERE sc.staff_name IS NOT NULL
    AND sc.staff_name !~ '^[A-Z0-9]{6}$'
    AND sc.actual_departure IS NOT NULL
  UNION ALL
  SELECT
    oh.staff_name, oh.mission_type AS mission, COALESCE(e.event_name,'Sans événement') AS event_name,
    oh.work_date AS event_date, COALESCE(e.event_type,'autre') AS event_type, oh.event_id,
    'occasionnel' AS source, oh.hours_worked, oh.hourly_rate, oh.total_cost
  FROM occasional_hours oh LEFT JOIN events e ON e.event_id = oh.event_id;

-- ╔═══ 2/3 · get_event_costs ═══╗
-- ═══════════════════════════════════════════════════════════════════
-- get_event_costs(event) — coûts F&B + RH d'un événement (À APPLIQUER via MCP).
-- Défensif : lit occasional_hours seulement si la table existe (bloc 4).
-- compute_actual_hours(time,time) existe déjà (passage minuit géré).
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION get_event_costs(p_event_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_fb DECIMAL(12,2) := 0; v_rh DECIMAL(12,2) := 0; v_occ DECIMAL(12,2) := 0;
BEGIN
  SELECT COALESCE(SUM((esl.initial_qty + COALESCE(esl.reassort_qty,0) - esl.final_qty)
                      * COALESCE(p.unit_price_ht,0)), 0)
  INTO v_fb
  FROM event_stock_lines esl JOIN products p ON p.product_id = esl.product_id
  WHERE esl.event_id = p_event_id AND esl.final_qty IS NOT NULL AND p.unit_price_ht IS NOT NULL;

  SELECT COALESCE(SUM(CASE WHEN sc.actual_departure IS NOT NULL AND sc.hourly_rate IS NOT NULL
    THEN compute_actual_hours(sc.planned_arrival, sc.actual_departure) * sc.hourly_rate ELSE 0 END), 0)
  INTO v_rh FROM schedules sc WHERE sc.event_id = p_event_id;

  IF to_regclass('public.occasional_hours') IS NOT NULL THEN
    EXECUTE 'SELECT COALESCE(SUM(total_cost),0) FROM occasional_hours WHERE event_id = $1'
      INTO v_occ USING p_event_id;
  END IF;

  RETURN json_build_object(
    'fb_cost_ht',    ROUND(v_fb, 2),
    'rh_cost',       ROUND(v_rh + v_occ, 2),
    'total_cost_ht', ROUND(v_fb + v_rh + v_occ, 2)
  );
END; $$;

-- ╔═══ 3/3 · seminar_report (table + trigger + fonction) ═══╗
-- ═══════════════════════════════════════════════════════════════════
-- Rapport séminaire auto-généré (À APPLIQUER via MCP dès Supabase réautorisé).
--
-- ⚠ Corrections vs prompt (schéma réel) :
--   • events n'a PAS de colonne regisseur_name → fallback régisseur =
--     premier debriefs.responsable non-code.
--   • debriefs n'a PAS de colonne `comment` → bullets construits depuis
--     suggestions_generales (positif) + problemes_espace / problemes_coordination
--     / problemes_dechets (points d'attention).
--   • RLS via is_stade() (rôle applicatif dans user_metadata).
--   • compute_actual_hours(time,time) existe (gestion passage minuit).
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS seminar_report_draft (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE UNIQUE,
  -- Couverture
  report_title        TEXT,
  client_name         TEXT,
  client_logo_url     TEXT,
  report_date         DATE,
  cover_photo_url     TEXT,
  -- Commercial
  responsable_commercial TEXT,
  pax                 INT,
  ca_ht               DECIMAL(12,2) DEFAULT 0,
  ca_type             TEXT DEFAULT 'payant' CHECK (ca_type IN ('payant','partenariat','gracieux','interne')),
  ca_note             TEXT,
  traiteur_company    TEXT,
  setup_type          TEXT,
  setup_note          TEXT,
  -- Totaux financiers
  total_fb_cost_ht    DECIMAL(12,2),
  total_rh_cost       DECIMAL(12,2),
  total_cost_ht       DECIMAL(12,2),
  gain_net_ht         DECIMAL(12,2),
  marge_pct           DECIMAL(6,2),
  -- Photos ordonnées [{url, caption, order}]
  setup_photo_urls    JSONB DEFAULT '[]',
  fb_photo_urls       JSONB DEFAULT '[]',
  -- Débrief
  regisseur_name      TEXT,
  regisseur_space     TEXT,
  debrief_bullets     JSONB DEFAULT '[]',   -- [{text, is_issue, is_positive}]
  cleaning_score      INT,
  technical_score     INT,
  cleaning_issues     TEXT[],
  technical_issues    TEXT[],
  -- Questionnaire client
  survey_respondent   TEXT,
  survey_respondent_role TEXT,
  survey_submitted_at TIMESTAMPTZ,
  cadre_score         TEXT,
  proprete_score      TEXT,
  traiteur_score      TEXT,
  organisation_score  TEXT,
  equipes_score       TEXT,
  renouveler_score    TEXT,
  nps_experience      INT,
  nps_recommandation  INT,
  survey_commentaire  TEXT,
  -- Statut
  draft_status        TEXT DEFAULT 'brouillon' CHECK (draft_status IN ('brouillon','en_revision','validé','exporté')),
  last_edited_by      TEXT,
  last_edited_at      TIMESTAMPTZ,
  exported_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE seminar_report_draft ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stade_full_draft ON seminar_report_draft;
CREATE POLICY stade_full_draft ON seminar_report_draft FOR ALL TO authenticated
  USING (is_stade()) WITH CHECK (is_stade());

CREATE OR REPLACE FUNCTION generate_seminar_report_draft(p_event_id UUID)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_event    events%ROWTYPE;
  v_fb_cost  DECIMAL(12,2) := 0;
  v_rh_cost  DECIMAL(12,2) := 0;
  v_regisseur TEXT; v_regisseur_space TEXT; v_traiteur TEXT;
  v_bullets  JSONB := '[]';
  v_cleaning INT; v_technical INT;
  v_cl_issues TEXT[]; v_tech_issues TEXT[];
BEGIN
  SELECT * INTO v_event FROM events WHERE event_id = p_event_id;
  IF v_event.event_type = 'match' THEN
    RAISE NOTICE 'generate_seminar_report_draft ignoré pour les matchs'; RETURN;
  END IF;

  -- Coût F&B (initial + réassort − final) × prix
  SELECT COALESCE(SUM((esl.initial_qty + COALESCE(esl.reassort_qty,0) - COALESCE(esl.final_qty,0))
                      * COALESCE(p.unit_price_ht,0)), 0)
  INTO v_fb_cost
  FROM event_stock_lines esl JOIN products p ON p.product_id = esl.product_id
  WHERE esl.event_id = p_event_id AND esl.final_qty IS NOT NULL;

  -- Coût RH (heures réelles × taux, passage minuit géré)
  SELECT COALESCE(SUM(CASE WHEN sc.actual_departure IS NOT NULL AND sc.hourly_rate IS NOT NULL
    THEN compute_actual_hours(sc.planned_arrival, sc.actual_departure) * sc.hourly_rate ELSE 0 END), 0)
  INTO v_rh_cost
  FROM schedules sc WHERE sc.event_id = p_event_id;

  -- Régisseur : premier staff non-code, sinon premier responsable de débrief
  SELECT sc.staff_name, s.space_name INTO v_regisseur, v_regisseur_space
  FROM schedules sc JOIN spaces s ON s.space_id = sc.space_id
  WHERE sc.event_id = p_event_id AND sc.staff_name IS NOT NULL
    AND sc.staff_name !~ '^[A-Z0-9]{6}$'
  ORDER BY sc.created_at LIMIT 1;
  IF v_regisseur IS NULL THEN
    SELECT d.responsable INTO v_regisseur FROM debriefs d
    WHERE d.event_id = p_event_id AND d.responsable IS NOT NULL LIMIT 1;
  END IF;

  -- Traiteur (provider_presence)
  SELECT pp.provider_company INTO v_traiteur FROM provider_presence pp
  WHERE pp.event_id = p_event_id AND pp.provider_type = 'traiteur'
  ORDER BY pp.planned_arrival_time LIMIT 1;

  -- Bullets : positifs (suggestions_generales) + points d'attention (problemes_*)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('text', t.txt, 'is_issue', t.issue, 'is_positive', NOT t.issue)), '[]')
  INTO v_bullets
  FROM (
    SELECT d.suggestions_generales AS txt, false AS issue FROM debriefs d
      WHERE d.event_id=p_event_id AND d.submitted_at IS NOT NULL AND COALESCE(d.suggestions_generales,'')<>''
    UNION ALL SELECT d.problemes_espace, true FROM debriefs d
      WHERE d.event_id=p_event_id AND d.submitted_at IS NOT NULL AND COALESCE(d.problemes_espace,'')<>''
    UNION ALL SELECT d.problemes_coordination, true FROM debriefs d
      WHERE d.event_id=p_event_id AND d.submitted_at IS NOT NULL AND COALESCE(d.problemes_coordination,'')<>''
    UNION ALL SELECT d.problemes_dechets, true FROM debriefs d
      WHERE d.event_id=p_event_id AND d.submitted_at IS NOT NULL AND COALESCE(d.problemes_dechets,'')<>''
  ) t;

  SELECT ROUND(AVG(d.cleaning_score)), ROUND(AVG(d.technical_score))
  INTO v_cleaning, v_technical FROM debriefs d WHERE d.event_id = p_event_id;

  SELECT d.cleaning_issues, d.tech_issues INTO v_cl_issues, v_tech_issues
  FROM debriefs d WHERE d.event_id = p_event_id
    AND (d.cleaning_issues IS NOT NULL OR d.tech_issues IS NOT NULL) LIMIT 1;

  INSERT INTO seminar_report_draft (
    event_id, report_title, client_name, report_date,
    regisseur_name, regisseur_space, traiteur_company, pax,
    total_fb_cost_ht, total_rh_cost, total_cost_ht, gain_net_ht,
    debrief_bullets, cleaning_score, technical_score, cleaning_issues, technical_issues,
    draft_status, created_at
  ) VALUES (
    p_event_id,
    'RETOUR ' || UPPER(v_event.event_name) || ' ' || TO_CHAR(v_event.event_date, 'DD/MM'),
    v_event.event_name, v_event.event_date,
    v_regisseur, v_regisseur_space, v_traiteur, v_event.expected_attendees,
    v_fb_cost, v_rh_cost, v_fb_cost + v_rh_cost, 0 - (v_fb_cost + v_rh_cost),
    COALESCE(v_bullets,'[]'), v_cleaning, v_technical, v_cl_issues, v_tech_issues,
    'brouillon', now()
  )
  ON CONFLICT (event_id) DO UPDATE SET
    total_fb_cost_ht = EXCLUDED.total_fb_cost_ht,
    total_rh_cost    = EXCLUDED.total_rh_cost,
    total_cost_ht    = EXCLUDED.total_cost_ht,
    gain_net_ht      = EXCLUDED.total_cost_ht * -1 + COALESCE(seminar_report_draft.ca_ht,0),
    regisseur_name   = COALESCE(seminar_report_draft.regisseur_name, EXCLUDED.regisseur_name),
    traiteur_company = COALESCE(seminar_report_draft.traiteur_company, EXCLUDED.traiteur_company),
    debrief_bullets  = CASE WHEN seminar_report_draft.draft_status='brouillon'
                            THEN EXCLUDED.debrief_bullets ELSE seminar_report_draft.debrief_bullets END,
    cleaning_score   = COALESCE(seminar_report_draft.cleaning_score, EXCLUDED.cleaning_score),
    technical_score  = COALESCE(seminar_report_draft.technical_score, EXCLUDED.technical_score);
END; $$;

-- Trigger : brouillon auto à la clôture d'un événement NON-match.
CREATE OR REPLACE FUNCTION trigger_seminar_report_on_close()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('clôturé','archivé')
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.event_type <> 'match' THEN
    PERFORM generate_seminar_report_draft(NEW.event_id);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_seminar_report ON events;
CREATE TRIGGER trg_seminar_report
  AFTER UPDATE ON events FOR EACH ROW
  EXECUTE FUNCTION trigger_seminar_report_on_close();
