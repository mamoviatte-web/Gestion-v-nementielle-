-- =====================================================================
-- Module Runner Auto-Planning — Stade Maurice David
-- À exécuter APRÈS schema.sql + rls_policies.sql.
--
-- NOTE RLS (correction) : le prompt initial utilisait
--   auth.jwt()->>'role' = 'ROLE_STADE'
-- ce qui est TOUJOURS faux (le claim 'role' du JWT vaut 'authenticated' ;
-- le rôle applicatif est dans user_metadata.role). On réutilise donc les
-- helpers existants is_stade() / app_role() / app_space_id().
-- =====================================================================

-- ─── Tables ──────────────────────────────────────────────────────────
create table if not exists area_stocks (
  id           uuid primary key default gen_random_uuid(),
  area_id      uuid not null references spaces(space_id),
  product_id   uuid not null references products(product_id),
  current_qty  int not null default 0,
  initial_qty  int not null default 0,
  last_updated timestamptz default now(),
  updated_by   text,
  unique (area_id, product_id)
);

create table if not exists runner_templates (
  id            uuid primary key default gen_random_uuid(),
  template_name text not null,
  event_type    text not null check (event_type in
                  ('match','séminaire','cocktail','réception_vip','événement_partenaire','réunion','autre')),
  space_id      uuid references spaces(space_id),
  product_id    uuid not null references products(product_id),
  base_quantity int not null default 0,
  ratio_per_100 decimal(8,2) default 0,
  is_active     boolean default true,
  created_at    timestamptz default now()
);

create table if not exists event_consumptions (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references events(event_id),
  space_id            uuid not null references spaces(space_id),
  product_id          uuid not null references products(product_id),
  initial_stock       int default 0,
  restock_qty         int default 0,
  final_stock         int default 0,
  consumed_qty        int generated always as (initial_stock + restock_qty - final_stock) stored,
  unit_price_ht       decimal(10,2),
  total_cost_ht       decimal(10,2) generated always as ((initial_stock + restock_qty - final_stock) * unit_price_ht) stored,
  event_type          text,
  expected_attendance int,
  weather_type        text,
  created_at          timestamptz default now(),
  unique (event_id, space_id, product_id)
);

create table if not exists runner_auto_planning (
  id                              uuid primary key default gen_random_uuid(),
  event_id                        uuid not null references events(event_id),
  space_id                        uuid not null references spaces(space_id),
  product_id                      uuid not null references products(product_id),
  initial_area_stock              int default 0,
  historical_avg_consumption      decimal(10,2),
  last_similar_event_consumption  decimal(10,2),
  consumption_reference           decimal(10,2),
  attendance_coefficient          decimal(4,2) default 1.00,
  weather_coefficient             decimal(4,2) default 1.00,
  event_type_coefficient          decimal(4,2) default 1.00,
  trend_coefficient               decimal(4,2) default 1.00,
  recommended_quantity            int,
  quantity_to_move                int,
  stock_sufficient                boolean default false,
  validated_quantity              int,
  stadium_manager_comment         text,
  validated_by                    text,
  validated_at                    timestamptz,
  picked_quantity                 int,
  returned_quantity               int,
  real_consumption                int generated always as (coalesce(picked_quantity,0) - coalesce(returned_quantity,0)) stored,
  estimated_cost_ht               decimal(10,2),
  responsible_name                text,
  validation_status               text default 'brouillon' check (validation_status in
                                    ('brouillon','en_attente_validation','validé','transmis_runners','préparé','livré','retour_saisi','clôturé')),
  alert_type                      text,
  terrain_token                   uuid,   -- jeton public partagé par (event, space)
  created_at                      timestamptz default now(),
  updated_at                      timestamptz default now(),
  unique (event_id, space_id, product_id)
);

create index if not exists idx_runner_event on runner_auto_planning(event_id);
create index if not exists idx_runner_space on runner_auto_planning(space_id);
create index if not exists idx_runner_token on runner_auto_planning(terrain_token);
create index if not exists idx_consumptions_event on event_consumptions(event_id);
create index if not exists idx_consumptions_product on event_consumptions(product_id);

create trigger trg_runner_planning_updated_at
  before update on runner_auto_planning
  for each row execute function set_updated_at();

-- ─── Colonnes additionnelles sur events ──────────────────────────────
alter table events add column if not exists weather_type text
  check (weather_type in ('normal','chaleur','forte_chaleur','pluie','froid','tres_favorable'));
alter table events add column if not exists temperature int;
alter table events add column if not exists consumption_trend text
  check (consumption_trend in ('stable','hausse','forte_hausse','baisse','surdotation','rupture'));
alter table events add column if not exists reference_event_id uuid references events(event_id);

-- ─── RLS ─────────────────────────────────────────────────────────────
alter table area_stocks          enable row level security;
alter table runner_templates     enable row level security;
alter table event_consumptions   enable row level security;
alter table runner_auto_planning enable row level security;

create policy stade_full_area_stocks on area_stocks
  for all using (is_stade()) with check (is_stade());
create policy stade_full_runner_templates on runner_templates
  for all using (is_stade()) with check (is_stade());
create policy stade_full_event_consumptions on event_consumptions
  for all using (is_stade()) with check (is_stade());
create policy stade_full_runner_planning on runner_auto_planning
  for all using (is_stade()) with check (is_stade());

-- ROLE_RESPONSABLE : lecture terrain de son espace (fiches transmises)
create policy responsable_runner_terrain on runner_auto_planning
  for select using (
    app_role() = 'ROLE_RESPONSABLE'
    and space_id = app_space_id()
    and validation_status in ('transmis_runners','préparé','livré','retour_saisi')
  );

-- ─── Vue terrain publique (par jeton) — SANS coût (RG-003) ────────────
-- Permet aux runners de consulter leur fiche sans compte. Expose uniquement
-- des colonnes opérationnelles (jamais estimated_cost_ht).
create or replace view runner_terrain_public
with (security_invoker = false) as
  select r.id, r.event_id, r.space_id, r.product_id, r.terrain_token,
         p.product_name, p.unit,
         r.quantity_to_move, r.validated_quantity, r.picked_quantity, r.returned_quantity,
         r.validation_status, r.responsible_name
  from runner_auto_planning r
  join products p on p.product_id = r.product_id
  where r.validation_status in ('transmis_runners','préparé','livré','retour_saisi');

grant select on runner_terrain_public to anon, authenticated;
comment on view runner_terrain_public is
  'Vue terrain runner par terrain_token, sans coût (RG-003), accessible publiquement.';
