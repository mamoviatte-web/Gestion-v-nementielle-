-- Bundle migrations 033 → 046. SQL Editor → Run. Idempotent.
BEGIN;

-- ── 20260707090033_zone_roadmaps.sql ──
-- ═══════════════════════════════════════════════════════════════════════════
-- zone_roadmaps.sql — Feuille de route par espace (brief) : admin remplit,
-- responsable lit. Pré-initialisée à la création du match → jamais de page vide.
--
-- ⚠ Adaptations : get_zone_roadmap EXISTE déjà (dotations runner + horaires) →
--   on l'ÉTEND avec le brief (sans casser MatchZoneRoadmap). RLS is_stade() ;
--   pax = events.expected_attendees (pas pax_count) ; résolution via
--   _zone_resolve (token exact). Le brief n'est renvoyé au responsable que si
--   is_published = true (brouillon masqué).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS zone_roadmaps (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  space_id       UUID NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
  brief_client   TEXT,
  brief_consigne TEXT,
  brief_dress    TEXT,
  brief_horaires TEXT,
  nb_pax_espace  INT,
  dotations      JSONB,
  info_contact   TEXT,
  info_acces     TEXT,
  info_materiel  TEXT,
  is_published   BOOLEAN DEFAULT false,
  published_at   TIMESTAMPTZ,
  published_by   TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (event_id, space_id)
);
ALTER TABLE zone_roadmaps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stade_all_roadmaps ON zone_roadmaps;
CREATE POLICY stade_all_roadmaps ON zone_roadmaps
  FOR ALL TO authenticated USING (is_stade()) WITH CHECK (is_stade());
CREATE INDEX IF NOT EXISTS idx_roadmaps_event_space ON zone_roadmaps(event_id, space_id);

CREATE OR REPLACE FUNCTION set_roadmap_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_roadmap_updated ON zone_roadmaps;
CREATE TRIGGER trg_roadmap_updated BEFORE UPDATE ON zone_roadmaps
  FOR EACH ROW EXECUTE FUNCTION set_roadmap_updated_at();

-- ── Auto-création : une feuille par espace lié ──────────────────────────────
CREATE OR REPLACE FUNCTION init_event_roadmaps(p_event_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_count INT := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM events WHERE event_id = p_event_id) THEN
    RETURN json_build_object('success', false, 'error', 'Événement non trouvé');
  END IF;
  INSERT INTO zone_roadmaps (event_id, space_id, is_published)
  SELECT p_event_id, es.space_id, false
  FROM event_spaces es JOIN spaces s ON s.space_id = es.space_id
  WHERE es.event_id = p_event_id AND s.active = true
  ON CONFLICT (event_id, space_id) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN json_build_object('success', true, 'created', v_count);
END; $$;
GRANT EXECUTE ON FUNCTION init_event_roadmaps(UUID) TO authenticated;

-- Backfill de tous les événements non archivés.
DO $$
DECLARE v_id UUID;
BEGIN
  FOR v_id IN SELECT event_id FROM events WHERE status <> 'archivé' LOOP
    PERFORM init_event_roadmaps(v_id);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION auto_init_roadmaps()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_TABLE_NAME = 'events' THEN
    PERFORM init_event_roadmaps(NEW.event_id);           -- matchs ET séminaires
  ELSIF TG_TABLE_NAME = 'event_spaces' THEN
    INSERT INTO zone_roadmaps (event_id, space_id, is_published)
    VALUES (NEW.event_id, NEW.space_id, false)
    ON CONFLICT (event_id, space_id) DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_auto_roadmaps_events ON events;
CREATE TRIGGER trg_auto_roadmaps_events AFTER INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION auto_init_roadmaps();
DROP TRIGGER IF EXISTS trg_auto_roadmaps_spaces ON event_spaces;
CREATE TRIGGER trg_auto_roadmaps_spaces AFTER INSERT ON event_spaces
  FOR EACH ROW EXECUTE FUNCTION auto_init_roadmaps();

-- ── get_zone_roadmap ÉTENDU : dotations runner + horaires + BRIEF ───────────
CREATE OR REPLACE FUNCTION get_zone_roadmap(p_token text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_e UUID; v_s UUID; v_n TEXT; v_prof TEXT;
        v_ev events%ROWTYPE; v_sp spaces%ROWTYPE; v_rm zone_roadmaps%ROWTYPE; v_pub BOOLEAN;
BEGIN
  SELECT * INTO v_e, v_s, v_n FROM _zone_resolve(p_token);
  IF v_e IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session expirée'); END IF;
  v_prof := space_profile(v_n);
  SELECT * INTO v_ev FROM events WHERE event_id = v_e;
  SELECT * INTO v_sp FROM spaces WHERE space_id = v_s;

  SELECT * INTO v_rm FROM zone_roadmaps WHERE event_id = v_e AND space_id = v_s;
  IF NOT FOUND THEN
    INSERT INTO zone_roadmaps (event_id, space_id, is_published) VALUES (v_e, v_s, false)
    ON CONFLICT (event_id, space_id) DO NOTHING;
    SELECT * INTO v_rm FROM zone_roadmaps WHERE event_id = v_e AND space_id = v_s;
  END IF;
  v_pub := COALESCE(v_rm.is_published, false);  -- brief masqué tant que non publié

  RETURN json_build_object(
    'success', true,
    'event_name', v_ev.event_name, 'event_date', v_ev.event_date, 'start_time', v_ev.start_time,
    'pax_count', v_ev.expected_attendees,
    'space_name', v_sp.space_name, 'service_type', v_sp.service_type,
    'is_published', v_pub,
    'brief_client',   CASE WHEN v_pub THEN v_rm.brief_client   END,
    'brief_consigne', CASE WHEN v_pub THEN v_rm.brief_consigne END,
    'brief_dress',    CASE WHEN v_pub THEN v_rm.brief_dress    END,
    'brief_horaires', CASE WHEN v_pub THEN v_rm.brief_horaires END,
    'nb_pax_espace',  CASE WHEN v_pub THEN v_rm.nb_pax_espace  END,
    'brief_dotations', CASE WHEN v_pub THEN COALESCE(v_rm.dotations, '[]'::jsonb) ELSE '[]'::jsonb END,
    'info_contact',  CASE WHEN v_pub THEN v_rm.info_contact  END,
    'info_acces',    CASE WHEN v_pub THEN v_rm.info_acces    END,
    'info_materiel', CASE WHEN v_pub THEN v_rm.info_materiel END,
    'published_by',  CASE WHEN v_pub THEN v_rm.published_by  END,
    'published_at',  CASE WHEN v_pub THEN v_rm.published_at  END,
    'dotations', (
      SELECT COALESCE(json_agg(json_build_object(
        'product_name', p.product_name, 'category', p.category, 'unit', p.unit,
        'planned_qty', rd.planned_qty, 'runner_status', rd.runner_status
      ) ORDER BY p.category, p.product_name), '[]'::json)
      FROM runner_dotations rd JOIN products p ON p.product_id = rd.product_id
      WHERE rd.event_id = v_e AND rd.space_id = v_s
        AND (v_prof = ANY(p.space_types) OR p.space_types IS NULL OR p.space_types = '{}')),
    'schedules', (
      SELECT COALESCE(json_agg(json_build_object(
        'staff_name', sc.staff_name, 'role', sc.role,
        'planned_arrival', sc.planned_arrival, 'planned_departure', sc.planned_departure
      ) ORDER BY sc.planned_arrival), '[]'::json)
      FROM schedules sc WHERE sc.event_id = v_e AND sc.space_id = v_s)
  );
END; $$;
GRANT EXECUTE ON FUNCTION get_zone_roadmap(TEXT) TO anon, authenticated;

-- ── 20260707090034_space_specificity_dashboard.sql ──
-- ═══════════════════════════════════════════════════════════════════════════
-- space_specificity_dashboard.sql
--   BLOC 1 — Spécificité espaces par type d'événement (séminaire vs match)
--   BLOC 2 — Vues du tableau de bord Stadium Manager (KPIs + espaces VIP live)
--
-- ⚠ ADAPTATIONS AU SCHÉMA RÉEL (vérifié en prod) :
--   • spaces.service_type ne vaut que {vip,bar,buvette,bodega} — PAS les 9
--     profils. La distinction fine (salon/loge/bar_pub/wine_bar/club/…) vient
--     de la fonction space_profile(space_name). → on filtre par space_profile().
--   • event_type = 'séminaire' (accentué) ; le discriminant fiable est
--     event_type = 'match' (tout le reste = premium intérieur).
--   • events n'a PAS pax_count → expected_attendees ; coûts = total_fb_cost_ht.
--   • match_access_sessions : id / staff_name / last_active_at / is_active OK.
--   • PAS de trigger auto-link sur events : l'app insère elle-même event_spaces
--     à la création (matchs = tous actifs, séminaires = premium). Un trigger
--     AFTER INSERT provoquerait des violations UNIQUE. La règle est appliquée
--     côté app (useEventCreation) + backfill ci-dessous + fonction réutilisable.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Profils premium intérieurs (séminaires + activité dashboard) ────────────
--   salon, loge, bar_pub, wine_bar, club  (exclut terrasse, bodega, pmr, buvette)

-- ══════════════════════════════════════════════════════════════════════════
-- BLOC 1 — Fonction : lier les bons espaces selon le type d'événement
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION link_event_spaces_by_type(p_event_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_event  events%ROWTYPE;
  v_count  INT := 0;
  v_types  TEXT[];
BEGIN
  SELECT * INTO v_event FROM events WHERE event_id = p_event_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Événement non trouvé');
  END IF;

  IF v_event.event_type = 'match' THEN
    -- Match : tous les espaces (VIP + bars + terrasses + buvettes + bodega).
    v_types := ARRAY['salon','loge','bar_pub','wine_bar','club',
                     'pmr','bodega','terrasse','buvette'];
  ELSE
    -- Séminaire (et types apparentés) : premium intérieur uniquement.
    v_types := ARRAY['salon','loge','bar_pub','wine_bar','club'];
  END IF;

  INSERT INTO event_spaces (event_id, space_id)
  SELECT p_event_id, s.space_id
  FROM spaces s
  WHERE s.active = true
    AND space_profile(s.space_name) = ANY(v_types)
    -- Exclure les anciens espaces parasites (buvettes historiques, parvis).
    AND s.space_name NOT IN (
      'Buvette Virage Toinou', 'Buvette Virage Ouest',
      'Buvette Virage Sud Ouest', 'Buvette Nord Ouest',
      'Buvette Nord Est', 'Buvette Est Galice',
      'Buvette Est Pagnol', 'Buvette Sud Est',
      'Buvette Sud Ouest', 'Parvis Nord'
    )
  ON CONFLICT (event_id, space_id) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Initialiser les feuilles de route (si le module roadmaps est déployé).
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'init_event_roadmaps') THEN
    PERFORM init_event_roadmaps(p_event_id);
  END IF;

  RETURN json_build_object(
    'success',       true,
    'event_type',    v_event.event_type,
    'space_types',   v_types,
    'spaces_linked', v_count
  );
END;
$$;
GRANT EXECUTE ON FUNCTION link_event_spaces_by_type(UUID) TO authenticated;

-- ── Backfill : uniquement les événements SANS aucun espace lié ──────────────
--   (on ne touche pas aux événements déjà configurés par l'app).
SELECT link_event_spaces_by_type(event_id)
FROM events
WHERE status <> 'archivé'
  AND event_id NOT IN (SELECT DISTINCT event_id FROM event_spaces);

-- ── Vérification : les séminaires n'ont pas de buvettes ─────────────────────
--   Attendu : nb_buvettes = 0 pour tout event_type <> 'match'.
--   SELECT e.event_name, e.event_type,
--     COUNT(*) FILTER (WHERE space_profile(s.space_name) = 'buvette') AS nb_buvettes,
--     COUNT(*) FILTER (WHERE space_profile(s.space_name) = 'salon')   AS nb_salons,
--     COUNT(*) AS total
--   FROM events e
--   JOIN event_spaces es ON es.event_id = e.event_id
--   JOIN spaces s ON s.space_id = es.space_id
--   GROUP BY e.event_id, e.event_name, e.event_type
--   ORDER BY e.event_type, e.event_name;

-- ══════════════════════════════════════════════════════════════════════════
-- BLOC 2 — Vues du tableau de bord
-- ══════════════════════════════════════════════════════════════════════════

-- Espaces VIP (premium intérieur) en direct — pas de buvettes/terrasses.
CREATE OR REPLACE VIEW dashboard_vip_spaces_status AS
SELECT
  e.event_id,
  e.event_name,
  e.event_type,
  e.status,
  e.event_date,
  s.space_id,
  s.space_name,
  s.service_type,
  space_profile(s.space_name) AS space_profile,
  CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM event_stock_lines esl
      WHERE esl.event_id = e.event_id AND esl.space_id = s.space_id
    ) THEN 'en_attente'
    WHEN EXISTS (
      SELECT 1 FROM event_stock_lines esl
      WHERE esl.event_id = e.event_id AND esl.space_id = s.space_id
        AND esl.final_qty IS NOT NULL
    ) THEN 'cloture'
    WHEN EXISTS (
      SELECT 1 FROM event_stock_lines esl
      WHERE esl.event_id = e.event_id AND esl.space_id = s.space_id
        AND esl.initial_qty > 0
    ) THEN 'en_cours'
    ELSE 'en_attente'
  END AS stock_status,
  MAX(mas.staff_name)      AS responsable,
  MAX(mas.last_active_at)  AS derniere_activite,
  COUNT(DISTINCT mas.id)   AS nb_sessions
FROM events e
JOIN event_spaces es ON es.event_id = e.event_id
JOIN spaces s        ON s.space_id  = es.space_id
LEFT JOIN match_access_sessions mas
       ON mas.event_id = e.event_id AND mas.space_id = s.space_id
      AND mas.is_active = true
WHERE e.status IN ('en_cours', 'préparé')
  AND s.active = true
  AND space_profile(s.space_name) IN ('salon','loge','bar_pub','wine_bar','club')
GROUP BY e.event_id, e.event_name, e.event_type, e.status,
         e.event_date, s.space_id, s.space_name, s.service_type
ORDER BY e.event_date DESC, s.space_name;

-- KPIs globaux (colonnes réelles : total_fb_cost_ht, expected_attendees).
CREATE OR REPLACE VIEW dashboard_kpis AS
SELECT
  COUNT(*) FILTER (WHERE status <> 'archivé')                       AS total_evenements,
  COUNT(*) FILTER (WHERE status = 'en_cours')                       AS en_cours,
  -- Bornes HAUTES obligatoires : event_date est une DATE (aucun fuseau). Sans
  -- borne supérieure, un match du mois/année suivant était compté « ce mois ».
  COUNT(*) FILTER (WHERE event_type = 'match'
    AND event_date >= DATE_TRUNC('month', CURRENT_DATE)::date
    AND event_date <  (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month')::date) AS matchs_ce_mois,
  COALESCE(SUM(total_fb_cost_ht) FILTER (
    WHERE status IN ('clôturé','archivé')
      AND event_date >= DATE_TRUNC('year', CURRENT_DATE)::date
      AND event_date <  (DATE_TRUNC('year', CURRENT_DATE) + INTERVAL '1 year')::date), 0) AS fb_annuel_ht,
  COUNT(*) FILTER (WHERE status IN ('clôturé','archivé')
    AND event_date >= DATE_TRUNC('year', CURRENT_DATE)::date
    AND event_date <  (DATE_TRUNC('year', CURRENT_DATE) + INTERVAL '1 year')::date) AS clotures_annee
FROM events;

-- RG-003 : ces vues portent des coûts → réservées à l'admin authentifié.
ALTER VIEW dashboard_vip_spaces_status SET (security_invoker = on);
ALTER VIEW dashboard_kpis              SET (security_invoker = on);
GRANT SELECT ON dashboard_vip_spaces_status, dashboard_kpis TO authenticated;
REVOKE SELECT ON dashboard_vip_spaces_status, dashboard_kpis FROM anon;

-- ── 20260707090035_match_closed_summary.sql ──
-- ═══════════════════════════════════════════════════════════════════════════
-- match_closed_summary.sql — bilan post-match par espace (matchs clôturés).
--
-- ⚠ ADAPTATIONS AU SCHÉMA RÉEL :
--   • events n'a PAS pax_count → expected_attendees.
--   • debriefs n'a PAS global_rating → overall_rating ; submitted_at OK.
--   • spaces.service_type ne vaut que {vip,bar,buvette,bodega} : le tri fin et
--     la séparation VIP/buvette se font via space_profile(space_name).
--   • zone_staff_hours : id / hours_worked / rh_cost / confirmed_by_staff /
--     confirmed_by_manager existent bien.
--   • Agrégats stock / RH calculés en LATERAL séparés → PAS de fan-out
--     (sinon SUM(rh_cost) et SUM(coût F&B) seraient multipliés entre eux).
--   • RG-003 : la vue porte unit_price_ht/coûts → réservée à l'admin
--     (security_invoker + REVOKE anon).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW match_closed_summary AS
SELECT
  e.event_id,
  e.event_name,
  e.event_type,
  e.event_date,
  e.expected_attendees,
  e.total_fb_cost_ht,
  e.total_rh_cost,
  e.total_event_cost,
  s.space_id,
  s.space_name,
  s.service_type,
  space_profile(s.space_name)                        AS space_profile,

  st.produits_saisis,
  st.produits_clotures,
  st.cout_fb_espace,

  rh.nb_agents_declares,
  rh.heures_travaillees,
  rh.cout_rh_espace,
  rh.agents_confirmes,

  (SELECT d.overall_rating FROM debriefs d
   WHERE d.event_id = e.event_id AND d.space_id = s.space_id LIMIT 1)  AS debrief_note,
  (SELECT d.submitted_at FROM debriefs d
   WHERE d.event_id = e.event_id AND d.space_id = s.space_id LIMIT 1)  AS debrief_soumis_le,

  CASE
    WHEN st.produits_saisis = 0            THEN 'aucun_stock'
    WHEN st.produits_clotures = 0          THEN 'ouverture_seule'
    WHEN st.produits_non_clotures > 0      THEN 'cloture_partielle'
    ELSE 'complet'
  END                                                AS statut_espace,

  (SELECT MAX(mas.staff_name) FROM match_access_sessions mas
   WHERE mas.event_id = e.event_id AND mas.space_id = s.space_id)      AS responsable

FROM events e
JOIN event_spaces es ON es.event_id = e.event_id
JOIN spaces       s  ON s.space_id  = es.space_id

-- Agrégat STOCK (une seule fois par espace, sans fan-out RH).
LEFT JOIN LATERAL (
  SELECT
    COUNT(esl.line_id) FILTER (WHERE esl.initial_qty > 0)          AS produits_saisis,
    COUNT(esl.line_id) FILTER (WHERE esl.final_qty IS NOT NULL)    AS produits_clotures,
    COUNT(esl.line_id) FILTER (WHERE esl.initial_qty > 0 AND esl.final_qty IS NULL)
                                                                   AS produits_non_clotures,
    COALESCE(SUM(
      (esl.initial_qty + COALESCE(esl.reassort_qty, 0) - COALESCE(esl.final_qty, 0))
      * p.unit_price_ht
    ) FILTER (WHERE esl.final_qty IS NOT NULL AND p.unit_price_ht > 0), 0) AS cout_fb_espace
  FROM event_stock_lines esl
  LEFT JOIN products p ON p.product_id = esl.product_id
  WHERE esl.event_id = e.event_id AND esl.space_id = s.space_id
) st ON true

-- Agrégat RH (une seule fois par espace, sans fan-out stock).
LEFT JOIN LATERAL (
  SELECT
    COUNT(zsh.id)                                          AS nb_agents_declares,
    COALESCE(SUM(zsh.hours_worked), 0)                     AS heures_travaillees,
    COALESCE(SUM(zsh.rh_cost), 0)                          AS cout_rh_espace,
    COUNT(zsh.id) FILTER (WHERE zsh.confirmed_by_staff AND zsh.confirmed_by_manager)
                                                           AS agents_confirmes
  FROM zone_staff_hours zsh
  WHERE zsh.event_id = e.event_id AND zsh.space_id = s.space_id
) rh ON true

WHERE e.event_type = 'match'
  AND e.status IN ('clôturé', 'archivé')
  AND s.active = true

ORDER BY
  CASE space_profile(s.space_name)
    WHEN 'salon' THEN 1 WHEN 'loge' THEN 2 WHEN 'bar_pub' THEN 3
    WHEN 'wine_bar' THEN 4 WHEN 'club' THEN 5 WHEN 'pmr' THEN 6
    WHEN 'bodega' THEN 7 WHEN 'terrasse' THEN 8 WHEN 'buvette' THEN 9 ELSE 10
  END,
  s.space_name;

ALTER VIEW match_closed_summary SET (security_invoker = on);
GRANT SELECT ON match_closed_summary TO authenticated;
REVOKE SELECT ON match_closed_summary FROM anon;

-- ── 20260707090036_event_planning_phases.sql ──
-- ═══════════════════════════════════════════════════════════════════════════
-- event_planning_phases.sql — planning hebdomadaire dynamique (remplace l'Excel).
--   BLOC 1 — table des phases opérationnelles + auto-création + backfill
--   BLOC 2 — vue weekly_planning (auto-alimentée par les événements)
--
-- ⚠ ADAPTATIONS AU SCHÉMA RÉEL :
--   • events n'a PAS pax_count → expected_attendees (aliasé pax_count dans la vue).
--   • event_type = 'séminaire' (accentué) ; couleur = match vs non-match.
--   • zone_staff_hours n'a PAS agent_role → colonne `role` ; le régisseur vient
--     de events.regisseur_name (fiable), pas d'un rôle RH.
--   • RLS via is_stade() (helper existant), pas via auth.jwt() brut.
--   • Index unique partiel + NOT EXISTS → auto-création idempotente.
--   • RG-003 : weekly_planning porte des coûts → admin only.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS event_planning_phases (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  space_id     UUID REFERENCES spaces(space_id) ON DELETE SET NULL,
  phase_type   TEXT NOT NULL CHECK (phase_type IN (
    'mise_en_place', 'evenement', 'demontage', 'ilot', 'autre'
  )),
  phase_date   DATE NOT NULL,
  start_time   TIME,
  end_time     TIME,
  label        TEXT,
  detail       TEXT,
  nb_personnes INT DEFAULT 0,
  regisseur    TEXT,
  is_validated BOOLEAN DEFAULT false,
  color        TEXT DEFAULT '#1A1A2E',
  created_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE event_planning_phases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stade_all_phases ON event_planning_phases;
CREATE POLICY stade_all_phases ON event_planning_phases
  FOR ALL TO authenticated USING (is_stade()) WITH CHECK (is_stade());

CREATE INDEX IF NOT EXISTS idx_phases_date  ON event_planning_phases(phase_date);
CREATE INDEX IF NOT EXISTS idx_phases_event ON event_planning_phases(event_id);
-- Une seule phase auto « evenement » par événement (idempotence trigger/backfill).
CREATE UNIQUE INDEX IF NOT EXISTS idx_phases_event_evenement
  ON event_planning_phases(event_id) WHERE phase_type = 'evenement';

-- Auto-création de la phase « evenement » à la création d'un événement.
CREATE OR REPLACE FUNCTION auto_create_event_phases()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO event_planning_phases (event_id, phase_type, phase_date, start_time, label, color)
  VALUES (
    NEW.event_id, 'evenement', NEW.event_date::date, NEW.start_time, NEW.event_name,
    CASE WHEN NEW.event_type = 'match' THEN '#1A1A2E' ELSE '#2563EB' END
  )
  ON CONFLICT (event_id) WHERE phase_type = 'evenement' DO NOTHING;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_auto_phases ON events;
CREATE TRIGGER trg_auto_phases AFTER INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION auto_create_event_phases();

-- Backfill des événements existants (non archivés), idempotent.
INSERT INTO event_planning_phases (event_id, phase_type, phase_date, start_time, label, color)
SELECT e.event_id, 'evenement', e.event_date::date, e.start_time, e.event_name,
       CASE WHEN e.event_type = 'match' THEN '#1A1A2E' ELSE '#2563EB' END
FROM events e
WHERE e.status <> 'archivé'
  AND NOT EXISTS (
    SELECT 1 FROM event_planning_phases p
    WHERE p.event_id = e.event_id AND p.phase_type = 'evenement'
  );

-- ══════════════════════════════════════════════════════════════════════════
-- BLOC 2 — Vue planning hebdomadaire
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW weekly_planning AS
SELECT
  e.event_id,
  e.event_name,
  e.event_type,
  e.status,
  e.expected_attendees                          AS pax_count,
  e.event_date::date                            AS event_day,
  EXTRACT(DOW FROM e.event_date)                AS day_of_week,
  TO_CHAR(e.event_date, 'IYYY-IW')              AS iso_week,
  e.start_time,

  (SELECT s.space_name FROM event_spaces es
   JOIN spaces s ON s.space_id = es.space_id
   WHERE es.event_id = e.event_id
   ORDER BY s.service_type, s.space_name LIMIT 1)  AS space_principal,

  (SELECT STRING_AGG(s.space_name, ' · ' ORDER BY s.service_type, s.space_name)
   FROM event_spaces es JOIN spaces s ON s.space_id = es.space_id
   WHERE es.event_id = e.event_id)                 AS all_spaces,

  -- Régisseur : champ événement (fiable), pas un rôle RH inexistant.
  e.regisseur_name                              AS regisseurs,

  (SELECT COUNT(DISTINCT zsh.id) FROM zone_staff_hours zsh
   WHERE zsh.event_id = e.event_id)                AS nb_agents_total,

  (SELECT JSON_AGG(JSON_BUILD_OBJECT(
     'phase_type', p.phase_type, 'label', p.label, 'phase_date', p.phase_date,
     'start_time', p.start_time, 'regisseur', p.regisseur, 'color', p.color
   ) ORDER BY p.phase_date, p.start_time)
   FROM event_planning_phases p WHERE p.event_id = e.event_id)  AS phases,

  e.total_fb_cost_ht,
  e.total_rh_cost,
  CASE WHEN e.event_type = 'match' THEN '#1A1A2E' ELSE '#2563EB' END AS event_color

FROM events e
WHERE e.status <> 'archivé'
ORDER BY e.event_date;

ALTER VIEW weekly_planning SET (security_invoker = on);
GRANT SELECT ON weekly_planning TO authenticated;
REVOKE SELECT ON weekly_planning FROM anon;

-- ── 20260707090037_event_deletion_cascade.sql ──
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

-- ── 20260707090038_coefficients_5match.sql ──
-- ═══════════════════════════════════════════════════════════════════════════
-- coefficients_5match.sql — Base runner 2026-2027 : coefficients réels 5 matchs.
--
-- ⚠ RÉCONCILIATION AVEC LE SCHÉMA RÉEL (vérifié en prod) — corrige les
--   incohérences de la version brute du prompt qui, appliquée telle quelle,
--   aurait perdu ou CORROMPU des données :
--
--   ESPACES :
--     • « LOGES … » → réel « Loge … » (singulier) → normalisé.
--     • « PMR » : aucun espace de ce nom → lignes ignorées (v_ko).
--     • « BUVETTE NORD OUEST / … » (9 noms géographiques) : les buvettes
--       réelles sont B1–B9 + Buvette 1/2 (pas de correspondance 1:1) → lignes
--       ignorées jusqu'à ce qu'un mapping nom→code soit décidé. Les données
--       restent dans ce fichier pour injection ultérieure.
--   PRODUITS :
--     • Table d'alias explicite (Cristaline 1 L, Pepsi 1L+, FADA * Bouteille,
--       Blanc Galiniere, CORONA SANS ALCOOL, GET 27…).
--     • Le fuzzy « %premier-mot% LIMIT 1 » du prompt est SUPPRIMÉ : il assignait
--       les coefficients au MAUVAIS produit. Un produit non résolu est ignoré,
--       jamais mal affecté.
--   • PAS de compute_space_coefficients() en fin d'injection : il recalcule
--     depuis les matchs clôturés (ON CONFLICT DO UPDATE) et écraserait cette
--     base de référence dès qu'un vrai match serait clôturé.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── BLOC A : mise à jour des prix HT (noms réels) ───────────────────────────
UPDATE products SET unit_price_ht = v.prix FROM (VALUES
  ('Mumm Blanc de Blanc',36.00),('Mumm Cordon Rouge',24.50),
  ('Perrier grande bouteille',1.05),('Pepsi bouteille 1L+',1.83),
  ('Pepsi Max bouteille',2.64),('Cristaline 50cl',0.17),
  ('Jus de fruits',2.60),('Schweppes',1.92),('Orangina 50cl',1.22),
  ('Ice Tea 50cl',1.26),('Pepsi 50cl',1.09),
  ('Blanc Galiniere',6.50),('Blanc du Seuil',6.30),('Blanc Montaurone',5.20),
  ('Rosé Miraval',8.50),('Rosé Pey Blanc',7.20),('Rosé Réal',8.70),
  ('Rosé NAIS',6.12),('Rouge Les Alexandrins',8.50),('Rouge Grand Boise',7.58),
  ('Rouge NAIS',4.74),('GET 27',12.21),('Lillet Blanc',12.65),
  ('Lillet Rosé',12.65),('Whisky Jameson',19.29),('Ricard classique',16.86),
  ('Fût BUD',99.99),('Fût LEFFE',132.03),('Fût Goose Island IPA',95.00),
  ('Fût Hoegaarden Blanche',112.00),('Bière en verre',1.36),
  ('Corona',1.63),('CORONA SANS ALCOOL',1.72),
  ('FADA IPA Bouteille',1.80),('FADA Blanche Bouteille',1.73),
  ('FADA Abricot Bouteille',1.80),('FADA Blonde Bouteille',1.48),
  ('San Pellegrino bouteille',0.94),('San Pellegrino 50cl',0.69)
) AS v(nom, prix)
WHERE product_name = v.nom AND active = true;

-- ── BLOC B : résolution d'alias produit (prompt → nom réel) ─────────────────
CREATE OR REPLACE FUNCTION _resolve_product_alias(p_name TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE UPPER(TRIM(p_name))
    WHEN 'CRISTALLINE 50CL'    THEN 'Cristaline 50cl'
    WHEN 'CRISTALLINE 50cl'    THEN 'Cristaline 50cl'
    WHEN 'PEPSI BOUTEILLE'     THEN 'Pepsi bouteille 1L+'
    WHEN 'BLANC GALINIÈRE'     THEN 'Blanc Galiniere'
    WHEN 'GET BODEGA'          THEN 'GET 27'
    WHEN 'BIÈRE EN VERRE BUD'  THEN 'Bière en verre'
    WHEN 'FADA IPA'            THEN 'FADA IPA Bouteille'
    WHEN 'FADA BLANCHE'        THEN 'FADA Blanche Bouteille'
    WHEN 'FADA ABRICOT'        THEN 'FADA Abricot Bouteille'
    WHEN 'FADA BLONDE BTL'     THEN 'FADA Blonde Bouteille'
    WHEN 'FADA BLANCHE BTL'    THEN 'FADA Blanche Bouteille'
    WHEN 'FADA ABRICOT BTL'    THEN 'FADA Abricot Bouteille'
    WHEN 'CORONA 0% SS ALCOOL' THEN 'CORONA SANS ALCOOL'
    WHEN 'FÛT FADA VP'         THEN NULL   -- pas d'équivalent → ignoré
    WHEN 'ROUGE PARADIS'       THEN NULL   -- pas d'équivalent → ignoré
    ELSE p_name                            -- ILIKE gère la casse pour le reste
  END;
$$;

-- ── BLOC C : injection ──────────────────────────────────────────────────────
-- La base injectée est tagguée source='seed' : la purge d'orphelins et le reset
-- total (coefficients_orphan_fix / 040) ne touchent QUE les lignes 'computed'.
-- On ajoute la colonne défensivement (038 s'exécute avant 040).
ALTER TABLE space_product_coefficients ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'computed';

CREATE OR REPLACE FUNCTION inject_5match_coefficients()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_ok INT := 0; v_ko INT := 0; v_ko_space INT := 0; v_ko_product INT := 0;
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
    ('SALON NORD','MUMM BLANC DE BLANC',31.0,70.0,1.0,5),
    ('SALON NORD','Perrier grande bouteille',27.5,35.0,17.0,4),
    ('SALON NORD','VITTEL VERRE',21.8,32.0,13.0,4),
    ('SALON NORD','Pepsi bouteille',18.0,22.0,14.0,5),
    ('SALON NORD','San Pellegrino bouteille',16.0,32.0,0.0,4),
    ('SALON NORD','MUMM CORDON ROUGE',15.0,20.0,5.0,5),
    ('SALON NORD','Blanc Galinière',14.2,25.0,3.0,5),
    ('SALON NORD','Rosé Miraval',11.2,15.0,6.0,5),
    ('SALON NORD','Blanc Montaurone',10.0,17.0,3.0,2),
    ('SALON NORD','GET 27',8.0,14.0,2.0,5),
    ('SALON NORD','Schweppes',6.4,10.0,2.0,5),
    ('SALON NORD','Rouge Les Alexandrins',6.2,11.0,0.0,5),
    ('SALON NORD','Jus de fruits',6.0,11.0,2.0,5),
    ('SALON NORD','Rouge Grand Boise',5.2,10.0,1.0,4),
    ('SALON NORD','Lillet Blanc',4.7,6.0,0.0,5),
    ('SALON NORD','Pepsi Max bouteille',4.6,6.0,3.0,5),
    ('SALON NORD','Whisky Jameson',3.4,9.0,1.0,5),
    ('SALON NORD','Blanc du Seuil',3.2,6.0,1.0,5),
    ('SALON NORD','Fût BUD',3.2,5.0,2.0,5),
    ('SALON NORD','Fût LEFFE',2.4,4.0,1.0,5),
    ('SALON NORD','Ricard classique',2.0,3.0,1.0,5),
    ('SALON NORD','Lillet rosé',1.7,3.0,1.0,3),
    ('SALON NORD','Sirop de pêche',1.0,1.0,1.0,3),
    ('SALON NORD','Sirop de menthe',1.0,1.0,1.0,2),
    ('SALON NORD','Sirop de grenadine',1.0,1.0,1.0,1),
    ('SALON SUD','San Pellegrino bouteille',46.8,55.0,42.0,4),
    ('SALON SUD','MUMM CORDON ROUGE',29.0,36.0,23.0,4),
    ('SALON SUD','VITTEL VERRE',22.5,32.0,8.0,4),
    ('SALON SUD','MUMM BLANC DE BLANC',21.0,36.0,0.0,3),
    ('SALON SUD','Rouge Grand Boise',18.5,35.0,2.0,2),
    ('SALON SUD','Blanc du Seuil',16.0,30.0,2.0,4),
    ('SALON SUD','Pepsi bouteille',14.2,17.0,10.0,5),
    ('SALON SUD','GET 27',13.8,21.0,10.0,4),
    ('SALON SUD','Blanc Galinière',13.5,17.0,10.0,2),
    ('SALON SUD','Rouge Les Alexandrins',12.7,14.0,11.0,3),
    ('SALON SUD','Blanc Montaurone',7.5,14.0,0.0,3),
    ('SALON SUD','Schweppes',7.3,14.0,2.0,4),
    ('SALON SUD','Perrier grande bouteille',7.3,14.0,1.0,3),
    ('SALON SUD','Rosé Réal',6.8,9.0,6.0,4),
    ('SALON SUD','Pepsi Max bouteille',5.8,11.0,3.0,4),
    ('SALON SUD','Jus de fruits',3.2,7.0,1.0,4),
    ('SALON SUD','Rosé Miraval',2.5,3.0,2.0,2),
    ('SALON SUD','Whisky Jameson',2.0,4.0,1.0,4),
    ('SALON SUD','Ricard classique',2.0,3.0,1.0,4),
    ('SALON SUD','Fût BUD',1.8,3.0,1.0,5),
    ('SALON SUD','Fût LEFFE',1.8,3.0,1.0,5),
    ('LOGE EST','Bière en verre',186.8,445.0,16.0,5),
    ('LOGE EST','Cristalline 50CL',155.0,280.0,60.0,3),
    ('LOGE EST','Pepsi bouteille',27.0,28.0,26.0,2),
    ('LOGE EST','MUMM CORDON ROUGE',23.4,40.0,1.0,5),
    ('LOGE EST','Perrier grande bouteille',18.0,26.0,5.0,3),
    ('LOGE EST','Rouge Grand Boise',16.0,26.0,0.0,3),
    ('LOGE EST','Blanc du Seuil',13.5,22.0,5.0,3),
    ('LOGE EST','Blanc Montaurone',11.3,30.0,1.0,4),
    ('LOGE EST','Ricard classique',10.0,14.0,4.0,3),
    ('LOGE EST','Rouge Les Alexandrins',8.5,15.0,2.0,3),
    ('LOGE EST','Jus de fruits',7.2,15.0,1.0,5),
    ('LOGE EST','Whisky Jameson',7.2,12.0,3.0,5),
    ('LOGE EST','Rosé Réal',7.0,10.0,4.0,3),
    ('LOGE EST','Rosé Miraval',3.5,6.0,1.0,2),
    ('LOGE OUEST NORD','Bière en verre',42.0,62.0,24.0,4),
    ('LOGE OUEST NORD','Cristalline 50CL',36.8,41.0,29.0,4),
    ('LOGE OUEST NORD','MUMM CORDON ROUGE',10.8,18.0,8.0,4),
    ('LOGE OUEST NORD','Perrier grande bouteille',5.5,8.0,4.0,4),
    ('LOGE OUEST NORD','Rouge Grand Boise',5.0,8.0,3.0,3),
    ('LOGE OUEST NORD','Pepsi bouteille',4.8,8.0,1.0,4),
    ('LOGE OUEST NORD','Blanc du Seuil',3.7,5.0,3.0,3),
    ('LOGE OUEST NORD','Blanc Montaurone',3.5,6.0,1.0,2),
    ('LOGE OUEST NORD','Ricard classique',1.7,2.0,1.0,4),
    ('LOGE OUEST NORD','Jus de fruits',1.5,3.0,1.0,4),
    ('LOGE OUEST NORD','Whisky Jameson',1.3,2.0,1.0,4),
    ('LOGE OUEST SUD','Cristalline 50CL',83.0,88.0,78.0,2),
    ('LOGE OUEST SUD','Bière en verre',78.3,87.0,68.0,3),
    ('LOGE OUEST SUD','MUMM CORDON ROUGE',7.7,8.0,7.0,3),
    ('LOGE OUEST SUD','Pepsi bouteille',7.0,8.0,5.0,3),
    ('LOGE OUEST SUD','Rouge Grand Boise',6.7,8.0,5.0,3),
    ('LOGE OUEST SUD','Perrier grande bouteille',4.7,7.0,2.0,3),
    ('LOGE OUEST SUD','Jus de fruits',4.3,6.0,2.0,3),
    ('LOGE OUEST SUD','Ricard classique',3.5,4.0,3.0,2),
    ('LOGE OUEST SUD','Whisky Jameson',2.7,3.0,2.0,3),
    ('WINE BAR NORD','Bière en verre',103.7,192.0,41.0,3),
    ('WINE BAR NORD','Cristalline 50CL',28.3,38.0,13.0,3),
    ('WINE BAR NORD','Pepsi bouteille',6.3,11.0,2.0,3),
    ('WINE BAR NORD','Jus de fruits',4.0,8.0,1.0,3),
    ('WINE BAR NORD','Perrier grande bouteille',1.7,2.0,1.0,3),
    ('WINE BAR SUD','Bière en verre',62.3,73.0,54.0,3),
    ('WINE BAR SUD','Cristalline 50CL',58.0,90.0,26.0,3),
    ('WINE BAR SUD','Pepsi bouteille',7.0,10.0,4.0,3),
    ('WINE BAR SUD','Perrier grande bouteille',5.7,8.0,4.0,3),
    ('WINE BAR SUD','Jus de fruits',3.7,4.0,3.0,3),
    ('CLUB 70 NORD','Cristalline 50CL',58.7,73.0,48.0,3),
    ('CLUB 70 NORD','MUMM CORDON ROUGE',18.4,24.0,14.0,5),
    ('CLUB 70 NORD','Blanc du Seuil',8.7,10.0,7.0,4),
    ('CLUB 70 NORD','Pepsi bouteille',8.2,11.0,6.0,5),
    ('CLUB 70 NORD','Blanc Montaurone',8.0,10.0,6.0,2),
    ('CLUB 70 NORD','Perrier grande bouteille',7.2,18.0,3.0,5),
    ('CLUB 70 NORD','Rouge Les Alexandrins',6.0,8.0,5.0,4),
    ('CLUB 70 NORD','Rosé Pey Blanc',5.0,11.0,2.0,5),
    ('CLUB 70 NORD','Rosé Miraval',4.0,5.0,3.0,2),
    ('CLUB 70 NORD','Fût BUD',4.0,6.0,3.0,5),
    ('CLUB 70 NORD','Pepsi Max bouteille',3.2,6.0,1.0,5),
    ('CLUB 70 NORD','Jus de fruits',1.0,1.0,1.0,4),
    ('CLUB 70 SUD','Cristalline 50CL',44.0,58.0,26.0,3),
    ('CLUB 70 SUD','Blanc du Seuil',20.0,21.0,19.0,2),
    ('CLUB 70 SUD','MUMM CORDON ROUGE',15.3,25.0,9.0,3),
    ('CLUB 70 SUD','Blanc Galinière',14.0,14.0,14.0,1),
    ('CLUB 70 SUD','Rosé Pey Blanc',8.0,12.0,4.0,2),
    ('CLUB 70 SUD','Rosé Miraval',7.0,12.0,2.0,3),
    ('CLUB 70 SUD','Perrier grande bouteille',7.3,10.0,5.0,3),
    ('CLUB 70 SUD','Pepsi bouteille',7.0,8.0,5.0,3),
    ('CLUB 70 SUD','Rouge Les Alexandrins',6.0,9.0,4.0,3),
    ('CLUB 70 SUD','Fût BUD',4.0,5.0,3.0,4),
    ('CLUB 70 SUD','Pepsi Max bouteille',2.3,4.0,1.0,3),
    ('CLUB 70 SUD','Jus de fruits',2.0,3.0,1.0,2),
    ('LE PUB','MUMM CORDON ROUGE',20.6,30.0,8.0,5),
    ('LE PUB','Perrier grande bouteille',20.4,28.0,16.0,5),
    ('LE PUB','Pepsi bouteille',17.8,21.0,14.0,5),
    ('LE PUB','Blanc du Seuil',13.7,19.0,8.0,3),
    ('LE PUB','Blanc Galinière',10.3,16.0,6.0,4),
    ('LE PUB','Schweppes',9.2,17.0,3.0,5),
    ('LE PUB','Lillet Blanc',5.8,10.0,3.0,5),
    ('LE PUB','Rosé Miraval',4.8,6.0,3.0,5),
    ('LE PUB','Rouge Grand Boise',4.8,6.0,2.0,5),
    ('LE PUB','Pepsi Max bouteille',3.6,7.0,1.0,5),
    ('LE PUB','Jus de fruits',3.2,4.0,2.0,5),
    ('LE PUB','Whisky Jameson',3.2,5.0,2.0,5),
    ('LE PUB','Ricard classique',3.0,5.0,1.0,5),
    ('LE PUB','Fût BUD',2.8,3.0,2.0,5),
    ('LE PUB','Fût LEFFE',1.6,2.0,1.0,5),
    ('LE PUB','Lillet rosé',2.0,3.0,1.0,3),
    ('BISTROT','Corona',60.0,91.0,38.0,5),
    ('BISTROT','Cristalline 50CL',56.0,60.0,48.0,3),
    ('BISTROT','Perrier grande bouteille',21.6,28.0,13.0,5),
    ('BISTROT','Pepsi bouteille',20.8,28.0,14.0,5),
    ('BISTROT','Fada IPA',18.2,35.0,3.0,5),
    ('BISTROT','Schweppes',15.4,22.0,9.0,5),
    ('BISTROT','Fada Blanche',14.4,21.0,9.0,5),
    ('BISTROT','Blanc Montaurone',12.5,15.0,10.0,4),
    ('BISTROT','Corona 0% SS ALCOOL',10.0,32.0,1.0,5),
    ('BISTROT','Lillet Blanc',7.8,12.0,3.0,5),
    ('BISTROT','Fada Abricot',6.2,10.0,0.0,5),
    ('BISTROT','Rouge Paradis',6.5,9.0,4.0,4),
    ('BISTROT','Rosé Réal',5.8,11.0,3.0,4),
    ('BISTROT','Pepsi Max bouteille',5.8,9.0,4.0,5),
    ('BISTROT','Blanc du Seuil',5.3,12.0,0.0,5),
    ('BISTROT','Lillet rosé',5.4,10.0,2.0,5),
    ('BISTROT','Fût BUD',5.0,7.0,4.0,5),
    ('BISTROT','Jus de fruits',5.0,7.0,1.0,5),
    ('BISTROT','Ricard classique',4.0,7.0,0.0,5),
    ('BISTROT','Fût LEFFE',3.2,4.0,2.0,5),
    ('BISTROT','Whisky Jameson',2.0,3.0,1.0,4),
    ('COMPTOIR','Pepsi bouteille',7.2,8.0,6.0,4),
    ('COMPTOIR','Schweppes',6.7,13.0,3.0,3),
    ('COMPTOIR','Rosé Miraval',6.7,7.0,6.0,3),
    ('COMPTOIR','Perrier grande bouteille',6.0,7.0,4.0,4),
    ('COMPTOIR','Rouge Les Alexandrins',5.5,6.0,5.0,2),
    ('COMPTOIR','Fût BUD',5.2,6.0,4.0,4),
    ('COMPTOIR','Blanc Montaurone',3.7,6.0,1.0,3),
    ('COMPTOIR','Blanc Galinière',3.5,4.0,3.0,2),
    ('COMPTOIR','Pepsi Max bouteille',3.0,5.0,1.0,4),
    ('COMPTOIR','Jus de fruits',2.8,3.0,2.0,4),
    ('COMPTOIR','Ricard classique',2.7,4.0,1.0,3),
    ('COMPTOIR','Lillet Blanc',2.0,3.0,1.0,4),
    ('COMPTOIR','Whisky Jameson',1.7,2.0,1.0,3),
    ('BODEGA','Cristalline 50cl',59.6,136.0,16.0,5),
    ('BODEGA','GET BODEGA',42.6,52.0,22.0,5),
    ('BODEGA','BLANC MONTAURONE',29.4,54.0,17.0,5),
    ('BODEGA','Pepsi 50cl',27.8,40.0,21.0,5),
    ('BODEGA','Perrier grande bouteille',25.2,52.0,9.0,5),
    ('BODEGA','San Pellegrino 50cl',17.8,25.0,11.0,5),
    ('BODEGA','Ice Tea 50cl',15.2,37.0,7.0,5),
    ('BODEGA','Fût FADA Blonde',11.8,14.0,10.0,5),
    ('BODEGA','Rosé NAIS',11.0,18.0,2.0,5),
    ('BODEGA','Orangina 50cl',9.0,16.0,2.0,5),
    ('BODEGA','MUMM CORDON ROUGE',8.6,17.0,6.0,5),
    ('BODEGA','Pepsi bouteille',8.2,14.0,5.0,5),
    ('BODEGA','ROUGE NAIS',8.0,24.0,0.0,5),
    ('BODEGA','Jus de fruits',6.0,9.0,4.0,5),
    ('BODEGA','Fût FADA IPA',3.6,5.0,2.0,5),
    ('BODEGA','Fût FADA VP',3.2,4.0,2.0,5),
    ('BODEGA','Fût FADA Blanche',3.0,4.0,1.0,5),
    -- PMR : aucun espace de ce nom → ignoré (données conservées)
    ('PMR','FADA BLONDE BTL',143.8,189.0,115.0,4),
    ('PMR','Cristalline 50CL',77.8,131.0,35.0,4),
    ('PMR','FADA ABRICOT BTL',64.2,108.0,33.0,4),
    ('PMR','Bière en verre BUD',60.0,72.0,51.0,3),
    ('PMR','FADA BLANCHE BTL',58.2,101.0,32.0,4),
    ('PMR','Pepsi bouteille',11.5,14.0,9.0,4),
    ('PMR','Perrier grande bouteille',6.8,9.0,4.0,4),
    ('PMR','Blanc Galinière',6.5,8.0,5.0,2),
    ('PMR','Blanc du Seuil',6.0,6.0,6.0,2),
    ('PMR','Jus de fruits',4.5,6.0,3.0,4),
    ('PMR','Rosé Miraval',4.0,7.0,1.0,3),
    ('PMR','Rouge Les Alexandrins',4.7,9.0,1.0,3),
    -- BUVETTES : noms géographiques sans correspondance B1–B9 → ignoré
    ('BUVETTE NORD OUEST','Cristalline 50cl',34.6,48.0,22.0,5),
    ('BUVETTE NORD OUEST','Pepsi 50cl',29.4,47.0,15.0,5),
    ('BUVETTE NORD OUEST','Ice Tea 50cl',26.4,36.0,14.0,5),
    ('BUVETTE NORD OUEST','San Pellegrino 50cl',21.2,25.0,15.0,5),
    ('BUVETTE NORD OUEST','Orangina 50cl',19.4,34.0,10.0,5),
    ('BUVETTE NORD OUEST','Fût Bud',6.8,9.0,4.0,5),
    ('BUVETTE NORD EST','Cristalline 50cl',37.8,48.0,27.0,5),
    ('BUVETTE NORD EST','Pepsi 50cl',28.8,45.0,17.0,5),
    ('BUVETTE EST GALICE','Cristalline 50cl',27.8,45.0,13.0,5),
    ('BUVETTE EST PAGNOL','Cristalline 50cl',32.0,47.0,22.0,5),
    ('BUVETTE SUD EST','Pepsi 50cl',26.2,60.0,13.0,5),
    ('BUVETTE SUD OUEST','Cristalline 50cl',25.4,48.0,13.0,5),
    ('BUVETTE VIRAGE OUEST','Cristalline 50cl',24.2,47.0,12.0,5),
    ('BUVETTE VIRAGE SUD OUEST','Ice Tea 50cl',11.2,24.0,5.0,5)
    ) AS d(space_name, product_name, avg_c, max_c, min_c, n_match)
  LOOP
    DECLARE v_sp UUID; v_pd UUID; v_name TEXT;
    BEGIN
      -- Espace : « LOGES » → « LOGE » (correction du pluriel).
      SELECT space_id INTO v_sp FROM spaces
      WHERE UPPER(TRIM(space_name)) = UPPER(TRIM(REPLACE(rec.space_name, 'LOGES ', 'LOGE ')))
        AND active = true LIMIT 1;
      IF v_sp IS NULL THEN v_ko := v_ko + 1; v_ko_space := v_ko_space + 1; CONTINUE; END IF;

      -- Produit : alias explicite, PAS de fuzzy (jamais de mauvaise affectation).
      v_name := _resolve_product_alias(rec.product_name);
      IF v_name IS NULL THEN v_ko := v_ko + 1; v_ko_product := v_ko_product + 1; CONTINUE; END IF;
      SELECT product_id INTO v_pd FROM products
      WHERE product_name ILIKE v_name AND active = true LIMIT 1;
      IF v_pd IS NULL THEN v_ko := v_ko + 1; v_ko_product := v_ko_product + 1; CONTINUE; END IF;

      INSERT INTO space_product_coefficients (
        space_id, product_id, avg_consumption, max_consumption, min_consumption,
        total_matches, confidence_level, recommended_qty, source
      ) VALUES (
        v_sp, v_pd, rec.avg_c, rec.max_c, rec.min_c, rec.n_match,
        CASE WHEN rec.n_match >= 5 THEN 'très élevé'
             WHEN rec.n_match >= 4 THEN 'élevé'
             WHEN rec.n_match >= 3 THEN 'moyen'
             ELSE 'faible' END,
        ROUND(rec.avg_c * 1.20), 'seed'
      )
      ON CONFLICT (space_id, product_id) DO UPDATE SET
        avg_consumption  = EXCLUDED.avg_consumption,
        max_consumption  = EXCLUDED.max_consumption,
        min_consumption  = EXCLUDED.min_consumption,
        total_matches    = EXCLUDED.total_matches,
        confidence_level = EXCLUDED.confidence_level,
        recommended_qty  = EXCLUDED.recommended_qty,
        source           = 'seed',
        last_computed_at = now();
      v_ok := v_ok + 1;
    END;
  END LOOP;

  -- ⚠ PAS de compute_space_coefficients() ici (écraserait la base injectée).
  RETURN json_build_object('ok', v_ok, 'ko', v_ko,
    'ko_espaces_non_trouves', v_ko_space, 'ko_produits_non_trouves', v_ko_product);
END;
$$;
GRANT EXECUTE ON FUNCTION inject_5match_coefficients() TO authenticated;
SELECT inject_5match_coefficients();

-- ── BLOC D : vue fiche runner ───────────────────────────────────────────────
CREATE OR REPLACE VIEW v_runner_sheet AS
SELECT
  s.space_name, s.service_type,
  p.product_name, p.category, p.unit, p.unit_price_ht,
  spc.avg_consumption AS conso_moy,
  spc.max_consumption AS conso_max,
  spc.min_consumption AS conso_min,
  spc.recommended_qty AS dotation_runner,
  spc.confidence_level,
  spc.total_matches   AS nb_matchs,
  ROUND(spc.recommended_qty * COALESCE(p.unit_price_ht, 0), 2) AS cout_dotation_ht,
  CASE WHEN spc.max_consumption > spc.avg_consumption * 2.5 THEN '⚡ Très variable'
       WHEN spc.max_consumption > spc.avg_consumption * 1.5 THEN '⚠️ Variable'
       ELSE '→ Stable' END AS variabilite
FROM space_product_coefficients spc
JOIN spaces   s ON s.space_id   = spc.space_id
JOIN products p ON p.product_id = spc.product_id
WHERE s.active = true AND p.active = true AND spc.avg_consumption > 0
ORDER BY s.service_type, s.space_name, spc.avg_consumption DESC;

ALTER VIEW v_runner_sheet SET (security_invoker = on);
GRANT SELECT ON v_runner_sheet TO authenticated;
REVOKE SELECT ON v_runner_sheet FROM anon;  -- RG-003 : prix/coûts admin only

-- ── 20260707090039_terrasse_zones.sql ──
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

-- ── 20260707090040_coefficients_orphan_fix.sql ──
-- ═══════════════════════════════════════════════════════════════════════════
-- coefficients_orphan_fix.sql — purge des coefficients orphelins à la
-- suppression d'un événement + reset total + exclusion des simulations.
--
-- ⚠ CONFLIT RÉSOLU avec la base runner injectée (coefficients_5match / 038) :
--   Cette base (~180 lignes) n'a AUCUNE source dans event_stock_lines → la purge
--   d'orphelins du prompt l'aurait DÉTRUITE. On ajoute une colonne `source`
--   ('seed' | 'computed'). La purge et le reset ne touchent QUE les lignes
--   'computed'. La base injectée (tagguée 'seed' par 038) est préservée.
--   type_averages : on garde space_profile() (cohérent avec l'existant), PAS
--   service_type (le prompt s'était trompé — service_type ≠ 9 profils).
--   Simulations (is_simulation=true) exclues des calculs même clôturées.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE space_product_coefficients ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'computed';
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_simulation BOOLEAN DEFAULT false;

CREATE OR REPLACE FUNCTION compute_space_coefficients()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_deleted INT := 0; v_updated INT := 0;
BEGIN
  -- ── 1) Purger les coefficients COMPUTED sans source réelle ────────────────
  --     (seed préservé ; simulations non comptées comme source).
  DELETE FROM space_product_coefficients spc
  WHERE COALESCE(spc.source, 'computed') = 'computed'
    AND NOT EXISTS (
      SELECT 1 FROM event_stock_lines esl
      JOIN events e ON e.event_id = esl.event_id
      WHERE esl.space_id = spc.space_id AND esl.product_id = spc.product_id
        AND e.status IN ('clôturé', 'archivé') AND e.event_type = 'match'
        AND COALESCE(e.is_simulation, false) = false
        AND esl.final_qty IS NOT NULL
        AND (esl.initial_qty + COALESCE(esl.reassort_qty, 0)) > 0
    );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- ── 2) Recalculer depuis les données réelles (hors simulations) ───────────
  WITH space_averages AS (
    SELECT esl.space_id, esl.product_id,
      COUNT(DISTINCT esl.event_id) AS nb_matches,
      ROUND(AVG(esl.initial_qty + COALESCE(esl.reassort_qty,0) - COALESCE(esl.final_qty,0))::DECIMAL, 2) AS avg_conso,
      ROUND(MIN(esl.initial_qty + COALESCE(esl.reassort_qty,0) - COALESCE(esl.final_qty,0))::DECIMAL, 2) AS min_conso,
      ROUND(MAX(esl.initial_qty + COALESCE(esl.reassort_qty,0) - COALESCE(esl.final_qty,0))::DECIMAL, 2) AS max_conso,
      ROUND(STDDEV(esl.initial_qty + COALESCE(esl.reassort_qty,0) - COALESCE(esl.final_qty,0))::DECIMAL, 2) AS std_dev
    FROM event_stock_lines esl
    JOIN events e ON e.event_id = esl.event_id
    JOIN products p ON p.product_id = esl.product_id
    WHERE e.status IN ('clôturé','archivé') AND e.event_type = 'match'
      AND COALESCE(e.is_simulation, false) = false
      AND esl.final_qty IS NOT NULL
      AND (esl.initial_qty + COALESCE(esl.reassort_qty,0)) > 0
      AND p.active = true
      AND (esl.initial_qty + COALESCE(esl.reassort_qty,0) - COALESCE(esl.final_qty,0)) > 0
    GROUP BY esl.space_id, esl.product_id
    HAVING COUNT(DISTINCT esl.event_id) >= 1
  ),
  type_averages AS (
    SELECT space_profile(s.space_name) AS profile, sa.product_id, AVG(sa.avg_conso) AS type_avg_conso
    FROM space_averages sa JOIN spaces s ON s.space_id = sa.space_id
    GROUP BY space_profile(s.space_name), sa.product_id
  )
  INSERT INTO space_product_coefficients (
    space_id, product_id, avg_consumption, total_matches, min_consumption,
    max_consumption, std_deviation, coefficient, confidence_level, recommended_qty,
    source, last_computed_at)
  SELECT sa.space_id, sa.product_id, sa.avg_conso, sa.nb_matches, sa.min_conso, sa.max_conso,
    COALESCE(sa.std_dev, 0),
    CASE WHEN COALESCE(ta.type_avg_conso,0) > 0 THEN ROUND((sa.avg_conso / ta.type_avg_conso)::DECIMAL, 2) ELSE 1.00 END,
    CASE WHEN sa.nb_matches >= 5 THEN 'très élevé' WHEN sa.nb_matches >= 4 THEN 'élevé'
         WHEN sa.nb_matches >= 3 THEN 'moyen' ELSE 'faible' END,
    ROUND((sa.avg_conso * 1.20)::DECIMAL, 0), 'computed', now()
  FROM space_averages sa
  JOIN spaces s ON s.space_id = sa.space_id
  LEFT JOIN type_averages ta ON ta.profile = space_profile(s.space_name) AND ta.product_id = sa.product_id
  ON CONFLICT (space_id, product_id) DO UPDATE SET
    avg_consumption=EXCLUDED.avg_consumption, total_matches=EXCLUDED.total_matches,
    min_consumption=EXCLUDED.min_consumption, max_consumption=EXCLUDED.max_consumption,
    std_deviation=EXCLUDED.std_deviation, coefficient=EXCLUDED.coefficient,
    confidence_level=EXCLUDED.confidence_level, recommended_qty=EXCLUDED.recommended_qty,
    source='computed', last_computed_at=now();
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN json_build_object('success', true, 'deleted', v_deleted, 'updated', v_updated,
    'message', format('%s orphelins supprimés · %s coefficients recalculés', v_deleted, v_updated));
END; $$;
GRANT EXECUTE ON FUNCTION compute_space_coefficients() TO authenticated;

-- Reset : vide les COMPUTED (préserve la base seed) puis recalcule.
CREATE OR REPLACE FUNCTION reset_all_coefficients()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_before INT; v_res JSON;
BEGIN
  SELECT COUNT(*) INTO v_before FROM space_product_coefficients WHERE COALESCE(source,'computed') = 'computed';
  DELETE FROM space_product_coefficients WHERE COALESCE(source,'computed') = 'computed';
  SELECT compute_space_coefficients() INTO v_res;
  RETURN json_build_object('success', true, 'cleared_before', v_before,
    'recomputed', (v_res->>'updated')::INT,
    'message', format('Reset : %s lignes computed effacées, %s recalculées (base « seed » préservée)',
      v_before, v_res->>'updated'));
END; $$;
GRANT EXECUTE ON FUNCTION reset_all_coefficients() TO authenticated;

-- ── 3) Trigger after_event_delete ────────────────────────────────────────────
--   Le trigger trg_after_event_delete (migration 037) appelle DÉJÀ
--   compute_space_coefficients() après chaque suppression d'événement. Comme
--   cette fonction purge désormais les orphelins avant de recalculer, la
--   suppression d'un événement nettoie automatiquement ses coefficients sans
--   trigger supplémentaire. On garantit simplement sa présence (idempotent).
CREATE OR REPLACE FUNCTION after_event_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM compute_space_coefficients();
  BEGIN
    UPDATE event_deletion_log SET recalculated_at = now()
     WHERE event_id = OLD.event_id AND recalculated_at IS NULL;
  EXCEPTION WHEN undefined_table THEN NULL;  -- log optionnel (037)
  END;
  RETURN OLD;
END; $$;
DROP TRIGGER IF EXISTS trg_after_event_delete ON events;
CREATE TRIGGER trg_after_event_delete AFTER DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION after_event_delete();

-- Nettoyage immédiat de l'état actuel (purge des orphelins de simulation).
SELECT compute_space_coefficients();

-- ── 20260707090041_match_access_realtime.sql ──
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

-- ── 20260707090042_staff_hors_event.sql ──
-- ═══════════════════════════════════════════════════════════════════════════
-- staff_hors_event.sql — Personnel intervenant HORS événement (manutention,
-- nettoyage, technique, reporting, sécurité, logistique, prestataires…).
-- Forfait OU taux horaire ; heures & coût générés ; analytics intégrés.
--
-- ⚠ RÉCONCILIATION SCHÉMA / SÉCURITÉ :
--   • RLS via le helper existant is_stade() (cohérent avec le reste du projet),
--     plutôt qu'un test inline sur auth.jwt() (fragile selon la structure des
--     claims). RG-003 : ces données de coût restent réservées à ROLE_STADE.
--   • Politique idempotente (DROP POLICY IF EXISTS avant CREATE).
--   • Les vues exposent des COÛTS → security_invoker = on pour que la RLS de la
--     table s'applique (sinon une vue « definer » les exposerait à tous).
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staff_hors_event (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  agent_nom      TEXT NOT NULL,
  agent_prenom   TEXT NOT NULL,
  agent_role     TEXT NOT NULL DEFAULT 'Autre' CHECK (agent_role IN (
    'Manutention', 'Nettoyage', 'Technique / Maintenance',
    'Reporting / Admin', 'Sécurité', 'Logistique',
    'Prestataire externe', 'Autre'
  )),

  societe        TEXT,

  work_date      DATE NOT NULL,
  start_time     TIME,
  end_time       TIME,
  hours_worked   DECIMAL(5,2) GENERATED ALWAYS AS (
    CASE WHEN end_time IS NOT NULL AND start_time IS NOT NULL
      THEN ROUND((EXTRACT(EPOCH FROM (end_time - start_time)) / 3600)::numeric, 2)
      ELSE NULL END
  ) STORED,

  remun_type     TEXT NOT NULL DEFAULT 'horaire' CHECK (remun_type IN ('horaire', 'forfait')),
  hourly_rate    DECIMAL(8,2),
  forfait_amount DECIMAL(10,2),

  cost_ht        DECIMAL(10,2) GENERATED ALWAYS AS (
    CASE
      WHEN remun_type = 'forfait' THEN forfait_amount
      WHEN remun_type = 'horaire' AND hourly_rate IS NOT NULL
        AND end_time IS NOT NULL AND start_time IS NOT NULL
      THEN ROUND((EXTRACT(EPOCH FROM (end_time - start_time)) / 3600 * hourly_rate)::numeric, 2)
      ELSE NULL END
  ) STORED,

  description    TEXT,
  bon_commande   TEXT,

  validated_by   TEXT,
  validated_at   TIMESTAMPTZ,

  created_by     TEXT NOT NULL DEFAULT 'admin',
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE staff_hors_event ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stade_all_hors_event ON staff_hors_event;
CREATE POLICY stade_all_hors_event ON staff_hors_event
  FOR ALL TO authenticated
  USING (is_stade()) WITH CHECK (is_stade());

CREATE INDEX IF NOT EXISTS idx_she_date    ON staff_hors_event (work_date DESC);
CREATE INDEX IF NOT EXISTS idx_she_role    ON staff_hors_event (agent_role);
CREATE INDEX IF NOT EXISTS idx_she_societe ON staff_hors_event (societe);

CREATE OR REPLACE FUNCTION she_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_she_updated ON staff_hors_event;
CREATE TRIGGER trg_she_updated
  BEFORE UPDATE ON staff_hors_event
  FOR EACH ROW EXECUTE FUNCTION she_updated_at();

-- ── Vues analytiques (security_invoker → RLS appliquée, RG-003) ──────────────
CREATE OR REPLACE VIEW she_kpis AS
SELECT
  COUNT(*)                                        AS total_interventions,
  COUNT(DISTINCT agent_nom || agent_prenom)       AS total_agents,
  COUNT(DISTINCT societe)                          AS total_societes,
  COALESCE(SUM(hours_worked), 0)                  AS total_heures,
  COALESCE(SUM(cost_ht), 0)                       AS total_cout_ht,
  COALESCE(AVG(hours_worked), 0)                  AS moy_heures_intervention,
  COUNT(*) FILTER (WHERE remun_type = 'forfait')  AS nb_forfaits,
  COUNT(*) FILTER (WHERE remun_type = 'horaire')  AS nb_horaires,
  MIN(work_date)                                   AS premiere_intervention,
  MAX(work_date)                                   AS derniere_intervention
FROM staff_hors_event;

CREATE OR REPLACE VIEW she_by_month AS
SELECT
  DATE_TRUNC('month', work_date)             AS mois,
  TO_CHAR(work_date, 'Mon YYYY')             AS mois_label,
  COUNT(*)                                    AS nb_interventions,
  COUNT(DISTINCT agent_nom || agent_prenom)  AS nb_agents,
  SUM(hours_worked)                          AS total_heures,
  SUM(cost_ht)                               AS total_cout_ht
FROM staff_hors_event
GROUP BY DATE_TRUNC('month', work_date), TO_CHAR(work_date, 'Mon YYYY')
ORDER BY mois;

CREATE OR REPLACE VIEW she_by_role AS
SELECT
  agent_role,
  societe,
  COUNT(*)          AS nb_interventions,
  SUM(hours_worked) AS total_heures,
  SUM(cost_ht)      AS total_cout_ht,
  AVG(hourly_rate)  AS taux_moyen
FROM staff_hors_event
GROUP BY agent_role, societe
ORDER BY total_cout_ht DESC NULLS LAST;

ALTER VIEW she_kpis    SET (security_invoker = on);
ALTER VIEW she_by_month SET (security_invoker = on);
ALTER VIEW she_by_role  SET (security_invoker = on);

GRANT SELECT ON she_kpis, she_by_month, she_by_role TO authenticated;
REVOKE SELECT ON she_kpis, she_by_month, she_by_role FROM anon;

-- ── 20260707090043_coefficients_seed_recompute.sql ──
-- ═══════════════════════════════════════════════════════════════════════════
-- coefficients_seed_recompute.sql — recalcule la colonne `coefficient` des
-- lignes seed (base « 5 matchs », migration 038).
--
-- Problème corrigé : inject_5match_coefficients() (038) ne remplissait PAS la
-- colonne `coefficient` → elle valait 1.00 par défaut pour les 179 lignes, et
-- la page Coefficients (vue v_space_dotation_recommendations → coeff_espace)
-- affichait « ×1.00 » partout (dont Bistrot/Bodega).
--
-- Correctif : coefficient = conso moyenne de l'espace / moyenne du PROFIL
-- d'espace (space_profile) pour ce produit — cohérent avec
-- compute_space_coefficients (040). NON destructif : aucune ligne supprimée,
-- la base de référence est conservée. Idempotent / re-jouable.
--
-- ⚠ Déjà appliqué en production le 2026-08-05 via l'API REST (DML autorisée
--   par la clé service_role). Ce fichier assure la reproductibilité d'un
--   rebuild complet depuis les migrations.
-- ═══════════════════════════════════════════════════════════════════════════

WITH profile_avg AS (
  SELECT space_profile(s.space_name) AS profile,
         spc.product_id,
         AVG(spc.avg_consumption) AS type_avg
  FROM space_product_coefficients spc
  JOIN spaces s ON s.space_id = spc.space_id
  WHERE COALESCE(spc.source, 'computed') = 'seed'
    AND spc.avg_consumption > 0
  GROUP BY space_profile(s.space_name), spc.product_id
)
UPDATE space_product_coefficients spc
SET coefficient = CASE
      WHEN COALESCE(pa.type_avg, 0) > 0
        THEN ROUND((spc.avg_consumption / pa.type_avg)::numeric, 2)
      ELSE 1.00 END,
    last_computed_at = now()
FROM spaces s
JOIN profile_avg pa ON pa.profile = space_profile(s.space_name)
WHERE s.space_id = spc.space_id
  AND pa.product_id = spc.product_id
  AND COALESCE(spc.source, 'computed') = 'seed';

-- ── 20260707090044_purge_orphan_monthly_reports.sql ──
-- ═══════════════════════════════════════════════════════════════════════════
-- purge_orphan_monthly_reports.sql — nettoyage des rapports mensuels orphelins.
--
-- Contexte : `monthly_staff_reports` est un SNAPSHOT (généré par
-- generate_monthly_staff_report) qui n'a PAS de FK vers events — le CASCADE
-- (037) ne peut donc pas le nettoyer, et le RPC de régénération ne purge pas
-- les lignes dont l'événement a été supprimé (upsert seul). Résultat : après
-- suppression d'un événement (ex. AIRBUS), ses lignes de rapport persistaient
-- (ex. HUGO PASCAL · Bistrot · 19h).
--
-- Ce correctif ajoute une fonction de purge + un trigger AFTER DELETE dédié
-- (additif : il coexiste avec trg_after_event_delete de 037, ne le remplace
-- pas). Le front applique déjà une défense-en-profondeur (masquage des
-- rapports orphelins) ; cette purge garde en plus le snapshot propre en base
-- pour les exports et autres consommateurs. Idempotent.
--
-- ⚠ NON appliqué automatiquement (PAT Supabase révoqué) — à exécuter via le
--   SQL Editor. Le nettoyage des lignes déjà orphelines a été fait via REST.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION purge_orphan_monthly_reports()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_deleted INT := 0;
BEGIN
  -- Supprime les lignes dont AUCUN événement du détail n'existe encore,
  -- en ne touchant pas les lignes au détail vide (indéterminées).
  DELETE FROM monthly_staff_reports msr
  WHERE COALESCE(jsonb_array_length(to_jsonb(msr.events_detail)), 0) > 0
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(to_jsonb(msr.events_detail)) AS d
      JOIN events e ON e.event_name = d->>'event_name'
    );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION purge_orphan_monthly_reports() TO authenticated;

-- Trigger dédié : purge le snapshot après chaque suppression d'événement.
CREATE OR REPLACE FUNCTION trg_purge_monthly_after_event_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM purge_orphan_monthly_reports();
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_purge_monthly_reports ON events;
CREATE TRIGGER trg_purge_monthly_reports
  AFTER DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION trg_purge_monthly_after_event_delete();

-- Nettoyage immédiat des orphelins déjà présents (idempotent).
SELECT purge_orphan_monthly_reports();

-- ── 20260707090045_cdc_v3_area_product_reference.sql ──
-- ═══════════════════════════════════════════════════════════════════════════
-- cdc_v3_area_product_reference.sql — Cahier des Charges Produits par Espace V3.
--   • Référentiel permanent produit × espace (indépendant des événements).
--   • Niveaux d'association CDC : S (socle/défaut) · R (récurrent) · P (ponctuel)
--     · C (à confirmer, conservé, jamais supprimé).
--   • RPC fiche runner par espace, filtrable par niveau. Aucun coût ici.
--
-- ⚠ ADAPTATIONS AU SCHÉMA RÉEL :
--   • BLOC 2 du prompt (renommage buvettes → B1-B9 + spaces.legacy_area_name)
--     NON repris : les espaces buvette sont DÉJÀ nommés B1..B9, et la table
--     spaces n'a pas de colonne legacy_area_name (l'UPDATE échouerait). Les
--     libellés historiques sont portés par area_product_reference.legacy_area_name.
--   • RLS via is_stade() (convention du projet) au lieu du chemin JWT brut.
--   • 'Buvette Virage Toinou' reste hors référentiel CDC (non validé).
-- ═══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════
-- BLOC 1 — TABLE area_product_reference
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS area_product_reference (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area_name        TEXT NOT NULL,
  area_group       TEXT NOT NULL,
  legacy_area_name TEXT,
  product_name     TEXT NOT NULL,
  product_family   TEXT NOT NULL CHECK (product_family IN (
    'Bière / Fûts','Vins','Champagne','Softs / Eau / Sirops',
    'Spiritueux / Apéritifs','Gaz / Technique','Autres'
  )),
  association_level TEXT NOT NULL CHECK (association_level IN ('S','R','P','C')),
  is_default        BOOLEAN GENERATED ALWAYS AS (association_level = 'S') STORED,
  product_id       UUID REFERENCES products(product_id) ON DELETE SET NULL,
  cdc_version      TEXT DEFAULT 'V3',
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (area_name, product_name)
);

ALTER TABLE area_product_reference ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stade_all_apr" ON area_product_reference;
CREATE POLICY "stade_all_apr" ON area_product_reference
  FOR ALL TO authenticated
  USING (is_stade()) WITH CHECK (is_stade());

CREATE INDEX IF NOT EXISTS idx_apr_area       ON area_product_reference(area_name);
CREATE INDEX IF NOT EXISTS idx_apr_group      ON area_product_reference(area_group);
CREATE INDEX IF NOT EXISTS idx_apr_level      ON area_product_reference(association_level);
CREATE INDEX IF NOT EXISTS idx_apr_default    ON area_product_reference(is_default) WHERE is_default = true;
CREATE INDEX IF NOT EXISTS idx_apr_product_id ON area_product_reference(product_id);

-- ══════════════════════════════════════════════════════════════════════════
-- BLOC 3 — INJECTION RÉFÉRENTIEL CDC V3
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION inject_cdc_v3()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_count INT := 0;
BEGIN
  DELETE FROM area_product_reference WHERE cdc_version = 'V3';

  INSERT INTO area_product_reference
    (area_name, area_group, legacy_area_name, product_name, product_family, association_level)
  VALUES
  -- ── BODEGA ──
  ('Bodega','Bodega',NULL,'Fût Fada Blanche','Bière / Fûts','S'),
  ('Bodega','Bodega',NULL,'Fût Fada Blonde','Bière / Fûts','S'),
  ('Bodega','Bodega',NULL,'Fût Fada IPA','Bière / Fûts','S'),
  ('Bodega','Bodega',NULL,'Fût VP Fada','Bière / Fûts','S'),
  ('Bodega','Bodega',NULL,'Fût VIP Groupe','Bière / Fûts','P'),
  ('Bodega','Bodega',NULL,'Fût Fada Abricot','Bière / Fûts','C'),
  ('Bodega','Bodega',NULL,'Blanc Montaurone','Vins','S'),
  ('Bodega','Bodega',NULL,'Rosé NAIS','Vins','S'),
  ('Bodega','Bodega',NULL,'Rouge NAIS','Vins','S'),
  ('Bodega','Bodega',NULL,'Blanc Montaurone / Touloubre','Vins','C'),
  ('Bodega','Bodega',NULL,'Rosé Pey Blanc','Vins','C'),
  ('Bodega','Bodega',NULL,'Rosé Réal','Vins','C'),
  ('Bodega','Bodega',NULL,'Mumm Cordon Rouge','Champagne','S'),
  ('Bodega','Bodega',NULL,'Cristalline 50cl','Softs / Eau / Sirops','S'),
  ('Bodega','Bodega',NULL,'Ice Tea 50cl','Softs / Eau / Sirops','S'),
  ('Bodega','Bodega',NULL,'Jus de fruits','Softs / Eau / Sirops','S'),
  ('Bodega','Bodega',NULL,'Orangina 50cl','Softs / Eau / Sirops','S'),
  ('Bodega','Bodega',NULL,'Pepsi 50cl','Softs / Eau / Sirops','S'),
  ('Bodega','Bodega',NULL,'Pepsi bouteille','Softs / Eau / Sirops','S'),
  ('Bodega','Bodega',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','S'),
  ('Bodega','Bodega',NULL,'San Pellegrino 50cl','Softs / Eau / Sirops','S'),
  ('Bodega','Bodega',NULL,'Sirop de pêche','Softs / Eau / Sirops','S'),
  ('Bodega','Bodega',NULL,'Sirop de grenadine','Softs / Eau / Sirops','R'),
  ('Bodega','Bodega',NULL,'Sirop de menthe','Softs / Eau / Sirops','R'),
  ('Bodega','Bodega',NULL,'Pepsi Max bouteille','Softs / Eau / Sirops','C'),
  ('Bodega','Bodega',NULL,'Sirop de citron','Softs / Eau / Sirops','C'),
  ('Bodega','Bodega',NULL,'Get Bodega','Spiritueux / Apéritifs','S'),
  ('Bodega','Bodega',NULL,'Ricard classique VP','Spiritueux / Apéritifs','S'),
  ('Bodega','Bodega',NULL,'CO2','Gaz / Technique','P'),
  -- ── B1 ──
  ('B1','Buvettes','Buvette Nord Ouest','Fût Bud','Bière / Fûts','S'),
  ('B1','Buvettes','Buvette Nord Ouest','Fût Goose Island IPA','Bière / Fûts','S'),
  ('B1','Buvettes','Buvette Nord Ouest','Fût Hoegaarden Blanche','Bière / Fûts','S'),
  ('B1','Buvettes','Buvette Nord Ouest','Fût Leffe','Bière / Fûts','S'),
  ('B1','Buvettes','Buvette Nord Ouest','Cristalline 50cl','Softs / Eau / Sirops','S'),
  ('B1','Buvettes','Buvette Nord Ouest','Ice Tea 50cl','Softs / Eau / Sirops','S'),
  ('B1','Buvettes','Buvette Nord Ouest','Orangina 50cl','Softs / Eau / Sirops','S'),
  ('B1','Buvettes','Buvette Nord Ouest','Pepsi 50cl','Softs / Eau / Sirops','S'),
  ('B1','Buvettes','Buvette Nord Ouest','San Pellegrino 50cl','Softs / Eau / Sirops','S'),
  ('B1','Buvettes','Buvette Nord Ouest','Sirop de grenadine','Softs / Eau / Sirops','S'),
  ('B1','Buvettes','Buvette Nord Ouest','Sirop de pêche','Softs / Eau / Sirops','S'),
  ('B1','Buvettes','Buvette Nord Ouest','Sirop de citron','Softs / Eau / Sirops','P'),
  ('B1','Buvettes','Buvette Nord Ouest','Sirop de menthe','Softs / Eau / Sirops','C'),
  ('B1','Buvettes','Buvette Nord Ouest','CO2','Gaz / Technique','P'),
  -- ── B2 ──
  ('B2','Buvettes','Buvette Nord Est','Fût Bud','Bière / Fûts','S'),
  ('B2','Buvettes','Buvette Nord Est','Fût Goose Island IPA','Bière / Fûts','S'),
  ('B2','Buvettes','Buvette Nord Est','Fût Hoegaarden Blanche','Bière / Fûts','S'),
  ('B2','Buvettes','Buvette Nord Est','Fût Leffe','Bière / Fûts','S'),
  ('B2','Buvettes','Buvette Nord Est','Cristalline 50cl','Softs / Eau / Sirops','S'),
  ('B2','Buvettes','Buvette Nord Est','Ice Tea 50cl','Softs / Eau / Sirops','S'),
  ('B2','Buvettes','Buvette Nord Est','Orangina 50cl','Softs / Eau / Sirops','S'),
  ('B2','Buvettes','Buvette Nord Est','Pepsi 50cl','Softs / Eau / Sirops','S'),
  ('B2','Buvettes','Buvette Nord Est','San Pellegrino 50cl','Softs / Eau / Sirops','S'),
  ('B2','Buvettes','Buvette Nord Est','Sirop de pêche','Softs / Eau / Sirops','S'),
  ('B2','Buvettes','Buvette Nord Est','Sirop de grenadine','Softs / Eau / Sirops','P'),
  ('B2','Buvettes','Buvette Nord Est','Sirop de menthe','Softs / Eau / Sirops','P'),
  ('B2','Buvettes','Buvette Nord Est','Sirop de citron','Softs / Eau / Sirops','C'),
  ('B2','Buvettes','Buvette Nord Est','CO2','Gaz / Technique','C'),
  -- ── B3 ──
  ('B3','Buvettes','Buvette Est Galice','Fût Bud','Bière / Fûts','S'),
  ('B3','Buvettes','Buvette Est Galice','Fût Goose Island IPA','Bière / Fûts','S'),
  ('B3','Buvettes','Buvette Est Galice','Fût Hoegaarden Blanche','Bière / Fûts','S'),
  ('B3','Buvettes','Buvette Est Galice','Fût Leffe','Bière / Fûts','S'),
  ('B3','Buvettes','Buvette Est Galice','Cristalline 50cl','Softs / Eau / Sirops','S'),
  ('B3','Buvettes','Buvette Est Galice','Ice Tea 50cl','Softs / Eau / Sirops','S'),
  ('B3','Buvettes','Buvette Est Galice','Orangina 50cl','Softs / Eau / Sirops','S'),
  ('B3','Buvettes','Buvette Est Galice','Pepsi 50cl','Softs / Eau / Sirops','S'),
  ('B3','Buvettes','Buvette Est Galice','San Pellegrino 50cl','Softs / Eau / Sirops','S'),
  ('B3','Buvettes','Buvette Est Galice','Sirop de pêche','Softs / Eau / Sirops','S'),
  ('B3','Buvettes','Buvette Est Galice','Sirop de grenadine','Softs / Eau / Sirops','R'),
  ('B3','Buvettes','Buvette Est Galice','Sirop de citron','Softs / Eau / Sirops','C'),
  ('B3','Buvettes','Buvette Est Galice','Sirop de menthe','Softs / Eau / Sirops','C'),
  ('B3','Buvettes','Buvette Est Galice','CO2','Gaz / Technique','C'),
  -- ── B4 ──
  ('B4','Buvettes','Buvette Est Pagnol','Fût Bud','Bière / Fûts','S'),
  ('B4','Buvettes','Buvette Est Pagnol','Fût Goose Island IPA','Bière / Fûts','S'),
  ('B4','Buvettes','Buvette Est Pagnol','Fût Hoegaarden Blanche','Bière / Fûts','S'),
  ('B4','Buvettes','Buvette Est Pagnol','Fût Leffe','Bière / Fûts','S'),
  ('B4','Buvettes','Buvette Est Pagnol','Cristalline 50cl','Softs / Eau / Sirops','S'),
  ('B4','Buvettes','Buvette Est Pagnol','Ice Tea 50cl','Softs / Eau / Sirops','S'),
  ('B4','Buvettes','Buvette Est Pagnol','Orangina 50cl','Softs / Eau / Sirops','S'),
  ('B4','Buvettes','Buvette Est Pagnol','Pepsi 50cl','Softs / Eau / Sirops','S'),
  ('B4','Buvettes','Buvette Est Pagnol','San Pellegrino 50cl','Softs / Eau / Sirops','S'),
  ('B4','Buvettes','Buvette Est Pagnol','Sirop de grenadine','Softs / Eau / Sirops','S'),
  ('B4','Buvettes','Buvette Est Pagnol','Sirop de pêche','Softs / Eau / Sirops','S'),
  ('B4','Buvettes','Buvette Est Pagnol','Sirop de citron','Softs / Eau / Sirops','C'),
  ('B4','Buvettes','Buvette Est Pagnol','Sirop de menthe','Softs / Eau / Sirops','C'),
  ('B4','Buvettes','Buvette Est Pagnol','CO2','Gaz / Technique','P'),
  -- ── B5 ──
  ('B5','Buvettes','Buvette Virage Sud Est','Fût Bud','Bière / Fûts','S'),
  ('B5','Buvettes','Buvette Virage Sud Est','Fût Leffe','Bière / Fûts','S'),
  ('B5','Buvettes','Buvette Virage Sud Est','Fût Goose Island IPA','Bière / Fûts','C'),
  ('B5','Buvettes','Buvette Virage Sud Est','Fût Hoegaarden Blanche','Bière / Fûts','C'),
  ('B5','Buvettes','Buvette Virage Sud Est','Sirop de pêche','Softs / Eau / Sirops','S'),
  ('B5','Buvettes','Buvette Virage Sud Est','Cristalline 50cl','Softs / Eau / Sirops','C'),
  ('B5','Buvettes','Buvette Virage Sud Est','Ice Tea 50cl','Softs / Eau / Sirops','C'),
  ('B5','Buvettes','Buvette Virage Sud Est','Orangina 50cl','Softs / Eau / Sirops','C'),
  ('B5','Buvettes','Buvette Virage Sud Est','Pepsi 50cl','Softs / Eau / Sirops','C'),
  ('B5','Buvettes','Buvette Virage Sud Est','San Pellegrino 50cl','Softs / Eau / Sirops','C'),
  ('B5','Buvettes','Buvette Virage Sud Est','Sirop de citron','Softs / Eau / Sirops','C'),
  ('B5','Buvettes','Buvette Virage Sud Est','Sirop de grenadine','Softs / Eau / Sirops','C'),
  ('B5','Buvettes','Buvette Virage Sud Est','Sirop de menthe','Softs / Eau / Sirops','C'),
  ('B5','Buvettes','Buvette Virage Sud Est','CO2','Gaz / Technique','P'),
  -- ── B6 ──
  ('B6','Buvettes','Buvette Sud Est','Fût Bud','Bière / Fûts','S'),
  ('B6','Buvettes','Buvette Sud Est','Fût Goose Island IPA','Bière / Fûts','S'),
  ('B6','Buvettes','Buvette Sud Est','Fût Hoegaarden Blanche','Bière / Fûts','S'),
  ('B6','Buvettes','Buvette Sud Est','Fût Leffe','Bière / Fûts','S'),
  ('B6','Buvettes','Buvette Sud Est','Cristalline 50cl','Softs / Eau / Sirops','S'),
  ('B6','Buvettes','Buvette Sud Est','Ice Tea 50cl','Softs / Eau / Sirops','S'),
  ('B6','Buvettes','Buvette Sud Est','Orangina 50cl','Softs / Eau / Sirops','S'),
  ('B6','Buvettes','Buvette Sud Est','Pepsi 50cl','Softs / Eau / Sirops','S'),
  ('B6','Buvettes','Buvette Sud Est','San Pellegrino 50cl','Softs / Eau / Sirops','S'),
  ('B6','Buvettes','Buvette Sud Est','Sirop de pêche','Softs / Eau / Sirops','S'),
  ('B6','Buvettes','Buvette Sud Est','Sirop de grenadine','Softs / Eau / Sirops','R'),
  ('B6','Buvettes','Buvette Sud Est','Sirop de citron','Softs / Eau / Sirops','C'),
  ('B6','Buvettes','Buvette Sud Est','Sirop de menthe','Softs / Eau / Sirops','C'),
  ('B6','Buvettes','Buvette Sud Est','CO2','Gaz / Technique','R'),
  -- ── B7 ──
  ('B7','Buvettes','Buvette Sud Ouest','Fût Bud','Bière / Fûts','S'),
  ('B7','Buvettes','Buvette Sud Ouest','Fût Goose Island IPA','Bière / Fûts','S'),
  ('B7','Buvettes','Buvette Sud Ouest','Fût Hoegaarden Blanche','Bière / Fûts','S'),
  ('B7','Buvettes','Buvette Sud Ouest','Fût Leffe','Bière / Fûts','S'),
  ('B7','Buvettes','Buvette Sud Ouest','Cristalline 50cl','Softs / Eau / Sirops','S'),
  ('B7','Buvettes','Buvette Sud Ouest','Ice Tea 50cl','Softs / Eau / Sirops','S'),
  ('B7','Buvettes','Buvette Sud Ouest','Orangina 50cl','Softs / Eau / Sirops','S'),
  ('B7','Buvettes','Buvette Sud Ouest','Pepsi 50cl','Softs / Eau / Sirops','S'),
  ('B7','Buvettes','Buvette Sud Ouest','San Pellegrino 50cl','Softs / Eau / Sirops','S'),
  ('B7','Buvettes','Buvette Sud Ouest','Sirop de grenadine','Softs / Eau / Sirops','S'),
  ('B7','Buvettes','Buvette Sud Ouest','Sirop de pêche','Softs / Eau / Sirops','S'),
  ('B7','Buvettes','Buvette Sud Ouest','Sirop de citron','Softs / Eau / Sirops','C'),
  ('B7','Buvettes','Buvette Sud Ouest','Sirop de menthe','Softs / Eau / Sirops','C'),
  ('B7','Buvettes','Buvette Sud Ouest','CO2','Gaz / Technique','P'),
  -- ── B8 (Lillet + Tonic) ──
  ('B8','Buvettes','Buvette Virage Sud Ouest','Fût Bud','Bière / Fûts','S'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','Fût Leffe','Bière / Fûts','S'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','Fût Fada Blanche','Bière / Fûts','C'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','Fût Fada IPA','Bière / Fûts','C'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','Lillet Blanc','Vins','R'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','Lillet Rosé','Vins','C'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','Cristalline 50cl','Softs / Eau / Sirops','S'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','Ice Tea 50cl','Softs / Eau / Sirops','S'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','Orangina 50cl','Softs / Eau / Sirops','S'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','Pepsi 50cl','Softs / Eau / Sirops','S'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','San Pellegrino 50cl','Softs / Eau / Sirops','S'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','Sirop de pêche','Softs / Eau / Sirops','R'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','Sirop de grenadine','Softs / Eau / Sirops','P'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','Sirop de citron','Softs / Eau / Sirops','P'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','Sirop de menthe','Softs / Eau / Sirops','C'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','CO2','Gaz / Technique','C'),
  ('B8','Buvettes','Buvette Virage Sud Ouest','Tonic','Autres','S'),
  -- ── B9 ──
  ('B9','Buvettes','Buvette Virage Ouest','Fût Bud','Bière / Fûts','S'),
  ('B9','Buvettes','Buvette Virage Ouest','Fût Goose Island IPA','Bière / Fûts','S'),
  ('B9','Buvettes','Buvette Virage Ouest','Fût Hoegaarden Blanche','Bière / Fûts','S'),
  ('B9','Buvettes','Buvette Virage Ouest','Fût Leffe','Bière / Fûts','S'),
  ('B9','Buvettes','Buvette Virage Ouest','Cristalline 50cl','Softs / Eau / Sirops','S'),
  ('B9','Buvettes','Buvette Virage Ouest','Ice Tea 50cl','Softs / Eau / Sirops','S'),
  ('B9','Buvettes','Buvette Virage Ouest','Pepsi 50cl','Softs / Eau / Sirops','S'),
  ('B9','Buvettes','Buvette Virage Ouest','Orangina 50cl','Softs / Eau / Sirops','R'),
  ('B9','Buvettes','Buvette Virage Ouest','San Pellegrino 50cl','Softs / Eau / Sirops','R'),
  ('B9','Buvettes','Buvette Virage Ouest','Sirop de grenadine','Softs / Eau / Sirops','R'),
  ('B9','Buvettes','Buvette Virage Ouest','Sirop de pêche','Softs / Eau / Sirops','R'),
  ('B9','Buvettes','Buvette Virage Ouest','Perrier grande bouteille','Softs / Eau / Sirops','P'),
  ('B9','Buvettes','Buvette Virage Ouest','Sirop de citron','Softs / Eau / Sirops','C'),
  ('B9','Buvettes','Buvette Virage Ouest','Sirop de menthe','Softs / Eau / Sirops','C'),
  ('B9','Buvettes','Buvette Virage Ouest','CO2','Gaz / Technique','P'),
  -- ── Garden Party ──
  ('Garden Party','Terrasses',NULL,'Fût Leffe','Bière / Fûts','R'),
  ('Garden Party','Terrasses',NULL,'Bière en verre','Bière / Fûts','C'),
  ('Garden Party','Terrasses',NULL,'Fût Bud','Bière / Fûts','C'),
  ('Garden Party','Terrasses',NULL,'Mumm Cordon Rouge','Champagne','C'),
  ('Garden Party','Terrasses',NULL,'Cristalline 50cl','Softs / Eau / Sirops','R'),
  ('Garden Party','Terrasses',NULL,'Jus de fruits','Softs / Eau / Sirops','R'),
  ('Garden Party','Terrasses',NULL,'Pepsi bouteille','Softs / Eau / Sirops','R'),
  ('Garden Party','Terrasses',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','R'),
  ('Garden Party','Terrasses',NULL,'Pepsi Max bouteille','Softs / Eau / Sirops','C'),
  ('Garden Party','Terrasses',NULL,'Sirop Orgeat','Softs / Eau / Sirops','C'),
  ('Garden Party','Terrasses',NULL,'Sirop de citron','Softs / Eau / Sirops','C'),
  ('Garden Party','Terrasses',NULL,'Sirop de grenadine','Softs / Eau / Sirops','C'),
  ('Garden Party','Terrasses',NULL,'Sirop de menthe','Softs / Eau / Sirops','C'),
  ('Garden Party','Terrasses',NULL,'Sirop de pêche','Softs / Eau / Sirops','C'),
  ('Garden Party','Terrasses',NULL,'Ricard classique VP','Spiritueux / Apéritifs','C'),
  ('Garden Party','Terrasses',NULL,'CO2','Gaz / Technique','R'),
  ('Garden Party','Terrasses',NULL,'Schweppes','Autres','C'),
  ('Garden Party','Terrasses',NULL,'Whisky Jameson','Autres','C'),
  -- ── Parvis Nord ──
  ('Parvis Nord','Terrasses',NULL,'Fût Bud','Bière / Fûts','R'),
  ('Parvis Nord','Terrasses',NULL,'Fût Leffe','Bière / Fûts','R'),
  ('Parvis Nord','Terrasses',NULL,'Fût Fada Abricot','Bière / Fûts','C'),
  ('Parvis Nord','Terrasses',NULL,'Fût Fada Blanche','Bière / Fûts','C'),
  ('Parvis Nord','Terrasses',NULL,'Fût Fada Blonde','Bière / Fûts','C'),
  ('Parvis Nord','Terrasses',NULL,'Fût Fada IPA','Bière / Fûts','C'),
  ('Parvis Nord','Terrasses',NULL,'Blanc Montaurone / Touloubre','Vins','C'),
  ('Parvis Nord','Terrasses',NULL,'Rosé Pey Blanc','Vins','C'),
  ('Parvis Nord','Terrasses',NULL,'Get Bodega','Spiritueux / Apéritifs','C'),
  ('Parvis Nord','Terrasses',NULL,'Ricard classique VP','Spiritueux / Apéritifs','C'),
  ('Parvis Nord','Terrasses',NULL,'CO2','Gaz / Technique','R'),
  -- ── Bistrot ──
  ('Bistrot','VIP',NULL,'Fût Bud','Bière / Fûts','S'),
  ('Bistrot','VIP',NULL,'Fût Leffe','Bière / Fûts','S'),
  ('Bistrot','VIP',NULL,'Bière en verre','Bière / Fûts','C'),
  ('Bistrot','VIP',NULL,'Fût Fada Blonde','Bière / Fûts','C'),
  ('Bistrot','VIP',NULL,'Mumm Cordon Rouge','Champagne','C'),
  ('Bistrot','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','S'),
  ('Bistrot','VIP',NULL,'Pepsi Max bouteille','Softs / Eau / Sirops','S'),
  ('Bistrot','VIP',NULL,'Pepsi bouteille','Softs / Eau / Sirops','S'),
  ('Bistrot','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','S'),
  ('Bistrot','VIP',NULL,'Sirop de grenadine','Softs / Eau / Sirops','S'),
  ('Bistrot','VIP',NULL,'Sirop de pêche','Softs / Eau / Sirops','S'),
  ('Bistrot','VIP',NULL,'Cristalline 50cl','Softs / Eau / Sirops','R'),
  ('Bistrot','VIP',NULL,'Sirop Orgeat','Softs / Eau / Sirops','R'),
  ('Bistrot','VIP',NULL,'Sirop de citron','Softs / Eau / Sirops','R'),
  ('Bistrot','VIP',NULL,'Sirop de menthe','Softs / Eau / Sirops','C'),
  ('Bistrot','VIP',NULL,'Ricard classique VP','Spiritueux / Apéritifs','S'),
  ('Bistrot','VIP',NULL,'CO2','Gaz / Technique','C'),
  ('Bistrot','VIP',NULL,'Corona','Autres','S'),
  ('Bistrot','VIP',NULL,'Corona 0° SS ALCOOL','Autres','S'),
  ('Bistrot','VIP',NULL,'Fada Abricot','Autres','S'),
  ('Bistrot','VIP',NULL,'Fada IPA','Autres','S'),
  ('Bistrot','VIP',NULL,'Schweppes','Autres','S'),
  ('Bistrot','VIP',NULL,'Whisky Jameson','Autres','S'),
  -- ── Club 70 Nord ──
  ('Club 70 Nord','VIP',NULL,'Fût Bud','Bière / Fûts','S'),
  ('Club 70 Nord','VIP',NULL,'Bière en verre','Bière / Fûts','C'),
  ('Club 70 Nord','VIP',NULL,'Fût Leffe','Bière / Fûts','C'),
  ('Club 70 Nord','VIP',NULL,'Mumm Cordon Rouge','Champagne','S'),
  ('Club 70 Nord','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','S'),
  ('Club 70 Nord','VIP',NULL,'Pepsi Max bouteille','Softs / Eau / Sirops','S'),
  ('Club 70 Nord','VIP',NULL,'Pepsi bouteille','Softs / Eau / Sirops','S'),
  ('Club 70 Nord','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','S'),
  ('Club 70 Nord','VIP',NULL,'Cristalline 50cl','Softs / Eau / Sirops','R'),
  ('Club 70 Nord','VIP',NULL,'Sirop Orgeat','Softs / Eau / Sirops','R'),
  ('Club 70 Nord','VIP',NULL,'Sirop de citron','Softs / Eau / Sirops','R'),
  ('Club 70 Nord','VIP',NULL,'Sirop de grenadine','Softs / Eau / Sirops','R'),
  ('Club 70 Nord','VIP',NULL,'Sirop de pêche','Softs / Eau / Sirops','R'),
  ('Club 70 Nord','VIP',NULL,'Sirop de menthe','Softs / Eau / Sirops','C'),
  ('Club 70 Nord','VIP',NULL,'Ricard classique VP','Spiritueux / Apéritifs','R'),
  ('Club 70 Nord','VIP',NULL,'CO2','Gaz / Technique','R'),
  ('Club 70 Nord','VIP',NULL,'Schweppes','Autres','C'),
  ('Club 70 Nord','VIP',NULL,'Whisky Jameson','Autres','C'),
  -- ── Comptoir ──
  ('Comptoir','VIP',NULL,'Fût Bud','Bière / Fûts','S'),
  ('Comptoir','VIP',NULL,'Bière en verre','Bière / Fûts','C'),
  ('Comptoir','VIP',NULL,'Fût Leffe','Bière / Fûts','C'),
  ('Comptoir','VIP',NULL,'Mumm Cordon Rouge','Champagne','C'),
  ('Comptoir','VIP',NULL,'Ricard classique VP','Spiritueux / Apéritifs','R'),
  ('Comptoir','VIP',NULL,'CO2','Gaz / Technique','P'),
  ('Comptoir','VIP',NULL,'Pastis','Autres','R'),
  ('Comptoir','VIP',NULL,'Schweppes','Autres','R'),
  ('Comptoir','VIP',NULL,'Whisky Jameson','Autres','R'),
  ('Comptoir','VIP',NULL,'San Pellegrino verre','Autres','C'),
  ('Comptoir','VIP',NULL,'Vittel verre','Autres','C'),
  -- ── Le Pub ──
  ('Le Pub','VIP',NULL,'Fût Bud','Bière / Fûts','S'),
  ('Le Pub','VIP',NULL,'Fût Leffe','Bière / Fûts','S'),
  ('Le Pub','VIP',NULL,'Bière en verre','Bière / Fûts','C'),
  ('Le Pub','VIP',NULL,'Mumm Cordon Rouge','Champagne','S'),
  ('Le Pub','VIP',NULL,'Cristalline 50cl','Softs / Eau / Sirops','S'),
  ('Le Pub','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','S'),
  ('Le Pub','VIP',NULL,'Pepsi Max bouteille','Softs / Eau / Sirops','S'),
  ('Le Pub','VIP',NULL,'Pepsi bouteille','Softs / Eau / Sirops','S'),
  ('Le Pub','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','S'),
  ('Le Pub','VIP',NULL,'Ricard classique VP','Spiritueux / Apéritifs','S'),
  ('Le Pub','VIP',NULL,'CO2','Gaz / Technique','R'),
  ('Le Pub','VIP',NULL,'Schweppes','Autres','S'),
  ('Le Pub','VIP',NULL,'Whisky Jameson','Autres','S'),
  -- ── Loges Est ──
  ('Loges Est','VIP',NULL,'Bière en verre','Bière / Fûts','S'),
  ('Loges Est','VIP',NULL,'Fût Bud','Bière / Fûts','C'),
  ('Loges Est','VIP',NULL,'Fût Leffe','Bière / Fûts','C'),
  ('Loges Est','VIP',NULL,'Mumm Cordon Rouge','Champagne','S'),
  ('Loges Est','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','S'),
  ('Loges Est','VIP',NULL,'Cristalline 50cl','Softs / Eau / Sirops','R'),
  ('Loges Est','VIP',NULL,'Pepsi bouteille','Softs / Eau / Sirops','R'),
  ('Loges Est','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','R'),
  ('Loges Est','VIP',NULL,'Pepsi Max bouteille','Softs / Eau / Sirops','C'),
  ('Loges Est','VIP',NULL,'Ricard classique VP','Spiritueux / Apéritifs','R'),
  ('Loges Est','VIP',NULL,'CO2','Gaz / Technique','C'),
  ('Loges Est','VIP',NULL,'Whisky Jameson','Autres','S'),
  ('Loges Est','VIP',NULL,'Schweppes','Autres','C'),
  -- ── Loges Ouest Nord ──
  ('Loges Ouest Nord','VIP',NULL,'Bière en verre','Bière / Fûts','S'),
  ('Loges Ouest Nord','VIP',NULL,'Fût Bud','Bière / Fûts','C'),
  ('Loges Ouest Nord','VIP',NULL,'Fût Leffe','Bière / Fûts','C'),
  ('Loges Ouest Nord','VIP',NULL,'Mumm Cordon Rouge','Champagne','S'),
  ('Loges Ouest Nord','VIP',NULL,'Cristalline 50cl','Softs / Eau / Sirops','S'),
  ('Loges Ouest Nord','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','S'),
  ('Loges Ouest Nord','VIP',NULL,'Pepsi bouteille','Softs / Eau / Sirops','S'),
  ('Loges Ouest Nord','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','S'),
  ('Loges Ouest Nord','VIP',NULL,'Ricard classique VP','Spiritueux / Apéritifs','R'),
  ('Loges Ouest Nord','VIP',NULL,'CO2','Gaz / Technique','C'),
  ('Loges Ouest Nord','VIP',NULL,'Whisky Jameson','Autres','R'),
  ('Loges Ouest Nord','VIP',NULL,'Schweppes','Autres','C'),
  -- ── Loges Ouest Sud ──
  ('Loges Ouest Sud','VIP',NULL,'Bière en verre','Bière / Fûts','R'),
  ('Loges Ouest Sud','VIP',NULL,'Fût Bud','Bière / Fûts','C'),
  ('Loges Ouest Sud','VIP',NULL,'Fût Leffe','Bière / Fûts','C'),
  ('Loges Ouest Sud','VIP',NULL,'Mumm Cordon Rouge','Champagne','R'),
  ('Loges Ouest Sud','VIP',NULL,'Cristalline 50cl','Softs / Eau / Sirops','R'),
  ('Loges Ouest Sud','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','R'),
  ('Loges Ouest Sud','VIP',NULL,'Pepsi bouteille','Softs / Eau / Sirops','R'),
  ('Loges Ouest Sud','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','R'),
  ('Loges Ouest Sud','VIP',NULL,'Ricard classique VP','Spiritueux / Apéritifs','R'),
  ('Loges Ouest Sud','VIP',NULL,'CO2','Gaz / Technique','C'),
  ('Loges Ouest Sud','VIP',NULL,'Whisky Jameson','Autres','R'),
  ('Loges Ouest Sud','VIP',NULL,'Schweppes','Autres','C'),
  -- ── PMR ──
  ('PMR','VIP',NULL,'Fût Fada Blonde','Bière / Fûts','S'),
  ('PMR','VIP',NULL,'Bière en verre','Bière / Fûts','R'),
  ('PMR','VIP',NULL,'Fût Bud','Bière / Fûts','C'),
  ('PMR','VIP',NULL,'Fût Leffe','Bière / Fûts','C'),
  ('PMR','VIP',NULL,'Mumm Cordon Rouge','Champagne','C'),
  ('PMR','VIP',NULL,'Cristalline 50cl','Softs / Eau / Sirops','S'),
  ('PMR','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','S'),
  ('PMR','VIP',NULL,'Pepsi bouteille','Softs / Eau / Sirops','S'),
  ('PMR','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','S'),
  ('PMR','VIP',NULL,'Ricard classique VP','Spiritueux / Apéritifs','C'),
  ('PMR','VIP',NULL,'CO2','Gaz / Technique','C'),
  ('PMR','VIP',NULL,'FADA ABRICOT BTL','Autres','S'),
  ('PMR','VIP',NULL,'FADA IPA BTL','Autres','C'),
  ('PMR','VIP',NULL,'Schweppes','Autres','C'),
  ('PMR','VIP',NULL,'Vin Autre','Autres','C'),
  ('PMR','VIP',NULL,'Whisky Jameson','Autres','C'),
  -- ── Salon Nord ──
  ('Salon Nord','VIP',NULL,'Fût Bud','Bière / Fûts','S'),
  ('Salon Nord','VIP',NULL,'Fût Leffe','Bière / Fûts','S'),
  ('Salon Nord','VIP',NULL,'Bière en verre','Bière / Fûts','C'),
  ('Salon Nord','VIP',NULL,'Mumm Blanc de Blanc','Champagne','S'),
  ('Salon Nord','VIP',NULL,'Mumm Cordon Rouge','Champagne','R'),
  ('Salon Nord','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','S'),
  ('Salon Nord','VIP',NULL,'Pepsi Max bouteille','Softs / Eau / Sirops','S'),
  ('Salon Nord','VIP',NULL,'Pepsi bouteille','Softs / Eau / Sirops','S'),
  ('Salon Nord','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','S'),
  ('Salon Nord','VIP',NULL,'Sirop de menthe','Softs / Eau / Sirops','R'),
  ('Salon Nord','VIP',NULL,'Sirop de pêche','Softs / Eau / Sirops','R'),
  ('Salon Nord','VIP',NULL,'Cristalline 50cl','Softs / Eau / Sirops','P'),
  ('Salon Nord','VIP',NULL,'Sirop de grenadine','Softs / Eau / Sirops','P'),
  ('Salon Nord','VIP',NULL,'Sirop Orgeat','Softs / Eau / Sirops','C'),
  ('Salon Nord','VIP',NULL,'Sirop de citron','Softs / Eau / Sirops','C'),
  ('Salon Nord','VIP',NULL,'Get Bodega','Spiritueux / Apéritifs','S'),
  ('Salon Nord','VIP',NULL,'Ricard classique VP','Spiritueux / Apéritifs','S'),
  ('Salon Nord','VIP',NULL,'CO2','Gaz / Technique','P'),
  ('Salon Nord','VIP',NULL,'Schweppes','Autres','S'),
  ('Salon Nord','VIP',NULL,'Vittel verre','Autres','S'),
  ('Salon Nord','VIP',NULL,'Whisky Jameson','Autres','S'),
  ('Salon Nord','VIP',NULL,'San Pellegrino verre','Autres','R'),
  -- ── Salon Sud ──
  ('Salon Sud','VIP',NULL,'Fût Bud','Bière / Fûts','S'),
  ('Salon Sud','VIP',NULL,'Fût Leffe','Bière / Fûts','S'),
  ('Salon Sud','VIP',NULL,'Bière en verre','Bière / Fûts','C'),
  ('Salon Sud','VIP',NULL,'Mumm Blanc de Blanc','Champagne','R'),
  ('Salon Sud','VIP',NULL,'Mumm Cordon Rouge','Champagne','R'),
  ('Salon Sud','VIP',NULL,'Blanc Galinière','Vins','S'),
  ('Salon Sud','VIP',NULL,'Blanc du Seuil','Vins','S'),
  ('Salon Sud','VIP',NULL,'Rosé Miraval','Vins','S'),
  ('Salon Sud','VIP',NULL,'Rouge Grand Boise','Vins','S'),
  ('Salon Sud','VIP',NULL,'Rouge Les Alexandrins','Vins','S'),
  ('Salon Sud','VIP',NULL,'FADA BLANCHE BTL','Vins','S'),
  ('Salon Sud','VIP',NULL,'Blanc Montaurone','Vins','R'),
  ('Salon Sud','VIP',NULL,'Lillet Blanc','Vins','R'),
  ('Salon Sud','VIP',NULL,'Lillet rosé','Vins','R'),
  ('Salon Sud','VIP',NULL,'Rosé Réal','Vins','R'),
  ('Salon Sud','VIP',NULL,'Rouge Paradis','Vins','R'),
  ('Salon Sud','VIP',NULL,'Rosé NAIS','Vins','R'),
  ('Salon Sud','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','S'),
  ('Salon Sud','VIP',NULL,'Pepsi Max bouteille','Softs / Eau / Sirops','S'),
  ('Salon Sud','VIP',NULL,'Pepsi bouteille','Softs / Eau / Sirops','S'),
  ('Salon Sud','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','R'),
  ('Salon Sud','VIP',NULL,'Sirop de citron','Softs / Eau / Sirops','R'),
  ('Salon Sud','VIP',NULL,'Cristalline 50cl','Softs / Eau / Sirops','P'),
  ('Salon Sud','VIP',NULL,'Get Bodega','Spiritueux / Apéritifs','S'),
  ('Salon Sud','VIP',NULL,'Ricard classique VP','Spiritueux / Apéritifs','R'),
  ('Salon Sud','VIP',NULL,'CO2','Gaz / Technique','C'),
  ('Salon Sud','VIP',NULL,'San Pellegrino verre','Autres','S'),
  ('Salon Sud','VIP',NULL,'Vittel verre','Autres','S'),
  ('Salon Sud','VIP',NULL,'Whisky Jameson','Autres','S'),
  ('Salon Sud','VIP',NULL,'Schweppes','Autres','R'),
  -- ── Wine Bar Nord ──
  ('Wine Bar Nord','VIP',NULL,'Bière en verre','Bière / Fûts','R'),
  ('Wine Bar Nord','VIP',NULL,'Fût Bud','Bière / Fûts','C'),
  ('Wine Bar Nord','VIP',NULL,'Fût Leffe','Bière / Fûts','C'),
  ('Wine Bar Nord','VIP',NULL,'Mumm Cordon Rouge','Champagne','C'),
  ('Wine Bar Nord','VIP',NULL,'Cristalline 50cl','Softs / Eau / Sirops','R'),
  ('Wine Bar Nord','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','R'),
  ('Wine Bar Nord','VIP',NULL,'Pepsi bouteille','Softs / Eau / Sirops','R'),
  ('Wine Bar Nord','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','R'),
  ('Wine Bar Nord','VIP',NULL,'Ricard classique VP','Spiritueux / Apéritifs','C'),
  ('Wine Bar Nord','VIP',NULL,'CO2','Gaz / Technique','C'),
  ('Wine Bar Nord','VIP',NULL,'Schweppes','Autres','C'),
  ('Wine Bar Nord','VIP',NULL,'Whisky Jameson','Autres','C'),
  -- ── Wine Bar Sud ──
  ('Wine Bar Sud','VIP',NULL,'Bière en verre','Bière / Fûts','R'),
  ('Wine Bar Sud','VIP',NULL,'Fût Bud','Bière / Fûts','C'),
  ('Wine Bar Sud','VIP',NULL,'Fût Leffe','Bière / Fûts','C'),
  ('Wine Bar Sud','VIP',NULL,'Mumm Cordon Rouge','Champagne','C'),
  ('Wine Bar Sud','VIP',NULL,'Cristalline 50cl','Softs / Eau / Sirops','R'),
  ('Wine Bar Sud','VIP',NULL,'Jus de fruits','Softs / Eau / Sirops','R'),
  ('Wine Bar Sud','VIP',NULL,'Pepsi bouteille','Softs / Eau / Sirops','R'),
  ('Wine Bar Sud','VIP',NULL,'Perrier grande bouteille','Softs / Eau / Sirops','R'),
  ('Wine Bar Sud','VIP',NULL,'Pepsi Max bouteille','Softs / Eau / Sirops','P'),
  ('Wine Bar Sud','VIP',NULL,'Ricard classique VP','Spiritueux / Apéritifs','C'),
  ('Wine Bar Sud','VIP',NULL,'CO2','Gaz / Technique','C'),
  ('Wine Bar Sud','VIP',NULL,'Schweppes','Autres','C'),
  ('Wine Bar Sud','VIP',NULL,'Whisky Jameson','Autres','C');

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Lier les product_id du catalogue (correspondance nom, insensible casse).
  UPDATE area_product_reference apr
  SET product_id = p.product_id
  FROM products p
  WHERE UPPER(TRIM(p.product_name)) = UPPER(TRIM(apr.product_name))
    AND p.active = true;

  RETURN json_build_object('success', true, 'inserted', v_count,
    'message', format('%s associations espace×produit injectées depuis CDC V3', v_count));
END;
$$;

GRANT EXECUTE ON FUNCTION inject_cdc_v3() TO authenticated;
SELECT inject_cdc_v3();

-- ══════════════════════════════════════════════════════════════════════════
-- BLOC 4 — RPC FICHE RUNNER PAR ESPACE (niveaux S/R/P/C, sans coûts)
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION get_runner_sheet_by_area(
  p_area_name  TEXT,
  p_show_level TEXT DEFAULT 'S'  -- 'S' | 'SR' | 'SRP' | 'ALL'
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN json_build_object(
    'area',  p_area_name,
    'level', p_show_level,
    'families', (
      SELECT COALESCE(JSON_AGG(fam ORDER BY fam->>'family'), '[]'::json)
      FROM (
        SELECT JSON_BUILD_OBJECT(
          'family', apr.product_family,
          'products', JSON_AGG(JSON_BUILD_OBJECT(
            'product_name',      apr.product_name,
            'association_level', apr.association_level,
            'is_default',        apr.is_default,
            'product_id',        apr.product_id,
            'recommended_qty',   spc.recommended_qty,
            'avg_conso',         spc.avg_consumption
          ) ORDER BY apr.association_level, apr.product_name)
        ) AS fam
        FROM area_product_reference apr
        LEFT JOIN spaces s
          ON UPPER(TRIM(s.space_name)) = UPPER(TRIM(apr.area_name))
        LEFT JOIN space_product_coefficients spc
          ON spc.space_id = s.space_id AND spc.product_id = apr.product_id
        WHERE UPPER(TRIM(apr.area_name)) = UPPER(TRIM(p_area_name))
          AND CASE p_show_level
            WHEN 'S'   THEN apr.association_level IN ('S')
            WHEN 'SR'  THEN apr.association_level IN ('S','R')
            WHEN 'SRP' THEN apr.association_level IN ('S','R','P')
            ELSE TRUE
          END
        GROUP BY apr.product_family
      ) sub
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_runner_sheet_by_area(TEXT, TEXT) TO authenticated;

-- ── 20260707090046_cdc_buvette_supervisors_runner_filter.sql ──
-- ═══════════════════════════════════════════════════════════════════════════
-- cdc_buvette_supervisors_runner_filter.sql
--
-- Bug : la fiche « Runner — Buvette 2 » affichait des produits VIP (Mumm, Rosé,
-- Lillet, Whisky, Bière en verre). Cause : la génération runner
-- (useRunnerPlanning) prend TOUS les produits présents dans area_stocks /
-- event_consumptions de l'espace, sans filtre gamme/CDC. Les espaces
-- superviseurs « Buvette 1 »/« Buvette 2 » n'avaient en plus AUCUNE entrée dans
-- area_product_reference → impossible de filtrer par CDC.
--
-- Ce correctif :
--   1) Ajoute la gamme CDC de base (fûts + softs + sirops + CO2) pour les
--      espaces superviseurs « Buvette 1 » et « Buvette 2 ». cdc_version distinct
--      'V3-super' → inject_cdc_v3() (qui purge WHERE cdc_version='V3') ne les
--      supprime pas. Idempotent (ON CONFLICT DO NOTHING).
--   2) Purge les lignes runner_auto_planning déjà générées pour des espaces
--      buvette dont le produit n'appartient PAS au CDC de l'espace (retire les
--      vins/champagnes/spiritueux/bière en verre infiltrés).
--
-- Le filtre CDC est appliqué en amont côté client (useRunnerPlanning) pour que
-- toute future génération reste propre.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO area_product_reference
  (area_name, area_group, product_name, product_family, association_level, cdc_version)
VALUES
  ('Buvette 1','Buvettes','Fût Bud','Bière / Fûts','S','V3-super'),
  ('Buvette 1','Buvettes','Fût Goose Island IPA','Bière / Fûts','S','V3-super'),
  ('Buvette 1','Buvettes','Fût Hoegaarden Blanche','Bière / Fûts','S','V3-super'),
  ('Buvette 1','Buvettes','Fût Leffe','Bière / Fûts','S','V3-super'),
  ('Buvette 1','Buvettes','Cristalline 50cl','Softs / Eau / Sirops','S','V3-super'),
  ('Buvette 1','Buvettes','Ice Tea 50cl','Softs / Eau / Sirops','S','V3-super'),
  ('Buvette 1','Buvettes','Orangina 50cl','Softs / Eau / Sirops','S','V3-super'),
  ('Buvette 1','Buvettes','Pepsi 50cl','Softs / Eau / Sirops','S','V3-super'),
  ('Buvette 1','Buvettes','San Pellegrino 50cl','Softs / Eau / Sirops','S','V3-super'),
  ('Buvette 1','Buvettes','Sirop de pêche','Softs / Eau / Sirops','S','V3-super'),
  ('Buvette 1','Buvettes','Sirop de grenadine','Softs / Eau / Sirops','R','V3-super'),
  ('Buvette 1','Buvettes','Sirop de menthe','Softs / Eau / Sirops','P','V3-super'),
  ('Buvette 1','Buvettes','Sirop de citron','Softs / Eau / Sirops','P','V3-super'),
  ('Buvette 1','Buvettes','CO2','Gaz / Technique','P','V3-super'),
  ('Buvette 2','Buvettes','Fût Bud','Bière / Fûts','S','V3-super'),
  ('Buvette 2','Buvettes','Fût Goose Island IPA','Bière / Fûts','S','V3-super'),
  ('Buvette 2','Buvettes','Fût Hoegaarden Blanche','Bière / Fûts','S','V3-super'),
  ('Buvette 2','Buvettes','Fût Leffe','Bière / Fûts','S','V3-super'),
  ('Buvette 2','Buvettes','Cristalline 50cl','Softs / Eau / Sirops','S','V3-super'),
  ('Buvette 2','Buvettes','Ice Tea 50cl','Softs / Eau / Sirops','S','V3-super'),
  ('Buvette 2','Buvettes','Orangina 50cl','Softs / Eau / Sirops','S','V3-super'),
  ('Buvette 2','Buvettes','Pepsi 50cl','Softs / Eau / Sirops','S','V3-super'),
  ('Buvette 2','Buvettes','San Pellegrino 50cl','Softs / Eau / Sirops','S','V3-super'),
  ('Buvette 2','Buvettes','Sirop de pêche','Softs / Eau / Sirops','S','V3-super'),
  ('Buvette 2','Buvettes','Sirop de grenadine','Softs / Eau / Sirops','R','V3-super'),
  ('Buvette 2','Buvettes','Sirop de menthe','Softs / Eau / Sirops','P','V3-super'),
  ('Buvette 2','Buvettes','Sirop de citron','Softs / Eau / Sirops','P','V3-super'),
  ('Buvette 2','Buvettes','CO2','Gaz / Technique','P','V3-super')
ON CONFLICT (area_name, product_name) DO NOTHING;

-- Lier les product_id du catalogue (mêmes règles que inject_cdc_v3).
UPDATE area_product_reference apr
SET product_id = p.product_id
FROM products p
WHERE apr.cdc_version = 'V3-super'
  AND apr.product_id IS NULL
  AND UPPER(TRIM(p.product_name)) = UPPER(TRIM(apr.product_name))
  AND p.active = true;

-- Purge des lignes runner déjà générées hors CDC pour les espaces buvette.
DELETE FROM runner_auto_planning rap
USING spaces s
WHERE rap.space_id = s.space_id
  AND s.service_type = 'buvette'
  AND NOT EXISTS (
    SELECT 1 FROM area_product_reference apr
    WHERE UPPER(TRIM(apr.area_name)) = UPPER(TRIM(s.space_name))
      AND apr.product_id = rap.product_id
  );

COMMIT;
