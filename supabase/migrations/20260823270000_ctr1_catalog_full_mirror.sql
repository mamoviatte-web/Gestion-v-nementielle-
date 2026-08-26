-- CTR-1 — le catalogue mirroir INTÉGRAL de area_product_reference (prérequis view)
-- ============================================================================
-- Décision exploitant : compléter le catalogue pour qu'il contienne toutes les
-- lignes de area_product_reference (tous niveaux S/R/C/P), afin de pouvoir plus
-- tard remplacer area_product_reference par une VUE sur le catalogue (bascule de
-- tous les lecteurs d'affichage d'un coup, zéro régression).
--
-- Ajouts schéma :
--   legacy_area_name, area_group, cdc_version  (colonnes miroir de l'ancien réf.)
--   is_reference (bool)                        (marque les lignes issues du réf.)
--   membership_level += 'reference_option'     (options R/C/P non génératrices)
--
-- Backfill : chaque ligne area_product_reference présente dans le catalogue avec
--   son association_level exact. Les niveaux non-S (R/C/P) → 'reference_option'
--   (invisibles à la génération : les blocs (1)/(2) ne lisent que socle/complement).
--   Les 27 produits à la fois option-réf ET complément historique : le niveau du
--   RÉFÉRENTIEL prime (association_level du réf.), membership 'complement' conservé
--   pour préserver la génération. Nettoyage : 2 doublons (S+R) de
--   area_product_reference supprimés (le S génère, le R était redondant).
--
-- Vérifié : catalogue (is_reference) reproduit area_product_reference à
-- l'identique (diff 0/0 sur area_name, product_id, association_level,
-- product_family, is_default=(niveau S)) ; génération runner INCHANGÉE (diff 0
-- sur Agen). Prochaine étape (hors de cette migration) : rediriger l'éditeur
-- d'assortiment vers le catalogue, puis area_product_reference → vue lecture seule.

alter table space_product_catalog add column if not exists legacy_area_name text;
alter table space_product_catalog add column if not exists area_group text;
alter table space_product_catalog add column if not exists cdc_version text;
alter table space_product_catalog add column if not exists is_reference boolean default false;

alter table space_product_catalog drop constraint if exists space_product_catalog_membership_level_check;
alter table space_product_catalog add constraint space_product_catalog_membership_level_check
  check (membership_level in ('socle','complement','loge','reference_option'));

-- Nettoyage doublons area_product_reference (garde S, retire le R redondant)
delete from area_product_reference a using area_product_reference b
 where a.area_name=b.area_name and a.product_id=b.product_id
   and a.association_level='R' and b.association_level='S' and a.product_id is not null;

-- Backfill des lignes réf. manquantes en 'reference_option'
insert into space_product_catalog
  (space_id, product_id, membership_level, association_level, product_family,
   is_default, legacy_area_name, area_group, cdc_version, active, source)
select s.space_id, a.product_id, 'reference_option', a.association_level, a.product_family,
       (a.association_level='S'), a.legacy_area_name, a.area_group, a.cdc_version, true, 'apr_backfill'
from area_product_reference a
join spaces s on upper(btrim(s.space_name))=upper(btrim(a.area_name))
where a.product_id is not null
  and not exists (select 1 from space_product_catalog c where c.space_id=s.space_id and c.product_id=a.product_id)
on conflict (space_id, product_id) do nothing;

-- Alignement colonnes miroir + is_reference + niveau (réf. prime)
update space_product_catalog c
   set legacy_area_name=a.legacy_area_name, area_group=a.area_group, cdc_version=a.cdc_version,
       product_family=a.product_family, is_reference=true
  from area_product_reference a
  join spaces s on upper(btrim(s.space_name))=upper(btrim(a.area_name))
 where c.space_id=s.space_id and c.product_id=a.product_id;

-- Niveau : S si le réf. a une ligne S pour ce couple (génère), sinon niveau réf.
update space_product_catalog c
   set association_level = (
     select case when bool_or(a.association_level='S') then 'S' else min(a.association_level) end
     from area_product_reference a join spaces s on upper(btrim(s.space_name))=upper(btrim(a.area_name))
     where s.space_id=c.space_id and a.product_id=c.product_id)
 where c.is_reference=true;

-- Membership génératrice cohérente : socle ⇔ niveau S (hors complement/loge)
update space_product_catalog set membership_level='socle'
 where is_reference and association_level='S' and membership_level='reference_option';
update space_product_catalog set membership_level='reference_option'
 where is_reference and association_level<>'S' and membership_level='socle';
