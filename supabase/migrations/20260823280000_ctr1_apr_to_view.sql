-- CTR-1 Phase 3.2 — area_product_reference devient une VUE sur le catalogue
-- ============================================================================
-- Le catalogue mirroir déjà area_product_reference à l'identique (0/0). On
-- remplace la table par une vue projetant space_product_catalog (lignes
-- is_reference). Tous les lecteurs (get_runner_sheet, get_runner_pdf_data,
-- get_buvette_runner, get_zone_stock/buvette_stock, v_space_dotation_*…)
-- basculent d'un coup, sans changement de code, en lisant désormais le catalogue.
--
-- Les écritures restantes (éditeur d'assortiment, inject_cdc_v3) sont redirigées
-- vers le catalogue par des triggers INSTEAD OF → aucune rupture.
-- L'ancienne table est conservée sous area_product_reference_deprecated
-- (@deprecated CTR-1, suppression après période d'observation).

alter table area_product_reference rename to area_product_reference_deprecated;
comment on table area_product_reference_deprecated is '@deprecated CTR-1 — remplacée par la vue area_product_reference sur space_product_catalog. Suppression après observation.';

create view area_product_reference as
select c.id,
       s.space_name        as area_name,
       c.area_group,
       c.legacy_area_name,
       p.product_name,
       c.product_family,
       c.association_level,
       (c.association_level = 'S') as is_default,
       c.product_id,
       c.cdc_version,
       c.created_at,
       c.updated_at
from space_product_catalog c
join spaces   s on s.space_id   = c.space_id
join products p on p.product_id = c.product_id
where c.is_reference = true;

-- INSTEAD OF INSERT : ajoute/repointe une ligne du catalogue (socle si niveau S)
create or replace function public.apr_view_insert() returns trigger
  language plpgsql security definer set search_path to 'public' as $$
declare v_space uuid; v_lvl text := coalesce(NEW.association_level,'S');
begin
  select space_id into v_space from spaces where upper(btrim(space_name))=upper(btrim(NEW.area_name));
  if v_space is null then return null; end if;
  insert into space_product_catalog
    (space_id, product_id, membership_level, association_level, product_family,
     is_default, area_group, legacy_area_name, cdc_version, is_reference, active, source)
  values (v_space, NEW.product_id,
     case when v_lvl='S' then 'socle' else 'reference_option' end,
     v_lvl, NEW.product_family, (v_lvl='S'), NEW.area_group, NEW.legacy_area_name,
     coalesce(NEW.cdc_version,'custom'), true, true, 'editor')
  on conflict (space_id, product_id) do update
     set membership_level = case when v_lvl='S' then 'socle' else space_product_catalog.membership_level end,
         association_level = v_lvl, is_reference = true, active = true, updated_at = now();
  return NEW;
end $$;
create trigger apr_view_ins instead of insert on area_product_reference
  for each row execute function public.apr_view_insert();

-- INSTEAD OF DELETE : retire la ligne du catalogue (socle) pour ce couple
create or replace function public.apr_view_delete() returns trigger
  language plpgsql security definer set search_path to 'public' as $$
declare v_space uuid;
begin
  select space_id into v_space from spaces where upper(btrim(space_name))=upper(btrim(OLD.area_name));
  delete from space_product_catalog
   where space_id = v_space and product_id = OLD.product_id
     and (OLD.association_level is null or association_level = OLD.association_level);
  return OLD;
end $$;
create trigger apr_view_del instead of delete on area_product_reference
  for each row execute function public.apr_view_delete();

-- INSTEAD OF UPDATE : réaligne niveau/famille sur le catalogue
create or replace function public.apr_view_update() returns trigger
  language plpgsql security definer set search_path to 'public' as $$
declare v_space uuid;
begin
  select space_id into v_space from spaces where upper(btrim(space_name))=upper(btrim(NEW.area_name));
  update space_product_catalog
     set association_level = coalesce(NEW.association_level, association_level),
         product_family    = coalesce(NEW.product_family, product_family),
         membership_level  = case when coalesce(NEW.association_level,'S')='S' then 'socle' else membership_level end,
         updated_at = now()
   where space_id = v_space and product_id = OLD.product_id;
  return NEW;
end $$;
create trigger apr_view_upd instead of update on area_product_reference
  for each row execute function public.apr_view_update();
