-- =====================================================================
-- RÉGULARISATION DES LIGNES DE STOCK ESPACE « HORS-CARTE »
-- ---------------------------------------------------------------------
-- Contexte : certaines lignes de stock espace (stock_balances, location
-- 'espace') portaient des produits ABSENTS de l'assortiment de l'espace
-- (space_product_catalog) → signalées « hors-carte ». Décision utilisateur :
-- régulariser A + B en carte, nettoyer les fantômes C.
--
--   A — lignes à stock RÉEL (> 0)                → rattachées à la carte
--   B — lignes à 0 saisies par un responsable /  → rattachées à la carte
--       reportées d'un stock final réel de match
--   C — fantômes (0 + sans auteur, « Reset QA »,  → balance supprimée +
--       code d'accès seul, ou Matériel)             trace RG-002
--
-- Régularisation = ajout en space_product_catalog au niveau 'complement'
-- (assortiment autorisé), avec avg_consumption NULL : la ligne devient
-- carte SANS forcer de planification runner (le générateur n'auto-planifie
-- un complément que si avg_consumption > 0). source='régularisation
-- hors-carte V1.1'. Idempotent (ON CONFLICT + auto-scopé au hors-carte).
-- =====================================================================

do $$
declare
  v_resp text := 'Nettoyage ligne fantôme hors-carte (0)';
  rec record;
  v_regul int := 0;
  v_clean int := 0;
begin
  for rec in
    with hc as (
      select s.space_id, s.space_name, s.service_type,
             p.product_id, p.product_name, p.category,
             b.location_id, b.current_quantity::numeric as q, b.updated_by
      from stock_balances b
      join stock_locations l on l.id = b.location_id and l.location_type = 'espace'
      join spaces s on s.space_id = l.area_id
      join products p on p.product_id = b.product_id
      where not exists (
        select 1 from space_product_catalog c
        where c.space_id = s.space_id and c.product_id = b.product_id and c.active = true)
    )
    select *, case
        when q > 0 then 'A'
        when category = 'Matériel' then 'C'
        when updated_by is null or updated_by = 'Reset QA' then 'C'
        when updated_by ~ '^[0-9A-F]{6}$' then 'C'   -- code d'accès match seul
        else 'B'
      end as klass
    from hc
  loop
    if rec.klass in ('A', 'B') then
      -- ------- Régularisation : rattachement à l'assortiment (complement) -------
      insert into space_product_catalog(
        space_id, product_id, membership_level, association_level, product_family,
        is_default, avg_consumption, coefficient, active, source, is_reference)
      values (
        rec.space_id, rec.product_id, 'complement', 'C',
        case
          when rec.product_name ilike 'CO2%'        then 'Gaz / Technique'
          when rec.category = 'Bières'              then 'Bière / Fûts'
          when rec.category in ('Sirops','Soft')    then 'Softs / Eau / Sirops'
          when rec.category = 'Spiritueux'          then 'Spiritueux / Apéritifs'
          when rec.product_name ilike 'Mumm%'       then 'Champagne'
          when rec.category = 'Vins'                then 'Vins'
          else 'Autres'
        end,
        false, null, null, true, 'régularisation hors-carte V1.1', false)
      on conflict (space_id, product_id) do update
        set active = true,
            source = 'régularisation hors-carte V1.1',
            updated_at = now();
      v_regul := v_regul + 1;

    else
      -- ------- Nettoyage fantôme (C) : trace RG-002 puis suppression balance ----
      insert into stock_movements(product_id, space_id, movement_type, qty,
          from_location_id, responsable_nom, is_anomaly, status)
      values (rec.product_id, rec.space_id, 'correction', 0,
          rec.location_id, v_resp, false, 'validated');

      delete from stock_balances
       where location_id = rec.location_id and product_id = rec.product_id;
      v_clean := v_clean + 1;
    end if;
  end loop;

  raise notice 'Régularisation hors-carte : % lignes rattachées à la carte, % fantômes nettoyés.',
    v_regul, v_clean;
end $$;
