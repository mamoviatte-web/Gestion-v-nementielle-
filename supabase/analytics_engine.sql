-- ═══════════════════════════════════════════════════════════════════
-- Moteur d'analyse et d'apprentissage des consommations (CDC Analytics)
-- Appliqué via Supabase MCP le 2026-07-01. Idempotent.
-- Corrections vs prompt d'origine :
--   • event_consumptions.restock_qty (et non restock_quantity)
--   • consumed_qty / total_cost_ht sont GÉNÉRÉES → jamais insérées
--   • RLS via helpers is_stade()/app_role()/app_space_id() (le claim JWT 'role'
--     vaut 'authenticated' ; le rôle applicatif est dans user_metadata)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS consumption_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(space_id),
  product_id UUID NOT NULL REFERENCES products(product_id),
  event_type TEXT NOT NULL,
  avg_qty_per_100_pax DECIMAL(10,4), avg_qty_per_event DECIMAL(10,4),
  median_consumption DECIMAL(10,4), std_deviation DECIMAL(10,4),
  coef_chaleur_observed DECIMAL(4,3), coef_pluie_observed DECIMAL(4,3),
  coef_froid_observed DECIMAL(4,3), coef_forte_affluence_observed DECIMAL(4,3),
  coef_faible_affluence_observed DECIMAL(4,3),
  trend_direction TEXT CHECK (trend_direction IN ('forte_hausse','hausse','stable','baisse','forte_baisse')),
  trend_pct_change DECIMAL(6,2),
  rupture_count INT DEFAULT 0, surdotation_count INT DEFAULT 0,
  return_rate_avg DECIMAL(4,3), loss_rate_avg DECIMAL(4,3),
  nb_events_analyzed INT DEFAULT 0, last_event_id UUID REFERENCES events(event_id),
  last_updated TIMESTAMPTZ DEFAULT now(), confidence_score DECIMAL(4,3),
  UNIQUE(space_id, product_id, event_type)
);

CREATE TABLE IF NOT EXISTS event_context_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(event_id) UNIQUE,
  event_type TEXT NOT NULL,
  expected_attendance INT, planned_weather TEXT, planned_temperature INT,
  real_attendance INT, real_weather TEXT, real_temperature INT,
  event_start_time TIME, event_duration_hours DECIMAL(4,1),
  total_consumed_value_ht DECIMAL(12,2), avg_spend_per_pax DECIMAL(8,2),
  total_ruptures INT DEFAULT 0, total_surdotations INT DEFAULT 0, total_losses INT DEFAULT 0,
  global_return_rate DECIMAL(4,3), data_quality_score DECIMAL(4,3),
  is_anomaly BOOLEAN DEFAULT false, anomaly_reason TEXT,
  closed_at TIMESTAMPTZ, closed_by TEXT
);

CREATE TABLE IF NOT EXISTS runner_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(event_id),
  space_id UUID NOT NULL REFERENCES spaces(space_id),
  product_id UUID NOT NULL REFERENCES products(product_id),
  analytics_nb_events INT, base_quantity DECIMAL(10,2), base_per_100_pax DECIMAL(10,4),
  coef_attendance DECIMAL(4,3), coef_weather DECIMAL(4,3), coef_event_type DECIMAL(4,3),
  coef_trend DECIMAL(4,3), coef_historical DECIMAL(4,3), total_coefficient DECIMAL(6,3),
  raw_recommended_qty DECIMAL(10,2), recommended_qty INT, area_initial_stock INT, qty_to_move INT,
  alert_type TEXT, alert_message TEXT, confidence_score DECIMAL(4,3),
  validated_qty INT, validation_delta_pct DECIMAL(6,2),
  generated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(event_id, space_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_analytics_space_product ON consumption_analytics(space_id, product_id);
CREATE INDEX IF NOT EXISTS idx_analytics_event_type ON consumption_analytics(event_type);
CREATE INDEX IF NOT EXISTS idx_reco_event ON runner_recommendations(event_id);
CREATE INDEX IF NOT EXISTS idx_context_log_event ON event_context_log(event_id);

ALTER TABLE consumption_analytics  ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_context_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE runner_recommendations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stade_full_analytics ON consumption_analytics;
CREATE POLICY stade_full_analytics ON consumption_analytics FOR ALL TO authenticated USING (is_stade()) WITH CHECK (is_stade());
DROP POLICY IF EXISTS stade_full_context ON event_context_log;
CREATE POLICY stade_full_context ON event_context_log FOR ALL TO authenticated USING (is_stade()) WITH CHECK (is_stade());
DROP POLICY IF EXISTS stade_full_reco ON runner_recommendations;
CREATE POLICY stade_full_reco ON runner_recommendations FOR ALL TO authenticated USING (is_stade()) WITH CHECK (is_stade());
DROP POLICY IF EXISTS responsable_read_analytics ON consumption_analytics;
CREATE POLICY responsable_read_analytics ON consumption_analytics FOR SELECT TO authenticated
  USING (app_role() = 'ROLE_RESPONSABLE' AND space_id = app_space_id());

-- Fonctions compute_consumption_analytics / refresh_all_analytics et
-- trigger trg_refresh_analytics_on_close : voir migrations
-- analytics_engine_functions (appliquées via MCP). Colonnes réelles utilisées :
-- ec.restock_qty, ec.consumed_qty (générée). Confiance : 0→0.0, 1→0.3, <5→+0.1/évt, ≥5→0.5+0.04·n (max 0.95).
