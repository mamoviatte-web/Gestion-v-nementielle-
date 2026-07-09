-- ═══════════════════════════════════════════════════════════════════════════
-- audit_corrections.sql — Corrections non destructives de l'audit pré-production.
--
-- Adaptations au schéma réel : event_stock_lines n'a PAS de colonne
-- buvette_zone_id (pas de table buvette_zones) → index correspondant omis.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── AUDIT 4 : index de performance (jointures fréquentes) ───────────────────
CREATE INDEX IF NOT EXISTS idx_esl_event_id     ON event_stock_lines(event_id);
CREATE INDEX IF NOT EXISTS idx_esl_space_id     ON event_stock_lines(space_id);
CREATE INDEX IF NOT EXISTS idx_esl_product_id   ON event_stock_lines(product_id);
CREATE INDEX IF NOT EXISTS idx_esl_event_space  ON event_stock_lines(event_id, space_id);
CREATE INDEX IF NOT EXISTS idx_schedules_event  ON schedules(event_id);
CREATE INDEX IF NOT EXISTS idx_schedules_space  ON schedules(space_id);
CREATE INDEX IF NOT EXISTS idx_zsh_event_space  ON zone_staff_hours(event_id, space_id);
CREATE INDEX IF NOT EXISTS idx_photos_event_type ON debrief_photos(event_id, photo_type);
CREATE INDEX IF NOT EXISTS idx_mas_token        ON match_access_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_mas_event_space  ON match_access_sessions(event_id, space_id);
CREATE INDEX IF NOT EXISTS idx_events_status    ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_type_date ON events(event_type, event_date DESC);

-- ── AUDIT 10.3 : désactiver l'espace parasite restant (0 référence) ─────────
-- « Buvette Virage Toinou » n'a aucune ligne de stock / dotation / event_spaces
-- et est déjà filtré de tous les flux → désactivation (soft, historique préservé).
UPDATE spaces SET active = false WHERE space_name = 'Buvette Virage Toinou' AND active = true;

-- ── AUDIT 1H : nettoyage des sessions anonymes expirées (> 48 h) ────────────
UPDATE match_access_sessions SET is_active = false
WHERE is_active = true AND connected_at < now() - INTERVAL '48 hours';
