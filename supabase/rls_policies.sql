-- =====================================================================
-- Politiques Row Level Security — Stade Maurice David (CDC V1.1)
-- À exécuter APRÈS schema.sql, dans Supabase → SQL Editor.
--
-- Deux rôles applicatifs (lus depuis user_metadata du JWT) :
--   ROLE_STADE        : accès complet (back-office Stade)
--   ROLE_RESPONSABLE  : accès restreint à son propre espace (space_id)
--
-- NOTE RG-003 (masquage de unit_price_ht) :
--   PostgreSQL RLS filtre des LIGNES, pas des COLONNES. Le prix HT n'existe
--   que dans `products`. Pour ne jamais l'exposer au Responsable :
--     1) aucune politique de SELECT n'est posée sur `products` pour lui ;
--     2) il lit le catalogue via la vue `products_public` (sans
--        unit_price_ht), définie en SECURITY DEFINER pour contourner la RLS
--        de la table de base tout en n'exposant que des colonnes sûres.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helpers : rôle applicatif et espace rattaché (depuis le JWT)
-- ---------------------------------------------------------------------
create or replace function app_role()
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '');
$$;

create or replace function app_space_id()
returns uuid
language sql
stable
set search_path = public
as $$
  select nullif(auth.jwt() -> 'user_metadata' ->> 'space_id', '')::uuid;
$$;

create or replace function is_stade()
returns boolean
language sql
stable
set search_path = public
as $$
  select app_role() = 'ROLE_STADE';
$$;

create or replace function is_responsable_of(target_space uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select app_role() = 'ROLE_RESPONSABLE' and app_space_id() = target_space;
$$;

-- ---------------------------------------------------------------------
-- Activation RLS sur toutes les tables
-- ---------------------------------------------------------------------
alter table spaces             enable row level security;
alter table users              enable row level security;
alter table products           enable row level security;
alter table events             enable row level security;
alter table event_spaces       enable row level security;
alter table runner_dotations   enable row level security;
alter table event_stock_lines  enable row level security;
alter table stock_movements    enable row level security;
alter table provider_presence  enable row level security;
alter table schedules          enable row level security;
alter table debriefs           enable row level security;

-- =====================================================================
-- spaces
--   STADE        : tout
--   RESPONSABLE  : SELECT son propre espace uniquement
-- =====================================================================
create policy spaces_stade_all on spaces
  for all using (is_stade()) with check (is_stade());

create policy spaces_resp_select on spaces
  for select using (is_responsable_of(space_id));

-- =====================================================================
-- users (table admin) — RESPONSABLE : aucun accès (interdite, CDC §4)
-- =====================================================================
create policy users_stade_all on users
  for all using (is_stade()) with check (is_stade());

-- =====================================================================
-- products
--   STADE        : tout (prix inclus)
--   RESPONSABLE  : AUCUNE policy ici → lecture via la vue products_public
--                  (le prix HT n'est jamais exposé — RG-003)
-- =====================================================================
create policy products_stade_all on products
  for all using (is_stade()) with check (is_stade());

-- =====================================================================
-- events
--   STADE        : tout
--   RESPONSABLE  : SELECT si son espace est dans event_spaces
-- =====================================================================
create policy events_stade_all on events
  for all using (is_stade()) with check (is_stade());

create policy events_resp_select on events
  for select using (
    app_role() = 'ROLE_RESPONSABLE'
    and exists (
      select 1 from event_spaces es
      where es.event_id = events.event_id
        and es.space_id = app_space_id()
    )
  );

-- =====================================================================
-- event_spaces
--   STADE        : tout
--   RESPONSABLE  : SELECT si space_id = son espace
-- =====================================================================
create policy event_spaces_stade_all on event_spaces
  for all using (is_stade()) with check (is_stade());

create policy event_spaces_resp_select on event_spaces
  for select using (is_responsable_of(space_id));

-- =====================================================================
-- runner_dotations
--   STADE        : tout
--   RESPONSABLE  : SELECT si son espace, pas d'écriture
-- =====================================================================
create policy runner_dotations_stade_all on runner_dotations
  for all using (is_stade()) with check (is_stade());

create policy runner_dotations_resp_select on runner_dotations
  for select using (is_responsable_of(space_id));

-- =====================================================================
-- event_stock_lines
--   STADE        : tout
--   RESPONSABLE  : SELECT / INSERT / UPDATE si space_id = son espace
--   (la table ne contient aucun prix — RG-003 garanti par construction)
-- =====================================================================
create policy stock_lines_stade_all on event_stock_lines
  for all using (is_stade()) with check (is_stade());

create policy stock_lines_resp_select on event_stock_lines
  for select using (is_responsable_of(space_id));

create policy stock_lines_resp_insert on event_stock_lines
  for insert with check (is_responsable_of(space_id));

create policy stock_lines_resp_update on event_stock_lines
  for update using (is_responsable_of(space_id))
  with check (is_responsable_of(space_id));

-- =====================================================================
-- stock_movements
--   STADE        : tout
--   RESPONSABLE  : INSERT si son espace + SELECT de son historique
-- =====================================================================
create policy movements_stade_all on stock_movements
  for all using (is_stade()) with check (is_stade());

create policy movements_resp_select on stock_movements
  for select using (is_responsable_of(space_id));

create policy movements_resp_insert on stock_movements
  for insert with check (is_responsable_of(space_id));

-- =====================================================================
-- provider_presence
--   STADE        : tout
--   RESPONSABLE  : SELECT / INSERT / UPDATE si space_id = son espace
-- =====================================================================
create policy provider_stade_all on provider_presence
  for all using (is_stade()) with check (is_stade());

create policy provider_resp_select on provider_presence
  for select using (is_responsable_of(space_id));

create policy provider_resp_insert on provider_presence
  for insert with check (is_responsable_of(space_id));

create policy provider_resp_update on provider_presence
  for update using (is_responsable_of(space_id))
  with check (is_responsable_of(space_id));

-- =====================================================================
-- schedules
--   STADE        : tout
--   RESPONSABLE  : SELECT / INSERT / UPDATE si space_id = son espace
-- =====================================================================
create policy schedules_stade_all on schedules
  for all using (is_stade()) with check (is_stade());

create policy schedules_resp_select on schedules
  for select using (is_responsable_of(space_id));

create policy schedules_resp_insert on schedules
  for insert with check (is_responsable_of(space_id));

create policy schedules_resp_update on schedules
  for update using (is_responsable_of(space_id))
  with check (is_responsable_of(space_id));

-- =====================================================================
-- debriefs
--   STADE        : tout
--   RESPONSABLE  : SELECT / INSERT / UPDATE si space_id = son espace
-- =====================================================================
create policy debriefs_stade_all on debriefs
  for all using (is_stade()) with check (is_stade());

create policy debriefs_resp_select on debriefs
  for select using (is_responsable_of(space_id));

create policy debriefs_resp_insert on debriefs
  for insert with check (is_responsable_of(space_id));

create policy debriefs_resp_update on debriefs
  for update using (is_responsable_of(space_id))
  with check (is_responsable_of(space_id));

-- =====================================================================
-- RG-003 — Vue catalogue SANS prix HT pour le contexte Responsable
-- SECURITY DEFINER (security_invoker = false) : contourne la RLS de
-- `products` pour exposer uniquement des colonnes sûres (sans unit_price_ht).
-- =====================================================================
create or replace view products_public
with (security_invoker = false) as
  select
    product_id, product_name, category, unit, packaging, stock_min, active
  from products
  where active = true;

comment on view products_public is
  'Vue du catalogue SANS unit_price_ht (RG-003), destinée au ROLE_RESPONSABLE.';

grant select on products_public to authenticated;
