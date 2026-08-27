-- Correction ciblée : PMR / match Agen — « Fût FADA Blonde » → « FADA Blonde Bouteille »
-- ============================================================================
-- La terrasse PMR ne sert PAS de fûts : la clôture Agen enregistrait à tort la
-- consommation contre « Fût FADA Blonde » (fût, 98,28 €) au lieu de
-- « FADA Blonde Bouteille » (bouteille, 1,48 €). Résultat : coût aberrant
-- 50 × 98,28 = 4 914 € HT au lieu de 50 × 1,48 = 74 € HT.
--
-- Périmètre STRICT (rien d'autre touché) : event = Agen (5b999a21),
-- space = PMR (5a074fb1), product = Fût FADA Blonde (0c93bd1c) → FADA Blonde
-- Bouteille (a30dc8cb). Aucune modification de l'assortiment global de PMR ni
-- d'un autre espace/événement.
--
-- Quantités inchangées (72 initial / 22 final / 50 conso) : seul le produit
-- porteur change. Le trigger auto_compute_line_cost recalcule le coût au prix
-- bouteille (frozen_unit_price_ht est NULL). trg_lock_closed_lines ne se
-- déclenche pas (on ne modifie pas initial/reassort/final ; l'événement est
-- en_cours). trg_stock_final_entered ne se re-déclenche pas (final_qty inchangé).
--
-- Cohérence « sans rien mélanger » :
--   • event_stock_lines : repoint (coût recalculé 74 € HT)
--   • stock_movements   : repoint de la conso 50 (RG-002 : UPDATE tracé autorisé)
--   • runner_auto_planning : repoint (le board PMR ne recommande plus de fût)
--   • keg_inventory     : suppression du fût vide (50) — une bouteille n'est pas
--     un fût ; sinon fantôme dans le sous-système fûts (keg_true_balance).
--   PMR ne conserve pas le stock (retains_stock=false) et les fûts ne vivent pas
--   dans stock_balances (keg = source unique) → aucun reliquat à nettoyer.

do $$
declare
  v_ev  uuid := '5b999a21-25e6-4fb3-babc-d89cf69e2e27';  -- Agen
  v_pmr uuid := '5a074fb1-07a5-4dda-b905-cdff59942fa0';  -- PMR
  v_fut uuid := '0c93bd1c-d70e-4945-b799-51356a00dee7';  -- Fût FADA Blonde
  v_btl uuid := 'a30dc8cb-a922-46e3-8f75-7f928407acde';  -- FADA Blonde Bouteille
begin
  -- Sécurité : ne rien faire s'il existe déjà une ligne bouteille (évite collision
  -- sur UNIQUE(event,space,product) et rend la migration idempotente).
  if exists (select 1 from event_stock_lines
             where event_id=v_ev and space_id=v_pmr and product_id=v_btl) then
    raise notice 'Ligne bouteille déjà présente pour PMR@Agen — aucune action.';
    return;
  end if;

  perform set_config('app.allow_adjustment', 'on', true);  -- ajustement tracé (belt & suspenders)

  update event_stock_lines
     set product_id = v_btl
   where event_id=v_ev and space_id=v_pmr and product_id=v_fut;

  update stock_movements
     set product_id = v_btl
   where event_id=v_ev and space_id=v_pmr and product_id=v_fut;

  update runner_auto_planning
     set product_id = v_btl
   where event_id=v_ev and space_id=v_pmr and product_id=v_fut;

  delete from keg_inventory
   where event_id=v_ev and space_id=v_pmr and product_id=v_fut;
end $$;
