-- ═══════════════════════════════════════════════════════════════════════════
-- event_delete_cascade.sql — suppression d'événement fiable
-- Recrée dynamiquement toutes les FK pointant sur events(event_id) :
--   • keg_inventory.event_id + *.last_event_id → ON DELETE SET NULL (survivent)
--   • toutes les autres → ON DELETE CASCADE
-- Idempotent (ne recrée que les contraintes dont la règle diffère).
-- ⚠ Le front NE DOIT PAS utiliser la service_role key (VITE_* = exposée au
--   navigateur). La suppression passe par le client normal + RLS is_stade().
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE r RECORD; want TEXT;
BEGIN
  FOR r IN
    SELECT tc.table_name, tc.constraint_name, kcu.column_name, rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.constraint_schema
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
      AND ccu.table_name = 'events' AND ccu.column_name = 'event_id'
  LOOP
    -- Les fûts et les analytics « dernier événement » survivent → SET NULL.
    IF r.table_name = 'keg_inventory' OR r.column_name = 'last_event_id' THEN
      want := 'SET NULL';
    ELSE
      want := 'CASCADE';
    END IF;

    IF r.delete_rule <> want THEN
      EXECUTE format(
        'ALTER TABLE public.%I DROP CONSTRAINT %I, ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES events(event_id) ON DELETE %s',
        r.table_name, r.constraint_name, r.constraint_name, r.column_name, want);
      RAISE NOTICE 'FK % .% → ON DELETE %', r.table_name, r.column_name, want;
    END IF;
  END LOOP;
END $$;

-- Vérification : toutes les FK event_id doivent être CASCADE (ou SET NULL).
SELECT tc.table_name, kcu.column_name, rc.delete_rule
  FROM information_schema.table_constraints tc
  JOIN information_schema.referential_constraints rc
    ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.constraint_schema
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
 WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
   AND ccu.table_name = 'events' AND ccu.column_name = 'event_id'
 ORDER BY tc.table_name;
