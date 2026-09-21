-- =====================================================================
-- OPÉRATEUR DE CONTRÔLE DES FÛTS À LA CLÔTURE
-- ---------------------------------------------------------------------
-- Objectif : à la clôture d'un match, un contrôle dédié UNIQUEMENT aux fûts
-- annonce les défauts de cheminement — ceux que la clôture ne corrige pas
-- toute seule et qui font ensuite dériver le stock (cf. écart Australie).
--
-- audit_keg_closure(p_event) renvoie, pour un match :
--   • resume  : cheminement fûts (dispatché, vides à rentrer, pleins retournés
--     au stockage, pleins gardés sur place, nb espaces).
--   • defauts : liste typée des anomalies détectées :
--       - final_manquant  (bloquant) : fût parti vers un espace mais final non
--         saisi à la clôture → sort du suivi, source directe de dérive.
--       - conso_negative  (bloquant) : final > initial+réassort (saisie fausse).
--       - garde_hors_regle(alerte)   : fûts pleins « gardés sur place » dans un
--         espace qui ne conserve pas les fûts.
--   • ancrage_perime : le dernier comptage physique des fûts est antérieur au
--     match → le stock fûts va dériver, un comptage physique est requis
--     (bouton « Inventaire »). C'est LA leçon de l'écart constaté.
--
-- Lecture seule (aucune écriture) — réservé ROLE_STADE.
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
begin
  if auth.uid() is not null and not coalesce(is_stade(), false) then
    return json_build_object('success', false, 'error', 'Réservé à l''équipe stade.');
  end if;
  select * into v_event from events where event_id = p_event_id;
  if not found then
    return json_build_object('success', false, 'error', 'Événement introuvable.');
  end if;

  -- Résumé du cheminement fûts (vue event_keg_reconciliation).
  select json_build_object(
    'dispatche', coalesce(sum(dispatche), 0),
    'vides_a_rentrer', coalesce(sum(vides_a_rentrer), 0),
    'pleins_retour_stockage', coalesce(sum(pleins_restants) filter (where destination_pleins = 'retour_stockage'), 0),
    'pleins_gardes', coalesce(sum(pleins_restants) filter (where destination_pleins = 'garde_sur_place'), 0),
    'espaces', count(distinct space_id)
  ) into v_resume
  from event_keg_reconciliation
  where event_id = p_event_id;

  -- Dernier comptage physique des fûts (tous produits confondus).
  select max(counted_at)::date into v_last_count from keg_inventory_counts;

  -- Défauts typés.
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
