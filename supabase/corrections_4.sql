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
