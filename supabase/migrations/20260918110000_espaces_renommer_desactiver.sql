-- =====================================================================
-- ESPACES CRÉÉS — RENOMMER / DÉSACTIVER / RÉACTIVER
-- ---------------------------------------------------------------------
-- Complète 20260918100000 : gestion du cycle de vie des espaces créés
-- depuis « Assortiment des espaces ». Ces actions sont RÉSERVÉES aux
-- espaces créés via l'appli (spaces.user_created = true) pour protéger les
-- 16 espaces socle (Salon Nord, Loges, buvettes de référence…) d'un
-- renommage / d'une désactivation accidentels.
--
--   1. Drapeau spaces.user_created (défaut false ; les espaces existants
--      restent protégés). create_service_space le positionne à true.
--   2. rename_service_space   → renomme l'espace ; area_product_reference
--      dérive area_name de spaces.space_name (JOIN par space_id) → le socle
--      suit automatiquement. Met aussi à jour le nom de la stock-location
--      « <nom> — Espace » (cosmétique ; espace_location_of résout par area_id).
--   3. set_service_space_active → désactive (active=false) ou réactive.
--      active=false suffit à retirer l'espace partout (validate_match_code,
--      generate_runner_dotations, EventSpacesModal, assortiment filtrent
--      active=true) ; les event_spaces restent → réactivation réversible.
-- Idempotent.
-- =====================================================================

alter table public.spaces
  add column if not exists user_created boolean not null default false;

-- create_service_space : marque les nouveaux espaces comme user_created.
create or replace function public.create_service_space(
  p_name          text,
  p_service_type  text,
  p_max_pax       int     default null,
  p_retains_stock boolean default null,
  p_access_code   text    default null
) returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_name    text := btrim(coalesce(p_name, ''));
  v_svc     text := lower(btrim(coalesce(p_service_type, '')));
  v_type    text;
  v_code    text := nullif(upper(btrim(coalesce(p_access_code, ''))), '');
  v_retains boolean;
  v_id      uuid;
  v_try     int := 0;
begin
  if not is_stade() then
    return json_build_object('success', false, 'error', 'Réservé au rôle Stade.');
  end if;

  if length(v_name) < 2 then
    return json_build_object('success', false, 'error', 'Nom d''espace trop court (2 caractères minimum).');
  end if;
  if v_svc not in ('bar', 'buvette') then
    return json_build_object('success', false, 'error', 'Type de service invalide (bar ou buvette uniquement).');
  end if;
  if exists (select 1 from spaces where upper(btrim(space_name)) = upper(v_name)) then
    return json_build_object('success', false, 'error', format('Un espace « %s » existe déjà.', v_name));
  end if;

  v_type    := case when v_svc = 'bar' then 'Bar' else 'Buvette' end;
  v_retains := coalesce(p_retains_stock, v_svc = 'bar');

  if v_code is not null then
    if exists (select 1 from spaces where upper(access_code) = v_code) then
      return json_build_object('success', false, 'error', format('Le code d''accès « %s » est déjà pris.', v_code));
    end if;
  else
    loop
      v_try := v_try + 1;
      v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
      exit when not exists (select 1 from spaces where upper(access_code) = v_code);
      if v_try > 20 then
        return json_build_object('success', false, 'error', 'Impossible de générer un code d''accès unique.');
      end if;
    end loop;
  end if;

  insert into spaces (
    space_name, space_type, service_type, access_code, capacity, max_pax,
    is_operational, is_supervisor_slot, retains_stock, retain_kegs_in_espace, active, user_created
  ) values (
    v_name, v_type, v_svc, v_code, p_max_pax, p_max_pax,
    false, false, v_retains, false, true, true
  )
  returning space_id into v_id;

  if not exists (select 1 from stock_locations where area_id = v_id and location_type = 'espace') then
    insert into stock_locations (name, location_type, area_id, is_active, description)
    values (v_name || ' — Espace', 'espace', v_id, true, 'Créé via l''assortiment des espaces');
  end if;

  return json_build_object(
    'success', true, 'space_id', v_id, 'space_name', v_name,
    'service_type', v_svc, 'access_code', v_code,
    'retains_stock', v_retains, 'max_pax', p_max_pax
  );
end;
$function$;

grant execute on function public.create_service_space(text, text, int, boolean, text) to authenticated;

-- ── Renommer un espace créé ──────────────────────────────────────────
create or replace function public.rename_service_space(
  p_space_id uuid,
  p_new_name text
) returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_space spaces%rowtype;
  v_name  text := btrim(coalesce(p_new_name, ''));
begin
  if not is_stade() then
    return json_build_object('success', false, 'error', 'Réservé au rôle Stade.');
  end if;
  select * into v_space from spaces where space_id = p_space_id;
  if not found then
    return json_build_object('success', false, 'error', 'Espace introuvable.');
  end if;
  if not coalesce(v_space.user_created, false) then
    return json_build_object('success', false, 'error', 'Seuls les espaces créés depuis l''appli peuvent être renommés.');
  end if;
  if length(v_name) < 2 then
    return json_build_object('success', false, 'error', 'Nom trop court (2 caractères minimum).');
  end if;
  if exists (select 1 from spaces where upper(btrim(space_name)) = upper(v_name) and space_id <> p_space_id) then
    return json_build_object('success', false, 'error', format('Un espace « %s » existe déjà.', v_name));
  end if;

  update spaces set space_name = v_name where space_id = p_space_id;
  -- Nom de la stock-location « <nom> — Espace » (cosmétique).
  update stock_locations set name = v_name || ' — Espace'
   where area_id = p_space_id and location_type = 'espace';

  return json_build_object('success', true, 'space_id', p_space_id, 'space_name', v_name);
end;
$function$;

grant execute on function public.rename_service_space(uuid, text) to authenticated;

-- ── Désactiver / réactiver un espace créé ────────────────────────────
create or replace function public.set_service_space_active(
  p_space_id uuid,
  p_active   boolean
) returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_space spaces%rowtype;
begin
  if not is_stade() then
    return json_build_object('success', false, 'error', 'Réservé au rôle Stade.');
  end if;
  select * into v_space from spaces where space_id = p_space_id;
  if not found then
    return json_build_object('success', false, 'error', 'Espace introuvable.');
  end if;
  if not coalesce(v_space.user_created, false) then
    return json_build_object('success', false, 'error', 'Seuls les espaces créés depuis l''appli peuvent être désactivés.');
  end if;

  update spaces set active = coalesce(p_active, false) where space_id = p_space_id;

  return json_build_object('success', true, 'space_id', p_space_id, 'active', coalesce(p_active, false));
end;
$function$;

grant execute on function public.set_service_space_active(uuid, boolean) to authenticated;
