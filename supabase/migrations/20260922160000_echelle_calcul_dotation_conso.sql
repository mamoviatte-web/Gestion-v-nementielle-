-- =====================================================================
-- ÉCHELLE DE CALCUL DE LA DOTATION — MODÈLE DE CONSOMMATION PAR ESPACE
-- ---------------------------------------------------------------------
-- Remplace la moyenne plate × marge fixe par une véritable échelle statistique,
-- calculée PAR ESPACE × PRODUIT à partir des matchs clôturés :
--
--   1. Intensité de conso normalisée pour 1000 spectateurs, par match :
--        r_m = (initial + réassort − final) / (affluence_m / 1000)
--   2. Pondération par RÉCENCE (les matchs récents pèsent plus) :
--        w_m = 0.6 ^ (rang_récence)      (rang 0 = plus récent)
--      → intensité pondérée  r̄ = Σ(w·r) / Σ(w)
--   3. VARIABILITÉ (coefficient de variation pondéré) :
--        cv = écart-type pondéré / r̄
--   4. MARGE DE SÉCURITÉ ADAPTATIVE (au lieu d'un 15 % fixe) :
--        marge = 12 % + 35 %·cv + bonus petit échantillon
--                (+15 % si 1 match, +8 % si 2), bornée à [10 %, 45 %]
--      → un produit régulier reçoit peu de marge, un produit volatil davantage,
--        un produit à faible historique est protégé par un buffer plus large.
--   5. BESOIN projeté sur l'affluence attendue :
--        besoin = ceil( r̄ × (affluence / 1000) × (1 + marge) )
--   6. À MONTER = max(0, besoin − stock restant), soustraction faite par la
--      fiche runner (event_runner_board), vivante et par produit.
--
-- Produits SANS historique de conso : besoin = NULL → NON touchés (le socle /
-- plancher de la génération par défaut est conservé). Loges exclues (dotation
-- de base fixe).
--
-- runner_demand_scale(event[, space]) : l'échelle, transparente (lecture seule).
-- apply_consumption_demand(event[, space]) : écrit la DEMANDE (recommended +
--   validated) issue de l'échelle, efface l'override manuel.
-- generate_runner_dotations : applique l'échelle AUTOMATIQUEMENT en fin de
--   génération (plus besoin du bouton) — via un wrapper sur la génération de base.
-- expert_runner_analysis / apply_expert_dotation : rebranchés sur l'échelle.
-- =====================================================================

-- ── 1) L'ÉCHELLE (transparente, lecture seule) ────────────────────────
create or replace function public.runner_demand_scale(p_event_id uuid, p_space_id uuid default null)
returns table(
  space_id uuid, product_id uuid, space_name text, product_name text, category text,
  n_matchs int, intensite_kpax numeric, cv numeric, marge numeric,
  conso_dernier int, conso_projetee int, besoin int, area_stock int, a_monter int, is_loge boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with params as (
    select coalesce(expected_attendees, 0)::numeric as pax from events where event_id = p_event_id
  ),
  loges as (select array[
    'a96044d1-9ab0-45d0-85eb-73672df6ab82',
    '673b6e4e-0f5a-406f-9029-c35b25a38103',
    '8be2956e-a379-4e8e-a3eb-65401bac3c56'
  ]::uuid[] as ids),
  hist as (
    select esl.space_id, esl.product_id, e.event_date,
           (esl.initial_qty + coalesce(esl.reassort_qty, 0) - esl.final_qty)::numeric as conso,
           (esl.initial_qty + coalesce(esl.reassort_qty, 0) - esl.final_qty)::numeric / (e.expected_attendees / 1000.0) as r
    from event_stock_lines esl
    join events e on e.event_id = esl.event_id and e.event_type = 'match'
      and lower(coalesce(e.status, '')) in ('clôturé', 'cloture', 'archivé', 'archive')
      and e.event_id <> p_event_id and coalesce(e.expected_attendees, 0) > 0
    where esl.final_qty is not null
      and (esl.initial_qty + coalesce(esl.reassort_qty, 0) - esl.final_qty) >= 0
  ),
  ranked as (
    select space_id, product_id, r, conso, event_date,
           row_number() over (partition by space_id, product_id order by event_date desc) as rk,
           count(*)     over (partition by space_id, product_id) as n
    from hist
  ),
  wt as (
    select space_id, product_id, n, r, power(0.6, rk - 1)::numeric as w,
           first_value(conso) over (partition by space_id, product_id order by event_date desc) as conso_dernier
    from ranked
  ),
  agg as (
    select space_id, product_id, max(n) as n, max(conso_dernier) as conso_dernier,
           sum(w * r) / nullif(sum(w), 0) as rbar,
           sum(w * r * r) / nullif(sum(w), 0) as er2
    from wt group by space_id, product_id
  ),
  scaled as (
    select space_id, product_id, n, conso_dernier, rbar,
           case when rbar > 0 then sqrt(greatest(er2 - rbar * rbar, 0)) / rbar else 0 end as cv
    from agg
  ),
  demand as (
    select space_id, product_id, n, conso_dernier, rbar, cv,
           least(0.45, greatest(0.10,
             0.12 + 0.35 * cv + case when n < 2 then 0.15 when n < 3 then 0.08 else 0 end)) as marge
    from scaled
  )
  select
    b.space_id, b.product_id, b.space_name, b.product_name, b.category,
    coalesce(d.n, 0) as n_matchs,
    round(coalesce(d.rbar, 0), 2) as intensite_kpax,
    round(coalesce(d.cv, 0), 2) as cv,
    round(coalesce(d.marge, 0), 3) as marge,
    coalesce(d.conso_dernier, 0)::int as conso_dernier,
    case when d.rbar is not null then round(d.rbar * (pp.pax / 1000.0))::int else 0 end as conso_projetee,
    case when d.rbar is not null then ceil(d.rbar * (pp.pax / 1000.0) * (1 + d.marge))::int else null end as besoin,
    coalesce(b.area_stock, 0)::int as area_stock,
    case when d.rbar is not null
         then greatest(0, ceil(d.rbar * (pp.pax / 1000.0) * (1 + d.marge))::int - coalesce(b.area_stock, 0))
         else null end as a_monter,
    (b.space_id = any(lg.ids)) as is_loge
  from event_runner_board b
  cross join params pp
  cross join loges lg
  left join demand d on d.space_id = b.space_id and d.product_id = b.product_id
  where b.event_id = p_event_id and (p_space_id is null or b.space_id = p_space_id);
$function$;

grant execute on function public.runner_demand_scale(uuid, uuid) to authenticated;

-- ── 2) Écrit la DEMANDE issue de l'échelle (reste soustrait par le board) ──
create or replace function public.apply_consumption_demand(p_event_id uuid, p_space_id uuid default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_n int := 0;
begin
  if auth.uid() is not null and not coalesce(is_stade(), false) then
    return json_build_object('success', false, 'error', 'Réservé à l''équipe stade.');
  end if;

  update runner_auto_planning rap
     set recommended_quantity = s.besoin,
         validated_quantity   = s.besoin,
         quantity_to_move     = s.besoin,
         manual_qty_to_move   = null,
         updated_at = now()
    from runner_demand_scale(p_event_id, p_space_id) s
   where rap.event_id = p_event_id and rap.space_id = s.space_id and rap.product_id = s.product_id
     and s.besoin is not null and not s.is_loge
     and coalesce(rap.validation_status, 'brouillon') = 'brouillon'
     and (rap.recommended_quantity is distinct from s.besoin
          or rap.validated_quantity is distinct from s.besoin
          or rap.manual_qty_to_move is not null);
  get diagnostics v_n = row_count;

  return json_build_object('success', true, 'lignes_ajustees', v_n,
    'principe', 'demande = échelle conso par espace (récence + marge adaptative) ; reste soustrait auto');
end;
$function$;

grant execute on function public.apply_consumption_demand(uuid, uuid) to authenticated;

-- ── 3) Le bouton « Appliquer la dotation experte » réutilise l'échelle ──
create or replace function public.apply_expert_dotation(p_event_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  return apply_consumption_demand(p_event_id, null);
end;
$function$;

grant execute on function public.apply_expert_dotation(uuid) to authenticated;

-- ── 4) L'analyse (panneau) rebranchée sur l'échelle ───────────────────
create or replace function public.expert_runner_analysis(p_event_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_event events%rowtype;
  v_out json;
begin
  if auth.uid() is not null and not coalesce(is_stade(), false) then
    return json_build_object('success', false, 'error', 'Réservé à l''équipe stade.');
  end if;
  select * into v_event from events where event_id = p_event_id;
  if not found then
    return json_build_object('success', false, 'error', 'Événement introuvable.');
  end if;

  with s as (select * from runner_demand_scale(p_event_id)),
  board as (select space_id, product_id, qty_to_move from event_runner_board where event_id = p_event_id),
  calc as (
    select
      s.space_name, s.product_name, s.category, s.is_loge, s.n_matchs, s.cv, s.marge,
      case
        when s.product_name ilike '%Fût%'        then 'Fûts'
        when s.category in ('Vins', 'Champagne')  then 'Vins'
        when s.category = 'Bières'                then 'Bières'
        when s.category = 'Soft'                  then 'Softs & Eaux'
        when s.category = 'Sirops'                then 'Sirops'
        when s.category = 'Spiritueux'            then 'Spiritueux'
        else 'Autres'
      end as gamme,
      s.conso_dernier,
      case when s.is_loge then null else s.conso_projetee end as conso_projetee,
      s.area_stock as espace,
      coalesce(s.besoin, b.qty_to_move, 0) as besoin_expert,
      coalesce(b.qty_to_move, 0) as a_monter_actuel,
      -- loge ou produit sans historique → pas de recalcul (on garde l'actuel)
      case when s.is_loge or s.a_monter is null then coalesce(b.qty_to_move, 0) else s.a_monter end as a_monter_expert,
      case when s.is_loge then 'dotation_loge' else 'conso' end as modele
    from s left join board b on b.space_id = s.space_id and b.product_id = s.product_id
  )
  select json_build_object(
    'success', true,
    'event_id', p_event_id, 'event_name', v_event.event_name, 'expected_attendees', coalesce(v_event.expected_attendees, 0),
    'total_a_monter_actuel', (select coalesce(sum(a_monter_actuel), 0) from calc),
    'total_a_monter_expert', (select coalesce(sum(a_monter_expert), 0) from calc),
    'total_surtransmission', (select coalesce(sum(a_monter_actuel - a_monter_expert), 0) from calc),
    'gammes', (
      select coalesce(json_agg(g order by g->>'gamme'), '[]'::json) from (
        select json_build_object(
          'gamme', gamme,
          'conso_projetee', coalesce(sum(conso_projetee), 0), 'espace', sum(espace),
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

-- ── 5) Câblage AUTO dans la génération (wrapper base + échelle) ────────
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'generate_runner_dotations_base'
  ) then
    alter function public.generate_runner_dotations(uuid, uuid, boolean)
      rename to generate_runner_dotations_base;
  end if;
end $$;

create or replace function public.generate_runner_dotations(
  p_event_id uuid, p_space_id uuid default null, p_as_buvette boolean default false)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_base json; v_dem json;
begin
  -- 1) Génération de base (socle CDC, loges, complément, consolidation anti-mélange).
  v_base := public.generate_runner_dotations_base(p_event_id, p_space_id, p_as_buvette);
  -- 2) Échelle de conso PAR ESPACE : la demande = conso projetée (récence +
  --    marge adaptative) ; la fiche runner soustrait le reste automatiquement.
  v_dem := public.apply_consumption_demand(p_event_id, p_space_id);
  return jsonb_set(coalesce(v_base::jsonb, '{}'::jsonb), '{dotation_conso}', coalesce(v_dem::jsonb, 'null'::jsonb))::json;
end;
$function$;

grant execute on function public.generate_runner_dotations(uuid, uuid, boolean) to authenticated;
