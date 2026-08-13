-- ═══════════════════════════════════════════════════════════════════════════
-- runner_board_consumption_reference.sql — expose consumption_reference sur la
-- vue event_runner_board pour distinguer, à l'affichage des fiches runner, les
-- produits issus de l'historique de conso (complément) des produits de socle.
--
-- Contexte : generate_runner_dotations génère désormais l'union « socle CDC +
-- complément historique » (le vin des espaces VIP/Bars réapparaît). Un produit
-- avec consumption_reference > 0 a un historique de consommation dans l'espace
-- → badge « historique » côté front (informatif).
--
-- Additif : ajoute UNE colonne en fin de vue (RG-003 : réservé ROLE_STADE,
-- garde inchangée). Aucun autre changement.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW event_runner_board AS
 WITH reserve AS (
         SELECT b.product_id,
            sum(b.current_quantity) AS reserve_qty
           FROM stock_balances b
             JOIN stock_locations l ON l.id = b.location_id
          WHERE l.location_type = 'reserve_centrale'::text
          GROUP BY b.product_id
        ), demand AS (
         SELECT runner_auto_planning.event_id,
            runner_auto_planning.product_id,
            sum(GREATEST(COALESCE(runner_auto_planning.quantity_to_move, 0), 0)) AS event_demand
           FROM runner_auto_planning
          GROUP BY runner_auto_planning.event_id, runner_auto_planning.product_id
        )
 SELECT rap.event_id,
    rap.space_id,
    s.space_name,
        CASE
            WHEN s.service_type = ANY (ARRAY['buvette'::text, 'bar'::text]) THEN 'Buvettes'::text
            ELSE 'VIP'::text
        END AS family,
    s.service_type,
    rap.product_id,
    p.product_name,
    p.category,
    COALESCE(rap.validated_quantity, rap.recommended_quantity) AS needed_qty,
    GREATEST(COALESCE(rap.quantity_to_move, 0), 0) AS qty_to_move,
    COALESCE(rap.initial_area_stock, 0) AS area_stock,
    COALESCE(res.reserve_qty, 0::numeric) AS reserve_qty,
    COALESCE(dem.event_demand, 0::bigint) AS event_demand,
    round(COALESCE(rap.estimated_cost_ht, 0::numeric), 2) AS cost_ht,
    rap.validation_status,
    rap.alert_type,
    COALESCE(res.reserve_qty, 0::numeric) >= COALESCE(dem.event_demand, 0::bigint)::numeric AS stock_sufficient_live,
    GREATEST(COALESCE(dem.event_demand, 0::bigint)::numeric - COALESCE(res.reserve_qty, 0::numeric), 0::numeric) AS shortfall_qty,
    COALESCE(rap.consumption_reference, 0::numeric) AS consumption_reference
   FROM runner_auto_planning rap
     JOIN event_spaces es ON es.event_id = rap.event_id AND es.space_id = rap.space_id
     JOIN spaces s ON s.space_id = rap.space_id
     LEFT JOIN products p ON p.product_id = rap.product_id
     LEFT JOIN reserve res ON res.product_id = rap.product_id
     LEFT JOIN demand dem ON dem.event_id = rap.event_id AND dem.product_id = rap.product_id;
