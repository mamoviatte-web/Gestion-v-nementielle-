-- =====================================================================
-- DOTATION EXPERTE — ANALYSE DE CONSOMMATION & « À MONTER » RÉALISTE
-- ---------------------------------------------------------------------
-- Problème : la fiche runner demande de monter du stock alors que l'espace
-- contient déjà PLUS que la tendance de consommation (dotation socle/loge
-- fixe, gonflée, sans plafonnement par le stock présent).
--
-- Algorithme expert — pour chaque (espace, produit), on répond aux 3 questions :
--   1. Combien consommé récemment ? → moyenne des matchs clôturés, NORMALISÉE
--      par l'affluence (conso pour 1000 spectateurs), projetée sur l'affluence
--      attendue du match à venir.
--   2. Combien déjà dans l'espace ? → area_stock LIVE (event_runner_board).
--   3. Combien monter ? → besoin_expert − espace, borné à 0.
--        besoin_expert = conso_projetée × (1 + marge_sécurité 15 %).
--   → Si l'espace couvre déjà le besoin, à monter = 0 (fin de la surtransmission).
--
-- expert_runner_analysis(event) : analyse (lecture seule) par ligne + par gamme.
-- apply_expert_dotation(event)  : applique la reco (quantity_to_move ← à monter
--                                 expert) sur les lignes brouillon. ROLE_STADE.
-- =====================================================================

create or replace function public.expert_runner_analysis(p_event_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_event  events%rowtype;
  v_pax    numeric;
  v_marge  numeric := 0.15;
  v_out    json;
begin
  if auth.uid() is not null and not coalesce(is_stade(), false) then
    return json_build_object('success', false, 'error', 'Réservé à l''équipe stade.');
  end if;
  select * into v_event from events where event_id = p_event_id;
  if not found then
    return json_build_object('success', false, 'error', 'Événement introuvable.');
  end if;
  v_pax := coalesce(v_event.expected_attendees, 0);

  with hist as (
    select esl.space_id, esl.product_id,
           avg((esl.initial_qty + coalesce(esl.reassort_qty, 0) - esl.final_qty) / (e.expected_attendees / 1000.0)) as conso_kpax,
           (array_agg((esl.initial_qty + coalesce(esl.reassort_qty, 0) - esl.final_qty) order by e.event_date desc))[1] as conso_dernier
    from event_stock_lines esl
    join events e on e.event_id = esl.event_id
      and e.event_type = 'match'
      and lower(coalesce(e.status, '')) in ('clôturé', 'cloture', 'archivé', 'archive')
      and e.event_id <> p_event_id
      and coalesce(e.expected_attendees, 0) > 0
    where esl.final_qty is not null
      and (esl.initial_qty + coalesce(esl.reassort_qty, 0) - esl.final_qty) >= 0
    group by esl.space_id, esl.product_id
  ),
  calc as (
    select
      b.space_name, b.product_name, b.category,
      case
        when b.product_name ilike '%Fût%'        then 'Fûts'
        when b.category in ('Vins', 'Champagne') then 'Vins'
        when b.category = 'Bières'               then 'Bières'
        when b.category = 'Soft'                 then 'Softs & Eaux'
        when b.category = 'Sirops'               then 'Sirops'
        when b.category = 'Spiritueux'           then 'Spiritueux'
        else 'Autres'
      end as gamme,
      coalesce(h.conso_dernier, 0)::int as conso_dernier,
      round(coalesce(h.conso_kpax * (v_pax / 1000.0), b.consumption_reference, 0))::int as conso_projetee,
      coalesce(b.area_stock, 0)::int as espace,
      coalesce(b.qty_to_move, 0)::int as a_monter_actuel,
      ceil(coalesce(h.conso_kpax * (v_pax / 1000.0), b.consumption_reference, 0) * (1 + v_marge))::int as besoin_expert,
      greatest(0, ceil(coalesce(h.conso_kpax * (v_pax / 1000.0), b.consumption_reference, 0) * (1 + v_marge))::int - coalesce(b.area_stock, 0))::int as a_monter_expert
    from event_runner_board b
    left join hist h on h.space_id = b.space_id and h.product_id = b.product_id
    where b.event_id = p_event_id
  )
  select json_build_object(
    'success', true,
    'event_id', p_event_id, 'event_name', v_event.event_name, 'expected_attendees', v_pax,
    'marge_securite', v_marge,
    'total_a_monter_actuel', (select coalesce(sum(a_monter_actuel), 0) from calc),
    'total_a_monter_expert', (select coalesce(sum(a_monter_expert), 0) from calc),
    'total_surtransmission', (select coalesce(sum(a_monter_actuel - a_monter_expert), 0) from calc),
    'gammes', (
      select coalesce(json_agg(g order by g->>'gamme'), '[]'::json) from (
        select json_build_object(
          'gamme', gamme,
          'conso_dernier', sum(conso_dernier), 'conso_projetee', sum(conso_projetee),
          'espace', sum(espace), 'a_monter_actuel', sum(a_monter_actuel),
          'a_monter_expert', sum(a_monter_expert), 'surtransmission', sum(a_monter_actuel - a_monter_expert)
        ) as g
        from calc group by gamme
      ) t
    ),
    'lignes', (
      select coalesce(json_agg(json_build_object(
        'space_name', space_name, 'product_name', product_name, 'gamme', gamme,
        'conso_dernier', conso_dernier, 'conso_projetee', conso_projetee,
        'espace', espace, 'besoin_expert', besoin_expert,
        'a_monter_actuel', a_monter_actuel, 'a_monter_expert', a_monter_expert,
        'surtransmission', a_monter_actuel - a_monter_expert
      ) order by (a_monter_actuel - a_monter_expert) desc, space_name), '[]'::json)
      from calc where a_monter_actuel > 0 or a_monter_expert > 0
    )
  ) into v_out;

  return v_out;
end;
$function$;

grant execute on function public.expert_runner_analysis(uuid) to authenticated;

-- ── Application de la reco experte (écrit quantity_to_move) ───────────
create or replace function public.apply_expert_dotation(p_event_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_n int := 0; v_marge numeric := 0.15; v_pax numeric;
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
  )
  update runner_auto_planning rap
     set quantity_to_move = c.a_monter, updated_at = now()
    from cible c
   where rap.event_id = p_event_id and rap.space_id = c.space_id and rap.product_id = c.product_id
     and coalesce(rap.validation_status, 'brouillon') = 'brouillon'
     and rap.quantity_to_move is distinct from c.a_monter;
  get diagnostics v_n = row_count;

  return json_build_object('success', true, 'lignes_ajustees', v_n);
end;
$function$;

grant execute on function public.apply_expert_dotation(uuid) to authenticated;
