-- =====================================================================
-- CRÉATION D'ESPACES (bar / buvette) + ALIGNEMENT SUR LES MATCHS
-- ---------------------------------------------------------------------
-- Besoin : depuis l'écran « Assortiment des espaces », pouvoir créer de
-- nouveaux espaces souhaités (bars / buvettes) puis les aligner en un clic
-- sur les matchs à venir avec toute la coordination associée (event_spaces
-- + régénération des dotations runner depuis le socle d'assortiment).
--
-- Deux RPC SECURITY DEFINER, réservées ROLE_STADE (is_stade()) :
--   1. create_service_space  → insère l'espace avec les bons drapeaux d'un
--      espace de service (is_operational=false, is_supervisor_slot=false),
--      génère un access_code unique, et provisionne sa stock-location
--      « <nom> — Espace » (indispensable au grand-livre stock / ledger).
--   2. align_space_on_upcoming_matches → ajoute l'espace à tous les matchs
--      actifs (event_spaces), régénère leurs dotations runner et renvoie la
--      liste des matchs mis à jour (coordination globale).
--
-- Un espace créé ainsi est ensuite pris en charge automatiquement :
--   - futurs matchs : link_event_spaces_by_type le rattache (bar → profil
--     'bar_pub' par défaut ; buvette → clause service_type='buvette') ;
--   - sélection par match : EventSpacesModal le liste (tous espaces actifs) ;
--   - assortiment / socle : EspaceAssortmentPage l'édite ;
--   - accès responsable : validate_match_code le propose dès qu'il est lié.
-- Idempotent (CREATE OR REPLACE).
-- =====================================================================

-- ── 1. Création d'un espace de service ───────────────────────────────
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

  -- Validations métier
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
  -- Par défaut, un bar conserve son stock entre matchs, une buvette non
  -- (cohérent avec les données existantes) ; surchargeable par l'appelant.
  v_retains := coalesce(p_retains_stock, v_svc = 'bar');

  -- access_code unique : soit celui fourni, soit un code hexadécimal généré.
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
    is_operational, is_supervisor_slot, retains_stock, retain_kegs_in_espace, active
  ) values (
    v_name, v_type, v_svc, v_code, p_max_pax, p_max_pax,
    false, false, v_retains, false, true
  )
  returning space_id into v_id;

  -- Provisionne la stock-location « <nom> — Espace » (ledger : espace_location_of).
  if not exists (select 1 from stock_locations where area_id = v_id and location_type = 'espace') then
    insert into stock_locations (name, location_type, area_id, is_active, description)
    values (v_name || ' — Espace', 'espace', v_id, true, 'Créé via l''assortiment des espaces');
  end if;

  return json_build_object(
    'success', true,
    'space_id', v_id,
    'space_name', v_name,
    'service_type', v_svc,
    'access_code', v_code,
    'retains_stock', v_retains,
    'max_pax', p_max_pax
  );
end;
$function$;

grant execute on function public.create_service_space(text, text, int, boolean, text) to authenticated;

-- ── 2. Alignement d'un espace sur les matchs à venir ─────────────────
-- Ajoute l'espace à chaque match actif (brouillon / préparé / en_cours),
-- régénère les dotations runner de ces matchs (socle → fiche → stock) et
-- renvoie la liste détaillée. p_regenerate=false pour lier sans régénérer.
create or replace function public.align_space_on_upcoming_matches(
  p_space_id   uuid,
  p_regenerate boolean default true
) returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_space   spaces%rowtype;
  v_matches json;
  v_added   int := 0;
  r         record;
begin
  if not is_stade() then
    return json_build_object('success', false, 'error', 'Réservé au rôle Stade.');
  end if;

  select * into v_space from spaces where space_id = p_space_id;
  if not found then
    return json_build_object('success', false, 'error', 'Espace introuvable.');
  end if;

  -- Parcourt les matchs actifs ; lie l'espace s'il ne l'est pas déjà.
  for r in
    select e.event_id, e.event_name, e.event_date
    from events e
    where e.event_type = 'match'
      and e.status in ('brouillon', 'préparé', 'en_cours')
    order by e.event_date
  loop
    insert into event_spaces (event_id, space_id)
    values (r.event_id, p_space_id)
    on conflict (event_id, space_id) do nothing;

    if found then
      v_added := v_added + 1;
      -- Coordination : feuilles de route + régénération des dotations du match.
      if exists (select 1 from pg_proc where proname = 'init_event_roadmaps') then
        perform init_event_roadmaps(r.event_id);
      end if;
      if p_regenerate then
        perform generate_runner_dotations(r.event_id);
      end if;
    end if;
  end loop;

  select coalesce(json_agg(json_build_object(
           'event_id', e.event_id,
           'event_name', e.event_name,
           'event_date', e.event_date,
           'linked', exists (select 1 from event_spaces es
                             where es.event_id = e.event_id and es.space_id = p_space_id)
         ) order by e.event_date), '[]'::json)
    into v_matches
  from events e
  where e.event_type = 'match'
    and e.status in ('brouillon', 'préparé', 'en_cours');

  return json_build_object(
    'success', true,
    'space_id', p_space_id,
    'space_name', v_space.space_name,
    'matches_added', v_added,
    'regenerated', p_regenerate and v_added > 0,
    'matches', v_matches
  );
end;
$function$;

grant execute on function public.align_space_on_upcoming_matches(uuid, boolean) to authenticated;
