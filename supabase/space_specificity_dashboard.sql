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
  COUNT(*) FILTER (WHERE event_type = 'match'
    AND event_date >= DATE_TRUNC('month', CURRENT_DATE))            AS matchs_ce_mois,
  COALESCE(SUM(total_fb_cost_ht) FILTER (
    WHERE status IN ('clôturé','archivé')
      AND event_date >= DATE_TRUNC('year', CURRENT_DATE)), 0)       AS fb_annuel_ht,
  COUNT(*) FILTER (WHERE status IN ('clôturé','archivé')
    AND event_date >= DATE_TRUNC('year', CURRENT_DATE))             AS clotures_annee
FROM events;

-- RG-003 : ces vues portent des coûts → réservées à l'admin authentifié.
ALTER VIEW dashboard_vip_spaces_status SET (security_invoker = on);
ALTER VIEW dashboard_kpis              SET (security_invoker = on);
GRANT SELECT ON dashboard_vip_spaces_status, dashboard_kpis TO authenticated;
REVOKE SELECT ON dashboard_vip_spaces_status, dashboard_kpis FROM anon;
