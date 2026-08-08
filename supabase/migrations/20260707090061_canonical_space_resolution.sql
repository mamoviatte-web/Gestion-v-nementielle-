-- Robustesse espaces : résolution canonique systématique (BLOC 1 + prévention).
-- Un responsable connecté sur un espace « doublon » (ex. « Buvette 1 » alias de
-- « B1 ») doit toujours voir les bonnes données (stock, dotations, roadmap,
-- planning, débrief, RH). La règle : ne jamais requêter avec l'espace de session
-- brut ; toujours passer par l'espace CANONIQUE (zone_canonical_space).
--
-- Approche : résoudre le canonique aux DEUX points d'entrée serveur, ce qui
-- corrige d'un coup toutes les fonctions zone et l'objet session côté front —
-- sans devoir modifier chaque requête. Couvre tous les espaces actuels ET futurs
-- (motif « Buvette N → BN » automatique + space_canonical_map pour noms libres).

-- ── 1) _zone_resolve : renvoie désormais l'espace CANONIQUE ───────────────────
-- Utilisé par get_zone_stock / get_zone_roadmap / get_zone_status /
-- get_zone_schedule / save_zone_stock / save_zone_schedule / save_zone_debrief.
-- Tous scopent sur v_space : en renvoyant le canonique ici, ils sont tous
-- corrigés uniformément (y compris toute future fonction zone_* qui l'utilisera).
CREATE OR REPLACE FUNCTION _zone_resolve(
  p_token text,
  OUT v_event uuid,
  OUT v_space uuid,
  OUT v_staff text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT event_id, zone_canonical_space(space_id), staff_name
  FROM match_access_sessions
  WHERE session_token = p_token AND is_active = true
  LIMIT 1;
$$;

-- ── 2) get_match_session : l'objet session du front porte le space_id CANONIQUE ─
-- Toutes les requêtes directes du front (PhotoGallery, navigation, filtres
-- éventuels) lisent session.space_id → elles deviennent correctes sans changement.
-- On expose aussi session_space_id (brut) + is_alias pour information/diagnostic.
-- Le libellé affiché reste le nom de session (ce que le responsable attend),
-- le service_type provient du canonique (pilote le référentiel/UI).
CREATE OR REPLACE FUNCTION get_match_session(p_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v json;
  v_raw uuid;
  v_canon uuid;
BEGIN
  UPDATE match_access_sessions
     SET last_active_at = now(), is_active = true
   WHERE session_token = TRIM(p_token);

  SELECT mas.space_id INTO v_raw
    FROM match_access_sessions mas
   WHERE mas.session_token = TRIM(p_token);

  IF v_raw IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Session expirée');
  END IF;

  v_canon := zone_canonical_space(v_raw);

  SELECT json_build_object(
    'success', true,
    'session_token', mas.session_token,
    'event_id', e.event_id, 'event_name', e.event_name, 'event_date', e.event_date,
    'match_access_code', e.match_access_code,
    -- space_id = CANONIQUE : point d'appui de toutes les données
    'space_id', v_canon,
    -- nom affiché : celui de la session (familier au responsable)
    'space_name', ss.space_name,
    -- service_type : celui du canonique (référentiel/comportement UI)
    'service_type', sc.service_type,
    'session_space_id', v_raw,
    'is_alias', (v_canon <> v_raw),
    'staff_name', mas.staff_name
  ) INTO v
  FROM match_access_sessions mas
  JOIN events e ON e.event_id = mas.event_id
  JOIN spaces ss ON ss.space_id = mas.space_id
  JOIN spaces sc ON sc.space_id = v_canon
  WHERE mas.session_token = TRIM(p_token);

  RETURN COALESCE(v, json_build_object('success', false, 'error', 'Session expirée'));
END;
$$;

-- ── 3) Prévention : ne jamais attacher un doublon à un événement ───────────────
-- Trigger BEFORE INSERT sur event_spaces : tout space_id doublon est remplacé par
-- son canonique avant insertion. Si le canonique est déjà attaché à l'événement,
-- l'insertion du doublon est ignorée silencieusement (RETURN NULL) pour respecter
-- UNIQUE(event_id, space_id). Couvre TOUS les chemins d'ajout (front, admin,
-- imports, futurs) — bien plus robuste qu'un garde-fou côté client.
CREATE OR REPLACE FUNCTION trg_event_spaces_canonical()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canon uuid;
BEGIN
  v_canon := zone_canonical_space(NEW.space_id);
  IF v_canon IS DISTINCT FROM NEW.space_id THEN
    -- Le canonique est-il déjà rattaché à cet événement ?
    IF EXISTS (
      SELECT 1 FROM event_spaces es
      WHERE es.event_id = NEW.event_id AND es.space_id = v_canon
    ) THEN
      RETURN NULL; -- doublon inutile : on ignore l'insertion
    END IF;
    NEW.space_id := v_canon; -- on rattache le canonique à la place du doublon
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS event_spaces_canonical ON event_spaces;
CREATE TRIGGER event_spaces_canonical
  BEFORE INSERT ON event_spaces
  FOR EACH ROW
  EXECUTE FUNCTION trg_event_spaces_canonical();

-- ── 4) Grants (RG-003 : ces fonctions n'exposent aucun coût) ──────────────────
-- CREATE OR REPLACE préserve les ACL existantes des fonctions ; le trigger
-- s'exécute en SECURITY DEFINER et n'a pas besoin de grant public.
