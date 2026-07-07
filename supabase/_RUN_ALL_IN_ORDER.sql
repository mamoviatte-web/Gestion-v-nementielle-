-- ═══════════════════════════════════════════════════════════════════════════
-- _RUN_ALL_IN_ORDER.sql — TOUTES les migrations en attente, dans l'ordre.
-- Généré par concaténation. Chaque bloc est idempotent et déjà validé sur
-- PostgreSQL. Coller l'intégralité dans le SQL Editor Supabase → Run.
-- Ordre des dépendances : _APPLY_ALL → corrections_4 → buvettes_capacites →
--                         runner_season_ref → runner_chain → match_access.
-- ═══════════════════════════════════════════════════════════════════════════


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  FICHIER : _APPLY_ALL.sql
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════════════
-- _APPLY_ALL.sql — Rattrapage complet des migrations en attente (idempotent)
-- ───────────────────────────────────────────────────────────────────────────
-- À exécuter en une passe dans le SQL Editor Supabase (rôle service) ou via MCP.
-- Ordre : reset → colonnes → tables → fonctions/vues/trigger → données → vérif.
--
-- ⚠ Corrections vs le SQL du prompt (schéma RÉEL du projet) :
--   • stock_balances.current_quantity        (PAS current_qty)
--   • RLS via helper is_stade()              (le claim JWT `role` = 'authenticated' ;
--                                             le rôle applicatif est dans user_metadata)
--   • products : PAS de contrainte UNIQUE(product_name) → INSERT ... WHERE NOT EXISTS
--                au lieu de ON CONFLICT (product_name)
--   • Colonnes (Phase 4) créées AVANT les fonctions/données qui les référencent
--   • product_depot_routing rempli APRÈS l'ajout des nouveaux produits (Phase 5)
--   • Vue agent_hours_cumulative en security_invoker (respect RLS)
--
-- Pré-requis présent en prod : helper is_stade(). Ce script ne le redéfinit pas.
-- ═══════════════════════════════════════════════════════════════════════════

-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ PHASE 1 — RESET STOCKS À ZÉRO                                          ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
DO $$
DECLARE n1 INT; n2 INT; n3 INT; n4 INT; n5 INT;
BEGIN
  UPDATE stock_balances
     SET current_quantity = 0, reusable_quantity = 0, opened_quantity = 0,
         last_movement_at = now(), updated_by = 'RESET_INITIAL'
   WHERE current_quantity <> 0 OR reusable_quantity <> 0 OR opened_quantity <> 0;
  GET DIAGNOSTICS n1 = ROW_COUNT;

  UPDATE area_stocks
     SET current_qty = 0, initial_qty = 0, last_updated = now()
   WHERE current_qty <> 0 OR initial_qty <> 0;
  GET DIAGNOSTICS n2 = ROW_COUNT;

  UPDATE event_stock_lines esl
     SET initial_qty = 0, reassort_qty = 0
    FROM events e
   WHERE e.event_id = esl.event_id
     AND e.status NOT IN ('clôturé','archivé')
     AND (esl.initial_qty > 0 OR esl.reassort_qty > 0);
  GET DIAGNOSTICS n3 = ROW_COUNT;

  UPDATE keg_inventory SET status = 'retourné' WHERE status = 'plein';
  GET DIAGNOSTICS n4 = ROW_COUNT;

  UPDATE runner_auto_planning SET initial_area_stock = 0 WHERE initial_area_stock <> 0;
  GET DIAGNOSTICS n5 = ROW_COUNT;

  DELETE FROM supplier_delivery_lines WHERE delivery_id IN (
    SELECT id FROM supplier_deliveries
     WHERE invoice_ref ILIKE 'BL-2026-000%' OR notes ILIKE '%démo%' OR notes ILIKE '%demo%');
  DELETE FROM supplier_deliveries
   WHERE invoice_ref ILIKE 'BL-2026-000%' OR notes ILIKE '%démo%' OR notes ILIKE '%demo%';

  RAISE NOTICE 'PHASE 1 reset — balances:% area:% esl:% kegs:% runner:%', n1,n2,n3,n4,n5;
END $$;

-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ PHASE 4 — COLONNES MANQUANTES (avant fonctions/données)                ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS hourly_rate  DECIMAL(8,2);
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS mission_type TEXT;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS is_external  BOOLEAN DEFAULT false;

ALTER TABLE events ADD COLUMN IF NOT EXISTS regisseur_name     TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS regisseur_space_id UUID REFERENCES spaces(space_id);
ALTER TABLE events ADD COLUMN IF NOT EXISTS previous_event_id  UUID REFERENCES events(event_id);
ALTER TABLE events ADD COLUMN IF NOT EXISTS sequence_number    INT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS weather_type       TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS temperature        INT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS total_fb_cost_ht   DECIMAL(12,2);
ALTER TABLE events ADD COLUMN IF NOT EXISTS total_rh_cost      DECIMAL(12,2);
ALTER TABLE events ADD COLUMN IF NOT EXISTS total_event_cost   DECIMAL(12,2);
ALTER TABLE events ADD COLUMN IF NOT EXISTS cost_per_pax       DECIMAL(8,2);

ALTER TABLE products ADD COLUMN IF NOT EXISTS min_stock      INT DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS max_stock      INT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS qr_code        TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_sensitive   BOOLEAN DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS fournisseur    TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS packaging_qty  INT DEFAULT 1;
ALTER TABLE products ADD COLUMN IF NOT EXISTS packaging_unit TEXT;

ALTER TABLE debriefs ADD COLUMN IF NOT EXISTS cleaning_score      INT;
ALTER TABLE debriefs ADD COLUMN IF NOT EXISTS cleaning_before_ok  BOOLEAN;
ALTER TABLE debriefs ADD COLUMN IF NOT EXISTS cleaning_after_ok   BOOLEAN;
ALTER TABLE debriefs ADD COLUMN IF NOT EXISTS cleaning_issues     TEXT[];
ALTER TABLE debriefs ADD COLUMN IF NOT EXISTS cleaning_comment    TEXT;
ALTER TABLE debriefs ADD COLUMN IF NOT EXISTS technical_score     INT;
ALTER TABLE debriefs ADD COLUMN IF NOT EXISTS tech_fridge_ok      BOOLEAN;
ALTER TABLE debriefs ADD COLUMN IF NOT EXISTS tech_equipment_ok   BOOLEAN;
ALTER TABLE debriefs ADD COLUMN IF NOT EXISTS tech_lighting_ok    BOOLEAN;
ALTER TABLE debriefs ADD COLUMN IF NOT EXISTS tech_plumbing_ok    BOOLEAN;
ALTER TABLE debriefs ADD COLUMN IF NOT EXISTS tech_hvac_ok        BOOLEAN;
ALTER TABLE debriefs ADD COLUMN IF NOT EXISTS tech_issues         TEXT[];
ALTER TABLE debriefs ADD COLUMN IF NOT EXISTS technical_comment   TEXT;
ALTER TABLE debriefs ADD COLUMN IF NOT EXISTS has_urgent_issue    BOOLEAN DEFAULT false;
ALTER TABLE debriefs ADD COLUMN IF NOT EXISTS urgent_issue_detail TEXT;
ALTER TABLE debriefs ADD COLUMN IF NOT EXISTS overall_rating      TEXT;
ALTER TABLE debriefs ADD COLUMN IF NOT EXISTS service_score       INT;

-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ PHASE 2 — TABLES MANQUANTES                                            ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 2.1 occasional_hours
CREATE TABLE IF NOT EXISTS occasional_hours (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID REFERENCES events(event_id) ON DELETE CASCADE,
  staff_name   TEXT NOT NULL,
  mission_type TEXT NOT NULL DEFAULT 'mise_en_place'
               CHECK (mission_type IN ('mise_en_place','débarrassage','logistique','nettoyage','technique','sécurité','autre')),
  work_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  start_time   TIME, end_time TIME,
  hours_worked DECIMAL(6,2) NOT NULL,
  hourly_rate  DECIMAL(8,2),
  total_cost   DECIMAL(10,2) GENERATED ALWAYS AS (hours_worked * COALESCE(hourly_rate,0)) STORED,
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE occasional_hours ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stade_occ ON occasional_hours;
CREATE POLICY stade_occ ON occasional_hours FOR ALL TO authenticated USING (is_stade()) WITH CHECK (is_stade());

-- 2.2 buvette_groups + members
CREATE TABLE IF NOT EXISTS buvette_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_name TEXT NOT NULL, group_code TEXT NOT NULL UNIQUE,
  responsable_name TEXT, description TEXT, color TEXT DEFAULT '#EF9F27',
  is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS buvette_group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES buvette_groups(id),
  space_id UUID NOT NULL REFERENCES spaces(space_id),
  is_active BOOLEAN DEFAULT true, added_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(group_id, space_id)
);
ALTER TABLE buvette_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE buvette_group_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stade_buvette_groups  ON buvette_groups;
DROP POLICY IF EXISTS stade_buvette_members ON buvette_group_members;
CREATE POLICY stade_buvette_groups  ON buvette_groups        FOR ALL TO authenticated USING (is_stade()) WITH CHECK (is_stade());
CREATE POLICY stade_buvette_members ON buvette_group_members FOR ALL TO authenticated USING (is_stade()) WITH CHECK (is_stade());
INSERT INTO buvette_groups (group_name, group_code, description, color) VALUES
  ('Buvette 1','BUV1','Virages Ouest, Sud Ouest, Nord Ouest, Nord Est','#EF9F27'),
  ('Buvette 2','BUV2','Virages Sud Est, Est Galice, Est Pagnol, Sud Est, Sud Ouest','#E5A340')
ON CONFLICT (group_code) DO NOTHING;

-- 2.3 product_depot_routing (table ; remplissage en Phase 5, après les nouveaux produits)
CREATE TABLE IF NOT EXISTS product_depot_routing (
  product_id UUID PRIMARY KEY REFERENCES products(product_id),
  depot_id   UUID NOT NULL REFERENCES stock_locations(id),
  depot_name TEXT, priority INT DEFAULT 1
);
ALTER TABLE product_depot_routing ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stade_routing ON product_depot_routing;
CREATE POLICY stade_routing ON product_depot_routing FOR ALL TO authenticated USING (is_stade()) WITH CHECK (is_stade());

-- 2.4 seminar_report_draft
CREATE TABLE IF NOT EXISTS seminar_report_draft (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(event_id) UNIQUE,
  report_title TEXT, client_name TEXT, client_logo_url TEXT, report_date DATE,
  responsable_commercial TEXT, pax INT,
  ca_ht DECIMAL(12,2) DEFAULT 0, ca_type TEXT DEFAULT 'payant', ca_note TEXT,
  traiteur_company TEXT, setup_type TEXT, regisseur_name TEXT, regisseur_space TEXT,
  total_fb_cost_ht DECIMAL(12,2), total_rh_cost DECIMAL(12,2), total_cost_ht DECIMAL(12,2),
  gain_net_ht DECIMAL(12,2), marge_pct DECIMAL(6,2),
  setup_photo_urls JSONB DEFAULT '[]', fb_photo_urls JSONB DEFAULT '[]', cover_photo_url TEXT,
  debrief_bullets JSONB DEFAULT '[]', cleaning_score INT, technical_score INT,
  survey_respondent TEXT, nps_experience INT, nps_recommandation INT,
  cadre_score TEXT, proprete_score TEXT, traiteur_score TEXT, organisation_score TEXT,
  equipes_score TEXT, renouveler_score TEXT, survey_commentaire TEXT,
  draft_status TEXT DEFAULT 'brouillon', last_edited_by TEXT, last_edited_at TIMESTAMPTZ,
  exported_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE seminar_report_draft ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stade_draft ON seminar_report_draft;
CREATE POLICY stade_draft ON seminar_report_draft FOR ALL TO authenticated USING (is_stade()) WITH CHECK (is_stade());

-- 2.5 event_commercial_data + client_satisfaction_survey
CREATE TABLE IF NOT EXISTS event_commercial_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(event_id) UNIQUE,
  responsable_commercial TEXT, client_company TEXT, client_logo_url TEXT,
  ca_ht DECIMAL(12,2) DEFAULT 0, ca_type TEXT DEFAULT 'payant', ca_note TEXT,
  traiteur_company TEXT, setup_type TEXT,
  total_fb_cost_ht DECIMAL(12,2), total_rh_cost DECIMAL(12,2), total_event_cost_ht DECIMAL(12,2),
  gain_net_ht DECIMAL(12,2), marge_pct DECIMAL(6,2), computed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE event_commercial_data ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stade_commercial ON event_commercial_data;
CREATE POLICY stade_commercial ON event_commercial_data FOR ALL TO authenticated USING (is_stade()) WITH CHECK (is_stade());

CREATE TABLE IF NOT EXISTS client_satisfaction_survey (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(event_id) UNIQUE,
  submitted_at TIMESTAMPTZ, respondent_name TEXT, respondent_role TEXT,
  cadre_score TEXT, proprete_score TEXT, traiteur_score TEXT, organisation_score TEXT,
  equipes_score TEXT, renouveler_score TEXT, nps_experience INT, nps_recommandation INT,
  commentaire TEXT, created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE client_satisfaction_survey ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stade_survey ON client_satisfaction_survey;
CREATE POLICY stade_survey ON client_satisfaction_survey FOR ALL TO authenticated USING (is_stade()) WITH CHECK (is_stade());

-- 2.6 event_report_photos
CREATE TABLE IF NOT EXISTS event_report_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(event_id),
  photo_type TEXT NOT NULL CHECK (photo_type IN ('mise_en_place','fb','ambiance','couverture')),
  file_url TEXT NOT NULL, caption TEXT, display_order INT DEFAULT 0,
  uploaded_by TEXT, uploaded_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE event_report_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stade_report_photos ON event_report_photos;
CREATE POLICY stade_report_photos ON event_report_photos FOR ALL TO authenticated USING (is_stade()) WITH CHECK (is_stade());

-- 2.7 monthly_staff_reports
CREATE TABLE IF NOT EXISTS monthly_staff_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_name TEXT NOT NULL, space_id UUID REFERENCES spaces(space_id),
  report_month DATE NOT NULL, total_events INT DEFAULT 0,
  total_planned_h DECIMAL(8,2), total_actual_h DECIMAL(8,2), total_overtime_h DECIMAL(8,2),
  events_detail JSONB, generated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(staff_name, space_id, report_month)
);
ALTER TABLE monthly_staff_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stade_monthly ON monthly_staff_reports;
CREATE POLICY stade_monthly ON monthly_staff_reports FOR ALL TO authenticated USING (is_stade()) WITH CHECK (is_stade());

-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ PHASE 3 — FONCTIONS / VUES / TRIGGER                                   ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 3.1 compute_actual_hours (passage minuit)
CREATE OR REPLACE FUNCTION compute_actual_hours(p_arrival TIME, p_departure TIME)
RETURNS DECIMAL(6,2) LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_arrival IS NULL OR p_departure IS NULL THEN RETURN NULL; END IF;
  IF p_departure < p_arrival THEN
    RETURN EXTRACT(EPOCH FROM (p_departure - p_arrival + INTERVAL '24 hours')) / 3600;
  ELSE
    RETURN EXTRACT(EPOCH FROM (p_departure - p_arrival)) / 3600;
  END IF;
END; $$;

-- 3.2 get_event_costs
CREATE OR REPLACE FUNCTION get_event_costs(p_event_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_fb DECIMAL(12,2):=0; v_rh DECIMAL(12,2):=0; v_occ DECIMAL(12,2):=0;
BEGIN
  SELECT COALESCE(SUM((esl.initial_qty + COALESCE(esl.reassort_qty,0) - esl.final_qty) * COALESCE(p.unit_price_ht,0)),0)
    INTO v_fb
    FROM event_stock_lines esl JOIN products p ON p.product_id = esl.product_id
   WHERE esl.event_id = p_event_id AND esl.final_qty IS NOT NULL AND p.unit_price_ht IS NOT NULL;

  SELECT COALESCE(SUM(CASE WHEN sc.actual_departure IS NOT NULL AND sc.hourly_rate IS NOT NULL
                     THEN compute_actual_hours(sc.planned_arrival::time, sc.actual_departure::time) * sc.hourly_rate
                     ELSE 0 END),0)
    INTO v_rh
    FROM schedules sc WHERE sc.event_id = p_event_id;

  SELECT COALESCE(SUM(total_cost),0) INTO v_occ FROM occasional_hours WHERE event_id = p_event_id;

  RETURN json_build_object('fb_cost_ht', ROUND(v_fb,2),
                           'rh_cost', ROUND(v_rh+v_occ,2),
                           'total_cost_ht', ROUND(v_fb+v_rh+v_occ,2));
END; $$;

-- 3.3 generate_seminar_report_draft
CREATE OR REPLACE FUNCTION generate_seminar_report_draft(p_event_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_event events%ROWTYPE; v_costs JSON; v_regisseur TEXT; v_traiteur TEXT; v_bullets JSONB := '[]';
BEGIN
  SELECT * INTO v_event FROM events WHERE event_id = p_event_id;
  IF v_event.event_type = 'match' THEN RETURN; END IF;

  SELECT get_event_costs(p_event_id) INTO v_costs;

  SELECT sc.staff_name INTO v_regisseur
    FROM schedules sc
   WHERE sc.event_id = p_event_id AND sc.staff_name IS NOT NULL
     AND sc.staff_name !~ '^[A-Z0-9]{6}$'
   ORDER BY sc.created_at LIMIT 1;
  v_regisseur := COALESCE(v_regisseur, v_event.regisseur_name,
                          (SELECT responsable FROM debriefs WHERE event_id = p_event_id LIMIT 1));

  SELECT pp.provider_company INTO v_traiteur
    FROM provider_presence pp
   WHERE pp.event_id = p_event_id AND pp.provider_type = 'traiteur' LIMIT 1;

  INSERT INTO seminar_report_draft (
    event_id, report_title, client_name, report_date, regisseur_name, traiteur_company, pax,
    total_fb_cost_ht, total_rh_cost, total_cost_ht, gain_net_ht, debrief_bullets, draft_status)
  VALUES (
    p_event_id,
    'RETOUR ' || UPPER(v_event.event_name) || ' ' || TO_CHAR(v_event.event_date,'DD/MM'),
    v_event.event_name, v_event.event_date, v_regisseur, v_traiteur, v_event.expected_attendees,
    (v_costs->>'fb_cost_ht')::DECIMAL, (v_costs->>'rh_cost')::DECIMAL,
    (v_costs->>'total_cost_ht')::DECIMAL, 0 - (v_costs->>'total_cost_ht')::DECIMAL,
    v_bullets, 'brouillon')
  ON CONFLICT (event_id) DO UPDATE SET
    total_fb_cost_ht = EXCLUDED.total_fb_cost_ht, total_rh_cost = EXCLUDED.total_rh_cost,
    total_cost_ht = EXCLUDED.total_cost_ht, gain_net_ht = EXCLUDED.gain_net_ht;
END; $$;

-- 3.4 trigger rapport à la clôture séminaire
CREATE OR REPLACE FUNCTION trigger_seminar_report_on_close()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('clôturé','archivé') AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.event_type <> 'match' THEN
    PERFORM generate_seminar_report_draft(NEW.event_id);
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_seminar_report ON events;
CREATE TRIGGER trg_seminar_report AFTER UPDATE ON events FOR EACH ROW
  EXECUTE FUNCTION trigger_seminar_report_on_close();

-- 3.5 vue cumulative heures agents (security_invoker → respecte RLS)
CREATE OR REPLACE VIEW agent_hours_cumulative WITH (security_invoker = true) AS
  SELECT sc.staff_name, sc.role AS mission, e.event_name, e.event_date, e.event_type, e.event_id,
         'planifié' AS source,
         compute_actual_hours(sc.planned_arrival::time, sc.actual_departure::time) AS hours_worked,
         sc.hourly_rate,
         CASE WHEN sc.hourly_rate IS NOT NULL AND sc.actual_departure IS NOT NULL
           THEN compute_actual_hours(sc.planned_arrival::time, sc.actual_departure::time) * sc.hourly_rate END AS total_cost
    FROM schedules sc JOIN events e ON e.event_id = sc.event_id
   WHERE sc.staff_name IS NOT NULL AND sc.staff_name !~ '^[A-Z0-9]{6}$' AND sc.actual_departure IS NOT NULL
  UNION ALL
  SELECT oh.staff_name, oh.mission_type, COALESCE(e.event_name,'Sans événement'), oh.work_date,
         COALESCE(e.event_type,'autre'), oh.event_id, 'occasionnel', oh.hours_worked, oh.hourly_rate, oh.total_cost
    FROM occasional_hours oh LEFT JOIN events e ON e.event_id = oh.event_id;

-- 3.6 repair_match_chain
CREATE OR REPLACE FUNCTION repair_match_chain() RETURNS void LANGUAGE plpgsql AS $$
DECLARE ev RECORD; prev_id UUID;
BEGIN
  FOR ev IN SELECT event_id, event_date FROM events
             WHERE event_type = 'match' AND previous_event_id IS NULL ORDER BY event_date ASC
  LOOP
    SELECT event_id INTO prev_id FROM events
     WHERE event_type = 'match' AND event_date < ev.event_date ORDER BY event_date DESC LIMIT 1;
    IF prev_id IS NOT NULL THEN
      UPDATE events SET previous_event_id = prev_id WHERE event_id = ev.event_id;
    END IF;
  END LOOP;
END; $$;
SELECT repair_match_chain();

-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ PHASE 5 — DONNÉES DE RÉFÉRENCE                                         ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 5.1 — 10 espaces buvettes
INSERT INTO spaces (space_name, space_type, access_code) VALUES
  ('Buvette Virage Ouest','Buvette','BVO2026'),
  ('Buvette Virage Sud Ouest','Buvette','BVSO2026'),
  ('Buvette Virage Sud Est','Buvette','BVSE2026'),
  ('Buvette Virage Toinou','Buvette','BVTOI26'),
  ('Buvette Nord Ouest','Buvette','BNO2026'),
  ('Buvette Nord Est','Buvette','BNE2026'),
  ('Buvette Est Galice','Buvette','BEG2026'),
  ('Buvette Est Pagnol','Buvette','BEP2026'),
  ('Buvette Sud Est','Buvette','BSE2026'),
  ('Buvette Sud Ouest','Buvette','BSO2026')
ON CONFLICT (access_code) DO NOTHING;

-- 5.2 — association buvettes → groupes
INSERT INTO buvette_group_members (group_id, space_id)
SELECT g.id, s.space_id FROM buvette_groups g, spaces s
 WHERE g.group_code = 'BUV1' AND s.access_code IN ('BVO2026','BVSO2026','BNO2026','BNE2026','BVTOI26')
ON CONFLICT DO NOTHING;
INSERT INTO buvette_group_members (group_id, space_id)
SELECT g.id, s.space_id FROM buvette_groups g, spaces s
 WHERE g.group_code = 'BUV2' AND s.access_code IN ('BVSE2026','BEG2026','BEP2026','BSE2026','BSO2026')
ON CONFLICT DO NOTHING;

-- 5.3 — produits vins/spiritueux/softs manquants (products.product_name NON unique → WHERE NOT EXISTS)
INSERT INTO products (product_name, category, unit, unit_price_ht, active)
SELECT v.product_name, v.category, v.unit, v.unit_price_ht, true
FROM (VALUES
  ('Rosé Réal','Vins','btl',8.70),('Rosé Pey Blanc','Vins','btl',7.20),
  ('Rosé NAIS','Vins','btl',6.12),('Rouge Les Alexandrins','Vins','btl',8.50),
  ('Rouge Grand Boise','Vins','btl',7.58),('Rouge NAIS','Vins','btl',4.74),
  ('Rouge Gigondas','Vins','btl',11.00),('Blanc du Seuil','Vins','btl',6.30),
  ('Blanc Galiniere','Vins','btl',6.50),('Blanc Montaurone','Vins','btl',5.20),
  ('Blanc NAIS','Vins','btl',3.64),('Lillet Blanc','Spiritueux','btl',12.52),
  ('Lillet Rosé','Spiritueux','btl',12.28),('Ricard aux Herbes','Spiritueux','btl',17.25),
  ('Pepsi 50cl','Soft','btl',1.09),('Orangina 50cl','Soft','btl',1.22),
  ('Ice Tea 50cl','Soft','btl',1.26),('San Pellegrino 50cl','Soft','btl',0.69),
  ('Pepsi Max bouteille','Soft','btl',2.56),('Perrier grande bouteille','Soft','btl',1.04),
  ('San Pellegrino verre','Soft','verre',0.94),('Vittel verre','Soft','verre',0.83)
) AS v(product_name, category, unit, unit_price_ht)
WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.product_name = v.product_name);

-- 5.4 — stock_balances 0 dans les bons dépôts (current_quantity, pas current_qty)
WITH est AS (SELECT id FROM stock_locations WHERE name ILIKE '%EST%' LIMIT 1)
INSERT INTO stock_balances (product_id, location_id, current_quantity)
SELECT p.product_id, est.id, 0 FROM products p, est
 WHERE p.category IN ('Vins','Spiritueux') AND p.active = true AND p.product_name NOT ILIKE '%Fût%'
ON CONFLICT (product_id, location_id) DO NOTHING;

WITH auc AS (SELECT id FROM stock_locations WHERE name ILIKE '%AUC%' LIMIT 1)
INSERT INTO stock_balances (product_id, location_id, current_quantity)
SELECT p.product_id, auc.id, 0 FROM products p, auc
 WHERE p.category IN ('Soft','Sirops','Bières','Matériel') AND p.active = true AND p.product_name NOT ILIKE '%Fût%'
ON CONFLICT (product_id, location_id) DO NOTHING;

-- 5.5 — remplissage product_depot_routing (après ajout des nouveaux produits)
INSERT INTO product_depot_routing (product_id, depot_id, depot_name)
SELECT DISTINCT ON (p.product_id) p.product_id, sl.id, sl.name
FROM products p CROSS JOIN stock_locations sl
WHERE p.active = true AND sl.location_type = 'reserve_centrale'
  AND (
    (p.product_name ILIKE '%Fût%' AND sl.name ILIKE '%Fût%')
    OR (p.category IN ('Vins','Spiritueux') AND sl.name ILIKE '%EST%' AND p.product_name NOT ILIKE '%Fût%')
    OR (sl.name ILIKE '%AUC%' AND p.product_name NOT ILIKE '%Fût%' AND p.category NOT IN ('Vins','Spiritueux'))
  )
ORDER BY p.product_id,
  CASE WHEN p.product_name ILIKE '%Fût%' AND sl.name ILIKE '%Fût%' THEN 1
       WHEN p.category IN ('Vins','Spiritueux') AND sl.name ILIKE '%EST%' THEN 1
       WHEN sl.name ILIKE '%AUC%' THEN 2 ELSE 3 END
ON CONFLICT (product_id) DO UPDATE SET depot_id = EXCLUDED.depot_id, depot_name = EXCLUDED.depot_name;

-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ VÉRIFICATION FINALE                                                    ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
SELECT 'stock_balances non nuls' AS check_name, COUNT(*)::text AS valeur FROM stock_balances WHERE current_quantity <> 0
UNION ALL SELECT 'area_stocks non nuls', COUNT(*)::text FROM area_stocks WHERE current_qty <> 0
UNION ALL SELECT 'keg pleins restants', COUNT(*)::text FROM keg_inventory WHERE status = 'plein'
UNION ALL SELECT 'buvette_groups', COUNT(*)::text FROM buvette_groups
UNION ALL SELECT 'buvette_group_members', COUNT(*)::text FROM buvette_group_members
UNION ALL SELECT 'produits actifs', COUNT(*)::text FROM products WHERE active = true
UNION ALL SELECT 'product_depot_routing', COUNT(*)::text FROM product_depot_routing;


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  FICHIER : corrections_4.sql
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════════════
-- corrections_4.sql — 4 corrections ciblées (idempotent)
-- ⚠ Corrections vs le SQL des prompts (schéma RÉEL) :
--   • stock_balances.current_quantity (PAS current_qty)
--   • RLS via is_stade() (le rôle applicatif est dans user_metadata, pas le claim `role`)
-- À exécuter dans le SQL Editor Supabase (rôle service) ou via MCP.
-- ═══════════════════════════════════════════════════════════════════════════

-- ╔═══ CORRECTION 1 — Stocks espaces à 0 ══════════════════════════════════╗
UPDATE stock_balances sb
   SET current_quantity = 0, reusable_quantity = 0, opened_quantity = 0, last_movement_at = now()
  FROM stock_locations sl
 WHERE sl.id = sb.location_id
   AND sl.location_type = 'espace'
   AND (sb.current_quantity <> 0 OR sb.reusable_quantity <> 0 OR sb.opened_quantity <> 0);

UPDATE area_stocks SET current_qty = 0, initial_qty = 0
 WHERE current_qty <> 0 OR initial_qty <> 0;

-- Vérif : espaces à 0, seuls les dépôts (reserve_centrale) peuvent avoir des valeurs
-- SELECT sl.name, sl.location_type, SUM(sb.current_quantity) AS total
--   FROM stock_balances sb JOIN stock_locations sl ON sl.id = sb.location_id
--  GROUP BY sl.name, sl.location_type ORDER BY sl.location_type, sl.name;

-- ╔═══ CORRECTION 2.2 — Table des alertes ignorées ════════════════════════╗
CREATE TABLE IF NOT EXISTS dismissed_alerts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_key    TEXT NOT NULL UNIQUE,
  dismissed_by TEXT,
  dismissed_at TIMESTAMPTZ DEFAULT now(),
  expires_at   TIMESTAMPTZ DEFAULT (now() + INTERVAL '7 days')
);
ALTER TABLE dismissed_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stade_dismissed ON dismissed_alerts;
CREATE POLICY stade_dismissed ON dismissed_alerts FOR ALL TO authenticated
  USING (is_stade()) WITH CHECK (is_stade());

-- ╔═══ CORRECTION 3 — Vue consommation groupée par produit ════════════════╗
-- Colonnes alignées sur consumption_analytics réel (voir analytics_engine.sql) :
--   avg_qty_per_event, avg_qty_per_100_pax, confidence_score, trend_direction,
--   rupture_count, surdotation_count, nb_events_analyzed.
CREATE OR REPLACE VIEW consumption_by_product WITH (security_invoker = true) AS
SELECT
  p.product_id, p.product_name, p.category, p.unit,
  COUNT(DISTINCT ca.space_id)                          AS nb_espaces,
  COALESCE(MAX(ca.nb_events_analyzed), 0)              AS nb_evenements,
  SUM(ca.avg_qty_per_event)                            AS total_avg_conso,
  AVG(ca.avg_qty_per_100_pax)                          AS avg_ratio_100pax,
  AVG(ca.confidence_score)                             AS avg_confidence,
  MODE() WITHIN GROUP (ORDER BY ca.trend_direction)    AS dominant_trend,
  COALESCE(SUM(ca.rupture_count), 0)                   AS total_ruptures,
  COALESCE(SUM(ca.surdotation_count), 0)               AS total_surdotations,
  json_agg(json_build_object(
    'space_name',   s.space_name,
    'space_type',   s.space_type,
    'avg_conso',    ca.avg_qty_per_event,
    'ratio_100pax', ca.avg_qty_per_100_pax,
    'confidence',   ca.confidence_score,
    'trend',        ca.trend_direction,
    'ruptures',     ca.rupture_count
  ) ORDER BY s.space_name)                             AS espaces_detail
FROM consumption_analytics ca
JOIN products p ON p.product_id = ca.product_id
JOIN spaces   s ON s.space_id   = ca.space_id
GROUP BY p.product_id, p.product_name, p.category, p.unit
ORDER BY p.category, p.product_name;

-- ╔═══ CORRECTION 4 — occasional_hours (rappel : créée par _APPLY_ALL.sql) ═╗
-- SELECT COUNT(*) FROM occasional_hours;   -- doit répondre (table présente)
-- La vue agent_hours_cumulative expose source='occasionnel' (cf _APPLY_ALL.sql 3.5).


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  FICHIER : buvettes_capacites.sql
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════════════
-- buvettes_capacites.sql — Renommage B1-B9 · Capacités espaces · Schéma match
-- Idempotent. À exécuter dans le SQL Editor Supabase (rôle service) ou via MCP.
-- Note : espaces.space_type reste ('VIP','Bar','Buvette') ; service_type est la
-- nouvelle dimension de service ('vip','bar','buvette') pilotant les dotations.
-- ═══════════════════════════════════════════════════════════════════════════

-- ╔═══ ÉTAPE 1 — Renommage buvettes B1 à B9 (codes d'accès inchangés) ══════╗
UPDATE spaces SET space_name = 'B1' WHERE access_code = 'BNO2026';
UPDATE spaces SET space_name = 'B2' WHERE access_code = 'BNE2026';
UPDATE spaces SET space_name = 'B3' WHERE access_code = 'BEG2026';
UPDATE spaces SET space_name = 'B4' WHERE access_code = 'BEP2026';
UPDATE spaces SET space_name = 'B5' WHERE access_code = 'BVSE2026';
UPDATE spaces SET space_name = 'B6' WHERE access_code = 'BSE2026';
UPDATE spaces SET space_name = 'B7' WHERE access_code = 'BSO2026';
UPDATE spaces SET space_name = 'B8' WHERE access_code = 'BVSO2026';
UPDATE spaces SET space_name = 'B9' WHERE access_code = 'BVO2026';
-- Buvette Virage Toinou (BVTOI26) : occasionnelle, non renommée.

-- ╔═══ ÉTAPE 2 — Capacités + service_type ═════════════════════════════════╗
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS max_pax INT;
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS service_type TEXT DEFAULT 'bar';
-- CHECK ajouté séparément (idempotent) pour ne pas échouer si déjà présent.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spaces_service_type_check') THEN
    ALTER TABLE spaces ADD CONSTRAINT spaces_service_type_check
      CHECK (service_type IN ('vip','bar','buvette'));
  END IF;
END $$;

UPDATE spaces SET max_pax = 400, service_type = 'vip' WHERE access_code = 'SN2026';
UPDATE spaces SET max_pax = 290, service_type = 'vip' WHERE access_code = 'SS2026';
UPDATE spaces SET max_pax = 200, service_type = 'bar' WHERE access_code = 'PUB2026';
UPDATE spaces SET max_pax = 150, service_type = 'bar' WHERE access_code = 'C70S26';
UPDATE spaces SET max_pax = 150, service_type = 'bar' WHERE access_code = 'C70N26';
UPDATE spaces SET max_pax = 195, service_type = 'bar' WHERE access_code = 'CO2026';
UPDATE spaces SET max_pax = 165, service_type = 'bar' WHERE access_code = 'BI2026';
UPDATE spaces SET max_pax = 120, service_type = 'bar' WHERE access_code = 'WBS2026';
UPDATE spaces SET max_pax = 120, service_type = 'bar' WHERE access_code = 'WBN2026';
UPDATE spaces SET max_pax = 100, service_type = 'vip' WHERE access_code IN ('LE2026','LON2026','LOS2026');
UPDATE spaces SET service_type = 'buvette' WHERE space_type = 'Buvette';
UPDATE spaces SET max_pax = 300, service_type = 'bar' WHERE access_code = 'TER2026';
UPDATE spaces SET max_pax = 400, service_type = 'bar' WHERE access_code = 'BOD2026';

-- Garden Party — créée si absente.
INSERT INTO spaces (space_name, space_type, access_code, max_pax, service_type)
VALUES ('Garden Party', 'Bar', 'GP2026', 150, 'bar')
ON CONFLICT (access_code) DO UPDATE SET max_pax = 150, service_type = 'bar';

-- ╔═══ ÉTAPE 3 — Colonnes match + fonction dotation VIP ═══════════════════╗
ALTER TABLE event_spaces ADD COLUMN IF NOT EXISTS service_mode TEXT DEFAULT 'auto';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_spaces_service_mode_check') THEN
    ALTER TABLE event_spaces ADD CONSTRAINT event_spaces_service_mode_check
      CHECK (service_mode IN ('vip','bar','buvette','fermé','auto'));
  END IF;
END $$;
ALTER TABLE event_spaces ADD COLUMN IF NOT EXISTS expected_pax INT;

-- Dotation VIP = pax attendus × ratio produit / 100.
CREATE OR REPLACE FUNCTION get_vip_dotation(p_space_id UUID, p_product_id UUID, p_event_id UUID)
RETURNS INT LANGUAGE plpgsql STABLE AS $$
DECLARE v_pax INT; v_ratio DECIMAL(8,4); v_raw DECIMAL(8,2);
BEGIN
  SELECT COALESCE(es.expected_pax, s.max_pax, 100) INTO v_pax
    FROM event_spaces es JOIN spaces s ON s.space_id = es.space_id
   WHERE es.event_id = p_event_id AND es.space_id = p_space_id;
  v_pax := COALESCE(v_pax, 100);

  SELECT COALESCE(ca.avg_qty_per_100_pax, 0) INTO v_ratio
    FROM consumption_analytics ca
   WHERE ca.space_id = p_space_id AND ca.product_id = p_product_id AND ca.event_type = 'match'
   LIMIT 1;
  v_ratio := COALESCE(v_ratio, 0);

  IF v_ratio = 0 THEN
    SELECT COALESCE(rt.ratio_per_100, 0) INTO v_ratio
      FROM runner_templates rt
     WHERE rt.space_id = p_space_id AND rt.product_id = p_product_id AND rt.event_type = 'match'
     LIMIT 1;
    v_ratio := COALESCE(v_ratio, 0);
  END IF;

  v_raw := (v_pax::DECIMAL / 100) * v_ratio;
  RETURN CEIL(v_raw);
END; $$;

-- ╔═══ ÉTAPE 5 — Vue rapport consommation match (Grand Public / VIP) ══════╗
CREATE OR REPLACE VIEW match_consumption_report WITH (security_invoker = true) AS
SELECT
  e.event_id, e.event_name, e.event_date, e.expected_attendees,
  CASE WHEN s.service_type = 'buvette' THEN 'Grand Public'
       WHEN s.service_type = 'vip'     THEN 'VIP'
       ELSE 'Bar' END AS consumption_category,
  s.space_id, s.space_name, s.service_type, s.max_pax, es.expected_pax,
  p.product_id, p.product_name, p.category, p.unit, p.unit_price_ht,
  esl.initial_qty,
  COALESCE(esl.reassort_qty, 0) AS reassort_qty,
  esl.final_qty,
  esl.initial_qty + COALESCE(esl.reassort_qty,0) - COALESCE(esl.final_qty,0) AS consumed_qty,
  CASE WHEN esl.final_qty IS NOT NULL AND p.unit_price_ht IS NOT NULL
       THEN (esl.initial_qty + COALESCE(esl.reassort_qty,0) - esl.final_qty) * p.unit_price_ht END AS cost_ht,
  CASE WHEN esl.final_qty IS NOT NULL AND COALESCE(es.expected_pax, e.expected_attendees, 0) > 0
       THEN (esl.initial_qty + COALESCE(esl.reassort_qty,0) - esl.final_qty)::DECIMAL
            / COALESCE(es.expected_pax, e.expected_attendees, 1) * 100 END AS qty_per_100pax
FROM event_stock_lines esl
JOIN events   e ON e.event_id   = esl.event_id
JOIN spaces   s ON s.space_id   = esl.space_id
JOIN products p ON p.product_id = esl.product_id
JOIN event_spaces es ON es.event_id = e.event_id AND es.space_id = s.space_id
WHERE e.event_type = 'match'
ORDER BY e.event_date DESC,
  CASE s.service_type WHEN 'vip' THEN 1 WHEN 'bar' THEN 2 ELSE 3 END,
  s.space_name, p.category, p.product_name;

-- ╔═══ ÉTAPE 7 — Match test avec expected_pax par espace ══════════════════╗
DO $$
DECLARE v_event UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM events WHERE event_name = 'Provence Rugby vs TEST') THEN
    INSERT INTO events (event_name, event_type, event_date, start_time, expected_attendees, status)
    VALUES ('Provence Rugby vs TEST', 'match', CURRENT_DATE + 7, '19:00', 8000, 'préparé')
    RETURNING event_id INTO v_event;

    INSERT INTO event_spaces (event_id, space_id, service_mode, expected_pax)
    SELECT v_event, s.space_id, COALESCE(s.service_type, 'bar'),
      CASE s.access_code
        WHEN 'SN2026' THEN 400 WHEN 'SS2026' THEN 290 WHEN 'PUB2026' THEN 200
        WHEN 'C70S26' THEN 150 WHEN 'C70N26' THEN 150 WHEN 'CO2026' THEN 195
        WHEN 'BI2026' THEN 165 WHEN 'WBS2026' THEN 120 WHEN 'WBN2026' THEN 120
        WHEN 'TER2026' THEN 300 WHEN 'BOD2026' THEN 400 WHEN 'GP2026' THEN 150
        ELSE NULL END
    FROM spaces s WHERE s.active = true
    ON CONFLICT (event_id, space_id) DO NOTHING;
  END IF;
END $$;


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  FICHIER : runner_season_ref.sql
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════════════
-- runner_season_ref.sql — Base historique saison S-1 (5 matchs référence)
-- Nouvelle saison : espaces à 0 → À monter = Recommandé. Supersede vip_history_import.
-- Prérequis : _APPLY_ALL.sql (produits, event_consumptions) + buvettes_capacites.sql
--             (spaces.max_pax/service_type).
--
-- ⚠ Corrections vs le SQL du prompt (schéma RÉEL) :
--   • events n'a PAS de colonne notes → ALTER ADD notes.
--   • event_consumptions.consumed_qty est GÉNÉRÉE → on écrit initial_stock.
--   • insert_ref_conso : matching EXACT prioritaire + alias 'Pepsi bouteille 1L+'
--     → 'Pepsi bouteille' (le ILIKE '%Pepsi%' du prompt tapait 'Pepsi 50cl').
--   • PHASE 2 trend : le prompt met COUNT(*) DANS AVG() = agrégat imbriqué INVALIDE
--     → total_n via COUNT() OVER (colonne), comparaison 1re moitié / 2e moitié valide.
--   • PAS de « DELETE consumption_analytics WHERE event_type='match' » : effacerait
--     les analytics BUVETTES importées auparavant → on UPSERT uniquement.
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE events ADD COLUMN IF NOT EXISTS notes TEXT;

-- ╔═══ PHASE 1.1 — 5 événements de référence (S-1) ════════════════════════╗
INSERT INTO events (event_name, event_type, event_date, expected_attendees, status, notes)
SELECT v.n, 'match', v.d::date, v.a, 'archivé', 'Référence saison précédente'
FROM (VALUES
  ('Ref. vs Colomiers S-1',      '2025-03-26', 7750),
  ('Ref. vs Mont-de-Marsan S-1', '2025-04-10', 7500),
  ('Ref. vs Vannes S-1',         '2025-05-07', 7500),
  ('Ref. vs Angoulême S-1',      '2025-06-01', 8000),
  ('Ref. vs Barrage S-1',        '2025-06-20', 8500)
) AS v(n, d, a)
WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.event_name = v.n);

-- ╔═══ PHASE 1.2 — Fonction d'insertion (initial_stock, matching exact d'abord) ═╗
CREATE OR REPLACE FUNCTION insert_ref_conso(p_event_name TEXT, p_space_code TEXT, p_product_name TEXT, p_qty INT)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_event UUID; v_space UUID; v_product UUID; v_norm TEXT;
BEGIN
  SELECT event_id INTO v_event FROM events WHERE event_name = p_event_name LIMIT 1;
  SELECT space_id INTO v_space FROM spaces WHERE access_code = p_space_code;
  -- Alias connus (nom Excel ≠ catalogue).
  v_norm := CASE p_product_name WHEN 'Pepsi bouteille 1L+' THEN 'Pepsi bouteille' ELSE p_product_name END;
  -- Exact d'abord, puis fuzzy sur le premier mot.
  SELECT product_id INTO v_product FROM products
   WHERE active = true
     AND (lower(product_name) = lower(v_norm)
          OR product_name ILIKE '%' || SPLIT_PART(v_norm, ' ', 1) || '%')
   ORDER BY CASE WHEN lower(product_name) = lower(v_norm) THEN 0 ELSE 1 END, product_name
   LIMIT 1;

  IF v_event IS NULL OR v_space IS NULL OR v_product IS NULL THEN
    RAISE NOTICE 'Ignoré : event=% space=% prod=%', p_event_name, p_space_code, p_product_name;
    RETURN;
  END IF;

  INSERT INTO event_consumptions (event_id, space_id, product_id, initial_stock, restock_qty, final_stock, event_type, expected_attendance)
  SELECT v_event, v_space, v_product, p_qty, 0, 0, 'match', e.expected_attendees
  FROM events e WHERE e.event_id = v_event
  ON CONFLICT (event_id, space_id, product_id) DO UPDATE SET initial_stock = EXCLUDED.initial_stock;
END; $$;

-- ╔═══ PHASE 1.3 — SALON NORD (SN2026) ════════════════════════════════════╗
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Mumm Cordon Rouge',5);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Mumm Blanc de Blanc',38);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Rosé Miraval',15);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Rosé Réal',1);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Rouge Les Alexandrins',11);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Blanc Galiniere',11);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Blanc du Seuil',3);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Fût BUD',3);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Fût LEFFE',1);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Pepsi bouteille 1L+',21);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Pepsi Max bouteille',5);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Perrier grande bouteille',17);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Schweppes',8);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Jus de fruits',6);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Whisky Jameson',5);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','GET 27',5);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Lillet Blanc',4);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Lillet Rosé',3);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SN2026','Ricard classique',3);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Mumm Cordon Rouge',20);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Mumm Blanc de Blanc',1);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Rosé Miraval',14);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Rosé Réal',7);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Blanc Galiniere',25);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Blanc du Seuil',2);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Blanc Montaurone',3);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Fût BUD',2);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Fût LEFFE',2);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Pepsi bouteille 1L+',16);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Pepsi Max bouteille',6);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Perrier grande bouteille',30);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Schweppes',10);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Jus de fruits',11);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Whisky Jameson',1);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','GET 27',2);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Lillet Blanc',4);
SELECT insert_ref_conso('Ref. vs Barrage S-1','SN2026','Ricard classique',2);
SELECT insert_ref_conso('Ref. vs Colomiers S-1','SN2026','Mumm Blanc de Blanc',70);
SELECT insert_ref_conso('Ref. vs Colomiers S-1','SN2026','Rosé Miraval',10);
SELECT insert_ref_conso('Ref. vs Colomiers S-1','SN2026','Blanc Galiniere',22);
SELECT insert_ref_conso('Ref. vs Colomiers S-1','SN2026','Blanc du Seuil',6);
SELECT insert_ref_conso('Ref. vs Colomiers S-1','SN2026','Fût BUD',5);
SELECT insert_ref_conso('Ref. vs Colomiers S-1','SN2026','Fût LEFFE',3);
SELECT insert_ref_conso('Ref. vs Colomiers S-1','SN2026','Pepsi bouteille 1L+',17);
SELECT insert_ref_conso('Ref. vs Colomiers S-1','SN2026','Pepsi Max bouteille',4);
SELECT insert_ref_conso('Ref. vs Colomiers S-1','SN2026','Schweppes',3);
SELECT insert_ref_conso('Ref. vs Colomiers S-1','SN2026','Jus de fruits',6);
SELECT insert_ref_conso('Ref. vs Colomiers S-1','SN2026','Whisky Jameson',9);
SELECT insert_ref_conso('Ref. vs Colomiers S-1','SN2026','GET 27',10);
SELECT insert_ref_conso('Ref. vs Colomiers S-1','SN2026','Ricard classique',3);
SELECT insert_ref_conso('Ref. vs Mont-de-Marsan S-1','SN2026','Mumm Blanc de Blanc',28);
SELECT insert_ref_conso('Ref. vs Mont-de-Marsan S-1','SN2026','Rosé Miraval',6);
SELECT insert_ref_conso('Ref. vs Mont-de-Marsan S-1','SN2026','Blanc Galiniere',10);
SELECT insert_ref_conso('Ref. vs Mont-de-Marsan S-1','SN2026','Blanc du Seuil',4);
SELECT insert_ref_conso('Ref. vs Mont-de-Marsan S-1','SN2026','Fût BUD',4);
SELECT insert_ref_conso('Ref. vs Mont-de-Marsan S-1','SN2026','Fût LEFFE',2);
SELECT insert_ref_conso('Ref. vs Mont-de-Marsan S-1','SN2026','Pepsi bouteille 1L+',22);
SELECT insert_ref_conso('Ref. vs Mont-de-Marsan S-1','SN2026','Pepsi Max bouteille',5);
SELECT insert_ref_conso('Ref. vs Mont-de-Marsan S-1','SN2026','Perrier grande bouteille',35);
SELECT insert_ref_conso('Ref. vs Mont-de-Marsan S-1','SN2026','Schweppes',9);
SELECT insert_ref_conso('Ref. vs Mont-de-Marsan S-1','SN2026','Jus de fruits',5);
SELECT insert_ref_conso('Ref. vs Mont-de-Marsan S-1','SN2026','Whisky Jameson',1);
SELECT insert_ref_conso('Ref. vs Mont-de-Marsan S-1','SN2026','GET 27',9);
SELECT insert_ref_conso('Ref. vs Mont-de-Marsan S-1','SN2026','Lillet Blanc',6);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','Mumm Cordon Rouge',20);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','Mumm Blanc de Blanc',18);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','Rosé Miraval',11);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','Blanc Galiniere',3);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','Blanc Montaurone',17);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','Blanc du Seuil',1);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','Fût BUD',2);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','Fût LEFFE',4);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','Pepsi bouteille 1L+',14);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','Pepsi Max bouteille',3);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','Perrier grande bouteille',28);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','Schweppes',2);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','Jus de fruits',2);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','Whisky Jameson',1);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','GET 27',14);
SELECT insert_ref_conso('Ref. vs Vannes S-1','SN2026','Ricard classique',1);

-- ╔═══ PHASE 1.4 — SALON SUD (SS2026) ═════════════════════════════════════╗
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SS2026','Mumm Cordon Rouge',23);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SS2026','Rosé Réal',9);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SS2026','Rouge Les Alexandrins',13);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SS2026','Blanc Galiniere',17);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SS2026','Blanc du Seuil',2);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SS2026','Fût BUD',2);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SS2026','Fût LEFFE',2);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SS2026','Pepsi bouteille 1L+',13);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SS2026','Pepsi Max bouteille',6);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SS2026','Schweppes',6);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','SS2026','Jus de fruits',1);

-- ╔═══ PHASE 1.5 — LE PUB (PUB2026) ═══════════════════════════════════════╗
SELECT insert_ref_conso('Ref. vs Angoulême S-1','PUB2026','Mumm Cordon Rouge',24);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','PUB2026','Rosé Miraval',5);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','PUB2026','Rouge Grand Boise',5);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','PUB2026','Blanc Galiniere',16);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','PUB2026','Fût BUD',2);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','PUB2026','Fût LEFFE',2);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','PUB2026','Pepsi bouteille 1L+',17);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','PUB2026','Pepsi Max bouteille',2);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','PUB2026','Perrier grande bouteille',16);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','PUB2026','Schweppes',8);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','PUB2026','Jus de fruits',3);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','PUB2026','Lillet Blanc',3);

-- ╔═══ PHASE 2 — Analytics depuis les données S-1 (UPSERT, sans DELETE) ════╗
INSERT INTO consumption_analytics
  (space_id, product_id, event_type, avg_qty_per_event, avg_qty_per_100_pax,
   confidence_score, nb_events_analyzed, trend_direction, last_updated)
SELECT
  x.space_id, x.product_id, 'match',
  ROUND(AVG(x.consumed_qty)::numeric, 2),
  ROUND((AVG(x.consumed_qty) / COALESCE(s.max_pax, 200) * 100)::numeric, 4),
  LEAST(0.95, 0.2 + COUNT(*) * 0.15),
  COUNT(*),
  CASE
    WHEN COUNT(*) >= 4
     AND AVG(CASE WHEN x.rn * 2 <= x.total_n THEN x.consumed_qty END) * 1.15
       < AVG(CASE WHEN x.rn * 2 >  x.total_n THEN x.consumed_qty END) THEN 'hausse'
    WHEN COUNT(*) >= 4
     AND AVG(CASE WHEN x.rn * 2 <= x.total_n THEN x.consumed_qty END) * 0.85
       > AVG(CASE WHEN x.rn * 2 >  x.total_n THEN x.consumed_qty END) THEN 'baisse'
    ELSE 'stable'
  END,
  now()
FROM (
  SELECT ec.space_id, ec.product_id, ec.consumed_qty,
         ROW_NUMBER() OVER (PARTITION BY ec.space_id, ec.product_id ORDER BY e.event_date) AS rn,
         COUNT(*)   OVER (PARTITION BY ec.space_id, ec.product_id)                         AS total_n
    FROM event_consumptions ec
    JOIN events e ON e.event_id = ec.event_id
   WHERE e.notes ILIKE '%Référence saison%' AND ec.consumed_qty > 0
) x
JOIN spaces s ON s.space_id = x.space_id
GROUP BY x.space_id, x.product_id, s.max_pax
ON CONFLICT (space_id, product_id, event_type) DO UPDATE SET
  avg_qty_per_event   = EXCLUDED.avg_qty_per_event,
  avg_qty_per_100_pax = EXCLUDED.avg_qty_per_100_pax,
  confidence_score    = EXCLUDED.confidence_score,
  nb_events_analyzed  = EXCLUDED.nb_events_analyzed,
  trend_direction     = EXCLUDED.trend_direction,
  last_updated        = now();

-- ╔═══ PHASE 5 — Vérification Salon Nord (À monter = Recommandé, espace = 0) ═╗
SELECT p.product_name,
       ca.avg_qty_per_event   AS ref_s1,
       ca.nb_events_analyzed  AS nb_ref,
       ca.trend_direction     AS tendance,
       CEIL(ca.avg_qty_per_event
            * CASE ca.trend_direction WHEN 'hausse' THEN 1.10 WHEN 'baisse' THEN 0.92 ELSE 1.00 END
       ) AS a_monter_temps_normal
  FROM consumption_analytics ca
  JOIN spaces s   ON s.space_id   = ca.space_id
  JOIN products p ON p.product_id = ca.product_id
 WHERE s.access_code = 'SN2026' AND ca.event_type = 'match' AND ca.avg_qty_per_event > 0
 ORDER BY ca.avg_qty_per_event DESC;


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  FICHIER : runner_chain.sql
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════════════
-- runner_chain.sql — Espaces complémentaires S-1 + chaîne runner→stock→coût→débrief
-- À appliquer APRÈS runner_season_ref.sql (événements S-1 + helper insert_ref_conso).
-- Idempotent. Corrections vs prompt : consumed_qty GÉNÉRÉE → initial_stock ;
-- noms produits complets (le fuzzy '%Pepsi%' tape 'Pepsi 50cl') ; pas de DELETE
-- analytics (préserve les buvettes) ; ins() renommée insert_ref_conso (déjà fixée).
-- ═══════════════════════════════════════════════════════════════════════════

-- Filet de sécurité : (re)créer le helper corrigé si runner_season_ref pas encore joué.
CREATE OR REPLACE FUNCTION insert_ref_conso(p_event_name TEXT, p_space_code TEXT, p_product_name TEXT, p_qty INT)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_event UUID; v_space UUID; v_product UUID; v_norm TEXT;
BEGIN
  SELECT event_id INTO v_event FROM events WHERE event_name = p_event_name LIMIT 1;
  SELECT space_id INTO v_space FROM spaces WHERE access_code = p_space_code;
  v_norm := CASE p_product_name WHEN 'Pepsi bouteille 1L+' THEN 'Pepsi bouteille' ELSE p_product_name END;
  SELECT product_id INTO v_product FROM products
   WHERE active = true
     AND (lower(product_name) = lower(v_norm) OR product_name ILIKE '%' || SPLIT_PART(v_norm, ' ', 1) || '%')
   ORDER BY CASE WHEN lower(product_name) = lower(v_norm) THEN 0 ELSE 1 END, product_name
   LIMIT 1;
  IF v_event IS NULL OR v_space IS NULL OR v_product IS NULL THEN RETURN; END IF;
  INSERT INTO event_consumptions (event_id, space_id, product_id, initial_stock, restock_qty, final_stock, event_type, expected_attendance)
  SELECT v_event, v_space, v_product, p_qty, 0, 0, 'match', e.expected_attendees
  FROM events e WHERE e.event_id = v_event
  ON CONFLICT (event_id, space_id, product_id) DO UPDATE SET initial_stock = EXCLUDED.initial_stock;
END; $$;

-- ── Espaces complémentaires (noms produits COMPLETS) ────────────────────────
-- BISTROT (BI2026)
SELECT insert_ref_conso('Ref. vs Angoulême S-1','BI2026','Fût BUD',5);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','BI2026','Fût LEFFE',4);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','BI2026','Pepsi bouteille',17);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','BI2026','Pepsi Max bouteille',5);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','BI2026','Perrier grande bouteille',25);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','BI2026','Schweppes',9);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','BI2026','Blanc Montaurone',15);
SELECT insert_ref_conso('Ref. vs Barrage S-1','BI2026','Fût BUD',7);
SELECT insert_ref_conso('Ref. vs Barrage S-1','BI2026','Fût LEFFE',4);
SELECT insert_ref_conso('Ref. vs Barrage S-1','BI2026','Pepsi bouteille',20);
SELECT insert_ref_conso('Ref. vs Barrage S-1','BI2026','Perrier grande bouteille',28);
SELECT insert_ref_conso('Ref. vs Barrage S-1','BI2026','Schweppes',19);
-- COMPTOIR (CO2026)
SELECT insert_ref_conso('Ref. vs Angoulême S-1','CO2026','Fût BUD',5);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','CO2026','Rosé Miraval',6);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','CO2026','Rouge Les Alexandrins',6);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','CO2026','Pepsi bouteille',8);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','CO2026','Perrier grande bouteille',7);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','CO2026','Schweppes',13);
-- CLUB 70 NORD (C70N26)
SELECT insert_ref_conso('Ref. vs Angoulême S-1','C70N26','Mumm Cordon Rouge',24);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','C70N26','Rosé Pey Blanc',4);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','C70N26','Blanc du Seuil',9);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','C70N26','Fût BUD',3);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','C70N26','Pepsi bouteille',8);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','C70N26','Perrier grande bouteille',3);
SELECT insert_ref_conso('Ref. vs Barrage S-1','C70N26','Mumm Cordon Rouge',14);
SELECT insert_ref_conso('Ref. vs Barrage S-1','C70N26','Fût BUD',4);
SELECT insert_ref_conso('Ref. vs Barrage S-1','C70N26','Pepsi bouteille',11);
SELECT insert_ref_conso('Ref. vs Barrage S-1','C70N26','Perrier grande bouteille',18);
-- LOGES EST (LE2026)
SELECT insert_ref_conso('Ref. vs Angoulême S-1','LE2026','Mumm Cordon Rouge',1);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','LE2026','Bière en verre',16);
SELECT insert_ref_conso('Ref. vs Angoulême S-1','LE2026','Rosé Réal',4);
SELECT insert_ref_conso('Ref. vs Barrage S-1','LE2026','Mumm Cordon Rouge',36);
SELECT insert_ref_conso('Ref. vs Barrage S-1','LE2026','Bière en verre',112);

-- ── Rafraîchir analytics (UPSERT, sans DELETE : buvettes préservées) ────────
INSERT INTO consumption_analytics
  (space_id, product_id, event_type, avg_qty_per_event, avg_qty_per_100_pax,
   confidence_score, nb_events_analyzed, trend_direction, last_updated)
SELECT ec.space_id, ec.product_id, 'match',
  ROUND(AVG(ec.consumed_qty)::numeric, 2),
  ROUND((AVG(ec.consumed_qty) / NULLIF(COALESCE(s.max_pax, 400), 0) * 100)::numeric, 4),
  LEAST(0.95, 0.2 + COUNT(*) * 0.15), COUNT(*), 'stable', now()
FROM event_consumptions ec
JOIN events e ON e.event_id = ec.event_id
JOIN spaces s ON s.space_id = ec.space_id
WHERE e.notes ILIKE '%Référence%' AND ec.consumed_qty > 0
GROUP BY ec.space_id, ec.product_id, s.max_pax
ON CONFLICT (space_id, product_id, event_type) DO UPDATE SET
  avg_qty_per_event = EXCLUDED.avg_qty_per_event,
  avg_qty_per_100_pax = EXCLUDED.avg_qty_per_100_pax,
  confidence_score = EXCLUDED.confidence_score,
  nb_events_analyzed = EXCLUDED.nb_events_analyzed,
  last_updated = now();

-- ── 3.1 Vue de liaison complète runner → stock → coût → débrief ─────────────
CREATE OR REPLACE VIEW event_full_chain WITH (security_invoker = true) AS
SELECT
  e.event_id, e.event_name, e.event_type, e.event_date,
  s.space_id, s.space_name, s.service_type,
  rap.product_id, p.product_name, p.category, p.unit, p.unit_price_ht,
  rap.recommended_quantity AS runner_reco,
  rap.quantity_to_move     AS runner_to_move,
  rap.validated_quantity   AS runner_validated,
  rap.validation_status    AS runner_status,
  esl.initial_qty, esl.reassort_qty, esl.final_qty,
  esl.initial_qty + COALESCE(esl.reassort_qty,0) - COALESCE(esl.final_qty,0) AS consumed_qty,
  CASE WHEN esl.final_qty IS NOT NULL AND p.unit_price_ht IS NOT NULL
       THEN (esl.initial_qty + COALESCE(esl.reassort_qty,0) - esl.final_qty) * p.unit_price_ht END AS line_cost_ht,
  d.overall_rating AS debrief_rating, d.cleaning_score, d.technical_score,
  d.stocks_suffisants AS debrief_stocks_ok,
  CASE WHEN rap.validated_quantity IS NOT NULL AND esl.final_qty IS NOT NULL
       THEN (esl.initial_qty + COALESCE(esl.reassort_qty,0) - esl.final_qty) - rap.validated_quantity END AS conso_vs_reco_delta
FROM runner_auto_planning rap
JOIN events e   ON e.event_id   = rap.event_id
JOIN spaces s   ON s.space_id   = rap.space_id
JOIN products p ON p.product_id = rap.product_id
LEFT JOIN event_stock_lines esl
  ON esl.event_id = rap.event_id AND esl.space_id = rap.space_id AND esl.product_id = rap.product_id
LEFT JOIN debriefs d ON d.event_id = rap.event_id AND d.space_id = rap.space_id
ORDER BY e.event_date DESC, s.space_name, p.category, p.product_name;

-- ── 3.2 Trigger : transmission runner → crée les lignes de stock ────────────
CREATE OR REPLACE FUNCTION on_runner_validate_create_stock_lines()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.validation_status = 'transmis_runners'
     AND OLD.validation_status IS DISTINCT FROM NEW.validation_status
     AND COALESCE(NEW.validated_quantity, 0) > 0 THEN
    INSERT INTO event_stock_lines (event_id, space_id, product_id, initial_qty, reassort_qty, responsable_nom)
    VALUES (NEW.event_id, NEW.space_id, NEW.product_id, NEW.validated_quantity, 0, 'Runner auto')
    ON CONFLICT (event_id, space_id, product_id) DO UPDATE SET initial_qty = EXCLUDED.initial_qty;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_runner_to_stock ON runner_auto_planning;
CREATE TRIGGER trg_runner_to_stock AFTER UPDATE ON runner_auto_planning FOR EACH ROW
  EXECUTE FUNCTION on_runner_validate_create_stock_lines();


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  FICHIER : match_access.sql
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════════════
-- match_access.sql — Accès match par code unique (1 code → choix espace → nom)
-- Prérequis : buvettes_capacites.sql (event_spaces.service_mode, spaces.service_type),
--             _APPLY_ALL.sql (buvette_groups).
--
-- ⚠ Corrections vs le SQL du prompt (schéma RÉEL) :
--   • schedules n'a PAS de colonne declared_by_self → ALTER ADD.
--   • schedules n'a PAS de contrainte UNIQUE(event_id,space_id,staff_name)
--     → l'insert horaire utilise IF NOT EXISTS (pas ON CONFLICT).
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── ÉTAPE 1 — Code d'accès match + sessions ─────────────────────────────────
ALTER TABLE events ADD COLUMN IF NOT EXISTS match_access_code TEXT UNIQUE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS match_access_url  TEXT;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS declared_by_self BOOLEAN DEFAULT false;

CREATE TABLE IF NOT EXISTS match_access_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  space_id       UUID NOT NULL REFERENCES spaces(space_id),
  staff_name     TEXT NOT NULL,
  connected_at   TIMESTAMPTZ DEFAULT now(),
  last_active_at TIMESTAMPTZ DEFAULT now(),
  session_token  TEXT UNIQUE DEFAULT substring(gen_random_uuid()::text, 1, 8),
  is_active      BOOLEAN DEFAULT true,
  completed_at   TIMESTAMPTZ,
  UNIQUE(event_id, space_id, staff_name)
);

-- Génération auto du code à la création d'un match.
CREATE OR REPLACE FUNCTION generate_match_access_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event_type = 'match' AND NEW.match_access_code IS NULL THEN
    NEW.match_access_code := UPPER(substring(md5(NEW.event_id::text || random()::text), 1, 6));
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_match_access_code ON events;
CREATE TRIGGER trg_match_access_code BEFORE INSERT ON events FOR EACH ROW
  EXECUTE FUNCTION generate_match_access_code();

-- Codes pour les matchs existants.
UPDATE events
   SET match_access_code = UPPER(substring(md5(event_id::text || random()::text), 1, 6))
 WHERE event_type = 'match' AND match_access_code IS NULL;

-- RLS.
ALTER TABLE match_access_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_create_session ON match_access_sessions;
CREATE POLICY public_create_session ON match_access_sessions
  FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS read_session ON match_access_sessions;
CREATE POLICY read_session ON match_access_sessions
  FOR SELECT TO anon, authenticated
  USING (
    session_token = current_setting('request.jwt.claims', true)::json->>'session_token'
    OR is_stade()
  );
DROP POLICY IF EXISTS update_session ON match_access_sessions;
CREATE POLICY update_session ON match_access_sessions
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- ── ÉTAPE 2 — RPC publiques (SECURITY DEFINER → bypass RLS) ─────────────────
CREATE OR REPLACE FUNCTION validate_match_code(p_code TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event events%ROWTYPE;
BEGIN
  SELECT * INTO v_event FROM events
   WHERE UPPER(match_access_code) = UPPER(p_code)
     AND event_type = 'match' AND status IN ('préparé','en_cours','brouillon')
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Code invalide ou match non actif');
  END IF;
  RETURN json_build_object(
    'success', true, 'event_id', v_event.event_id, 'event_name', v_event.event_name,
    'event_date', v_event.event_date, 'start_time', v_event.start_time, 'status', v_event.status,
    'spaces', (
      SELECT COALESCE(json_agg(json_build_object(
        'space_id', s.space_id, 'space_name', s.space_name,
        'service_type', s.service_type, 'max_pax', s.max_pax, 'group_name', bg.group_name
      ) ORDER BY s.service_type, s.space_name), '[]'::json)
      FROM event_spaces es
      JOIN spaces s ON s.space_id = es.space_id
      LEFT JOIN buvette_group_members bgm ON bgm.space_id = s.space_id
      LEFT JOIN buvette_groups bg ON bg.id = bgm.group_id
      WHERE es.event_id = v_event.event_id
        AND COALESCE(es.service_mode, 'auto') <> 'fermé'
    )
  );
END; $$;

CREATE OR REPLACE FUNCTION register_zone_staff(p_match_code TEXT, p_space_id UUID, p_staff_name TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event UUID; v_token TEXT; v_name TEXT;
BEGIN
  v_name := UPPER(TRIM(p_staff_name));
  SELECT event_id INTO v_event FROM events
   WHERE UPPER(match_access_code) = UPPER(p_match_code)
     AND event_type = 'match' AND status IN ('préparé','en_cours','brouillon');
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Code invalide');
  END IF;

  INSERT INTO match_access_sessions (event_id, space_id, staff_name)
  VALUES (v_event, p_space_id, v_name)
  ON CONFLICT (event_id, space_id, staff_name)
  DO UPDATE SET last_active_at = now(), is_active = true
  RETURNING session_token INTO v_token;

  -- Ligne horaire RH (schedules n'a pas de contrainte unique → NOT EXISTS).
  IF NOT EXISTS (
    SELECT 1 FROM schedules
     WHERE event_id = v_event AND space_id = p_space_id AND staff_name = v_name
  ) THEN
    INSERT INTO schedules (event_id, space_id, staff_name, role, planned_arrival, declared_by_self)
    VALUES (v_event, p_space_id, v_name, 'Responsable espace', '07:00', true);
  END IF;

  RETURN json_build_object('success', true, 'session_token', v_token,
    'event_id', v_event, 'space_id', p_space_id, 'staff_name', v_name);
END; $$;

-- Charger une session par son token (accès public au tableau de zone).
CREATE OR REPLACE FUNCTION get_match_session(p_token TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v JSON;
BEGIN
  UPDATE match_access_sessions SET last_active_at = now()
   WHERE session_token = p_token AND is_active = true;
  SELECT json_build_object(
    'success', true,
    'session_token', mas.session_token,
    'event_id', e.event_id, 'event_name', e.event_name, 'event_date', e.event_date,
    'space_id', s.space_id, 'space_name', s.space_name, 'service_type', s.service_type,
    'staff_name', mas.staff_name
  ) INTO v
  FROM match_access_sessions mas
  JOIN events e ON e.event_id = mas.event_id
  JOIN spaces s ON s.space_id = mas.space_id
  WHERE mas.session_token = p_token AND mas.is_active = true;
  RETURN COALESCE(v, json_build_object('success', false, 'error', 'Session expirée'));
END; $$;

GRANT EXECUTE ON FUNCTION validate_match_code(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION register_zone_staff(TEXT, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_match_session(TEXT) TO anon, authenticated;

