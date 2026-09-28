-- =====================================================================
-- DÉRIVATION AUTOMATIQUE DU STOCK RESTANT PAR ESPACE APRÈS ÉVÉNEMENT
-- (skill « régie stock » — fûts d'abord, généralisable)
-- ---------------------------------------------------------------------
-- PROBLÈME TERRAIN : après un match, le responsable ne saisit pas toujours
-- le stock FINAL de fûts (ou le saisit de façon aberrante). Sans final, on
-- ne connaît pas le RESTANT (non consommé) → l'écran « Par espace » affiche 0
-- et la fiche runner du match suivant sous-transmet. Il faut DÉRIVER un
-- restant crédible à partir de signaux RÉELS, sans dépendre d'une saisie
-- parfaite, et sans jamais inventer de consommation ni polluer les tendances.
--
-- MÉTHODE DE DÉRIVATION (documentée comme skill) :
--   1. Point de départ = DISPATCHÉ RÉEL : D = initial_qty + reassort_qty
--      (ce qui est parti dans l'espace — donnée saisie, jamais dérivée).
--   2. Conso attendue = TENDANCE RÉELLE de CET espace × produit
--      (space_product_coefficients, alimentée par les matchs clôturés) :
--        EC = conso_per_100_pax × pax_du_match / 100        (si normalisé PAX)
--           ou avg_consumption                               (repli)
--           ou 0                                             (aucun historique)
--      arrondie au conditionnement fût (1 u) puis BORNÉE par le dispatché : EC ∈ [0, D].
--   3. RESTANT dérivé = D − EC  (≥ 0 par construction, ≤ D).
--        - product_state = 'fermé'    si restant > 0 (pleins non entamés)
--        - product_state = 'fût_vide' si restant = 0 (tout tapé)
--   4. ROUTAGE (via le trigger de clôture existant, RG-002) :
--        - retain_kegs_in_espace = true  → le restant RESTE en espace (area_stocks) ;
--        - retain_kegs_in_espace = false → espace = 0, le restant RETOURNE au
--          Stockage Fûts central (le restant dérivé = nb de fûts pleins à rentrer).
--
-- GARDE-FOUS :
--   • RG-004 : conso = EC ≥ 0 (jamais négative) — c'est justement ce qu'on répare.
--   • RG-002 : on n'écrit QUE final_qty ; le trigger trg_stock_final_entered
--     (on_stock_final_entered) trace tous les mouvements et met à jour
--     area_stocks / stock_balances / keg_inventory. Aucun court-circuit.
--   • On NE touche JAMAIS un final crédible (0 ≤ final ≤ D) réellement saisi.
--     Seules les lignes final NULL / final<0 / final>dispatché / conso<0 sont dérivées.
--   • TRAÇABILITÉ : la ligne dérivée est marquée `final_is_derived=true` +
--     anomaly_comment explicite « dérivé auto ». compute_space_coefficients EXCLUT
--     ces lignes → une estimation ne devient jamais une « tendance réelle »
--     (sinon boucle auto-référentielle).
--   • Verrou clôture (lock_closed_event_stock_lines) : levé proprement via
--     l'ajustement tracé app.allow_adjustment='on' (canal sanctionné).
--
-- CHIFFRES DE CALIBRAGE (lecture prod 2026-09-28) — validation sur BODEGA :
--   Bodega (Bar, retains_stock=true, retain_kegs_in_espace=FALSE → restant → central).
--   Dernier match servi = Aurillac (pax 8500). Finals RÉELLEMENT saisis, crédibles ;
--   la dérivation les CONFIRME (écart ≤ 1 fût) :
--     Produit           Dispatché  Conso attendue(dérivée)  Restant dérivé  Restant réel saisi
--     Fût FADA Blanche      4        0.0275×85 = 2 (arr.)          2               2   ✔
--     Fût FADA Blonde      12        0.1176×85 = 10 (arr.)         2               2   ✔
--     Fût FADA IPA          5        0.0471×85 = 4 (arr.)          1               2  (±1)
--     Fût FADA Abricot      0        (jamais dispatché)            0               0   ✔
--   → Bodega affiche 0 en espace car NON conservé : le restant (2/2/2) est bien
--     RETOURNÉ au Stockage central, pas perdu. « Les bons chiffres » = ces restants.
--
--   CAS RÉEL OÙ LA DÉRIVATION S'APPLIQUE (finals manquants) = match Australie
--   (2026-09-19, pax 5500) — 7 lignes fûts à final NULL, sans commentaire :
--     Espace         Produit                Dispatché  EC(=cp×55)  Restant  Destination
--     EST NORD       Fût BUD                    4       2.42→2        2      espace (conservé)
--     EST NORD       Fût Goose Island IPA       3       2.15→2        1      espace (conservé)
--     EST NORD       Fût Hoegaarden Blanche     3       2.00→2        1      espace (conservé)
--     EST SUD        Fût Hoegaarden Blanche     2       2.00→2        0      espace (conservé)
--     Nord EST       Fût Hoegaarden Blanche     2       1.11→1        1      espace (conservé)
--     SUD EST        Fût BUD                    5       2.97→3        2      retour Stockage central
--     Virage OUEST   Fût Hoegaarden Blanche     4       1.68→2        2      retour Stockage central
--   Tous crédibles (restant ≤ dispatché, conso dans la bande historique min/max).
-- =====================================================================


-- ── 1) Marqueur machine « final dérivé » (protège les tendances) ──────
alter table public.event_stock_lines
  add column if not exists final_is_derived boolean not null default false;

comment on column public.event_stock_lines.final_is_derived is
  'true = final_qty calculé par derive_and_apply_espace_finals (estimation tendance), '
  'PAS saisi par le responsable. Exclu du calcul des coefficients (compute_space_coefficients).';


-- ── 2) RPC de dérivation + application (dry-run par défaut) ───────────
create or replace function public.derive_and_apply_espace_finals(
  p_event_id uuid,
  p_by       text    default 'Régie (dérivation auto)',
  p_dry_run  boolean default true
) returns json
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_pax int; v_status text; v_type text; v_rows json; v_applied int := 0; r record;
begin
  if auth.uid() is not null and not coalesce(is_stade(), false) then
    return json_build_object('success', false, 'error', 'Action réservée à l''équipe stade.');
  end if;

  select expected_attendees, lower(coalesce(status, '')), event_type
    into v_pax, v_status, v_type
    from events where event_id = p_event_id;
  if not found then
    return json_build_object('success', false, 'error', 'Événement introuvable.');
  end if;
  if v_type <> 'match' then
    return json_build_object('success', false, 'error', 'Réservé aux matchs (modèle fûts).');
  end if;
  if v_status not in ('clôturé', 'cloture', 'archivé', 'archive') then
    return json_build_object('success', false, 'error', 'Événement non clôturé.');
  end if;

  -- Lignes candidates (final manquant / aberrant) + dérivation (LECTURE).
  with calc as (
    select esl.line_id, s.space_name, coalesce(s.retain_kegs_in_espace, false) as retain,
      p.product_name,
      (esl.initial_qty + coalesce(esl.reassort_qty, 0)) as dispatched,
      esl.final_qty as current_final,
      spc.total_matches, spc.confidence_level,
      case when esl.final_qty is null then 'FINAL_NULL'
           when esl.final_qty < 0 then 'FINAL_NEG'
           when esl.final_qty > (esl.initial_qty + coalesce(esl.reassort_qty, 0)) then 'FINAL>DISPATCH'
           else 'CONSO_NEG' end as flag,
      least(greatest(round(
        case when coalesce(spc.pax_normalized, false) and spc.conso_per_100_pax is not null and v_pax > 0
               then spc.conso_per_100_pax * v_pax / 100.0
             when spc.avg_consumption is not null then spc.avg_consumption
             else 0 end)::int, 0),
        (esl.initial_qty + coalesce(esl.reassort_qty, 0))) as expected_conso
    from event_stock_lines esl
    join spaces s on s.space_id = esl.space_id
    join products p on p.product_id = esl.product_id and p.unit = 'fût'
    left join space_product_coefficients spc
      on spc.space_id = esl.space_id and spc.product_id = esl.product_id
    where esl.event_id = p_event_id
      and (esl.initial_qty + coalesce(esl.reassort_qty, 0)) > 0
      and (esl.final_qty is null or esl.final_qty < 0
           or esl.final_qty > (esl.initial_qty + coalesce(esl.reassort_qty, 0))
           or (esl.initial_qty + coalesce(esl.reassort_qty, 0) - coalesce(esl.final_qty, 0)) < 0)
  )
  select json_agg(json_build_object(
      'espace', space_name, 'produit', product_name, 'conserve_futs', retain,
      'dispatche', dispatched, 'final_actuel', current_final, 'anomalie', flag,
      'conso_attendue', expected_conso, 'restant_derive', dispatched - expected_conso,
      'destination', case when retain then 'espace (conservé)' else 'retour Stockage Fûts (central)' end,
      'product_state', case when dispatched - expected_conso > 0 then 'fermé' else 'fût_vide' end,
      'base', case when total_matches is null then 'aucun_historique'
                   else total_matches || ' matchs (' || coalesce(confidence_level, '') || ')' end
    ) order by space_name, product_name)
  into v_rows
  from calc;

  if coalesce(p_dry_run, true) then
    return json_build_object('success', true, 'mode', 'dry_run', 'event_id', p_event_id,
      'pax', v_pax, 'lignes', coalesce(v_rows, '[]'::json),
      'note', 'Aucune écriture. Relancer avec p_dry_run := false pour appliquer.');
  end if;

  -- APPLICATION : ajustement tracé (lève le verrou clôture ; le trigger
  -- trg_stock_final_entered route espace/central/keg_inventory + mouvements RG-002).
  perform set_config('app.allow_adjustment', 'on', true);
  for r in
    with calc as (
      select esl.line_id,
        (esl.initial_qty + coalesce(esl.reassort_qty, 0)) as dispatched,
        case when esl.final_qty is null then 'FINAL_NULL'
             when esl.final_qty < 0 then 'FINAL_NEG'
             when esl.final_qty > (esl.initial_qty + coalesce(esl.reassort_qty, 0)) then 'FINAL>DISPATCH'
             else 'CONSO_NEG' end as flag,
        least(greatest(round(
          case when coalesce(spc.pax_normalized, false) and spc.conso_per_100_pax is not null and v_pax > 0
                 then spc.conso_per_100_pax * v_pax / 100.0
               when spc.avg_consumption is not null then spc.avg_consumption
               else 0 end)::int, 0),
          (esl.initial_qty + coalesce(esl.reassort_qty, 0))) as expected_conso
      from event_stock_lines esl
      join products p on p.product_id = esl.product_id and p.unit = 'fût'
      left join space_product_coefficients spc
        on spc.space_id = esl.space_id and spc.product_id = esl.product_id
      where esl.event_id = p_event_id
        and (esl.initial_qty + coalesce(esl.reassort_qty, 0)) > 0
        and (esl.final_qty is null or esl.final_qty < 0
             or esl.final_qty > (esl.initial_qty + coalesce(esl.reassort_qty, 0))
             or (esl.initial_qty + coalesce(esl.reassort_qty, 0) - coalesce(esl.final_qty, 0)) < 0)
    )
    select line_id, dispatched, expected_conso, flag,
           (dispatched - expected_conso) as restant
    from calc
  loop
    update event_stock_lines
       set final_qty        = r.restant,
           product_state    = case when r.restant > 0 then 'fermé' else 'fût_vide' end,
           final_is_derived = true,
           responsable_nom  = coalesce(responsable_nom, p_by),
           submitted_at     = now(),
           anomaly_comment  = left(
             coalesce(anomaly_comment, '') ||
             case when coalesce(anomaly_comment, '') = '' then '' else ' ' end ||
             '[Régie: final dérivé auto (' || r.flag || ') — dispatché ' || r.dispatched ||
             ', conso attendue ' || r.expected_conso || ' (tendance espace×produit), restant ' ||
             r.restant || '. Non saisi responsable → exclu des tendances.]', 2000)
     where line_id = r.line_id;
    v_applied := v_applied + 1;
  end loop;

  return json_build_object('success', true, 'mode', 'applied', 'event_id', p_event_id,
    'pax', v_pax, 'lignes_appliquees', v_applied, 'detail', coalesce(v_rows, '[]'::json),
    'note', 'Restants dérivés écrits + routés (espace conservé / retour central) via le trigger de clôture.');
end;
$fn$;

grant execute on function public.derive_and_apply_espace_finals(uuid, text, boolean) to authenticated;


-- ── 3) GARDE-FOU TENDANCES : compute_space_coefficients EXCLUT les finals dérivés
--        (ajout de `AND NOT COALESCE(esl.final_is_derived,false)` aux 2 filtres).
create or replace function public.compute_space_coefficients()
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_deleted int := 0; v_updated int := 0;
begin
  -- 1) Purger les coefficients COMPUTED sans source réelle (seed préservé).
  delete from space_product_coefficients spc
  where coalesce(spc.source, 'computed') = 'computed'
    and not exists (
      select 1 from event_stock_lines esl
      join events e on e.event_id = esl.event_id
      where esl.space_id = spc.space_id and esl.product_id = spc.product_id
        and e.status in ('clôturé', 'archivé') and e.event_type = 'match'
        and coalesce(e.is_simulation, false) = false
        and esl.final_qty is not null
        and not coalesce(esl.final_is_derived, false)          -- << exclut les finals dérivés
        and (esl.initial_qty + coalesce(esl.reassort_qty, 0)) > 0
    );
  get diagnostics v_deleted = row_count;

  -- 2) Recalculer depuis les données réelles + normalisation PAX.
  with space_averages as (
    select esl.space_id, esl.product_id,
      count(distinct esl.event_id) as nb_matches,
      round(avg(esl.initial_qty + coalesce(esl.reassort_qty,0) - coalesce(esl.final_qty,0))::decimal, 2) as avg_conso,
      round(min(esl.initial_qty + coalesce(esl.reassort_qty,0) - coalesce(esl.final_qty,0))::decimal, 2) as min_conso,
      round(max(esl.initial_qty + coalesce(esl.reassort_qty,0) - coalesce(esl.final_qty,0))::decimal, 2) as max_conso,
      round(stddev(esl.initial_qty + coalesce(esl.reassort_qty,0) - coalesce(esl.final_qty,0))::decimal, 2) as std_dev,
      count(distinct esl.event_id) filter (where e.expected_attendees > 0) as nb_matches_pax,
      round(avg(e.expected_attendees) filter (where e.expected_attendees > 0)) as avg_pax,
      round(avg(case when e.expected_attendees > 0
        then (esl.initial_qty + coalesce(esl.reassort_qty,0) - coalesce(esl.final_qty,0))::decimal / e.expected_attendees * 100 end), 4) as avg_c100,
      round(min(case when e.expected_attendees > 0
        then (esl.initial_qty + coalesce(esl.reassort_qty,0) - coalesce(esl.final_qty,0))::decimal / e.expected_attendees * 100 end), 4) as min_c100,
      round(max(case when e.expected_attendees > 0
        then (esl.initial_qty + coalesce(esl.reassort_qty,0) - coalesce(esl.final_qty,0))::decimal / e.expected_attendees * 100 end), 4) as max_c100
    from event_stock_lines esl
    join events e on e.event_id = esl.event_id
    join products p on p.product_id = esl.product_id
    where e.status in ('clôturé','archivé') and e.event_type = 'match'
      and coalesce(e.is_simulation, false) = false
      and esl.final_qty is not null
      and not coalesce(esl.final_is_derived, false)             -- << exclut les finals dérivés
      and (esl.initial_qty + coalesce(esl.reassort_qty,0)) > 0
      and p.active = true
      and (esl.initial_qty + coalesce(esl.reassort_qty,0) - coalesce(esl.final_qty,0)) > 0
    group by esl.space_id, esl.product_id
    having count(distinct esl.event_id) >= 1
  ),
  type_averages as (
    select space_profile(s.space_name) as profile, sa.product_id, avg(sa.avg_conso) as type_avg_conso
    from space_averages sa join spaces s on s.space_id = sa.space_id
    group by space_profile(s.space_name), sa.product_id
  )
  insert into space_product_coefficients (
    space_id, product_id, avg_consumption, total_matches, min_consumption,
    max_consumption, std_deviation, coefficient, confidence_level, recommended_qty,
    avg_pax_match, conso_per_100_pax, min_conso_per_100_pax, max_conso_per_100_pax, pax_normalized,
    source, last_computed_at)
  select sa.space_id, sa.product_id, sa.avg_conso, sa.nb_matches, sa.min_conso, sa.max_conso,
    coalesce(sa.std_dev, 0),
    case when coalesce(ta.type_avg_conso,0) > 0 then round((sa.avg_conso / ta.type_avg_conso)::decimal, 2) else 1.00 end,
    case when sa.nb_matches >= 5 then 'très élevé' when sa.nb_matches >= 4 then 'élevé'
         when sa.nb_matches >= 3 then 'moyen' else 'faible' end,
    round((sa.avg_conso * 1.20)::decimal, 0),
    sa.avg_pax, sa.avg_c100, sa.min_c100, sa.max_c100,
    (sa.nb_matches_pax >= 1),
    'computed', now()
  from space_averages sa
  join spaces s on s.space_id = sa.space_id
  left join type_averages ta on ta.profile = space_profile(s.space_name) and ta.product_id = sa.product_id
  on conflict (space_id, product_id) do update set
    avg_consumption=excluded.avg_consumption, total_matches=excluded.total_matches,
    min_consumption=excluded.min_consumption, max_consumption=excluded.max_consumption,
    std_deviation=excluded.std_deviation, coefficient=excluded.coefficient,
    confidence_level=excluded.confidence_level, recommended_qty=excluded.recommended_qty,
    avg_pax_match=excluded.avg_pax_match, conso_per_100_pax=excluded.conso_per_100_pax,
    min_conso_per_100_pax=excluded.min_conso_per_100_pax, max_conso_per_100_pax=excluded.max_conso_per_100_pax,
    pax_normalized=excluded.pax_normalized, source='computed', last_computed_at=now();
  get diagnostics v_updated = row_count;

  perform public.sync_catalog_complement();

  return json_build_object('success', true, 'deleted', v_deleted, 'updated', v_updated,
    'pax_normalized', (select count(*) from space_product_coefficients where pax_normalized = true),
    'message', format('%s recalculés · %s normalisés PAX', v_updated,
      (select count(*) from space_product_coefficients where pax_normalized = true)));
end; $function$;


-- =====================================================================
-- DÉCLENCHEMENT — 2 options (à valider par l'humain, non imposées) :
--
--  A) MANUEL (recommandé au départ) : bouton ROLE_STADE sur la fiche de clôture
--     « Dériver les restants manquants », qui appelle d'abord le dry-run
--        select derive_and_apply_espace_finals('<event>', 'M. Viatte', true);
--     l'opérateur relit le tableau proposé, puis applique
--        select derive_and_apply_espace_finals('<event>', 'M. Viatte', false);
--
--  B) AUTO à la clôture (option) : ajouter en fin de finalize_event_espace_stocks
--     un appel non bloquant (p_dry_run := false) APRÈS le recalage habituel, pour
--     que tout final fût manquant soit dérivé sans intervention. À n'activer
--     qu'après quelques cycles de validation manuelle (on garde l'humain dans la
--     boucle tant que la confiance n'est pas établie). Exemple (commenté) :
--        -- perform derive_and_apply_espace_finals(p_event_id, 'Clôture (auto)', false);
-- =====================================================================
