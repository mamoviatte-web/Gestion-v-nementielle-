-- =====================================================================
-- AUDITS STOCK — A (bascule post-match) + C (acheminement)  — LECTURE SEULE
-- ---------------------------------------------------------------------
-- A. v_event_bascule_audit : par événement × espace, complétude de la bascule
--    (le cas Comptoir : finals saisis mais jamais soumis → aucun mouvement).
--    Systématise le contrôle fait à la main pour Narbonne.
-- C. v_event_acheminement_audit : par événement × espace × produit, compare
--    l'acheminé PLANIFIÉ (event_runner_board.qty_to_move = needed − area_stock)
--    à l'acheminé RÉEL (Σ 'sortie' débitée par B+). Écart = sur/sous-acheminement
--    ou perte transport. (event_runner_board est vivant → surtout pertinent en
--    préparation ; en post-match le 'sortie' fait foi.)
-- =====================================================================

create or replace view public.v_event_bascule_audit as
select
  e.event_id, e.event_name, e.event_type, e.event_date, e.status,
  s.space_id, sp.space_name,
  count(*)                                                  as lignes,
  count(*) filter (where s.final_qty is not null)           as finals_saisis,
  count(*) filter (where s.submitted_at is not null)        as soumises,
  coalesce(mv.nb_mouvements, 0)                             as mouvements,
  coalesce(mv.nb_conso, 0)                                  as conso_tracee,
  -- Anomalie « type Comptoir » : des finals saisis mais AUCUN soumis → les
  -- triggers de bascule n'ont jamais tourné (clôture non validée dans l'appli).
  (count(*) filter (where s.final_qty is not null) > 0
     and count(*) filter (where s.submitted_at is not null) = 0) as anomalie_non_bascule
from event_stock_lines s
  join events e on e.event_id = s.event_id
  join spaces sp on sp.space_id = s.space_id
  left join (
    select event_id, space_id,
           count(*)                                          as nb_mouvements,
           count(*) filter (where movement_type='consommation') as nb_conso
    from stock_movements group by event_id, space_id
  ) mv on mv.event_id = s.event_id and mv.space_id = s.space_id
where e.status in ('clôturé','archivé','en_cours','clôture_en_attente')
group by e.event_id, e.event_name, e.event_type, e.event_date, e.status,
         s.space_id, sp.space_name, mv.nb_mouvements, mv.nb_conso;

create or replace view public.v_event_acheminement_audit as
select
  b.event_id, b.space_id, b.space_name, b.product_id, b.product_name, b.category,
  b.area_stock                                     as amont,
  b.needed_qty,
  b.qty_to_move                                    as achemine_planifie,
  coalesce(sr.sortie_reel, 0)                      as achemine_reel,
  coalesce(sr.sortie_reel, 0) - b.qty_to_move      as ecart_acheminement
from public.event_runner_board b
  left join (
    select event_id, space_id, product_id, sum(qty) as sortie_reel
    from public.stock_movements
    where movement_type = 'sortie'
    group by event_id, space_id, product_id
  ) sr on sr.event_id = b.event_id and sr.space_id = b.space_id and sr.product_id = b.product_id
where coalesce(b.qty_to_move, 0) <> 0 or coalesce(sr.sortie_reel, 0) <> 0;

grant select on public.v_event_bascule_audit, public.v_event_acheminement_audit to authenticated;
revoke select on public.v_event_bascule_audit, public.v_event_acheminement_audit from anon;
