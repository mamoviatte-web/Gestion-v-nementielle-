-- =====================================================================
-- DOTATION EXPERTE — ÉCRIRE DANS LA COLONNE RÉELLEMENT LUE PAR LA FICHE RUNNER
-- ---------------------------------------------------------------------
-- Bug : apply_expert_dotation() écrivait runner_auto_planning.quantity_to_move,
-- une colonne LEGACY que la vue event_runner_board N'UTILISE PAS. La fiche
-- runner calcule :
--     qty_to_move = GREATEST(COALESCE(manual_qty_to_move, auto_qty), 0)
-- où auto_qty = arrondi(besoin − stock espace live). L'« Appliquer la dotation
-- experte » renvoyait donc « lignes ajustées » mais NE CHANGEAIT RIEN sur la
-- fiche runner ni sur l'analyse (qui lit aussi board.qty_to_move).
--
-- Correctif : écrire la reco experte dans `manual_qty_to_move` (l'override que
-- la fiche runner lit en priorité). La colonne quantity_to_move est mise à jour
-- en parallèle pour cohérence, mais c'est manual_qty_to_move qui pilote.
-- Loges toujours exclues (dotation de base préservée via auto_qty).
-- Réservé ROLE_STADE. Idempotent.
-- =====================================================================

create or replace function public.apply_expert_dotation(p_event_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n int := 0; v_marge numeric := 0.15; v_pax numeric;
  v_loges uuid[] := array[
    'a96044d1-9ab0-45d0-85eb-73672df6ab82',
    '673b6e4e-0f5a-406f-9029-c35b25a38103',
    '8be2956e-a379-4e8e-a3eb-65401bac3c56'
  ]::uuid[];
begin
  if auth.uid() is not null and not coalesce(is_stade(), false) then
    return json_build_object('success', false, 'error', 'Réservé à l''équipe stade.');
  end if;
  select coalesce(expected_attendees, 0) into v_pax from events where event_id = p_event_id;

  with hist as (
    select esl.space_id, esl.product_id,
           avg((esl.initial_qty + coalesce(esl.reassort_qty, 0) - esl.final_qty) / (e.expected_attendees / 1000.0)) as conso_kpax
    from event_stock_lines esl
    join events e on e.event_id = esl.event_id and e.event_type = 'match'
      and lower(coalesce(e.status, '')) in ('clôturé', 'cloture', 'archivé', 'archive')
      and e.event_id <> p_event_id and coalesce(e.expected_attendees, 0) > 0
    where esl.final_qty is not null
      and (esl.initial_qty + coalesce(esl.reassort_qty, 0) - esl.final_qty) >= 0
    group by esl.space_id, esl.product_id
  ),
  cible as (
    select b.space_id, b.product_id,
           greatest(0, ceil(coalesce(h.conso_kpax * (v_pax / 1000.0), b.consumption_reference, 0) * (1 + v_marge))::int - coalesce(b.area_stock, 0)) as a_monter
    from event_runner_board b
    left join hist h on h.space_id = b.space_id and h.product_id = b.product_id
    where b.event_id = p_event_id
      and not (b.space_id = any(v_loges))     -- loges exclus : dotation de base préservée
  )
  update runner_auto_planning rap
     set manual_qty_to_move = c.a_monter,     -- ← colonne LUE par la fiche runner
         quantity_to_move   = c.a_monter,     -- cohérence (colonne legacy)
         updated_at = now()
    from cible c
   where rap.event_id = p_event_id and rap.space_id = c.space_id and rap.product_id = c.product_id
     and coalesce(rap.validation_status, 'brouillon') = 'brouillon'
     and coalesce(rap.manual_qty_to_move, -1) is distinct from c.a_monter;
  get diagnostics v_n = row_count;

  return json_build_object('success', true, 'lignes_ajustees', v_n);
end;
$function$;

grant execute on function public.apply_expert_dotation(uuid) to authenticated;
