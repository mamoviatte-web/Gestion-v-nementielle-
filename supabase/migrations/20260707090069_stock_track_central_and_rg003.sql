-- Fiabilisation des balances de stock :
--  - BLOC 4 : drapeau products.track_central_stock (défaut true) pour exclure du
--    suivi/alertes central les produits uniquement livrés par événement (Vins/
--    Ricard en VIP…), de façon propre et réversible (aucune exclusion par défaut).
--    La vue stock_live_balance filtre désormais sur ce drapeau.
--  - RG-003 : stock_live_balance expose unit_price_ht / valeur_depot_ht mais avait
--    un SELECT accordé à anon → retiré (aucun écran anon ne la consomme ; seuls
--    les écrans admin ROLE_STADE via useDepots).

ALTER TABLE products ADD COLUMN IF NOT EXISTS track_central_stock boolean NOT NULL DEFAULT true;

CREATE OR REPLACE VIEW stock_live_balance AS
 SELECT p.product_id,
    p.product_name,
    p.category,
    p.unit,
    p.unit_price_ht,
    p.min_stock,
    sum(sb.current_quantity) FILTER (WHERE sl.name ILIKE 'AUC%') AS qty_auc,
    sum(sb.current_quantity) FILTER (WHERE sl.name ILIKE '%EST%') AS qty_est,
    sum(sb.current_quantity) FILTER (WHERE sl.name ILIKE '%Fût%') AS qty_futs,
    COALESCE(sum(sb.current_quantity) FILTER (WHERE sl.location_type = 'reserve_centrale'::text), 0::numeric) AS qty_total_depot,
    COALESCE(( SELECT sum(esl.initial_qty + COALESCE(esl.reassort_qty, 0)) AS sum
           FROM event_stock_lines esl
             JOIN events e ON e.event_id = esl.event_id
          WHERE esl.product_id = p.product_id AND e.status = 'en_cours'::text AND esl.final_qty IS NULL), 0::bigint) AS qty_in_event,
    COALESCE(sum(sb.current_quantity) FILTER (WHERE sl.location_type = 'reserve_centrale'::text), 0::numeric) * COALESCE(p.unit_price_ht, 0::numeric) AS valeur_depot_ht,
        CASE
            WHEN COALESCE(sum(sb.current_quantity) FILTER (WHERE sl.location_type = 'reserve_centrale'::text), 0::numeric) = 0::numeric THEN 'rupture'::text
            WHEN p.min_stock IS NOT NULL AND p.min_stock > 0 AND COALESCE(sum(sb.current_quantity) FILTER (WHERE sl.location_type = 'reserve_centrale'::text), 0::numeric) < p.min_stock::numeric THEN 'critique'::text
            ELSE 'ok'::text
        END AS alert_status,
    pdr.depot_name AS source_depot
   FROM products p
     LEFT JOIN stock_balances sb ON sb.product_id = p.product_id
     LEFT JOIN stock_locations sl ON sl.id = sb.location_id
     LEFT JOIN product_depot_routing pdr ON pdr.product_id = p.product_id
  WHERE p.active = true AND COALESCE(p.track_central_stock, true)
  GROUP BY p.product_id, p.product_name, p.category, p.unit, p.unit_price_ht, p.min_stock, pdr.depot_name
  ORDER BY p.category, p.product_name;

REVOKE SELECT ON stock_live_balance FROM anon;
