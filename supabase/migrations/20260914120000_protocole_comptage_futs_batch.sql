-- =====================================================================
-- PROTOCOLE POST-MATCH — COMPTAGE FÛTS EN LOT (ancrage physique)
-- ---------------------------------------------------------------------
-- Cause profonde des écarts fûts (ex. Narbonne : keg_summary calculait 98
-- pleins pour 56 réels) : aucun COMPTAGE PHYSIQUE n'était fait après les
-- matchs, donc l'estimation (réceptions − conso) dérivait. Le comptage
-- physique EST la vérité : record_keg_count ré-ancre keg_summary ET
-- stock_balances(Stockage Fûts) + trace un mouvement d'inventaire (RG-002).
--
-- Ce batch permet d'enregistrer TOUT le comptage du stockage en UN appel
-- (au lieu d'un save par fût) → le réflexe post-match devient une action de
-- 30 s. Chaque ligne réutilise record_keg_count (même logique, même traçage).
-- Idempotent.
-- =====================================================================

create or replace function public.record_keg_inventory(
  p_counts jsonb,
  p_by text default null,
  p_note text default null
) returns json
language plpgsql security definer set search_path to 'public'
as $function$
declare v_item jsonb; v_pid uuid; v_full int; v_ok int := 0; v_res json;
begin
  if auth.uid() is not null and not coalesce(is_stade(), false) then
    return json_build_object('success', false, 'error', 'Réservé équipe stade.');
  end if;
  if p_counts is null or jsonb_typeof(p_counts) <> 'array' then
    return json_build_object('success', false, 'error', 'Comptage attendu : tableau [{product_id, full}].');
  end if;

  for v_item in select * from jsonb_array_elements(p_counts) loop
    v_pid := nullif(v_item->>'product_id', '')::uuid;
    v_full := (v_item->>'full')::int;
    if v_pid is null or v_full is null or v_full < 0 then continue; end if;
    v_res := record_keg_count(v_pid, v_full,
                              coalesce(p_by, 'Comptage fûts'),
                              coalesce(p_note, 'Comptage stockage (lot)'));
    if coalesce((v_res->>'success')::boolean, false) then v_ok := v_ok + 1; end if;
  end loop;

  return json_build_object('success', true, 'comptes_enregistres', v_ok);
end $function$;
