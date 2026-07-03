-- ═══════════════════════════════════════════════════════════════════
-- 3 améliorations zone responsable — objets DB.
-- NOTE : au moment de cette session, TOUS ces objets étaient DÉJÀ appliqués
-- en base (vérifiés via MCP). Ce fichier documente la couche DB attendue par
-- le front ; il est idempotent si ré-exécuté.
-- ═══════════════════════════════════════════════════════════════════

-- ── Amélioration 2 : horaires auto-déclarés + rapport mensuel ───────
-- schedules : colonnes declared_by_self / self_declared_at (présentes).
-- Index partiel unique pour l'upsert par (event, space, staff) auto-déclaré :
CREATE UNIQUE INDEX IF NOT EXISTS uniq_schedules_self_declared
  ON schedules(event_id, space_id, staff_name) WHERE declared_by_self;

-- monthly_staff_reports (table) + generate_monthly_staff_report(date) (fonction)
-- + RLS stade : voir migrations appliquées. La fonction agrège planned/actual/
-- overtime par staff_name × space × mois (événements clôturés/archivés).

-- submit_zone_schedule(p_token, p_responsible_name, p_arrival, p_departure, p_staff_name)
--   → met à jour event_spaces ET upsert une ligne schedules auto-déclarée
--     (staff_name en MAJUSCULES, declared_by_self=true) pour le rapport mensuel.

-- ── Amélioration 3 : débrief enrichi (scores ménage / technique / urgent) ──
-- debriefs : colonnes cleaning_score, cleaning_before_ok, cleaning_after_ok,
--   cleaning_issues[], cleaning_comment, technical_score, tech_fridge_ok,
--   tech_equipment_ok, tech_lighting_ok, tech_plumbing_ok, tech_hvac_ok,
--   tech_issues[], technical_comment, service_score, overall_rating,
--   has_urgent_issue, urgent_issue_detail, urgent_notified (présentes).
-- submit_zone_debrief(..., p_payload jsonb) : upsert de tous ces champs depuis un JSONB.
-- get_zone_state(token) : renvoie staff_name + le débrief enrichi complet (préremplissage).
-- Vue debrief_scores_analytics : moyennes service/ménage/technique par espace × mois
--   + problèmes ménage/technique les plus fréquents (mode()).

-- ── Amélioration 1 : filtrage stock final ──────────────────────────
-- 100 % côté front (ZoneDashboard) : le stock final n'affiche que les produits
-- avec initial_qty>0 OU reassort_qty>0, avec alerte RG-004 temps réel. Aucun objet DB.
