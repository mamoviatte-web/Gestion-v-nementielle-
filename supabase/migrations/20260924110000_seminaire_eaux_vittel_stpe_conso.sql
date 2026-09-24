-- =====================================================================
-- SÉMINAIRE — EAUX « VITTEL » & « ST-PÉ » : CATALOGUE COHÉRENT + CONSO
-- ---------------------------------------------------------------------
-- Les régisseurs séminaire ne retrouvaient pas « Vittel » ni « St Pé » dans
-- la suggestion de consommation :
--   • « Vittel » n'existait qu'en « Vittel verre » (unité 'verre'), incohérent
--     pour une conso séminaire comptée en BOUTEILLES ;
--   • « St Pé » n'existait pas sous ce nom — c'est le nom d'usage de la
--     San Pellegrino (eau gazeuse). Recherché « St Pé », le produit n'apparaît pas.
-- get_zone_state propose déjà TOUS les produits actifs : le problème est donc le
-- NOMMAGE. On normalise les deux eaux pour qu'elles soient reconnues (et la
-- recherche régisseur devient insensible aux accents/tirets côté front).
--
-- Idempotent : ciblé par product_id (stable), rejouable sans effet de bord.
-- =====================================================================

-- 1) « Vittel verre » → « Vittel » (bouteille)
update public.products
set product_name = 'Vittel', unit = 'btl'
where product_id = '922c8f3c-4274-49a0-8870-e331c87d857f';

-- 2) « San Pellegrino bouteille » → « San Pellegrino (St-Pé) » (nom d'usage régie)
update public.products
set product_name = 'San Pellegrino (St-Pé)'
where product_id = '08c46d8d-5566-4046-b372-8f437e5e7cce';

-- ---------------------------------------------------------------------
-- 3) Conso F&B du séminaire Altrad ENDEL du 23/09 (Salon Sud) :
--    7 Vittel + 8 St-Pé, prélevées « sur place ». La ligne Pepsi déjà saisie
--    est PRÉSERVÉE (upsert additif, contrairement à la saisie régie qui
--    remplace). Modèle conso séminaire : initial_qty = consommé, final_qty = 0
--    → consumed_qty (généré) = quantité consommée. RG-001 : responsable tracé.
-- ---------------------------------------------------------------------
do $$
declare
  v_event uuid := 'c2072f9f-231f-413b-8ae3-0f92eb162829'; -- Altrad ENDEL 2026-09-23
  v_space uuid := 'f52ece0b-bfaf-4a76-b280-720f158ba470'; -- Salon Sud
  v_src   uuid := 'd7cfd5c8-651f-4bdc-9441-47ea83b422b4'; -- « sur place » (espace)
  v_resp  text := 'Valentin CONSTANT';                     -- régie (nom réel, cf. § 4)
  v_vittel uuid := '922c8f3c-4274-49a0-8870-e331c87d857f';
  v_stpe   uuid := '08c46d8d-5566-4046-b372-8f437e5e7cce';
begin
  -- Ne rien faire si l'événement a été clôturé/archivé entre-temps.
  if exists (
    select 1 from public.events
    where event_id = v_event
      and lower(coalesce(status, '')) not in ('clôturé','cloture','clôturée','archivé','archive')
  ) then
    insert into public.event_stock_lines
      (event_id, space_id, product_id, initial_qty, reassort_qty, final_qty,
       source_location_id, responsable_nom, submitted_at)
    values
      (v_event, v_space, v_vittel, 7, 0, 0, v_src, v_resp, now()),
      (v_event, v_space, v_stpe,   8, 0, 0, v_src, v_resp, now())
    on conflict (event_id, space_id, product_id) do update
      set initial_qty        = excluded.initial_qty,
          reassort_qty       = 0,
          final_qty          = 0,
          source_location_id = excluded.source_location_id,
          responsable_nom    = excluded.responsable_nom,
          submitted_at       = now();
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4) RH — le régisseur du séminaire Altrad ENDEL 23/09 avait été enregistré
--    sous le CODE d'accès « 21B0FC » au lieu de son nom. On le corrige en
--    « Valentin CONSTANT » : ses 12,5 h (06:30→19:00 @ 10 €/h = 125 €) se
--    fondent automatiquement dans ses heures du mois via rh_person_key
--    (rh_monthly_hours : 35 h → 47,5 h, 350 € → 475 €). On aligne aussi la
--    traçabilité de la conso séminaire (responsable_nom) sur son vrai nom.
--    Idempotent : ne touche que les lignes encore au code « 21B0FC ».
-- ---------------------------------------------------------------------
update public.schedules
set staff_name = 'Valentin CONSTANT'
where staff_name = '21B0FC';

update public.event_stock_lines
set responsable_nom = 'Valentin CONSTANT'
where responsable_nom = '21B0FC';
