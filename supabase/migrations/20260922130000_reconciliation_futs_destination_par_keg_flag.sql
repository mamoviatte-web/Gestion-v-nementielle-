-- =====================================================================
-- RÉCONCILIATION FÛTS — DESTINATION DES PLEINS SELON LE BON DRAPEAU
-- ---------------------------------------------------------------------
-- La vue event_keg_reconciliation classait la destination des fûts pleins
-- restants avec `retains_stock` :
--     CASE WHEN retains_stock THEN 'garde_sur_place' ELSE 'retour_stockage'.
-- Or `retains_stock` = « l'espace conserve son stock (vins, bouteilles) d'un
-- match à l'autre » — VRAI pour les salons VIP et les bars. Mais ces espaces
-- ne conservent PAS leurs FÛTS : ils les tirent depuis la réserve centrale.
-- Le bon drapeau pour les fûts est `retain_kegs_in_espace` (VRAI seulement pour
-- les buvettes EST à cave dédiée).
--
-- Conséquence du bug : les fûts pleins restants d'un salon VIP / bar étaient
-- annoncés « gardés sur place » (garde_sur_place) au lieu de « ramenés en
-- stockage central » (retour_stockage) → reporting faux + alerte
-- garde_hors_regle à tort dans l'opérateur de contrôle.
--
-- Correctif : destination_pleins = 'garde_sur_place' UNIQUEMENT si
-- retain_kegs_in_espace = true, sinon 'retour_stockage'. Cohérent avec le
-- correctif 20260922110000 (solde fût espace = 0 pour les espaces non conservés).
-- =====================================================================

create or replace view public.event_keg_reconciliation as
 select esl.event_id,
    esl.space_id,
    s.space_name,
    s.service_type,
        case
            when s.service_type = 'buvette'::text then 'Buvettes'::text
            when s.service_type = 'bar'::text then 'Bars'::text
            else 'VIP'::text
        end as family,
    esl.product_id,
    p.product_name,
    coalesce(kvs.volume_liters, 0::numeric) as volume_l,
    coalesce(esl.initial_qty, 0) + coalesce(esl.reassort_qty, 0) as dispatche,
    greatest(coalesce(esl.consumed_qty, 0), 0) as vides_a_rentrer,
    greatest(coalesce(esl.final_qty, 0), 0) as pleins_restants,
        case
            when coalesce(s.retain_kegs_in_espace, false) then 'garde_sur_place'::text
            else 'retour_stockage'::text
        end as destination_pleins
   from event_stock_lines esl
     join products p on p.product_id = esl.product_id and p.unit = 'fût'::text
     join spaces s on s.space_id = esl.space_id
     left join keg_volume_standards kvs on kvs.product_id = esl.product_id
  where greatest(coalesce(esl.consumed_qty, 0), 0) > 0 or greatest(coalesce(esl.final_qty, 0), 0) > 0;
