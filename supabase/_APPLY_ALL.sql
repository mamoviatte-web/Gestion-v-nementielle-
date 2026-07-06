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
