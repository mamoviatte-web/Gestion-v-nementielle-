-- =====================================================================
-- FIABILISATION LEDGER FÛTS — ANTI SUR-COMPTAGE DU DISPATCH
-- ---------------------------------------------------------------------
-- CONSTAT (matchs Aurillac / Australie / Narbonne) : les mouvements bruts
-- `sortie` (dispatch « Stockage Fûts » → espace) DÉPASSENT le dispatch réel
-- des fiches (event_stock_lines.initial + réassort). Mesuré (net des retours,
-- au niveau event×espace×produit, part positive) :
--   Fût BUD +124 · LEFFE +70 · Hoegaarden +43 · Goose +41 ·
--   FADA Blonde +12 · FADA IPA +5 · FADA Blanche +4.
-- Ces `sortie` fantômes sur-débitent le central SANS crédit compensatoire
-- (0 mouvement sur 181 `sortie` du central ne porte de `reversal_of`) → le
-- solde stock_balances(Stockage Fûts) ne boucle pas contre le comptage
-- physique.
--
-- CAUSE RACINE (code) : trigger `trg_initial_entered` (BEFORE INSERT OR
-- UPDATE OF initial_qty) → fonction `on_initial_entered()` (chantier B+,
-- 20260916140000). Elle calcule :
--     amont  = solde ESPACE courant (stock_balances location 'espace')
--     Δ      = initial_qty − amont
--     dépôt −= Δ ; espace = initial_qty ; mouvement 'sortie' de Δ.
-- Conçue idempotente SI le solde espace persiste entre deux enregistrements.
-- MAIS la clôture (`on_stock_final_entered`) et la réconciliation
-- (`reconcile_non_retained_keg_espace`, `finalize_event_espace_stocks`)
-- REMETTENT le solde fûts espace à 0 (ou au final). Si `initial_qty` est
-- ré-enregistré APRÈS ce reset (ré-save de la fiche, même valeur inchangée —
-- le trigger fire dès que la colonne est dans le SET), `on_initial_entered`
-- revoit amont=0 → Δ = initial_qty ENTIER → un SECOND `sortie` identique,
-- sans `reversal_of` ni crédit compensatoire. Preuve terrain : couples avec
-- deux `sortie` de même quantité à quelques heures d'écart (ex. Bistrot BUD
-- 9@14:14 + 9@22:11 ; Club70 Sud 8+8 ; Salon Sud 5+5 …).
--   → Taxonomie : c'est le cas (a) « doublon quand la fiche est ré-enregistrée
--     sans reverser l'ancienne sortie » (interaction reset-solde × ré-save).
--     Ce n'est PAS un double réassort (Δ-based, seulement à la hausse) ni une
--     sortie hors-event (celles-ci sont séparées et non concernées).
--
-- SYMÉTRIE : le fantôme reste NET (pas de retour compensatoire). Les retours
-- (`retour_réutilisable` espace→central) sont bien plus petits que le fantôme
-- (BUD retours 36 vs sur-débit 124) → sur-débit net confirmé sur le central.
--
-- CE CORRECTIF (deux volets, PROPOSÉS — rien appliqué ici) :
--   (A) DURABLE — `on_initial_entered` durci : sur UPDATE, si `initial_qty`
--       est INCHANGÉ (IS NOT DISTINCT FROM OLD), NE RIEN re-dispatcher.
--       Tue à la source le doublon observé (ré-save d'une même valeur après
--       reset de solde) sans changer le dispatch légitime (Δ réel ≠ 0).
--   (B) RATTRAPAGE HISTORIQUE — `neutralize_dispatch_phantom(event, by,
--       dry_run)` : par event×espace×produit fût, crédite le central du
--       fantôme = (Σ sortie/réassort central→espace) − (Σ retour/correction
--       espace→central) − (initial+réassort de la fiche), UNIQUEMENT pour les
--       mouvements postérieurs au DERNIER COMPTAGE PHYSIQUE du produit
--       (keg_inventory_counts) → ne se bat JAMAIS contre un recomptage.
--       Mouvement `correction` tracé from=espace to=central (RG-002),
--       stock_balances central += fantôme. IDEMPOTENT (les `correction`
--       déjà écrites sont re-soustraites → re-run = 0).
--
-- GARDE-FOUS : RG-002 (chaque correction = 1 mouvement écrit AVANT le
-- compteur) · event_stock_lines JAMAIS modifié (finals responsables /
-- CLOSING_LOCK : lecture seule ici) · RG-009/011 sans objet (aucune
-- suppression) · le COMPTAGE PHYSIQUE reste la VÉRITÉ ABSOLUE et PRIME :
-- ce correctif fait CONVERGER le ledger vers le physique ENTRE deux
-- comptages, il ne le remplace pas.
-- =====================================================================

-- ── (A) DURABLE : on_initial_entered — garde anti ré-dispatch ─────────
-- Reprise EXACTE de la version LIVE en prod (y compris la détection
-- `manque_constaté` quand le dépôt est à sec) avec, en tête, le seul ajout :
-- le garde « UPDATE à valeur inchangée → no-op » qui neutralise le doublon.
create or replace function public.on_initial_entered()
returns trigger language plpgsql set search_path to 'public'
as $function$
declare v_depot uuid; v_esp uuid; v_amont numeric; v_target int; v_delta int;
        v_is_keg boolean; v_resp text; v_avail numeric;
begin
  if (select event_type from events where event_id=NEW.event_id) = 'séminaire' then return NEW; end if;

  -- GARDE ANTI SUR-COMPTAGE : un ré-enregistrement de la fiche qui ne change
  -- PAS initial_qty ne doit JAMAIS re-débiter le dépôt. Sans ce garde, si le
  -- solde espace a été remis à 0 par la clôture/réconciliation entre-temps,
  -- amont=0 recalculait Δ=initial_qty → 'sortie' fantôme dupliquée.
  if TG_OP = 'UPDATE' and NEW.initial_qty is not distinct from OLD.initial_qty then
    return NEW;
  end if;

  -- transfert inter-espace déjà géré ailleurs → ne pas re-sortir
  if exists (select 1 from stock_movements m
              where m.event_id=NEW.event_id and m.space_id=NEW.space_id
                and m.product_id=NEW.product_id and m.movement_type='transfert_espace') then
    return NEW;
  end if;

  v_resp   := coalesce(NEW.responsable_nom, 'Ouverture');
  v_target := coalesce(NEW.initial_qty, 0);
  v_depot  := (select depot_id from product_depot_routing where product_id=NEW.product_id);
  v_esp    := espace_location_of(NEW.space_id);
  v_amont  := coalesce((select current_quantity from stock_balances
                        where product_id=NEW.product_id and location_id=v_esp), 0);
  v_delta  := v_target - v_amont;
  if v_delta = 0 then return NEW; end if;
  select (product_name ilike '%Fût%') into v_is_keg from products where product_id=NEW.product_id;

  if v_depot is not null then
    -- (préservé de la version live) : détecter le manque si le dépôt est à sec.
    select coalesce(current_quantity,0) into v_avail from stock_balances
      where product_id=NEW.product_id and location_id=v_depot;
    update stock_balances set current_quantity = current_quantity - v_delta, last_movement_at=now()
      where product_id=NEW.product_id and location_id=v_depot;
    if v_delta > 0 and coalesce(v_avail,0) < v_delta then
      insert into stock_movements (event_id, product_id, space_id, movement_type, qty, is_anomaly, responsable_nom)
        values (NEW.event_id, NEW.product_id, NEW.space_id, 'manque_constaté', v_delta - coalesce(v_avail,0), true, v_resp);
    end if;
  end if;
  if v_esp is not null then
    insert into stock_balances (product_id, location_id, current_quantity, last_movement_at, updated_by)
      values (NEW.product_id, v_esp, v_target, now(), v_resp)
      on conflict (product_id, location_id) do update
        set current_quantity=v_target, last_movement_at=now(), updated_by=v_resp;
  end if;

  if v_delta > 0 then
    insert into stock_movements (event_id, product_id, space_id, from_location_id, to_location_id, movement_type, qty, responsable_nom)
      values (NEW.event_id, NEW.product_id, NEW.space_id, v_depot, v_esp, 'sortie', v_delta, v_resp);
    if v_is_keg then
      perform reduce_keg_plein(NEW.product_id, v_delta);
      insert into keg_inventory (product_id, status, qty, volume_liters, event_id, space_id, dispatched_at, responsable_nom)
        values (NEW.product_id, 'en_espace', v_delta,
                (select volume_liters from keg_volume_standards where product_id=NEW.product_id),
                NEW.event_id, NEW.space_id, now(), v_resp);
    end if;
  else
    insert into stock_movements (event_id, product_id, space_id, from_location_id, to_location_id, movement_type, qty, responsable_nom)
      values (NEW.event_id, NEW.product_id, NEW.space_id, v_esp, v_depot, 'retour_réutilisable', -v_delta, v_resp);
  end if;
  return NEW;
end $function$;

-- ── (B) RATTRAPAGE HISTORIQUE : neutralize_dispatch_phantom ───────────
create or replace function public.neutralize_dispatch_phantom(
  p_event_id uuid    default null,
  p_by       text    default 'Correction sur-comptage dispatch fûts',
  p_dry_run  boolean default true
) returns json
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  r         record;
  v_central uuid;
  v_rows    json;
  v_lines   int := 0;
  v_credit  int := 0;
begin
  if auth.uid() is not null and not coalesce(is_stade(), false) then
    return json_build_object('success', false, 'error', 'Action réservée à l''équipe stade.');
  end if;

  select id into v_central from stock_locations
   where location_type = 'reserve_centrale' and name = 'Stockage Fûts' limit 1;
  if v_central is null then
    return json_build_object('success', false, 'error', 'Emplacement « Stockage Fûts » introuvable.');
  end if;

  create temporary table if not exists _ndp_plan (
    event_id uuid, space_id uuid, product_id uuid, product_name text, space_name text,
    out_q int, ret_q int, reel int, phantom int, loc uuid, anchor timestamptz
  ) on commit drop;
  delete from _ndp_plan;

  -- Ancre = dernier comptage physique par produit fût (keg_inventory_counts).
  -- On ne neutralise QUE le fantôme des mouvements POSTÉRIEURS à l'ancre :
  -- avant l'ancre, le comptage a déjà lavé l'erreur (vérité absolue).
  insert into _ndp_plan
  with lastc as (
    select product_id, max(counted_at) as c from keg_inventory_counts group by product_id
  ),
  outm as (
    select m.event_id, m.space_id, m.product_id, sum(m.qty) q
    from stock_movements m
    join lastc l on l.product_id = m.product_id and m.created_at > l.c
    where m.from_location_id = v_central
      and m.movement_type in ('sortie','réassort_événement')
      and m.event_id is not null
      and (p_event_id is null or m.event_id = p_event_id)
    group by 1,2,3
  ),
  retm as (
    select m.event_id, m.space_id, m.product_id, sum(m.qty) q
    from stock_movements m
    join lastc l on l.product_id = m.product_id and m.created_at > l.c
    where m.to_location_id = v_central
      and m.movement_type in ('retour_réutilisable','correction')
      and m.event_id is not null
      and (p_event_id is null or m.event_id = p_event_id)
    group by 1,2,3
  ),
  esl as (
    select e2.event_id, e2.space_id, e2.product_id,
           coalesce(e2.initial_qty,0) + coalesce(e2.reassort_qty,0) reel
    from event_stock_lines e2
    join products p on p.product_id = e2.product_id and p.unit = 'fût'
  )
  select coalesce(o.event_id, r.event_id) as event_id,
         coalesce(o.space_id, r.space_id) as space_id,
         coalesce(o.product_id, r.product_id) as product_id,
         p.product_name, s.space_name,
         coalesce(o.q,0) out_q, coalesce(r.q,0) ret_q, coalesce(e.reel,0) reel,
         coalesce(o.q,0) - coalesce(r.q,0) - coalesce(e.reel,0) as phantom,
         espace_location_of(coalesce(o.space_id, r.space_id)) as loc,
         (select c from lastc where product_id = coalesce(o.product_id, r.product_id)) as anchor
  from outm o
  full join retm r
    on r.event_id=o.event_id and r.space_id=o.space_id and r.product_id=o.product_id
  left join esl e
    on e.event_id=coalesce(o.event_id,r.event_id)
   and e.space_id=coalesce(o.space_id,r.space_id)
   and e.product_id=coalesce(o.product_id,r.product_id)
  join products p on p.product_id = coalesce(o.product_id, r.product_id)
  join spaces   s on s.space_id   = coalesce(o.space_id, r.space_id)
  where coalesce(o.q,0) - coalesce(r.q,0) - coalesce(e.reel,0) > 0;

  select coalesce(json_agg(json_build_object(
           'match', (select event_name from events where event_id = pl.event_id),
           'espace', pl.space_name, 'produit', pl.product_name,
           'sortie_out', pl.out_q, 'retours', pl.ret_q, 'fiche_reel', pl.reel,
           'phantom_credit', pl.phantom) order by pl.product_name, pl.space_name), '[]'::json),
         count(*), coalesce(sum(pl.phantom),0)
  into v_rows, v_lines, v_credit
  from _ndp_plan pl;

  if coalesce(p_dry_run, true) then
    return json_build_object('success', true, 'mode', 'dry_run',
      'couples_a_corriger', v_lines, 'pleins_a_crediter_central', v_credit,
      'detail', v_rows,
      'note', 'Aucune écriture. Fantôme postérieur au dernier comptage physique uniquement. Relancer p_dry_run:=false pour créditer.');
  end if;

  for r in select * from _ndp_plan loop
    -- RG-002 : mouvement de correction AVANT le compteur. Sens espace→central
    -- (miroir du sur-débit dispatch central→espace).
    insert into stock_movements (event_id, product_id, space_id,
      from_location_id, to_location_id, movement_type, qty, responsable_nom, event_category)
    values (r.event_id, r.product_id, r.space_id,
      r.loc, v_central, 'correction', r.phantom, p_by, 'autre');

    insert into stock_balances (product_id, location_id, current_quantity, last_movement_at, updated_by)
    values (r.product_id, v_central, r.phantom, now(), p_by)
    on conflict (product_id, location_id) do update
      set current_quantity = coalesce(stock_balances.current_quantity,0) + r.phantom,
          last_movement_at = now(), updated_by = p_by;
  end loop;

  return json_build_object('success', true, 'mode', 'applied',
    'couples_corriges', v_lines, 'pleins_credites_central', v_credit,
    'detail', v_rows,
    'note', 'Sur-comptage dispatch neutralisé (postérieur au dernier comptage). Le comptage physique reste la vérité absolue et prime.');
end;
$fn$;

grant execute on function public.neutralize_dispatch_phantom(uuid, text, boolean) to authenticated;

comment on function public.neutralize_dispatch_phantom(uuid, text, boolean) is
  'Neutralise le sur-comptage des sorties dispatch fûts : crédite « Stockage '
  'Fûts » du fantôme (Σ sortie/réassort central→espace − Σ retour/correction − '
  'fiche initial+réassort) pour les mouvements postérieurs au dernier comptage '
  'physique. Mouvement correction tracé (RG-002). Idempotent. Le comptage '
  'physique prime. Ne modifie jamais event_stock_lines.';

-- ── OPTION d'exécution (À VALIDER — NE PAS décommenter sans validation) ─
-- Dry-run global :
--   select public.neutralize_dispatch_phantom(null, 'Correction dispatch', true);
-- Effet attendu (état au 28/09, fantôme post-ancre 21/09 12:47 non lavé par un
-- recomptage — BUD/LEFFE recomptés le 28/09 → déjà à 0, hors périmètre) :
--   FADA Blonde  : central −12 +12 → 0
--   Fût Goose    : +9  (déjà partiellement recrédité par ailleurs)
--   Hoegaarden   : +7
--   FADA IPA     : central −7  +5  → −2 (résidu = autre cause, à investiguer)
--   FADA Blanche : central −5  +4  → −1 (résidu = autre cause)
-- Application (après validation) :
--   select public.neutralize_dispatch_phantom(null, 'Correction dispatch', false);
-- =====================================================================
