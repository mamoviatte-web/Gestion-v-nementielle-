-- ═══════════════════════════════════════════════════════════════════════════
-- match_access_realtime.sql — Présence live des responsables de zone.
--   Heartbeat (ping_session), déconnexion propre (leave_session), Realtime.
--
-- ⚠ RÉCONCILIATION AVEC LE SCHÉMA RÉEL :
--   • last_active_at EXISTE DÉJÀ sur match_access_sessions (match_access.sql).
--   • session_token est stocké en MINUSCULES (substring(gen_random_uuid()…)).
--     Le prompt matchait `UPPER(TRIM(p_token))` → n'aurait JAMAIS matché.
--     On matche à l'exact (TRIM sans UPPER), comme get_match_session.
--   • ping_session RÉACTIVE la session (is_active=true) : un simple refresh
--     déclenche beforeunload→leave (is_active=false) puis, au rechargement,
--     le ping de montage remet is_active=true → pas de faux « hors ligne ».
--   • Publication supabase_realtime : ajout GARDÉ (erreur si déjà présente),
--     c'est probablement CE qui manquait pour que les abonnements existants
--     (MatchAccessCode, useMatchLiveStatus) reçoivent enfin les événements.
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE match_access_sessions
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS user_agent     TEXT;

-- ── Heartbeat : appelé toutes les ~25 s depuis le client zone ────────────────
CREATE OR REPLACE FUNCTION ping_session(p_token TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE match_access_sessions
     SET last_active_at = now(),
         is_active      = true          -- réactive après un leave (refresh)
   WHERE session_token = TRIM(p_token);
  RETURN FOUND;
END; $$;
GRANT EXECUTE ON FUNCTION ping_session(TEXT) TO anon, authenticated;

-- ── Déconnexion propre : appelée au beforeunload / unmount ───────────────────
CREATE OR REPLACE FUNCTION leave_session(p_token TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE match_access_sessions
     SET is_active      = false,
         last_active_at = now()
   WHERE session_token = TRIM(p_token);
  RETURN FOUND;
END; $$;
GRANT EXECUTE ON FUNCTION leave_session(TEXT) TO anon, authenticated;

-- ── get_match_session : réactive la session + expose le code match ───────────
--    (le code permet le « ← Changer d'espace » côté zone). Redéfinition sûre.
CREATE OR REPLACE FUNCTION get_match_session(p_token TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v JSON;
BEGIN
  UPDATE match_access_sessions
     SET last_active_at = now(), is_active = true
   WHERE session_token = TRIM(p_token);
  SELECT json_build_object(
    'success', true,
    'session_token', mas.session_token,
    'event_id', e.event_id, 'event_name', e.event_name, 'event_date', e.event_date,
    'match_access_code', e.match_access_code,
    'space_id', s.space_id, 'space_name', s.space_name, 'service_type', s.service_type,
    'staff_name', mas.staff_name
  ) INTO v
  FROM match_access_sessions mas
  JOIN events e ON e.event_id = mas.event_id
  JOIN spaces s ON s.space_id = mas.space_id
  WHERE mas.session_token = TRIM(p_token);
  RETURN COALESCE(v, json_build_object('success', false, 'error', 'Session expirée'));
END; $$;
GRANT EXECUTE ON FUNCTION get_match_session(TEXT) TO anon, authenticated;

-- ── Index de présence ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_mas_event_active
  ON match_access_sessions (event_id, is_active, last_active_at DESC);

-- ── Realtime : replica identity complète + ajout à la publication ────────────
ALTER TABLE match_access_sessions REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename  = 'match_access_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE match_access_sessions;
  END IF;
EXCEPTION
  WHEN undefined_object THEN NULL;  -- publication absente (env local) → ignoré
END $$;
