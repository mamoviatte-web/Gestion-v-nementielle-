-- ═══════════════════════════════════════════════════════════════════════════
-- bodega_wine_required.sql — CDC V5 #2 : BODEGA_WINE_REQUIRED.
--
-- La fiche runner Bodega doit contenir une gamme vin (rouge/blanc/rosé — le
-- champagne Mumm ne compte pas comme « vin »). Fonction d'état utilisée par la
-- génération et la validation stadium manager pour bloquer « Bodega incomplète :
-- gamme vin absente ». Lecture seule ; réservé aux comptes authentifiés.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_bodega_wine_status(p_event UUID)
RETURNS JSON LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT json_build_object(
    'bodega_present', EXISTS (
      SELECT 1 FROM event_spaces es JOIN spaces s ON s.space_id = es.space_id
      WHERE es.event_id = p_event AND s.service_type = 'bodega'),
    'has_wine', EXISTS (
      SELECT 1 FROM runner_auto_planning r
      JOIN spaces s   ON s.space_id = r.space_id AND s.service_type = 'bodega'
      JOIN products p ON p.product_id = r.product_id
      WHERE r.event_id = p_event AND p.category = 'Vins' AND p.product_name NOT ILIKE 'Mumm%'
        AND COALESCE(r.validated_quantity, r.recommended_quantity, 0) > 0),
    'wines', COALESCE((
      SELECT json_agg(DISTINCT p.product_name)
      FROM runner_auto_planning r
      JOIN spaces s   ON s.space_id = r.space_id AND s.service_type = 'bodega'
      JOIN products p ON p.product_id = r.product_id
      WHERE r.event_id = p_event AND p.category = 'Vins' AND p.product_name NOT ILIKE 'Mumm%'
        AND COALESCE(r.validated_quantity, r.recommended_quantity, 0) > 0), '[]'::json)
  );
$$;

GRANT EXECUTE ON FUNCTION get_bodega_wine_status(UUID) TO authenticated;
