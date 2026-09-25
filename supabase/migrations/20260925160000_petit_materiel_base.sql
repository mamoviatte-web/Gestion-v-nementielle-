-- =====================================================================
-- PETIT MATÉRIEL — BASE DORMANTE (préparée, NON activée)
-- ---------------------------------------------------------------------
-- Objet : permettre aux espaces VIP & Bars de déclarer un besoin chiffré de
-- petit matériel (gobelets, couverts, consommables d'entretien…) qui prépare
-- l'événement suivant et alimente les dotations runner.
--
-- ISOLATION TOTALE : uniquement des objets NOUVEAUX. Aucune table existante
-- n'est modifiée, aucun trigger sur les tables existantes, aucune ligne de
-- dotation/stock touchée. Rien n'est visible côté appli tant que le drapeau
-- front `PETIT_MATERIEL_ENABLED` reste à false. → « prépare la base sans
-- créer l'action ».
-- =====================================================================

-- 1) Catalogue du petit matériel (référentiel, sans prix — RG-003 sans objet).
create table if not exists public.petit_materiel_items (
  item_id     uuid primary key default gen_random_uuid(),
  code        text unique not null,        -- code stable de correspondance (jamais réutilisé)
  label       text not null,
  sort_order  int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz default now()
);

-- 2) Besoins déclarés : 1 ligne par (événement × espace × item) → un chiffre.
create table if not exists public.petit_materiel_requests (
  request_id      uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(event_id) on delete cascade,
  space_id        uuid not null references public.spaces(space_id),
  item_id         uuid not null references public.petit_materiel_items(item_id),
  qty             int  not null default 0,
  responsable_nom text,
  updated_at      timestamptz default now(),
  unique(event_id, space_id, item_id)
);
create index if not exists idx_pm_requests_event on public.petit_materiel_requests(event_id);
create index if not exists idx_pm_requests_event_space on public.petit_materiel_requests(event_id, space_id);

-- 3) RLS — catalogue lisible par le stade & les responsables authentifiés,
--    écriture stade uniquement. Les besoins : stade FOR ALL ; l'écriture
--    responsable de zone passe par des RPC SECURITY DEFINER (flux token anon),
--    donc pas de policy anon nécessaire.
alter table public.petit_materiel_items    enable row level security;
alter table public.petit_materiel_requests enable row level security;

drop policy if exists pm_items_read  on public.petit_materiel_items;
drop policy if exists pm_items_write on public.petit_materiel_items;
create policy pm_items_read  on public.petit_materiel_items
  for select to authenticated using (true);
create policy pm_items_write on public.petit_materiel_items
  for all to authenticated using (coalesce(is_stade(), false)) with check (coalesce(is_stade(), false));

drop policy if exists pm_requests_stade on public.petit_materiel_requests;
create policy pm_requests_stade on public.petit_materiel_requests
  for all to authenticated using (coalesce(is_stade(), false)) with check (coalesce(is_stade(), false));

-- 4) Seed du catalogue (27 items dédupliqués depuis la pièce jointe fournie).
insert into public.petit_materiel_items (code, label, sort_order) values
  ('GOB50',     'Gobelets 50cl plastique',      10),
  ('GOB25',     'Gobelets 25cl plastique',      20),
  ('GOBEXP',    'Gobelets Café expresso',       30),
  ('GOBALL',    'Gobelets Café allongé',        40),
  ('SACPOUB',   'Sac poubelle',                 50),
  ('SOPALIN',   'Sopalin',                      60),
  ('EPONGE',    'Eponge',                       70),
  ('FOURCH',    'Fourchettes',                  80),
  ('COUTEAU',   'Couteaux',                     90),
  ('CUILLERE',  'Cuillères',                   100),
  ('ASSGDE',    'Grandes assiettes',           110),
  ('ASSPTE',    'Petites assiettes',           120),
  ('SERVGDE',   'GRANDES Serviettes paquet',   130),
  ('SERVPTE',   'Petites serviettes paquet',   140),
  ('GANTS',     'Gants',                       150),
  ('TORCHON',   'Torchons',                    160),
  ('PAILLEFER', 'Paille de fer',               170),
  ('ROULNAPE',  'Rouleau nappe',               180),
  ('LIQVAIS',   'Liquide vaisselle',           190),
  ('SPRAYNET',  'Spray nettoyant',             200),
  ('LAVBLEU',   'Lavettes bleues',             210),
  ('CAFEGRAIN', 'Café grain',                  220),
  ('CAFECAPS',  'Café capsules',               230),
  ('SUCRE',     'Buchette sucre',              240),
  ('ALU',       'Aluminium',                   250),
  ('FILMALIM',  'Film alimentaire',            260),
  ('PINCEBAMBOU','Pinces bambous',             270)
on conflict (code) do nothing;

-- =====================================================================
-- RPC — toutes SECURITY DEFINER. ADMIN (is_stade) et FLUX ZONE (token).
-- =====================================================================

-- 5a) Lecture ADMIN : catalogue actif + quantité déjà déclarée pour cet espace.
create or replace function public.get_petit_materiel(p_event_id uuid, p_space_id uuid)
returns json language sql security definer set search_path to 'public' as $$
  select coalesce(json_agg(json_build_object(
           'item_id', i.item_id, 'code', i.code, 'label', i.label,
           'qty', coalesce(r.qty, 0)) order by i.sort_order), '[]'::json)
  from public.petit_materiel_items i
  left join public.petit_materiel_requests r
    on r.item_id = i.item_id and r.event_id = p_event_id and r.space_id = p_space_id
  where i.active;
$$;

-- 5b) Écriture ADMIN : upsert des besoins (p_lines = [{item_id, qty}, …]).
create or replace function public.save_petit_materiel(p_event_id uuid, p_space_id uuid, p_lines jsonb)
returns json language plpgsql security definer set search_path to 'public' as $function$
declare rec jsonb;
begin
  if not coalesce(is_stade(), false) then
    return json_build_object('success', false, 'error', 'Réservé à l''équipe stade.');
  end if;
  for rec in select * from jsonb_array_elements(p_lines) loop
    insert into public.petit_materiel_requests (event_id, space_id, item_id, qty, updated_at)
    values (p_event_id, p_space_id, (rec->>'item_id')::uuid, coalesce((rec->>'qty')::int, 0), now())
    on conflict (event_id, space_id, item_id)
      do update set qty = excluded.qty, updated_at = now();
  end loop;
  return json_build_object('success', true);
end $function$;

-- 5c) Lecture ZONE (responsable, flux token) : catalogue + quantités de SON espace.
create or replace function public.get_zone_petit_materiel(p_token text)
returns json language plpgsql security definer set search_path to 'public' as $function$
declare v_e uuid; v_s uuid; v_n text;
begin
  select * into v_e, v_s, v_n from _zone_resolve(p_token);
  if v_e is null then return json_build_object('success', false, 'error', 'Session expirée'); end if;
  return json_build_object('success', true, 'items', (
    select coalesce(json_agg(json_build_object(
             'item_id', i.item_id, 'code', i.code, 'label', i.label,
             'qty', coalesce(r.qty, 0)) order by i.sort_order), '[]'::json)
    from public.petit_materiel_items i
    left join public.petit_materiel_requests r
      on r.item_id = i.item_id and r.event_id = v_e and r.space_id = v_s
    where i.active));
end $function$;

-- 5d) Écriture ZONE : upsert des besoins de l'espace du token (RG-001 : nom requis).
create or replace function public.save_zone_petit_materiel(p_token text, p_responsable text, p_lines jsonb)
returns json language plpgsql security definer set search_path to 'public' as $function$
declare v_e uuid; v_s uuid; v_n text; v_name text; rec jsonb;
begin
  select * into v_e, v_s, v_n from _zone_resolve(p_token);
  if v_e is null then return json_build_object('success', false, 'error', 'Session expirée'); end if;
  v_name := upper(trim(coalesce(p_responsable, '')));
  if length(v_name) < 2 then return json_build_object('success', false, 'error', 'Nom requis (RG-001)'); end if;
  for rec in select * from jsonb_array_elements(p_lines) loop
    insert into public.petit_materiel_requests (event_id, space_id, item_id, qty, responsable_nom, updated_at)
    values (v_e, v_s, (rec->>'item_id')::uuid, coalesce((rec->>'qty')::int, 0), v_name, now())
    on conflict (event_id, space_id, item_id)
      do update set qty = excluded.qty, responsable_nom = v_name, updated_at = now();
  end loop;
  return json_build_object('success', true);
end $function$;

-- 5e) Transmission fluide ENTRE MATCHS : reprend les besoins du match précédent
--     pour préparer le match cible (events.previous_event_id), matchs uniquement.
create or replace function public.carry_forward_petit_materiel(p_to_event uuid)
returns json language plpgsql security definer set search_path to 'public' as $function$
declare v_from uuid; n int := 0;
begin
  if not coalesce(is_stade(), false) then
    return json_build_object('success', false, 'error', 'Réservé à l''équipe stade.');
  end if;
  select e.previous_event_id into v_from
    from public.events e
   where e.event_id = p_to_event and e.event_type = 'match';
  if v_from is null then
    return json_build_object('success', false, 'error', 'Aucun match précédent rattaché.');
  end if;
  -- Uniquement si le précédent est aussi un match (transmission entre matchs).
  if not exists (select 1 from public.events e where e.event_id = v_from and e.event_type = 'match') then
    return json_build_object('success', false, 'error', 'Le précédent n''est pas un match.');
  end if;
  insert into public.petit_materiel_requests (event_id, space_id, item_id, qty, updated_at)
  select p_to_event, r.space_id, r.item_id, r.qty, now()
    from public.petit_materiel_requests r
   where r.event_id = v_from and r.qty > 0
  on conflict (event_id, space_id, item_id) do update set qty = excluded.qty, updated_at = now();
  get diagnostics n = row_count;
  return json_build_object('success', true, 'lignes', n);
end $function$;

grant execute on function public.get_petit_materiel(uuid, uuid)               to authenticated;
grant execute on function public.save_petit_materiel(uuid, uuid, jsonb)        to authenticated;
grant execute on function public.get_zone_petit_materiel(text)                 to anon, authenticated;
grant execute on function public.save_zone_petit_materiel(text, text, jsonb)   to anon, authenticated;
grant execute on function public.carry_forward_petit_materiel(uuid)            to authenticated;
