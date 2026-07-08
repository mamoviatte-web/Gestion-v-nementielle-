-- ═══════════════════════════════════════════════════════════════════════════
-- charges_dashboard.sql — Vues du tableau de bord « Contrôle de charges ».
--
-- ⚠ Adaptation au schéma réel : le P&L des séminaires vit dans
-- seminar_report_draft (ca_ht, gain_net…), PAS dans event_commercial_data
-- (vide). Les coûts F&B/RH/externes viennent de event_stock_summary +
-- get_event_costs (source unique, qui intègre déjà RH + occasionnels + externes).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── VUE 1 : charges_fb_by_event — coûts par événement + P&L ─────────────────
CREATE OR REPLACE VIEW charges_fb_by_event AS
WITH gc AS (
  SELECT e.event_id,
         (get_event_costs(e.event_id)->>'rh_cost')::numeric        AS rh,
         (get_event_costs(e.event_id)->>'external_cost_ht')::numeric AS ext,
         (get_event_costs(e.event_id)->>'total_cost_ht')::numeric   AS total
  FROM events e
  WHERE e.status IN ('clôturé', 'archivé')
)
SELECT
  e.event_id,
  e.event_name,
  e.event_type,
  e.event_date,
  e.status,
  COALESCE(e.expected_attendees, 0)                                          AS pax,
  COALESCE(SUM(ess.cost_ht) FILTER (WHERE ess.category = 'Vins'), 0)        AS vins_ht,
  COALESCE(SUM(ess.cost_ht) FILTER (WHERE ess.category = 'Bières'), 0)      AS bieres_ht,
  COALESCE(SUM(ess.cost_ht) FILTER (WHERE ess.category = 'Soft'), 0)        AS soft_ht,
  COALESCE(SUM(ess.cost_ht) FILTER (WHERE ess.category = 'Sirops'), 0)      AS sirops_ht,
  COALESCE(SUM(ess.cost_ht) FILTER (WHERE ess.category = 'Spiritueux'), 0)  AS spiritueux_ht,
  COALESCE(SUM(ess.cost_ht) FILTER (WHERE ess.category = 'Matériel'), 0)    AS materiel_ht,
  COALESCE(SUM(ess.cost_ht), 0)                                            AS total_fb_ht,
  CASE WHEN COALESCE(e.expected_attendees, 0) > 0
    THEN ROUND(COALESCE(SUM(ess.cost_ht), 0) / e.expected_attendees, 4)
    ELSE 0 END                                                             AS fb_per_pax,
  COUNT(ess.product_id) FILTER (WHERE ess.is_missing_cloture)              AS missing_clotures,
  COUNT(ess.product_id) FILTER (WHERE ess.is_missing_price)                AS missing_prices,
  COALESCE(MAX(gc.rh), 0)                                                  AS rh_ht,
  COALESCE(MAX(gc.ext), 0)                                                 AS external_ht,
  COALESCE(MAX(gc.total), 0)                                               AS total_charges_ht,
  COALESCE(MAX(srd.ca_ht), 0)                                              AS ca_ht,
  COALESCE(MAX(srd.ca_ht), 0) - COALESCE(MAX(gc.total), 0)                AS gain_net_ht,
  CASE WHEN COALESCE(MAX(srd.ca_ht), 0) > 0
    THEN ROUND((COALESCE(MAX(srd.ca_ht), 0) - COALESCE(MAX(gc.total), 0))
               / MAX(srd.ca_ht) * 100, 2)
    ELSE 0 END                                                            AS marge_pct
FROM events e
LEFT JOIN event_stock_summary ess   ON ess.event_id = e.event_id
LEFT JOIN gc                         ON gc.event_id = e.event_id
LEFT JOIN seminar_report_draft srd   ON srd.event_id = e.event_id
WHERE e.status IN ('clôturé', 'archivé')
GROUP BY e.event_id, e.event_name, e.event_type, e.event_date, e.status,
         e.expected_attendees;

-- ── VUE 2 : charges_products_ranking — top produits coûteux ─────────────────
CREATE OR REPLACE VIEW charges_products_ranking AS
SELECT
  ess.product_id,
  ess.product_name,
  ess.category,
  ess.unit,
  ess.unit_price_ht,
  COUNT(DISTINCT ess.event_id)     AS nb_events,
  SUM(ess.consumed_qty)            AS total_consumed,
  COALESCE(SUM(ess.cost_ht), 0)    AS total_cost_ht,
  ROUND(AVG(ess.cost_ht), 2)       AS avg_cost_per_event,
  ROUND(AVG(ess.consumed_qty), 2)  AS avg_consumed_per_event
FROM event_stock_summary ess
JOIN events e ON e.event_id = ess.event_id
WHERE e.status IN ('clôturé', 'archivé')
  AND ess.cost_ht IS NOT NULL AND ess.cost_ht > 0
GROUP BY ess.product_id, ess.product_name, ess.category, ess.unit, ess.unit_price_ht
ORDER BY total_cost_ht DESC;

-- ── VUE 3 : charges_external_by_event — prestataires par événement ──────────
CREATE OR REPLACE VIEW charges_external_by_event AS
SELECT
  e.event_id,
  e.event_name,
  e.event_type,
  e.event_date,
  COALESCE(e.expected_attendees, 0)  AS pax,
  eec.charge_type,
  eec.provider_name,
  SUM(eec.amount_ht)                 AS total_ht,
  COUNT(eec.id)                      AS nb_charges,
  BOOL_AND(eec.is_confirmed)         AS all_confirmed,
  CASE WHEN COALESCE(e.expected_attendees, 0) > 0
    THEN ROUND(SUM(eec.amount_ht) / e.expected_attendees, 2) ELSE 0 END AS cost_per_pax
FROM events e
JOIN event_external_charges eec ON eec.event_id = e.event_id
WHERE e.status IN ('clôturé', 'archivé', 'en_cours')
GROUP BY e.event_id, e.event_name, e.event_type, e.event_date,
         e.expected_attendees, eec.charge_type, eec.provider_name
ORDER BY e.event_date DESC, eec.charge_type;

-- ── VUE 4 : charges_traiteurs_summary — synthèse traiteurs ──────────────────
CREATE OR REPLACE VIEW charges_traiteurs_summary AS
WITH gc AS (
  SELECT e.event_id, (get_event_costs(e.event_id)->>'fb_cost_ht')::numeric AS fb
  FROM events e WHERE e.status IN ('clôturé', 'archivé')
)
SELECT
  e.event_id,
  e.event_name,
  e.event_type,
  e.event_date,
  COALESCE(e.expected_attendees, 0)  AS pax,
  eec.provider_name                  AS traiteur_name,
  SUM(eec.amount_ht)                 AS traiteur_ht,
  SUM(eec.amount_ttc)                AS traiteur_ttc,
  CASE WHEN COALESCE(e.expected_attendees, 0) > 0
    THEN ROUND(SUM(eec.amount_ht) / e.expected_attendees, 2) ELSE 0 END AS traiteur_per_pax,
  BOOL_AND(eec.is_confirmed)         AS facture_confirmee,
  COALESCE(MAX(gc.fb), 0)            AS fb_cost_ht,
  COALESCE(MAX(srd.ca_ht), 0)        AS ca_ht,
  CASE WHEN COALESCE(MAX(srd.ca_ht), 0) > 0
    THEN ROUND(SUM(eec.amount_ht) / MAX(srd.ca_ht) * 100, 1) ELSE 0 END AS pct_ca
FROM events e
JOIN event_external_charges eec ON eec.event_id = e.event_id AND eec.charge_type = 'traiteur'
LEFT JOIN gc ON gc.event_id = e.event_id
LEFT JOIN seminar_report_draft srd ON srd.event_id = e.event_id
WHERE e.status IN ('clôturé', 'archivé')
GROUP BY e.event_id, e.event_name, e.event_type, e.event_date,
         e.expected_attendees, eec.provider_name
ORDER BY e.event_date DESC;

GRANT SELECT ON charges_fb_by_event, charges_products_ranking,
  charges_external_by_event, charges_traiteurs_summary TO authenticated;
