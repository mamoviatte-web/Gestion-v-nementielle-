-- =====================================================================
-- DOTATION EXPERTE — PARTICULARITÉ DES LOGES (dotation de base fixe)
-- ---------------------------------------------------------------------
-- Schéma Loges : « Loge Est / Ouest Nord / Ouest Sud » sont des STOCKS
-- CENTRAUX qui regroupent la dotation de base des N loges individuelles
-- (14 pour l'Est, 4 + 4 pour l'Ouest — table loge_dotations, une ligne par
-- loge). Le stock central reçoit les RETOURS des loges. Le « à monter » =
-- base totale − stock central (remise à niveau de la mise en place), et NON
-- une estimation de consommation.
--
-- → L'algorithme expert (conso projetée − espace) NE DOIT PAS s'appliquer aux
--   loges : on conserve leur dotation de base (passthrough). Seuls les autres
--   espaces (salons, bars, buvettes, bodega) sont recalculés sur la conso.
-- Chaque ligne porte désormais un `modele` : 'dotation_loge' | 'conso'.
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
  v_loges  uuid[] := array[
    'a96044d1-9ab0-45d0-85eb-73672df6ab82',  -- Loge Est (14 loges)
    '673b6e4e-0f5a-406f-9029-c35b25a38103',  -- Loge Ouest Nord (4)
    '8be2956e-a379-4e8e-a3eb-65401bac3c56'   -- Loge Ouest Sud (4)
  ]::uuid[];
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
      (b.space_id = any(v_loges)) as is_loge,
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
      -- Conso projetée : NULL pour les loges (dotation fixe, pas de conso).
      case when b.space_id = any(v_loges) then null
           else round(coalesce(h.conso_kpax * (v_pax / 1000.0), b.consumption_reference, 0))::int end as conso_projetee,
      coalesce(b.area_stock, 0)::int as espace,
      coalesce(b.qty_to_move, 0)::int as a_monter_actuel,
      -- Besoin : loge = base totale (à monter actuel + espace) ; sinon conso × marge.
      case when b.space_id = any(v_loges) then (coalesce(b.qty_to_move, 0) + coalesce(b.area_stock, 0))
           else ceil(coalesce(h.conso_kpax * (v_pax / 1000.0), b.consumption_reference, 0) * (1 + v_marge))::int end as besoin_expert,
      -- À monter expert : loge = inchangé (dotation) ; sinon besoin − espace.
      case when b.space_id = any(v_loges) then coalesce(b.qty_to_move, 0)
           else greatest(0, ceil(coalesce(h.conso_kpax * (v_pax / 1000.0), b.consumption_reference, 0) * (1 + v_marge))::int - coalesce(b.area_stock, 0)) end as a_monter_expert,
      case when b.space_id = any(v_loges) then 'dotation_loge' else 'conso' end as modele
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
          'conso_projetee', sum(conso_projetee), 'espace', sum(espace),
          'a_monter_actuel', sum(a_monter_actuel), 'a_monter_expert', sum(a_monter_expert),
          'surtransmission', sum(a_monter_actuel - a_monter_expert)
        ) as g
        from calc group by gamme
      ) t
    ),
    'lignes', (
      select coalesce(json_agg(json_build_object(
        'space_name', space_name, 'product_name', product_name, 'gamme', gamme, 'modele', modele,
        'conso_dernier', conso_dernier, 'conso_projetee', conso_projetee,
        'espace', espace, 'besoin_expert', besoin_expert,
        'a_monter_actuel', a_monter_actuel, 'a_monter_expert', a_monter_expert,
        'surtransmission', a_monter_actuel - a_monter_expert
      ) order by (a_monter_actuel - a_monter_expert) desc, space_name), '[]'::json)
      from calc where (a_monter_actuel > 0 or a_monter_expert > 0) and modele = 'conso'
    )
  ) into v_out;

  return v_out;
end;
$function$;

grant execute on function public.expert_runner_analysis(uuid) to authenticated;

-- ── Application : ne touche PAS les loges (dotation de base préservée) ──
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
