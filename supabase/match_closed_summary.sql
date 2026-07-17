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
