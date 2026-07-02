-- ═══════════════════════════════════════════════════════════════════
-- Dashboard live : fonction agrégée optionnelle (1 seul appel).
-- Le hook useDashboardLive fonctionne SANS cette fonction (composition
-- côté client) ; l'appliquer permet de tout servir en un appel.
--
-- Corrections vs prompt d'origine :
--   • stock_balances.current_qty → current_quantity (nom réel de la colonne)
--   • création de la table space_daily_status (référencée mais absente)
--   • SECURITY DEFINER + GRANT authenticated
-- À APPLIQUER quand l'accès DB (MCP / psql) est disponible.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS space_daily_status (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id    UUID NOT NULL REFERENCES spaces(space_id),
  status_date DATE NOT NULL,
  operational TEXT,   -- ex: 'ouvert', 'préparation', 'fermé'
  UNIQUE(space_id, status_date)
);
ALTER TABLE space_daily_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stade_full_space_daily ON space_daily_status;
CREATE POLICY stade_full_space_daily ON space_daily_status FOR ALL TO authenticated
  USING (is_stade()) WITH CHECK (is_stade());

CREATE OR REPLACE FUNCTION get_dashboard_live()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result JSON;
BEGIN
  SELECT json_build_object(
    'today_events', (
      SELECT json_agg(json_build_object(
        'event_id', e.event_id, 'event_name', e.event_name, 'event_type', e.event_type,
        'status', e.status, 'start_time', e.start_time, 'pax', e.expected_attendees,
        'spaces_count', (SELECT COUNT(*) FROM event_spaces es WHERE es.event_id = e.event_id),
        'stocks_submitted', (SELECT COUNT(DISTINCT space_id) FROM event_stock_lines
                             WHERE event_id = e.event_id AND final_qty IS NOT NULL)
      ) ORDER BY e.start_time)
      FROM events e
      WHERE e.event_date = CURRENT_DATE
         OR (e.event_date = CURRENT_DATE - 1 AND e.status = 'en_cours')
         OR (e.event_date BETWEEN CURRENT_DATE + 1 AND CURRENT_DATE + 7 AND e.status IN ('brouillon','préparé'))
    ),
    'kpis', (SELECT json_build_object(
      'active_events', (SELECT COUNT(*) FROM events WHERE event_date = CURRENT_DATE AND status = 'en_cours'),
      'total_pax_today', (SELECT COALESCE(SUM(expected_attendees),0) FROM events WHERE event_date = CURRENT_DATE AND status = 'en_cours'),
      'critical_alerts', (SELECT COUNT(*) FROM products p WHERE p.min_stock IS NOT NULL AND p.active = true
        AND (SELECT COALESCE(SUM(current_quantity),0) FROM stock_balances sb WHERE sb.product_id = p.product_id) < p.min_stock),
      'debriefs_pending', (SELECT COUNT(*) FROM event_spaces es JOIN events e ON e.event_id = es.event_id
        WHERE e.event_date = CURRENT_DATE AND NOT EXISTS (SELECT 1 FROM debriefs d WHERE d.event_id = es.event_id AND d.space_id = es.space_id))
    )),
    'stock_alerts', (
      SELECT json_agg(json_build_object(
        'product_name', p.product_name, 'category', p.category, 'current_qty', COALESCE(sb_total.total,0),
        'min_stock', p.min_stock,
        'severity', CASE WHEN COALESCE(sb_total.total,0) = 0 THEN 'rupture'
                         WHEN COALESCE(sb_total.total,0) < p.min_stock * 0.5 THEN 'critique' ELSE 'avertissement' END,
        'space_name', (SELECT s.space_name FROM stock_balances sb2 JOIN stock_locations sl ON sl.id = sb2.location_id
                       JOIN spaces s ON s.space_id = sl.area_id WHERE sb2.product_id = p.product_id
                       ORDER BY sb2.current_quantity ASC LIMIT 1)
      ) ORDER BY COALESCE(sb_total.total,0) ASC)
      FROM products p
      LEFT JOIN (SELECT product_id, SUM(current_quantity) AS total FROM stock_balances GROUP BY product_id) sb_total
        ON sb_total.product_id = p.product_id
      WHERE p.active = true AND p.min_stock IS NOT NULL AND COALESCE(sb_total.total,0) < p.min_stock
    ),
    'provider_alerts', (
      SELECT json_agg(json_build_object('company', pp.provider_company, 'space_id', pp.space_id,
        'planned_time', pp.planned_arrival_time,
        'delay_min', EXTRACT(EPOCH FROM (pp.actual_arrival_time - pp.planned_arrival_time))/60))
      FROM provider_presence pp JOIN events e ON e.event_id = pp.event_id
      WHERE e.event_date = CURRENT_DATE AND pp.status = 'en_retard'
    ),
    'spaces_status', (
      SELECT json_agg(json_build_object(
        'space_id', s.space_id, 'space_name', s.space_name, 'space_type', s.space_type,
        'has_event_today', (SELECT COUNT(*) > 0 FROM event_spaces es JOIN events e ON e.event_id = es.event_id
          WHERE es.space_id = s.space_id AND e.event_date = CURRENT_DATE AND e.status IN ('en_cours','préparé')),
        'operational', (SELECT sds.operational FROM space_daily_status sds WHERE sds.space_id = s.space_id AND sds.status_date = CURRENT_DATE),
        'event_type', (SELECT e.event_type FROM event_spaces es JOIN events e ON e.event_id = es.event_id
          WHERE es.space_id = s.space_id AND e.event_date = CURRENT_DATE AND e.status = 'en_cours' LIMIT 1),
        'has_alert', (SELECT COUNT(*) > 0 FROM stock_balances sb JOIN products p ON p.product_id = sb.product_id
          JOIN stock_locations sl ON sl.id = sb.location_id
          WHERE sl.area_id = s.space_id AND sb.current_quantity < COALESCE(p.min_stock, 9999))
      ) ORDER BY s.space_name)
      FROM spaces s WHERE s.active = true
    )
  ) INTO v_result;
  RETURN v_result;
END; $$;

GRANT EXECUTE ON FUNCTION get_dashboard_live() TO authenticated;
