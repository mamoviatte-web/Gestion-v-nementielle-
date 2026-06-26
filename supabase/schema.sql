-- =====================================================================
-- Schéma PostgreSQL — Stade Maurice David (CDC V1.1 — Provence Rugby)
-- Source de vérité : CLAUDE.md (noms de tables/colonnes EXACTS).
-- À coller dans Supabase → SQL Editor (ordre des tables = respect des FK).
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
-- 1. spaces — 16 espaces du stade
-- =====================================================================
create table if not exists spaces (
  space_id    uuid primary key default gen_random_uuid(),
  space_name  text not null,
  space_type  text not null check (space_type in ('VIP','Bar','Buvette')),
  access_code text unique not null,
  capacity    int,
  active      boolean default true,
  created_at  timestamptz default now()
);
comment on table spaces is 'Les 16 espaces de vente du stade.';
comment on column spaces.access_code is 'Code d''accès unique (identifiant Responsable, ex: SN2026).';

-- =====================================================================
-- 2. users — registre applicatif des comptes
-- =====================================================================
create table if not exists users (
  user_id       uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text unique,
  role          text not null check (role in ('ROLE_STADE','ROLE_RESPONSABLE')),
  space_id      uuid references spaces(space_id),
  is_active     boolean default true,
  last_login_at timestamptz,
  created_at    timestamptz default now()
);
comment on table users is 'Registre des comptes applicatifs (miroir métier de auth.users).';

-- =====================================================================
-- 3. products — catalogue (cible 269 produits)
-- =====================================================================
create table if not exists products (
  product_id    uuid primary key default gen_random_uuid(),
  product_name  text not null,
  category      text not null check (category in ('Vins','Bières','Soft','Sirops','Spiritueux','Matériel')),
  unit          text not null,
  packaging     text,
  unit_price_ht decimal(10,2),   -- NULL autorisé → alerte RG-005
  stock_min     int default 0,
  active        boolean default true
);
comment on table products is 'Catalogue produits (boissons + matériel).';
comment on column products.unit_price_ht is 'Prix unitaire HT. NULL = prix manquant (RG-005). Jamais exposé au ROLE_RESPONSABLE (RG-003).';

-- =====================================================================
-- 4. events — événements
-- =====================================================================
create table if not exists events (
  event_id           uuid primary key default gen_random_uuid(),
  event_name         text not null,
  event_type         text check (event_type in ('match','séminaire','cocktail','réception_vip','événement_partenaire','réunion','autre')),
  event_date         date not null,
  start_time         time,
  end_time           time,
  expected_attendees int,
  status             text default 'brouillon'
                       check (status in ('brouillon','préparé','en_cours','clôture_en_attente','clôturé','archivé')),
  created_at         timestamptz default now()
);
comment on table events is 'Événements (matchs, séminaires, cocktails, etc.).';

-- =====================================================================
-- 5. event_spaces — espaces activés par événement
-- =====================================================================
create table if not exists event_spaces (
  id                       uuid primary key default gen_random_uuid(),
  event_id                 uuid not null references events(event_id) on delete cascade,
  space_id                 uuid not null references spaces(space_id),
  responsible_default_name text,
  unique (event_id, space_id)
);
comment on table event_spaces is 'Espaces activés pour un événement.';

create index if not exists idx_event_spaces_event on event_spaces(event_id);
create index if not exists idx_event_spaces_space on event_spaces(space_id);

-- =====================================================================
-- 6. runner_dotations — fiches runner digitalisées (CDC §8)
-- =====================================================================
create table if not exists runner_dotations (
  dotation_id     uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events(event_id),
  space_id        uuid not null references spaces(space_id),
  product_id      uuid not null references products(product_id),
  planned_qty     int not null default 0,
  office_qty      int default 0,
  cartons_to_move int default 0,
  runner_status   text default 'à_préparer'
                    check (runner_status in ('à_préparer','préparé','monté','contrôlé','annulé')),
  runner_comment  text,
  updated_at      timestamptz default now(),
  unique (event_id, space_id, product_id)
);
comment on table runner_dotations is 'Dotations logistiques (runner) par espace/produit/événement.';

create index if not exists idx_runner_dotations_event on runner_dotations(event_id);
create index if not exists idx_runner_dotations_space on runner_dotations(space_id);
create index if not exists idx_runner_dotations_product on runner_dotations(product_id);

create trigger trg_runner_dotations_updated_at
  before update on runner_dotations
  for each row execute function set_updated_at();

-- =====================================================================
-- 7. event_stock_lines — état stock par événement/espace/produit (CDC §9)
--    consumed_qty = initial_qty + reassort_qty - final_qty  (CALCULÉ côté app)
-- =====================================================================
create table if not exists event_stock_lines (
  line_id         uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events(event_id),
  space_id        uuid not null references spaces(space_id),
  product_id      uuid not null references products(product_id),
  initial_qty     int default 0,
  reassort_qty    int default 0,
  final_qty       int,              -- NULL tant que clôture non faite
  product_state   text check (product_state in ('fermé','ouvert','cassé','perdu','périmé','fût_vide','fût_percuté')),
  anomaly_comment text,             -- obligatoire si consommation < 0 (RG-004)
  responsable_nom text not null,    -- RG-001 : traçabilité nominative obligatoire
  submitted_at    timestamptz,
  unique (event_id, space_id, product_id)
);
comment on table event_stock_lines is 'État stock (initial/réassort/final) par événement, espace, produit. consumed_qty calculé app-side (CDC §9).';

create index if not exists idx_stock_lines_event on event_stock_lines(event_id);
create index if not exists idx_stock_lines_space on event_stock_lines(space_id);
create index if not exists idx_stock_lines_product on event_stock_lines(product_id);

-- =====================================================================
-- 8. stock_movements — historique complet (RG-002)
-- =====================================================================
create table if not exists stock_movements (
  movement_id     uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events(event_id),
  space_id        uuid not null references spaces(space_id),
  product_id      uuid not null references products(product_id),
  movement_type   text not null check (movement_type in ('entrée','sortie','réassort','retour','casse','perte','correction','inventaire')),
  qty             int not null,
  responsable_nom text not null,
  created_at      timestamptz default now()
);
comment on table stock_movements is 'Journal append-only de tous les mouvements de stock (RG-002).';

create index if not exists idx_movements_event on stock_movements(event_id);
create index if not exists idx_movements_space on stock_movements(space_id);
create index if not exists idx_movements_product on stock_movements(product_id);

-- =====================================================================
-- 9. provider_presence — prestataires présents (CDC §7)
-- =====================================================================
create table if not exists provider_presence (
  provider_presence_id  uuid primary key default gen_random_uuid(),
  event_id              uuid not null references events(event_id),
  space_id              uuid references spaces(space_id),   -- NULL = tout stade
  provider_company      text not null,
  provider_type         text not null check (provider_type in ('traiteur','sécurité','nettoyage','technique','logistique','animation','autre')),
  provider_contact_name text,
  provider_phone        text,
  planned_arrival_time  time,
  actual_arrival_time   time,
  planned_start_time    time,
  actual_start_time     time,
  planned_end_time      time,
  actual_end_time       time,
  actual_departure_time time,
  status                text default 'prévu'
                          check (status in ('prévu','présent','en_retard','terminé','absent','annulé')),
  responsable_nom       text,
  comment               text
);
comment on table provider_presence is 'Présence des prestataires (RG-008 : retard > 15 min → en_retard).';

create index if not exists idx_provider_event on provider_presence(event_id);
create index if not exists idx_provider_space on provider_presence(space_id);

-- =====================================================================
-- 10. schedules — horaires staff par espace
-- =====================================================================
create table if not exists schedules (
  schedule_id          uuid primary key default gen_random_uuid(),
  event_id             uuid not null references events(event_id),
  space_id             uuid not null references spaces(space_id),
  staff_name           text not null,
  role                 text,
  planned_arrival      time,
  planned_departure    time,
  actual_departure     time,
  confirmed_by_staff   boolean default false,
  confirmed_by_manager boolean default false
);
comment on table schedules is 'Horaires planifiés du personnel par espace.';

create index if not exists idx_schedules_event on schedules(event_id);
create index if not exists idx_schedules_space on schedules(space_id);

-- =====================================================================
-- 11. debriefs — formulaire post-événement (7 sections)
-- =====================================================================
create table if not exists debriefs (
  debrief_id              uuid primary key default gen_random_uuid(),
  event_id                uuid not null references events(event_id),
  space_id                uuid not null references spaces(space_id),
  responsable             text not null,
  -- 1.1 Effectif
  nb_personnes            int,
  effectif_adapte         text,
  effectif_comment        text,
  efficacite              text,
  efficacite_comment      text,
  suggestion_effectif     text,
  -- 1.2 Organisation
  amenagement             text,
  amenagement_comment     text,
  problemes_espace        text,
  -- 1.3 Stocks
  stocks_suffisants       text,
  stocks_comment          text,
  suggestions_stocks      text,
  besoins_materiel        text,
  -- 2.1 Communication interne
  consignes_claires       text,
  consignes_comment       text,
  problemes_coordination  text,
  -- 2.2 Communication clients
  retours_clients         text,
  retours_clients_detail  text,
  -- 3. Propreté
  espace_etat_bon         text,
  espace_etat_comment     text,
  problemes_dechets       text,
  suggestions_proprete    text,
  -- 5. Suggestions
  suggestions_generales   text,
  besoins_specifiques     text,
  signature               boolean default false,
  submitted_at            timestamptz,
  created_at              timestamptz default now(),
  unique (event_id, space_id)
);
comment on table debriefs is 'Débrief de fin d''événement par espace (7 sections).';

create index if not exists idx_debriefs_event on debriefs(event_id);
create index if not exists idx_debriefs_space on debriefs(space_id);
