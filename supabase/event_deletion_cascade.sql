-- ═══════════════════════════════════════════════════════════════════════════
-- event_deletion_cascade.sql — suppression totale d'un événement + recalcul.
--   BLOC 2 — ON DELETE CASCADE sur TOUTES les FK → events (dynamique)
--   BLOC 3 — log de suppression + triggers before/after
--   BLOC 4 — delete_event_complete()
--
-- ⚠ ADAPTATIONS AU SCHÉMA RÉEL :
--   • events n'a PAS pax_count → expected_attendees.
--   • Bloc CASCADE DYNAMIQUE : on ne code pas en dur une liste de tables (les
--     ALTER sur zone_roadmaps / event_planning_phases échoueraient tant que
--     leurs migrations ne sont pas passées, et la liste du prompt oubliait
--     seminar_report_draft / event_attachments / runner_dotations /
--     provider_presence). On parcourt pg_constraint et on ne recrée que les FK
--     non-CASCADE existantes → complet, idempotent, sans erreur.
--   • deleted_by transmis via GUC de transaction (pas d'UPDATE ... ORDER BY
--     LIMIT, syntaxe invalide en Postgres).
--   • delete_event_complete garde is_stade() (SECURITY DEFINER ne doit pas
--     laisser un responsable supprimer un événement).
--   • compute_space_coefficients() : fonction existante (space_coefficients.sql).
-- ═══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════
-- BLOC 2 — ON DELETE CASCADE sur toutes les FK référençant events (dynamique)
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname,
           ns.nspname   AS schema_name,
           cl.relname   AS child_table,
           att.attname  AS fk_col
    FROM pg_constraint con
    JOIN pg_class cl      ON cl.oid = con.conrelid
    JOIN pg_namespace ns  ON ns.oid = cl.relnamespace
    JOIN pg_class rf      ON rf.oid = con.confrelid
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND rf.relname = 'events'
      AND array_length(con.conkey, 1) = 1
      AND con.confdeltype <> 'c'          -- 'c' = CASCADE : on ignore ce qui est déjà bon
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', r.schema_name, r.child_table, r.conname);
    EXECUTE format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES events(event_id) ON DELETE CASCADE',
      r.schema_name, r.child_table, r.conname, r.fk_col
    );
    RAISE NOTICE 'FK % sur %.% → ON DELETE CASCADE', r.conname, r.schema_name, r.child_table;
  END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════
-- BLOC 3 — Journal de suppression + triggers
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS event_deletion_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL,
  event_name      TEXT NOT NULL,
  event_type      TEXT,
  event_date      DATE,
  pax_count       INT,
  deleted_at      TIMESTAMPTZ DEFAULT now(),
  deleted_by      TEXT,
  nb_stock_lines  INT,
  nb_agents       INT,
  nb_photos       INT,
  total_fb_cost   DECIMAL(10,2),
  storage_paths   TEXT[],
  recalculated_at TIMESTAMPTZ
);
ALTER TABLE event_deletion_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stade_read_deletion_log ON event_deletion_log;
CREATE POLICY stade_read_deletion_log ON event_deletion_log
  FOR SELECT TO authenticated USING (is_stade());

-- BEFORE DELETE : snapshot des données liées (avant que les CASCADE effacent).
CREATE OR REPLACE FUNCTION before_event_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_nb_stock  INT;
  v_nb_agents INT;
  v_nb_photos INT;
  v_paths     TEXT[];
BEGIN
  SELECT COUNT(*) INTO v_nb_stock  FROM event_stock_lines  WHERE event_id = OLD.event_id;
  SELECT COUNT(*) INTO v_nb_agents FROM zone_staff_hours    WHERE event_id = OLD.event_id;
  SELECT COUNT(*) INTO v_nb_photos FROM debrief_photos      WHERE event_id = OLD.event_id;
  SELECT ARRAY_AGG(storage_path) INTO v_paths FROM debrief_photos WHERE event_id = OLD.event_id;

  INSERT INTO event_deletion_log (
    event_id, event_name, event_type, event_date, pax_count,
    deleted_by, nb_stock_lines, nb_agents, nb_photos, total_fb_cost, storage_paths
  ) VALUES (
    OLD.event_id, OLD.event_name, OLD.event_type, OLD.event_date::date, OLD.expected_attendees,
    NULLIF(current_setting('app.deleted_by', true), ''),
    v_nb_stock, v_nb_agents, v_nb_photos, OLD.total_fb_cost_ht, v_paths
  );

  PERFORM pg_notify('event_deleted', json_build_object(
    'event_id', OLD.event_id, 'event_name', OLD.event_name, 'storage_paths', v_paths
  )::text);

  RETURN OLD;
END; $$;
DROP TRIGGER IF EXISTS trg_before_event_delete ON events;
CREATE TRIGGER trg_before_event_delete BEFORE DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION before_event_delete();

-- AFTER DELETE : recalcul des coefficients sur les événements restants.
CREATE OR REPLACE FUNCTION after_event_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM compute_space_coefficients();
  UPDATE event_deletion_log
     SET recalculated_at = now()
   WHERE event_id = OLD.event_id AND recalculated_at IS NULL;
  RETURN OLD;
END; $$;
DROP TRIGGER IF EXISTS trg_after_event_delete ON events;
CREATE TRIGGER trg_after_event_delete AFTER DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION after_event_delete();

-- ══════════════════════════════════════════════════════════════════════════
-- BLOC 4 — delete_event_complete()
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION delete_event_complete(
  p_event_id   UUID,
  p_confirm    TEXT,
  p_deleted_by TEXT DEFAULT 'admin'
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_event     events%ROWTYPE;
  v_nb_stock  INT;
  v_nb_agents INT;
  v_nb_photos INT;
  v_paths     TEXT[];
BEGIN
  IF NOT is_stade() THEN
    RETURN json_build_object('success', false, 'error', 'Action réservée à l''équipe stade');
  END IF;
  IF p_confirm <> 'CONFIRMER' THEN
    RETURN json_build_object('success', false, 'error', 'Confirmation manquante (p_confirm = ''CONFIRMER'').');
  END IF;

  SELECT * INTO v_event FROM events WHERE event_id = p_event_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Événement non trouvé');
  END IF;

  SELECT COUNT(*) INTO v_nb_stock  FROM event_stock_lines WHERE event_id = p_event_id;
  SELECT COUNT(*) INTO v_nb_agents FROM zone_staff_hours   WHERE event_id = p_event_id;
  SELECT COUNT(*) INTO v_nb_photos FROM debrief_photos     WHERE event_id = p_event_id;
  SELECT ARRAY_AGG(storage_path) INTO v_paths FROM debrief_photos WHERE event_id = p_event_id;

  -- Transmet deleted_by au trigger BEFORE (GUC local à la transaction).
  PERFORM set_config('app.deleted_by', COALESCE(p_deleted_by, 'admin'), true);

  DELETE FROM events WHERE event_id = p_event_id;  -- CASCADE + triggers

  RETURN json_build_object(
    'success', true,
    'deleted', json_build_object(
      'event_id', p_event_id, 'event_name', v_event.event_name,
      'event_type', v_event.event_type, 'event_date', v_event.event_date
    ),
    'purged', json_build_object(
      'stock_lines', v_nb_stock, 'agents_rh', v_nb_agents,
      'photos', v_nb_photos, 'storage_paths', COALESCE(v_paths, ARRAY[]::text[])
    ),
    'recalculated', json_build_object('coefficients', true, 'analytics', true),
    'message', format(
      'Événement "%s" supprimé. %s lignes de stock, %s agents, %s photos effacés. Coefficients recalculés.',
      v_event.event_name, v_nb_stock, v_nb_agents, v_nb_photos
    )
  );
END; $$;
GRANT EXECUTE ON FUNCTION delete_event_complete(UUID, TEXT, TEXT) TO authenticated;
