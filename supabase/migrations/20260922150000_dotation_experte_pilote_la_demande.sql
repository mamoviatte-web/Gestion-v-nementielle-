-- =====================================================================
-- DOTATION EXPERTE — PILOTER LA DEMANDE (conso projetée par espace), LE RESTE
-- ÉTANT SOUSTRAIT AUTOMATIQUEMENT PAR LA FICHE RUNNER
-- ---------------------------------------------------------------------
-- Logique métier cible (validée) :
--   à monter (fiche runner) = CONSOMMATION PRÉVISIONNELLE du produit DANS CET
--   ESPACE − CE QUI RESTE automatiquement du dernier événement.
--
-- La fiche runner (event_runner_board) calcule déjà :
--   qty_to_move = arrondi( COALESCE(validated_quantity, recommended_quantity)
--                          − stock_espace_live )                   [borné à 0]
-- Donc « ce qui reste » (stock_espace_live) est SOUSTRAIT AUTOMATIQUEMENT et
-- reste vivant (il suit le stock réel de l'espace, corrigé par le finalize fûts
-- 20260922110000). Il suffit que la DEMANDE (recommended/validated) = la
-- consommation projetée par espace.
--
-- Avant : apply_expert_dotation figeait un « à monter » via manual_qty_to_move
-- → override statique qui court-circuitait la soustraction automatique du reste.
-- Maintenant : apply_expert_dotation écrit la DEMANDE (recommended_quantity ET
-- validated_quantity = conso projetée × marge), efface l'override manuel, et
-- laisse le board soustraire le reste. La demande est calculée PAR ESPACE, PAR
-- PRODUIT, à partir de la conso réelle des matchs clôturés normalisée pour 1000
-- spectateurs, projetée sur l'affluence attendue.
--
-- Garde-fous :
--   • Loges exclues (dotation de base fixe, pilotée par leur propre génération).
--   • Produits SANS historique de conso dans l'espace : NON touchés (on conserve
--     le socle/plancher de la génération par défaut) → pas de mise à 0 abusive.
--   • Marge de sécurité 15 %.
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
    -- Consommation moyenne PAR ESPACE, PAR PRODUIT, normalisée pour 1000 pax.
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
    -- DEMANDE = conso projetée sur l'affluence × marge. Uniquement là où l'on a
    -- une référence de conso (historique espace, sinon consumption_reference du
    -- board). Sinon on ne touche pas (socle par défaut conservé).
    select b.space_id, b.product_id,
           ceil(coalesce(h.conso_kpax * (v_pax / 1000.0), b.consumption_reference) * (1 + v_marge))::int as besoin
    from event_runner_board b
    left join hist h on h.space_id = b.space_id and h.product_id = b.product_id
    where b.event_id = p_event_id
      and not (b.space_id = any(v_loges))
      and coalesce(h.conso_kpax, b.consumption_reference) is not null
      and coalesce(h.conso_kpax, b.consumption_reference) > 0
  )
  update runner_auto_planning rap
     set recommended_quantity = c.besoin,   -- ← la DEMANDE (conso projetée × marge)
         validated_quantity   = c.besoin,   -- pré-remplit la validation (brouillon)
         quantity_to_move     = c.besoin,   -- legacy, cohérence
         manual_qty_to_move   = null,       -- ← lève l'override : le board soustrait le reste
         updated_at = now()
    from cible c
   where rap.event_id = p_event_id and rap.space_id = c.space_id and rap.product_id = c.product_id
     and coalesce(rap.validation_status, 'brouillon') = 'brouillon'
     and (rap.recommended_quantity is distinct from c.besoin
          or rap.validated_quantity is distinct from c.besoin
          or rap.manual_qty_to_move is not null);
  get diagnostics v_n = row_count;

  return json_build_object('success', true, 'lignes_ajustees', v_n,
    'principe', 'demande = conso projetée par espace ; reste soustrait automatiquement');
end;
$function$;

grant execute on function public.apply_expert_dotation(uuid) to authenticated;
