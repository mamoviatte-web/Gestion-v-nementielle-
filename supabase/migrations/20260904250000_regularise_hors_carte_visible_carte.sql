-- =====================================================================
-- RÉGULARISATION HORS-CARTE — RENDRE LES LIGNES VISIBLES DANS LA CARTE APP
-- ---------------------------------------------------------------------
-- Correctif de 20260904240000 : les lignes régularisées avaient été
-- insérées en space_product_catalog avec is_reference = false / niveau 'C'.
-- Or la carte telle que l'application la voit = la vue area_product_reference
-- = space_product_catalog WHERE is_reference = true, et la page « Assortiment
-- des espaces » ne liste que le socle (association_level = 'S'). Résultat :
-- les lignes régularisées n'apparaissaient PAS dans la carte de l'appli
-- (et les lignes B, à 0 sans stock, n'apparaissaient nulle part).
--
-- On aligne donc la régularisation sur ce que fait le bouton « Ajouter » de
-- la page Assortiment (fonction apr_view_insert) : socle, association_level
-- 'S', is_default true, is_reference true. Les produits deviennent des
-- membres de carte à part entière — visibles sur la page Assortiment et
-- pilotables par l'utilisateur (ajout / retrait via l'UI). dotation_floor
-- reste modéré (Sirops/Spiritueux 1, Vins 3, Softs 12…) → pas de sur-
-- planification runner. Idempotent (ciblé par source).
-- =====================================================================

update space_product_catalog
   set membership_level = 'socle',
       association_level = 'S',
       is_default        = true,
       is_reference      = true,
       active            = true,
       updated_at        = now()
 where source = 'régularisation hors-carte V1.1'
   and (is_reference = false or association_level <> 'S' or membership_level <> 'socle');
