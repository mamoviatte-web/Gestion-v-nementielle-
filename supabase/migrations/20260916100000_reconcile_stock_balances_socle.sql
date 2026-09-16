-- =====================================================================
-- CHANTIER 4a — reconcile_stock_balances CORRIGÉ (aligné sur le socle)
-- ---------------------------------------------------------------------
-- L'ancienne version était FAUSSE : elle recomptait le solde en ne comptant
-- que (entrée_fournisseur + retour_réutilisable − transfert_espace −
-- réassort_événement) → elle IGNORAIT les 'sortie' (débit principal), les
-- 'retour_fournisseur', et l'ancrage 'inventaire'. La lancer aurait gonflé
-- tous les dépôts.
--
-- Nouvelle version : outil de RÉPARATION délibéré. Aligne le compteur
-- (stock_balances) sur le DÉRIVÉ du socle = dernière ancre physique + Σ flux
-- (v_stock_ledger_balance). Le comptage physique reste la vérité ; reconcile
-- ne fait que réparer le cache quand on lui fait confiance.
--
-- p_location : NULL = tous les emplacements ; sinon cible un emplacement.
-- Retourne le nombre de lignes réalignées + l'écart absolu résorbé.
-- Réservé équipe stade.
-- =====================================================================

-- L'ancienne signature ()→void est fausse et sans appelant : on la retire pour
-- éviter toute ambiguïté d'overload avec la nouvelle.
drop function if exists public.reconcile_stock_balances();

create or replace function public.reconcile_stock_balances(p_location uuid default null)
returns json
language plpgsql security definer set search_path to 'public'
as $function$
declare v_rows int := 0; v_ecart numeric := 0;
begin
  if auth.uid() is not null and not coalesce(is_stade(), false) then
    return json_build_object('success', false, 'error', 'Réservé équipe stade.');
  end if;

  with cible as (
    select b.product_id, b.location_id, b.derived_qty, b.counter_qty
    from v_stock_ledger_balance b
    where (p_location is null or b.location_id = p_location)
      and b.derived_qty <> b.counter_qty
  ), maj as (
    update stock_balances sb
       set current_quantity = c.derived_qty, last_movement_at = now(),
           updated_by = coalesce(sb.updated_by, 'reconcile')
      from cible c
     where sb.product_id = c.product_id and sb.location_id = c.location_id
    returning c.counter_qty, c.derived_qty
  )
  select count(*), coalesce(sum(abs(derived_qty - counter_qty)),0) into v_rows, v_ecart from maj;

  return json_build_object('success', true, 'lignes_realignees', v_rows, 'ecart_resorbe', v_ecart);
end $function$;

grant execute on function public.reconcile_stock_balances(uuid) to authenticated;
