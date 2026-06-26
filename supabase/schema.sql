-- =====================================================================
-- Schéma PostgreSQL — Stade Maurice David (CDC V1.1 — Provence Rugby)
-- À coller dans Supabase → SQL Editor (ordre des tables = respect des FK)
-- =====================================================================

-- Extension pour gen_random_uuid()
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Trigger générique : maintien de updated_at
-- ---------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- =====================================================================
-- 1. spaces — les 16 espaces du stade
-- =====================================================================
create table if not exists spaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text not null unique,
  type        text not null check (type in ('VIP', 'Bar', 'Buvette')),
  capacity    integer,
  created_at  timestamptz not null default now()
);
comment on table spaces is 'Espaces de vente du stade (VIP, Bar, Buvette).';
comment on column spaces.code is 'Code d''accès unique servant d''identifiant au Responsable (ex: SN2026).';

-- =====================================================================
-- 2. products — catalogue produits
-- =====================================================================
create table if not exists products (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  category       text not null check (category in ('Vin','Bière','Soft','Sirop','Spiritueux','Matériel')),
  unit           text not null default 'pièce',
  unit_price_ht  numeric(10,2),                 -- NULL = prix manquant (RG-003/RG-005)
  packaging      text,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);
comment on table products is 'Catalogue produits (boissons + matériel).';
comment on column products.unit_price_ht is 'Prix unitaire HT. NULL = prix manquant. Colonne sensible (RG-003).';

-- =====================================================================
-- 3. events — événements
-- =====================================================================
create table if not exists events (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  type                text not null default 'match' check (type in ('match','séminaire','privatisation','autre')),
  date                date not null,
  start_time          text not null,            -- HH:MM
  expected_attendees  integer,
  status              text not null default 'brouillon'
                        check (status in ('brouillon','préparé','en_cours','clôture_en_attente','clôturé','archivé')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on table events is 'Événements (matchs, séminaires, privatisations).';
comment on column events.status is 'Cycle de vie de l''événement.';

create trigger trg_events_updated_at
  before update on events
  for each row execute function set_updated_at();

-- =====================================================================
-- 4. event_spaces — espaces ouverts pour un événement
-- =====================================================================
create table if not exists event_spaces (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references events(id) on delete cascade,
  space_id          uuid not null references spaces(id) on delete cascade,
  responsable_name  text,                       -- nom saisi à la connexion (RG-001)
  created_at        timestamptz not null default now(),
  unique (event_id, space_id)
);
comment on table event_spaces is 'Association événement ↔ espace ouvert.';
comment on column event_spaces.responsable_name is 'Nom du responsable saisi à la connexion (RG-001).';

create index if not exists idx_event_spaces_event on event_spaces(event_id);
create index if not exists idx_event_spaces_space on event_spaces(space_id);

-- =====================================================================
-- 5. runner_dotations — dotations logistiques préparées par le Stade
-- =====================================================================
create table if not exists runner_dotations (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  space_id    uuid not null references spaces(id) on delete cascade,
  product_id  uuid not null references products(id) on delete restrict,
  quantity    numeric(10,2) not null default 0,
  status      text not null default 'à_préparer'
                check (status in ('à_préparer','préparé','monté','contrôlé','annulé')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table runner_dotations is 'Dotations logistiques (runner) par espace/produit/événement.';

create index if not exists idx_runner_dotations_event on runner_dotations(event_id);
create index if not exists idx_runner_dotations_space on runner_dotations(space_id);
create index if not exists idx_runner_dotations_product on runner_dotations(product_id);

create trigger trg_runner_dotations_updated_at
  before update on runner_dotations
  for each row execute function set_updated_at();

-- =====================================================================
-- 6. event_stock_lines — lignes de stock par espace/produit/événement
-- =====================================================================
create table if not exists event_stock_lines (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references events(id) on delete cascade,
  space_id       uuid not null references spaces(id) on delete cascade,
  product_id     uuid not null references products(id) on delete restrict,
  initial_qty    numeric(10,2) not null default 0,
  reassort_qty   numeric(10,2) not null default 0,
  final_qty      numeric(10,2),                 -- NULL tant que la clôture n'est pas saisie
  unit_price_ht  numeric(10,2),                 -- snapshot du prix ; INTERDIT au Responsable (RG-003)
  phase          text not null default 'ouverture' check (phase in ('ouverture','reassort','cloture')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (event_id, space_id, product_id)
);
comment on table event_stock_lines is 'Lignes de stock (initial/réassort/final) par espace, produit et événement.';
comment on column event_stock_lines.unit_price_ht is 'Snapshot prix HT. Colonne masquée au ROLE_RESPONSABLE (RG-003).';

create index if not exists idx_stock_lines_event on event_stock_lines(event_id);
create index if not exists idx_stock_lines_space on event_stock_lines(space_id);
create index if not exists idx_stock_lines_product on event_stock_lines(product_id);

create trigger trg_stock_lines_updated_at
  before update on event_stock_lines
  for each row execute function set_updated_at();

-- =====================================================================
-- 7. stock_movements — journal des mouvements de stock
-- =====================================================================
create table if not exists stock_movements (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  space_id    uuid not null references spaces(id) on delete cascade,
  product_id  uuid not null references products(id) on delete restrict,
  quantity    numeric(10,2) not null,
  state       text not null check (state in ('fermé','ouvert','cassé','perdu','périmé','fût_vide','fût_percuté')),
  phase       text not null check (phase in ('ouverture','reassort','cloture')),
  created_by  text,
  created_at  timestamptz not null default now()
);
comment on table stock_movements is 'Journal append-only des mouvements de stock.';

create index if not exists idx_movements_event on stock_movements(event_id);
create index if not exists idx_movements_space on stock_movements(space_id);
create index if not exists idx_movements_product on stock_movements(product_id);

-- =====================================================================
-- 8. provider_presence — présence des prestataires (RG-008)
-- =====================================================================
create table if not exists provider_presence (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null references events(id) on delete cascade,
  assigned_space_id  uuid not null references spaces(id) on delete cascade,
  name               text not null,
  role               text,
  planned_arrival    text,                      -- HH:MM
  planned_departure  text,
  actual_arrival     text,
  actual_departure   text,
  status             text not null default 'prévu'
                       check (status in ('prévu','présent','en_retard','terminé','absent','annulé')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table provider_presence is 'Présence des prestataires par espace (RG-008).';

create index if not exists idx_provider_event on provider_presence(event_id);
create index if not exists idx_provider_space on provider_presence(assigned_space_id);

create trigger trg_provider_updated_at
  before update on provider_presence
  for each row execute function set_updated_at();

-- =====================================================================
-- 9. schedules — horaires du personnel par espace
-- =====================================================================
create table if not exists schedules (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  space_id    uuid not null references spaces(id) on delete cascade,
  staff_name  text not null,
  role        text,
  arrival     text not null,                    -- HH:MM
  departure   text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table schedules is 'Horaires planifiés du personnel par espace.';

create index if not exists idx_schedules_event on schedules(event_id);
create index if not exists idx_schedules_space on schedules(space_id);

create trigger trg_schedules_updated_at
  before update on schedules
  for each row execute function set_updated_at();

-- =====================================================================
-- 10. debriefs — débriefs de fin d'événement par espace
-- =====================================================================
create table if not exists debriefs (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  space_id    uuid not null references spaces(id) on delete cascade,
  content     text not null default '',
  rating      integer check (rating between 1 and 5),
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (event_id, space_id)
);
comment on table debriefs is 'Débrief de fin d''événement par espace.';

create index if not exists idx_debriefs_event on debriefs(event_id);
create index if not exists idx_debriefs_space on debriefs(space_id);

create trigger trg_debriefs_updated_at
  before update on debriefs
  for each row execute function set_updated_at();
