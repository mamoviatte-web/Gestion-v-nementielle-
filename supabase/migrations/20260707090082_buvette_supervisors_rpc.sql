-- ═══════════════════════════════════════════════════════════════════════════
-- buvette_supervisors_rpc.sql — expose les 2 slots superviseurs buvettes à
-- l'écran d'accès public « Mon espace » (rôle anon, sans compte). La table
-- spaces est en RLS (invisible à anon) → RPC SECURITY DEFINER en lecture seule
-- qui ne renvoie QUE les slots superviseurs (is_supervisor_slot), avec leur
-- display_name (« Superviseur Buvette 1/2 »).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_buvette_supervisors()
RETURNS JSON LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(json_agg(json_build_object(
    'space_id', space_id,
    'space_name', space_name,
    'display_name', COALESCE(display_name, space_name),
    'service_type', service_type
  ) ORDER BY space_name), '[]'::json)
  FROM spaces
  WHERE is_supervisor_slot = true AND active = true;
$$;

GRANT EXECUTE ON FUNCTION get_buvette_supervisors() TO anon, authenticated;
