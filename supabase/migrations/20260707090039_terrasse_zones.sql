-- ═══════════════════════════════════════════════════════════════════════════
-- terrasse_zones.sql — Terrasses T2→T5 (modèle sous-zones), match uniquement.
--
-- ⚠ RÉCONCILIATION SCHÉMA RÉEL :
--   • L'espace « Terrasses » existe déjà en service_type='bar' (profil
--     'terrasse'). La contrainte spaces_service_type_check n'autorise PAS
--     'terrasse' → on NE réinsère PAS l'espace avec service_type='terrasse'
--     (violerait le CHECK). On référence l'espace existant.
--   • Sélection PAR MATCH : le drapeau terrasse_zones.active est GLOBAL et ne
--     peut pas porter une activation par match → table de liaison
--     event_terrasse_zones (event_id, terrasse_zone_id).
--   • On NE réécrit PAS link_event_spaces_by_type : la migration 034 exclut
--     déjà les terrasses des séminaires via space_profile() (les séminaires =
--     salon/loge/bar_pub/wine_bar/club uniquement). La réécriture du prompt
--     (service_type = ANY(...)) casserait le lien (service_type ≠ 9 profils).
--   • Résolution token calquée sur get_zone_buvette_stock (session_token=p_token).
-- ═══════════════════════════════════════════════════════════════════════════

-- Catalogue des sous-zones (statique).
CREATE TABLE IF NOT EXISTS terrasse_zones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,           -- 'T2'..'T5'
  label       TEXT NOT NULL,
  location    TEXT,
  active      BOOLEAN DEFAULT true,           -- désactivation catalogue (pas par match)
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE terrasse_zones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stade_all_terrasse_zones ON terrasse_zones;
CREATE POLICY stade_all_terrasse_zones ON terrasse_zones
  FOR ALL TO authenticated USING (is_stade()) WITH CHECK (is_stade());

-- Activation PAR MATCH (le bon modèle : quelles zones ouvertes pour cet event).
CREATE TABLE IF NOT EXISTS event_terrasse_zones (
  event_id         UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  terrasse_zone_id UUID NOT NULL REFERENCES terrasse_zones(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (event_id, terrasse_zone_id)
);
ALTER TABLE event_terrasse_zones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stade_all_event_terrasse_zones ON event_terrasse_zones;
CREATE POLICY stade_all_event_terrasse_zones ON event_terrasse_zones
  FOR ALL TO authenticated USING (is_stade()) WITH CHECK (is_stade());
CREATE INDEX IF NOT EXISTS idx_etz_event ON event_terrasse_zones(event_id);

-- Seed T2→T5 (idempotent).
INSERT INTO terrasse_zones (code, label, location, sort_order) VALUES
  ('T2', 'Terrasse 2', 'Côté tribune principale – aile gauche', 1),
  ('T3', 'Terrasse 3', 'Côté tribune principale – centre',      2),
  ('T4', 'Terrasse 4', 'Côté tribune principale – aile droite', 3),
  ('T5', 'Terrasse 5', 'Côté virage',                           4)
ON CONFLICT (code) DO NOTHING;

-- RPC superviseur : zones ouvertes pour le match résolu par le token.
CREATE OR REPLACE FUNCTION get_terrasse_zones_for_match(p_token TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_event_id UUID;
BEGIN
  SELECT event_id INTO v_event_id
  FROM match_access_sessions
  WHERE session_token = p_token AND is_active = true
  LIMIT 1;

  IF v_event_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Session invalide');
  END IF;

  RETURN json_build_object(
    'success', true,
    'zones', (
      SELECT COALESCE(JSON_AGG(JSON_BUILD_OBJECT(
        'id', tz.id, 'code', tz.code, 'label', tz.label,
        'location', tz.location, 'sort_order', tz.sort_order
      ) ORDER BY tz.sort_order), '[]'::json)
      FROM event_terrasse_zones etz
      JOIN terrasse_zones tz ON tz.id = etz.terrasse_zone_id
      WHERE etz.event_id = v_event_id AND tz.active = true
    )
  );
END; $$;
GRANT EXECUTE ON FUNCTION get_terrasse_zones_for_match(TEXT) TO anon, authenticated;
