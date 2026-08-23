-- Gouvernance : toute suppression d'événement doit être JUSTIFIÉE et attribuée.
--
-- Le trigger before_event_delete journalisait déjà chaque suppression, mais sans
-- motif et souvent sans auteur (deleted_by NULL sur 30 suppressions). On renforce :
--   * event_deletion_log gagne `reason` (motif) + `db_role` (rôle SQL réel, jamais NULL) ;
--   * before_event_delete capture le motif (app.deletion_reason) + le rôle SQL ;
--   * delete_event_complete EXIGE un motif non vide (p_reason) — sinon refus.
-- Les suppressions brutes (hors RPC) restent tracées avec db_role ; leur motif
-- n'est présent que si app.deletion_reason a été positionné (cf. CLAUDE.md).

alter table event_deletion_log add column if not exists reason  text;
alter table event_deletion_log add column if not exists db_role text;

-- 1) Trigger de journalisation : motif + rôle SQL (attribution garantie)
CREATE OR REPLACE FUNCTION public.before_event_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_nb_stock INT; v_nb_agents INT; v_nb_photos INT; v_paths TEXT[];
BEGIN
  SELECT COUNT(*) INTO v_nb_stock  FROM event_stock_lines WHERE event_id = OLD.event_id;
  SELECT COUNT(*) INTO v_nb_agents FROM zone_staff_hours   WHERE event_id = OLD.event_id;
  SELECT COUNT(*) INTO v_nb_photos FROM debrief_photos     WHERE event_id = OLD.event_id;
  SELECT ARRAY_AGG(storage_path) INTO v_paths FROM debrief_photos WHERE event_id = OLD.event_id;

  INSERT INTO event_deletion_log (
    event_id, event_name, event_type, event_date, pax_count,
    deleted_by, reason, db_role,
    nb_stock_lines, nb_agents, nb_photos, total_fb_cost, storage_paths
  ) VALUES (
    OLD.event_id, OLD.event_name, OLD.event_type, OLD.event_date::date, OLD.expected_attendees,
    NULLIF(current_setting('app.deleted_by', true), ''),
    NULLIF(current_setting('app.deletion_reason', true), ''),
    session_user,
    v_nb_stock, v_nb_agents, v_nb_photos, OLD.total_fb_cost_ht, v_paths
  );

  PERFORM pg_notify('event_deleted', json_build_object(
    'event_id', OLD.event_id, 'event_name', OLD.event_name, 'storage_paths', v_paths
  )::text);

  RETURN OLD;
END; $function$;

-- 2) RPC de suppression : motif OBLIGATOIRE
DROP FUNCTION IF EXISTS public.delete_event_complete(uuid, text, text);
CREATE OR REPLACE FUNCTION public.delete_event_complete(
  p_event_id uuid, p_confirm text, p_deleted_by text DEFAULT 'admin'::text, p_reason text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event events%ROWTYPE; v_nb_stock INT; v_nb_agents INT; v_nb_photos INT; v_paths TEXT[];
BEGIN
  IF NOT is_stade() THEN
    RETURN json_build_object('success', false, 'error', 'Action réservée à l''équipe stade');
  END IF;
  IF p_confirm <> 'CONFIRMER' THEN
    RETURN json_build_object('success', false, 'error', 'Confirmation manquante (p_confirm = ''CONFIRMER'').');
  END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN
    RETURN json_build_object('success', false, 'error', 'Justification obligatoire : indiquez le motif de suppression.');
  END IF;
  SELECT * INTO v_event FROM events WHERE event_id = p_event_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Événement non trouvé');
  END IF;
  SELECT COUNT(*) INTO v_nb_stock  FROM event_stock_lines WHERE event_id = p_event_id;
  SELECT COUNT(*) INTO v_nb_agents FROM zone_staff_hours   WHERE event_id = p_event_id;
  SELECT COUNT(*) INTO v_nb_photos FROM debrief_photos     WHERE event_id = p_event_id;
  SELECT ARRAY_AGG(storage_path) INTO v_paths FROM debrief_photos WHERE event_id = p_event_id;

  PERFORM set_config('app.deleted_by', COALESCE(p_deleted_by, 'admin'), true);
  PERFORM set_config('app.deletion_reason', btrim(p_reason), true);
  PERFORM set_config('app.allow_closed_delete', 'on', true);
  PERFORM set_config('app.allow_movement_delete', 'on', true);

  DELETE FROM events WHERE event_id = p_event_id;

  RETURN json_build_object(
    'success', true,
    'deleted', json_build_object('event_id', p_event_id, 'event_name', v_event.event_name,
      'event_type', v_event.event_type, 'event_date', v_event.event_date, 'reason', btrim(p_reason)),
    'purged', json_build_object('stock_lines', v_nb_stock, 'agents_rh', v_nb_agents,
      'photos', v_nb_photos, 'storage_paths', COALESCE(v_paths, ARRAY[]::text[])),
    'message', format('Événement "%s" supprimé (motif : %s). %s lignes de stock, %s agents, %s photos effacés.',
      v_event.event_name, btrim(p_reason), v_nb_stock, v_nb_agents, v_nb_photos)
  );
END; $function$;

GRANT EXECUTE ON FUNCTION public.delete_event_complete(uuid, text, text, text) TO authenticated;
