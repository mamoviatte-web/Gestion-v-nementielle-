-- =====================================================================
-- OPÉRATEUR FÛTS — GARDE-FOU « FÛTS EN ESPACE NON SOLDÉS » (suivi clôture)
-- ---------------------------------------------------------------------
-- Complète audit_keg_closure avec un contrôle d'INVARIANT post-clôture :
-- après clôture, un espace qui ne conserve pas ses fûts (VIP, bars, buvettes
-- hors EST) NE DOIT PLUS avoir de fût en inventaire espace (ils repartent en
-- stockage central). Le correctif 20260922110000 garantit cet invariant à
-- chaque saisie de final + à la clôture ; ce contrôle le REND VISIBLE dans
-- l'opérateur de contrôle des fûts et sert de tripwire de suivi (doit rester
-- vert). Il ne se déclenche que sur un événement à/après clôture, pour ne pas
-- confondre le dispatch en cours de match (normal) avec une dérive.
--
-- Ajoute aussi au résumé le total « fûts encore en espace (non conservés) ».
-- Lecture seule — réservé ROLE_STADE.
-- =====================================================================

create or replace function public.audit_keg_closure(p_event_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_event      events%rowtype;
  v_resume     json;
  v_defauts    json;
  v_last_count date;
  v_nb         int;
  v_post_cloture boolean;
  v_futs_espace numeric;
begin
  if auth.uid() is not null and not coalesce(is_stade(), false) then
    return json_build_object('success', false, 'error', 'Réservé à l''équipe stade.');
  end if;
  select * into v_event from events where event_id = p_event_id;
  if not found then
    return json_build_object('success', false, 'error', 'Événement introuvable.');
  end if;

  v_post_cloture := lower(coalesce(v_event.status, '')) in
    ('clôture_en_attente', 'clôturé', 'cloture', 'archivé', 'archive');

  -- Total fûts encore en inventaire espace pour les espaces NON conservés du match.
  select coalesce(sum(sb.current_quantity), 0) into v_futs_espace
  from stock_balances sb
  join stock_locations loc on loc.id = sb.location_id and loc.location_type = 'espace'
  join spaces s on s.space_id = loc.area_id and not coalesce(s.retain_kegs_in_espace, false)
  join products p on p.product_id = sb.product_id and p.unit = 'fût'
  where loc.area_id in (select space_id from event_spaces where event_id = p_event_id)
    and coalesce(sb.current_quantity, 0) <> 0;

  -- Résumé du cheminement fûts (vue event_keg_reconciliation) + invariant espace.
  select json_build_object(
    'dispatche', coalesce(sum(dispatche), 0),
    'vides_a_rentrer', coalesce(sum(vides_a_rentrer), 0),
    'pleins_retour_stockage', coalesce(sum(pleins_restants) filter (where destination_pleins = 'retour_stockage'), 0),
    'pleins_gardes', coalesce(sum(pleins_restants) filter (where destination_pleins = 'garde_sur_place'), 0),
    'espaces', count(distinct space_id),
    'futs_espace_non_conserves', v_futs_espace
  ) into v_resume
  from event_keg_reconciliation
  where event_id = p_event_id;

  select max(counted_at)::date into v_last_count from keg_inventory_counts;

  with defs as (
    select 'final_manquant'::text as code, 'bloquant'::text as gravite, p.product_name, s.space_name,
           'Fût parti (' || (esl.initial_qty + coalesce(esl.reassort_qty, 0)) || ') mais final non saisi à la clôture' as detail,
           (esl.initial_qty + coalesce(esl.reassort_qty, 0)) as qty
    from event_stock_lines esl
    join products p on p.product_id = esl.product_id and p.product_name ilike '%Fût%'
    join spaces s on s.space_id = esl.space_id
    where esl.event_id = p_event_id
      and (esl.initial_qty + coalesce(esl.reassort_qty, 0)) > 0
      and esl.final_qty is null

    union all
    select 'conso_negative', 'bloquant', p.product_name, s.space_name,
           'Consommation négative (' || (esl.initial_qty + coalesce(esl.reassort_qty, 0) - esl.final_qty) || ') : final supérieur à initial + réassort' as detail,
           (esl.initial_qty + coalesce(esl.reassort_qty, 0) - esl.final_qty) as qty
    from event_stock_lines esl
    join products p on p.product_id = esl.product_id and p.product_name ilike '%Fût%'
    join spaces s on s.space_id = esl.space_id
    where esl.event_id = p_event_id
      and esl.final_qty is not null
      and (esl.initial_qty + coalesce(esl.reassort_qty, 0) - esl.final_qty) < 0

    union all
    select 'garde_hors_regle', 'alerte', ekr.product_name, ekr.space_name,
           'Fûts pleins gardés sur place (' || ekr.pleins_restants || ') alors que cet espace ne conserve pas les fûts' as detail,
           ekr.pleins_restants as qty
    from event_keg_reconciliation ekr
    join spaces s on s.space_id = ekr.space_id
    where ekr.event_id = p_event_id
      and ekr.destination_pleins = 'garde_sur_place'
      and ekr.pleins_restants > 0
      and not coalesce(s.retain_kegs_in_espace, false)

    -- Invariant post-clôture : fûts encore en inventaire espace non conservé.
    union all
    select 'fut_espace_non_solde', 'alerte', p.product_name, s.space_name,
           'Fûts encore en inventaire espace (' || sb.current_quantity ||
           ') alors que cet espace ne stocke pas les fûts — à ramener en stockage central (bouton « Recaler les stocks espaces »)' as detail,
           sb.current_quantity::int as qty
    from stock_balances sb
    join stock_locations loc on loc.id = sb.location_id and loc.location_type = 'espace'
    join spaces s on s.space_id = loc.area_id and not coalesce(s.retain_kegs_in_espace, false)
    join products p on p.product_id = sb.product_id and p.unit = 'fût'
    where v_post_cloture
      and loc.area_id in (select space_id from event_spaces where event_id = p_event_id)
      and coalesce(sb.current_quantity, 0) <> 0
  )
  select
    coalesce(json_agg(json_build_object(
      'code', code, 'gravite', gravite, 'product_name', product_name,
      'space_name', space_name, 'detail', detail, 'qty', qty
    ) order by (gravite = 'bloquant') desc, product_name), '[]'::json),
    count(*)
  into v_defauts, v_nb
  from defs;

  return json_build_object(
    'success', true,
    'event_id', p_event_id,
    'event_name', v_event.event_name,
    'event_date', v_event.event_date,
    'resume', v_resume,
    'dernier_comptage', v_last_count,
    'ancrage_perime', (v_last_count is null or v_last_count < v_event.event_date),
    'nb_defauts', v_nb,
    'nb_bloquants', (select count(*) from json_array_elements(v_defauts) d where d->>'gravite' = 'bloquant'),
    'defauts', v_defauts
  );
end;
$function$;

grant execute on function public.audit_keg_closure(uuid) to authenticated;
