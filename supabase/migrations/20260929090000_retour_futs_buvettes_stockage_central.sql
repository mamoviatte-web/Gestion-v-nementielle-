-- =====================================================================
-- RETOUR DES FÛTS PLEINS (NON CONSOMMÉS) DES ESPACES NON CONSERVATEURS
-- VERS « STOCKAGE FÛTS » (réserve centrale) — CRÉDIT + MOUVEMENT TRACÉ
-- ---------------------------------------------------------------------
-- GAP CONSTATÉ (matchs Aurillac / Australie / Narbonne) :
--   reconcile_non_retained_keg_espace(event) remet à 0 le solde fûts des
--   espaces qui ne conservent pas leurs fûts (retain_kegs_in_espace=false :
--   buvettes, tentes, VIP/bars sans cave), MAIS :
--     • ne CRÉDITE PAS l'emplacement central « Stockage Fûts » ;
--     • n'écrit AUCUN mouvement `retour_réutilisable`.
--   Le central est débité au dispatch ('sortie') mais jamais re-crédité au
--   retour → soldes négatifs (BUD −46, LEFFE −30, FADA Blonde −12,
--   Goose −7, FADA IPA −7, Hoegaarden −6, FADA Blanche −5).
--
--   Symétrie cassée : la branche NON-fût de on_stock_final_entered() crédite
--   déjà le dépôt et écrit un `retour_réutilisable` pour les 'fermé' rendus.
--   La branche fût (espace non conservateur) ne le fait pas → ce correctif
--   rétablit la symétrie côté fûts, à la clôture.
--
-- MODÈLE MÉTIER :
--   Fût dispatché depuis « Stockage Fûts » → tiré à la pression en espace.
--   En fin de match, l'espace non conservateur finit à 0 fût :
--     • fûts VIDES / percutés  → flux VIDES (keg_inventory 'vide'), NE
--       créditent PAS les pleins du central ;
--     • fûts PLEINS non entamés ('fermé') → RAPPORTÉS au « Stockage Fûts »
--       central = c'est CE crédit qui manquait.
--
-- CE QUE FAIT CE CORRECTIF :
--   1. return_buvette_kegs_to_central(p_event_id, p_by, p_dry_run) :
--      pour chaque (espace non conservateur × fût) de l'événement, calcule
--      les PLEINS non consommés (final_qty, product_state 'fermé'/NULL —
--      JAMAIS 'fût_vide'/'fût_percuté'/'cassé'/'perdu'/'périmé'/'ouvert'),
--      soustrait ce qui a DÉJÀ été crédité en `retour_réutilisable` vers le
--      central pour ce couple event×espace×produit (garde-fou idempotent),
--      et crédite le complément : mouvement `retour_réutilisable`
--      from=espace → to=« Stockage Fûts » (RG-002 : mouvement AVANT compteur),
--      puis stock_balances central += complément.
--   2. reconcile_event_closure() l'appelle en ÉTAPE B, juste APRÈS
--      reconcile_non_retained_keg_espace (espace→0) → le crédit central
--      devient AUTOMATIQUE à chaque clôture via trg_zz_reconcile_on_close.
--
-- IDEMPOTENCE : la fonction ne crédite QUE le complément non encore couvert.
--   Rejouée → complément 0 → aucune écriture, aucun double compte. La
--   correction d'un final par le responsable est gérée par on_stock_final_
--   entered() (étape reverse : supprime les `retour_réutilisable` du couple
--   et décrémente le central) ; un ré-appel recrédite proprement.
--
-- COHÉRENCE LEDGER : le solde central authoritatif est double : le COMPTEUR
--   (stock_balances.current_quantity) ET le DÉRIVÉ (v_stock_ledger_balance =
--   dernière ancre + Σ flux). On écrit le MOUVEMENT (flux_in central) ET on
--   incrémente le COMPTEUR du même montant → les deux avancent ensemble,
--   pas de divergence. Le comptage physique (record_keg_count) reste la
--   VÉRITÉ finale et ré-ancre le central (jamais inventé ici).
--
-- RG-001 responsable tracé (p_by) · RG-002 mouvement avant compteur ·
-- RG-003 aucun prix exposé côté responsable · réservé ROLE_STADE.
-- =====================================================================

-- ── 1) Fonction de retour des pleins non consommés vers le central ────
create or replace function public.return_buvette_kegs_to_central(
  p_event_id uuid,
  p_by       text    default 'Clôture (retour fûts → Stockage Fûts)',
  p_dry_run  boolean default false
) returns json
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  r          record;
  v_central  uuid;
  v_loc      uuid;
  v_complement int;
  v_rows     json;
  v_lines    int := 0;
  v_credited int := 0;
begin
  if auth.uid() is not null and not coalesce(is_stade(), false) then
    return json_build_object('success', false, 'error', 'Action réservée à l''équipe stade.');
  end if;

  -- Emplacement central « Stockage Fûts » (réserve centrale des fûts).
  select id into v_central
  from stock_locations
  where location_type = 'reserve_centrale' and name = 'Stockage Fûts'
  limit 1;
  if v_central is null then
    return json_build_object('success', false, 'error', 'Emplacement « Stockage Fûts » introuvable.');
  end if;

  -- Plan : pour chaque (espace NON conservateur × fût), pleins non consommés
  -- ('fermé'/NULL uniquement), moins ce qui est déjà crédité vers le central.
  create temporary table if not exists _rbk_plan (
    space_id uuid, product_id uuid, space_name text, product_name text,
    pleins_owed int, deja_credite int, complement int, loc uuid
  ) on commit drop;
  delete from _rbk_plan;

  insert into _rbk_plan
  select o.space_id, o.product_id, o.space_name, o.product_name,
         o.pleins_owed, coalesce(c.deja, 0) as deja_credite,
         greatest(o.pleins_owed - coalesce(c.deja, 0), 0) as complement,
         espace_location_of(o.space_id) as loc
  from (
    select esl.space_id, esl.product_id, s.space_name, p.product_name,
           sum(case
                 when coalesce(esl.product_state, 'fermé') in
                      ('fût_vide','fût_percuté','cassé','perdu','périmé','ouvert')
                 then 0
                 else greatest(coalesce(esl.final_qty, 0), 0)
               end) as pleins_owed
    from event_stock_lines esl
    join products p on p.product_id = esl.product_id and p.unit = 'fût'
    join spaces   s on s.space_id   = esl.space_id
                   and coalesce(s.retain_kegs_in_espace, false) = false
    where esl.event_id = p_event_id
      and esl.final_qty is not null
    group by esl.space_id, esl.product_id, s.space_name, p.product_name
  ) o
  left join (
    select m.space_id, m.product_id, sum(m.qty) as deja
    from stock_movements m
    where m.event_id = p_event_id
      and m.movement_type = 'retour_réutilisable'
      and m.to_location_id = v_central
    group by m.space_id, m.product_id
  ) c on c.space_id = o.space_id and c.product_id = o.product_id
  where o.pleins_owed > 0;

  select coalesce(json_agg(json_build_object(
           'espace', space_name, 'produit', product_name,
           'pleins_owed', pleins_owed, 'deja_credite', deja_credite,
           'complement', complement
         ) order by space_name, product_name), '[]'::json)
  into v_rows
  from _rbk_plan where complement > 0;

  select count(*), coalesce(sum(complement), 0)
  into v_lines, v_credited
  from _rbk_plan where complement > 0;

  if coalesce(p_dry_run, false) then
    return json_build_object('success', true, 'mode', 'dry_run', 'event_id', p_event_id,
      'couples_a_crediter', v_lines, 'pleins_a_crediter', v_credited,
      'detail', v_rows,
      'note', 'Aucune écriture. Relancer avec p_dry_run := false pour créditer le central.');
  end if;

  -- APPLICATION : RG-002 → mouvement AVANT compteur, un couple à la fois.
  for r in select * from _rbk_plan where complement > 0 loop
    v_complement := r.complement;

    -- Mouvement double-entrée : espace (perte) → « Stockage Fûts » (gain).
    insert into stock_movements (event_id, product_id, space_id,
      from_location_id, to_location_id, movement_type, qty, responsable_nom)
    values (p_event_id, r.product_id, r.space_id,
      r.loc, v_central, 'retour_réutilisable', v_complement, p_by);

    -- Compteur central += complément (aligné sur le flux ledger ci-dessus).
    insert into stock_balances (product_id, location_id, current_quantity, last_movement_at, updated_by)
    values (r.product_id, v_central, v_complement, now(), p_by)
    on conflict (product_id, location_id) do update
      set current_quantity = coalesce(stock_balances.current_quantity, 0) + v_complement,
          last_movement_at = now(), updated_by = p_by;
  end loop;

  return json_build_object('success', true, 'mode', 'applied', 'event_id', p_event_id,
    'couples_credites', v_lines, 'pleins_credites', v_credited,
    'detail', v_rows,
    'note', 'Pleins non consommés re-crédités au « Stockage Fûts ». Le comptage physique (record_keg_count) reste la vérité finale.');
end;
$fn$;

grant execute on function public.return_buvette_kegs_to_central(uuid, text, boolean) to authenticated;

comment on function public.return_buvette_kegs_to_central(uuid, text, boolean) is
  'Crédite « Stockage Fûts » des fûts PLEINS non consommés des espaces non '
  'conservateurs (retain_kegs_in_espace=false) et trace un retour_réutilisable '
  'espace→central (RG-002). Idempotente (ne crédite que le complément non déjà '
  'couvert). Appelée automatiquement par reconcile_event_closure à la clôture.';

-- ── 2) Intégration dans l'orchestration de clôture (ÉTAPE B) ──────────
-- Reprise intégrale de reconcile_event_closure (cf. 20260928160000) avec, en
-- ÉTAPE B, l'appel à return_buvette_kegs_to_central juste APRÈS la remise à 0
-- des espaces non conservateurs. Signature INCHANGÉE (uuid, text, boolean) →
-- compatible avec trg_zz_reconcile_on_close (clôture auto).
create or replace function public.reconcile_event_closure(
  p_event_id uuid,
  p_by       text    default 'Clôture (réconciliation)',
  p_dry_run  boolean default true
) returns json
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_status text; v_type text;
  v_derive json; v_nonret_keg json; v_nonret json; v_keginv json; v_reanchor json;
  v_anchors json; v_audit json; v_return_keg json;
begin
  if auth.uid() is not null and not coalesce(is_stade(), false) then
    return json_build_object('success', false, 'error', 'Action réservée à l''équipe stade.');
  end if;
  select lower(coalesce(status,'')), event_type into v_status, v_type from events where event_id = p_event_id;
  if not found then return json_build_object('success', false, 'error', 'Événement introuvable.'); end if;
  if v_type <> 'match' then return json_build_object('success', false, 'error', 'Réservé aux matchs.'); end if;
  if v_status not in ('clôturé','cloture','archivé','archive') then
    return json_build_object('success', false, 'error', 'Événement non clôturé.');
  end if;

  -- ÉTAPE A (espaces) — dériver les finals manquants/aberrants (dry ou apply).
  v_derive := public.derive_and_apply_espace_finals(p_event_id, p_by, p_dry_run);

  -- Signaux dépôts (LECTURE — jamais d'invention) : ancrages fûts périmés.
  select json_agg(a) into v_anchors from public.keg_central_anchor_status() a where a.ancrage_perime;
  -- Audit clôture fûts (LECTURE).
  v_audit := public.audit_keg_closure(p_event_id);

  if coalesce(p_dry_run, true) then
    -- Projection (lecture) du crédit central des pleins non consommés.
    v_return_keg := public.return_buvette_kegs_to_central(p_event_id, p_by, true);
    return json_build_object('success', true, 'mode', 'dry_run', 'event_id', p_event_id,
      'A_espaces_derivation', v_derive,
      'B_retour_futs_central_projete', v_return_keg,
      'B_depots_ancrages_perimes', coalesce(v_anchors, '[]'::json),
      'C_audit_futs', v_audit,
      'note', 'Aucune écriture. Relancer avec p_dry_run := false pour appliquer les étapes A→D.');
  end if;

  -- ÉTAPE B (espaces non conservés) → live espace = 0 (fûts puis non-fûts).
  v_nonret_keg := public.reconcile_non_retained_keg_espace(p_event_id);
  v_nonret     := public.reconcile_non_retained_espace(p_event_id);

  -- ÉTAPE B (suite) → les PLEINS non consommés reviennent au « Stockage Fûts »
  -- central (crédit + retour_réutilisable, RG-002). Idempotent : rejoué = 0.
  -- Ordre : espace zéroé d'abord (photo), puis central crédité (le complément
  -- est calculé sur event_stock_lines, indépendant de l'ordre → sûr).
  v_return_keg := public.return_buvette_kegs_to_central(p_event_id, p_by, false);

  -- ÉTAPE C (registre) — keg_inventory réaligné sur area_stocks (autorité).
  v_keginv := public.reconcile_keg_inventory_to_truth(p_event_id);

  -- ÉTAPE D (filet récence) — répare tout live clobberé par une dérivation antérieure.
  v_reanchor := public.reanchor_espace_live_to_last_match(null, null, false);

  -- Ré-audit + signaux après application.
  v_audit := public.audit_keg_closure(p_event_id);
  select json_agg(a) into v_anchors from public.keg_central_anchor_status() a where a.ancrage_perime;

  return json_build_object('success', true, 'mode', 'applied', 'event_id', p_event_id,
    'A_espaces_derivation', v_derive,
    'B_non_conserves_futs', v_nonret_keg, 'B_non_conserves_stock', v_nonret,
    'B_retour_futs_central', v_return_keg,
    'C_registre_keg', v_keginv, 'D_reancrage_live', v_reanchor,
    'audit_futs', v_audit,
    'depots_ancrages_perimes', coalesce(v_anchors, '[]'::json),
    'note', 'Réconciliation appliquée. Les ancrages dépôts périmés exigent un comptage physique (record_keg_count) — jamais inventé.');
end;
$fn$;

grant execute on function public.reconcile_event_closure(uuid, text, boolean) to authenticated;

-- ── 3) OPTION (séparée, À VALIDER) : rejeu sur les 3 matchs passés ────
-- NE PAS décommenter sans validation humaine. La fonction étant idempotente,
-- la rejouer sur les matchs déjà clôturés crédite proprement les pleins retour
-- MANQUANTS (sans double compte). C'est une réparation PARTIELLE : elle ne
-- couvre que les pleins réellement rapportés par ces 3 matchs — la VÉRITÉ
-- finale du central reste le COMPTAGE PHYSIQUE (record_keg_count), qui
-- ré-ancre en absolu et prime sur ce rejeu.
--
--   -- Dry-run (lecture) — montre le complément par produit :
--   -- select public.return_buvette_kegs_to_central('7720c0de-2e1b-4258-904e-830cf8bd687a', 'Rejeu retour fûts', true);  -- Aurillac
--   -- select public.return_buvette_kegs_to_central('4830e774-995b-4cac-95c7-c02679432b30', 'Rejeu retour fûts', true);  -- Australie
--   -- select public.return_buvette_kegs_to_central('c7aabc15-b218-4727-b32a-f7b75ba930c1', 'Rejeu retour fûts', true);  -- Narbonne
--
--   -- Application (après validation) :
--   -- select public.return_buvette_kegs_to_central('7720c0de-2e1b-4258-904e-830cf8bd687a', 'Rejeu retour fûts', false);
--   -- select public.return_buvette_kegs_to_central('4830e774-995b-4cac-95c7-c02679432b30', 'Rejeu retour fûts', false);
--   -- select public.return_buvette_kegs_to_central('c7aabc15-b218-4727-b32a-f7b75ba930c1', 'Rejeu retour fûts', false);
--
-- ATTENTION : rejeu ET comptage physique sont MUTUELLEMENT EXCLUSIFS pour
-- ré-ancrer le central. Faire l'un OU l'autre, jamais additionner les deux.
-- =====================================================================
