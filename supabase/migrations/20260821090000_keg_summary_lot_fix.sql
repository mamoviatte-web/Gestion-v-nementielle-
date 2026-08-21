-- ═══════════════════════════════════════════════════════════════════════════
-- Correctif keg_summary : une réception de fûts AVEC numéro de lot n'était pas
-- comptée dans les fûts pleins (les CTE `recu` et `era` filtraient lot_reference
-- IS NULL). register_keg_reception écrit le lot dans lot_reference → la réception
-- « disparaissait » du stock. On retire ce filtre : toute réception (event_id
-- NULL, status plein) compte, avec ou sans lot. Aucune ligne actuelle affectée.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.keg_summary AS
 WITH cnt AS (
         SELECT DISTINCT ON (keg_inventory_counts.product_id) keg_inventory_counts.product_id,
            keg_inventory_counts.counted_full,
            keg_inventory_counts.counted_at
           FROM keg_inventory_counts
          ORDER BY keg_inventory_counts.product_id, keg_inventory_counts.counted_at DESC
        ), recu AS (
         SELECT ki.product_id,
            sum(ki.qty) AS recu_total,
            sum(ki.qty) FILTER (WHERE c_1.counted_at IS NOT NULL AND ki.received_at > c_1.counted_at) AS recu_since
           FROM keg_inventory ki
             LEFT JOIN cnt c_1 ON c_1.product_id = ki.product_id
          WHERE ki.status = 'plein'::text AND ki.event_id IS NULL AND ki.received_at IS NOT NULL
          GROUP BY ki.product_id
        ), era AS (
         SELECT COALESCE(min(keg_inventory.received_at), now()) AS d0
           FROM keg_inventory
          WHERE keg_inventory.status = 'plein'::text AND keg_inventory.event_id IS NULL AND keg_inventory.received_at IS NOT NULL
        ), conso AS (
         SELECT esl.product_id,
            sum(GREATEST(COALESCE(esl.consumed_qty, 0), 0)) FILTER (WHERE e.event_date >= (( SELECT era.d0::date AS d0
                   FROM era))) AS conso_era,
            sum(GREATEST(COALESCE(esl.consumed_qty, 0), 0)) FILTER (WHERE c_1.counted_at IS NOT NULL AND e.event_date > c_1.counted_at::date) AS conso_since
           FROM event_stock_lines esl
             JOIN events e ON e.event_id = esl.event_id AND (lower(COALESCE(e.status, ''::text)) = ANY (ARRAY['clôturé'::text, 'cloture'::text, 'archivé'::text, 'archive'::text]))
             JOIN spaces s ON s.space_id = esl.space_id AND s.space_name <> 'Purge tireuses'::text
             LEFT JOIN cnt c_1 ON c_1.product_id = esl.product_id
          GROUP BY esl.product_id
        ), purge AS (
         SELECT esl.product_id,
            sum(GREATEST(COALESCE(esl.consumed_qty, 0), 0)) AS purge_total,
            sum(GREATEST(COALESCE(esl.consumed_qty, 0), 0)) FILTER (WHERE c_1.counted_at IS NOT NULL AND e.event_date > c_1.counted_at::date) AS purge_since
           FROM event_stock_lines esl
             JOIN spaces s ON s.space_id = esl.space_id AND s.space_name = 'Purge tireuses'::text
             JOIN events e ON e.event_id = esl.event_id
             LEFT JOIN cnt c_1 ON c_1.product_id = esl.product_id
          GROUP BY esl.product_id
        ), en_espace AS (
         SELECT esl.product_id,
            sum(GREATEST(COALESCE(esl.initial_qty, 0) + COALESCE(esl.reassort_qty, 0), 0)) AS qte
           FROM event_stock_lines esl
             JOIN events e ON e.event_id = esl.event_id AND (lower(COALESCE(e.status, ''::text)) <> ALL (ARRAY['clôturé'::text, 'cloture'::text, 'archivé'::text, 'archive'::text]))
             JOIN spaces s ON s.space_id = esl.space_id AND s.space_name <> 'Purge tireuses'::text
          GROUP BY esl.product_id
        ), vide_phys AS (
         SELECT keg_inventory.product_id,
            sum(keg_inventory.qty) AS qte
           FROM keg_inventory
          WHERE keg_inventory.status = 'vide'::text
          GROUP BY keg_inventory.product_id
        )
 SELECT p.product_id,
    p.product_name,
    p.unit,
    p.unit_price_ht,
    COALESCE(kvs.volume_liters, 0::numeric)::numeric(6,2) AS volume_unit,
    GREATEST(
        CASE
            WHEN cnt.counted_at IS NOT NULL THEN cnt.counted_full + COALESCE(r.recu_since, 0::bigint) - COALESCE(c.conso_since, 0::bigint) - COALESCE(pu.purge_since, 0::bigint)
            ELSE COALESCE(r.recu_total, 0::bigint) - COALESCE(c.conso_era, 0::bigint) - COALESCE(pu.purge_total, 0::bigint) - COALESCE(en.qte, 0::bigint)
        END, 0::bigint) AS pleins,
    COALESCE(en.qte, 0::bigint) AS en_espace,
    COALESCE(vp.qte, 0::bigint) AS vides,
    0::bigint AS retournes,
    GREATEST(
        CASE
            WHEN cnt.counted_at IS NOT NULL THEN cnt.counted_full + COALESCE(r.recu_since, 0::bigint) - COALESCE(c.conso_since, 0::bigint) - COALESCE(pu.purge_since, 0::bigint)
            ELSE COALESCE(r.recu_total, 0::bigint) - COALESCE(c.conso_era, 0::bigint) - COALESCE(pu.purge_total, 0::bigint) - COALESCE(en.qte, 0::bigint)
        END, 0::bigint)::numeric * COALESCE(kvs.volume_liters, 0::numeric) AS litres_disponibles
   FROM products p
     LEFT JOIN cnt ON cnt.product_id = p.product_id
     LEFT JOIN recu r ON r.product_id = p.product_id
     LEFT JOIN conso c ON c.product_id = p.product_id
     LEFT JOIN purge pu ON pu.product_id = p.product_id
     LEFT JOIN en_espace en ON en.product_id = p.product_id
     LEFT JOIN vide_phys vp ON vp.product_id = p.product_id
     LEFT JOIN keg_volume_standards kvs ON kvs.product_id = p.product_id
  WHERE p.active = true AND (p.product_name ~~* '%Fût%'::text OR p.product_name ~~* 'CO2%'::text);
