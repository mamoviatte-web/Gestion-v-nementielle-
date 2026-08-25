-- Fiche runner / liste de courses — réserve fûts alignée sur le stock réel
-- ============================================================================
-- Problème : la colonne « Stock réserve » du board runner (et donc la liste de
-- courses) lisait la réserve UNIQUEMENT depuis stock_balances (reserve_centrale).
-- Or les FÛTS + CO2 sont pilotés par un sous-système dédié (keg_inventory →
-- vue keg_true_balance : reçus − consommés − purges), qui est le stock
-- physiquement exact affiché sur le tableau « Fûts ». Les deux sources avaient
-- dérivé (ex. Fût BUD : réel 122 vs stock_balances 174 ; Fût FADA Blanche :
-- réel 9 vs stock_balances 1). La liste de courses affichait donc de faux
-- disponibles → besoins/manques erronés.
--
-- Correctif : la réserve du board provient désormais de la SOURCE AUTORITAIRE
-- par type de produit :
--   • produits « fûts / CO2 » présents dans keg_true_balance → pleins_theoriques
--     (le même chiffre que le tableau Fûts) ;
--   • tous les autres produits → stock_balances (reserve_centrale), inchangé.
-- Seule la CTE `reserve` change ; les colonnes du board sont identiques.

CREATE OR REPLACE VIEW public.event_runner_board AS
 WITH reserve AS (
         SELECT p.product_id,
            CASE
                WHEN ktb.product_id IS NOT NULL THEN ktb.pleins_theoriques::numeric
                ELSE COALESCE(sb.reserve_qty, 0::numeric)
            END AS reserve_qty
           FROM products p
             LEFT JOIN keg_true_balance ktb ON ktb.product_id = p.product_id
             LEFT JOIN ( SELECT b.product_id,
                    sum(b.current_quantity) AS reserve_qty
                   FROM stock_balances b
                     JOIN stock_locations l ON l.id = b.location_id
                  WHERE l.location_type = 'reserve_centrale'::text
                  GROUP BY b.product_id) sb ON sb.product_id = p.product_id
          WHERE ktb.product_id IS NOT NULL OR sb.product_id IS NOT NULL
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
