-- =====================================================================
-- RH — OUTILS D'ADMINISTRATION DES NOMS (ROLE_STADE)
-- ---------------------------------------------------------------------
-- Donne à l'équipe stade des « appuis » pour corriger la synthèse de paie sans
-- passer par une intervention en base :
--   • rh_rename_staff(old, new)  : attribuer / renommer une personne partout
--     (utile quand un responsable s'est connecté sous son CODE ou « Nom non
--      renseigné » — on lui met son vrai nom, ses heures se rattachent).
--   • rh_delete_staff(name, mois?): supprimer les heures d'une personne (une
--     saisie erronée, un doublon, une ligne sans nom) — sur un mois ou partout.
--
-- Réservé à ROLE_STADE (is_stade). Le renommage lève temporairement le verrou de
-- clôture (app.allow_adjustment) uniquement pour re-tagger responsable_nom — il
-- ne touche à aucune quantité. Idempotents / rejouables.
-- =====================================================================

create or replace function public.rh_rename_staff(p_old text, p_new text)
returns json
language plpgsql security definer set search_path to 'public'
as $function$
declare n int := 0; c int;
begin
  if not coalesce(is_stade(), false) then
    return json_build_object('success', false, 'error', 'Réservé à l''équipe stade.');
  end if;
  if length(coalesce(btrim(p_old), '')) < 1 then
    return json_build_object('success', false, 'error', 'Nom source requis.');
  end if;
  if length(coalesce(btrim(p_new), '')) < 2 then
    return json_build_object('success', false, 'error', 'Nom cible invalide (2 caractères minimum).');
  end if;

  -- Re-tag possible même sur événements clôturés (métadonnée nom, pas de stock).
  perform set_config('app.allow_adjustment', 'on', true);

  update public.zone_staff_hours set staff_name = p_new where staff_name = p_old;
  get diagnostics c = row_count; n := n + c;
  update public.schedules set staff_name = p_new where staff_name = p_old;
  get diagnostics c = row_count; n := n + c;
  update public.occasional_hours set staff_name = p_new where staff_name = p_old;
  get diagnostics c = row_count; n := n + c;
  update public.event_stock_lines set responsable_nom = p_new where responsable_nom = p_old;
  get diagnostics c = row_count; n := n + c;

  return json_build_object('success', true, 'lignes', n);
end $function$;

create or replace function public.rh_delete_staff(p_name text, p_mois text default null)
returns json
language plpgsql security definer set search_path to 'public'
as $function$
declare n int := 0; c int;
begin
  if not coalesce(is_stade(), false) then
    return json_build_object('success', false, 'error', 'Réservé à l''équipe stade.');
  end if;
  if length(coalesce(btrim(p_name), '')) < 1 then
    return json_build_object('success', false, 'error', 'Nom requis.');
  end if;

  delete from public.zone_staff_hours z
   where z.staff_name = p_name
     and (p_mois is null or to_char((select e.event_date from public.events e where e.event_id = z.event_id), 'YYYY-MM') = p_mois);
  get diagnostics c = row_count; n := n + c;

  delete from public.schedules s
   where s.staff_name = p_name
     and (p_mois is null or to_char((select e.event_date from public.events e where e.event_id = s.event_id), 'YYYY-MM') = p_mois);
  get diagnostics c = row_count; n := n + c;

  delete from public.occasional_hours o
   where o.staff_name = p_name
     and (p_mois is null or to_char(coalesce(o.work_date, (select e.event_date from public.events e where e.event_id = o.event_id)), 'YYYY-MM') = p_mois);
  get diagnostics c = row_count; n := n + c;

  return json_build_object('success', true, 'lignes', n);
end $function$;

grant execute on function public.rh_rename_staff(text, text) to authenticated;
grant execute on function public.rh_delete_staff(text, text) to authenticated;
