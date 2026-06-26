-- =====================================================================
-- Données de référence (seed) — Stade Maurice David (CDC V1.1)
-- À exécuter APRÈS schema.sql (et rls_policies.sql).
-- Idempotent : ON CONFLICT sur les clés naturelles.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Les 16 espaces (codes exacts CDC)
-- ---------------------------------------------------------------------
insert into spaces (space_name, space_type, access_code) values
  ('Salon Nord',       'VIP',     'SN2026'),
  ('Salon Sud',        'VIP',     'SS2026'),
  ('Le Pub',           'Bar',     'PUB2026'),
  ('Loge Est',         'VIP',     'LE2026'),
  ('Comptoir',         'Bar',     'CO2026'),
  ('Bistrot',          'Bar',     'BI2026'),
  ('Loge Ouest Nord',  'VIP',     'LON2026'),
  ('Loge Ouest Sud',   'VIP',     'LOS2026'),
  ('Wine bar Nord',    'Bar',     'WBN2026'),
  ('Wine bar Sud',     'Bar',     'WBS2026'),
  ('Club 70 Nord',     'Bar',     'C70N26'),
  ('Club 70 Sud',      'Bar',     'C70S26'),
  ('Terrasses',        'Bar',     'TER2026'),
  ('Bodega',           'Bar',     'BOD2026'),
  ('Buvette 1',        'Buvette', 'BV12026'),
  ('Buvette 2',        'Buvette', 'BV22026')
on conflict (access_code) do nothing;

-- ---------------------------------------------------------------------
-- 2. 25 produits de démonstration (valeurs exactes CDC)
-- ---------------------------------------------------------------------
insert into products (product_name, category, unit, unit_price_ht) values
  -- Vins (5)
  ('Mumm Cordon Rouge',     'Vins',        'btl', 23.96),
  ('Mumm Blanc de Blanc',   'Vins',        'btl', 38.11),
  ('Rosé Réal',             'Vins',        'btl', 8.70),
  ('Rosé Pey Blanc',        'Vins',        'btl', 7.20),
  ('Rosé Miraval',          'Vins',        'btl', 12.50),
  -- Bières (3)
  ('Fût BUD',               'Bières',      'fût', 97.95),
  ('Fût LEFFE',             'Bières',      'fût', 129.75),
  ('Bière en verre',        'Bières',      'u',   1.34),
  -- Soft (4)
  ('Pepsi bouteille',       'Soft',        'btl', 1.80),
  ('Cristaline 50cl',       'Soft',        'btl', 0.17),
  ('Jus de fruits',         'Soft',        'btl', 2.60),
  ('Schweppes',             'Soft',        'btl', 2.41),
  -- Sirops (4)
  ('Sirop de pêche',        'Sirops',      'btl', 6.45),
  ('Sirop de grenadine',    'Sirops',      'btl', 5.01),
  ('Sirop de menthe',       'Sirops',      'btl', 5.50),
  ('Sirop de citron',       'Sirops',      'btl', 4.80),
  -- Spiritueux (5)
  ('Whisky Jameson',        'Spiritueux',  'btl', 18.59),
  ('Lillet Blanc',          'Spiritueux',  'btl', 12.52),
  ('Lillet Rosé',           'Spiritueux',  'btl', 13.10),
  ('Ricard classique',      'Spiritueux',  'btl', 16.79),
  ('GET 27',                'Spiritueux',  'btl', 12.21),
  -- Matériel (4) — sans prix HT (unit_price_ht = NULL)
  ('Housses Mange debout',  'Matériel',    'u',   null),
  ('Housses Buffet',        'Matériel',    'u',   null),
  ('Housse Desk D''accueil','Matériel',    'u',   null),
  ('Nappes de rechange',    'Matériel',    'u',   null)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 3. Comptes (table applicative `users`)
--    1 compte ROLE_STADE + 16 comptes ROLE_RESPONSABLE (un par espace).
--    ⚠ Ce sont les enregistrements MÉTIER. Les comptes d'AUTHENTIFICATION
--      Supabase (auth.users) doivent être créés à part (cf. §4).
-- ---------------------------------------------------------------------
insert into users (name, email, role, space_id)
select 'Admin Stade', 'admin@stade-mauricedavid.fr', 'ROLE_STADE', null
where not exists (select 1 from users where email = 'admin@stade-mauricedavid.fr');

insert into users (name, email, role, space_id)
select 'Responsable ' || s.space_name,
       lower(s.access_code) || '@stade.fr',
       'ROLE_RESPONSABLE',
       s.space_id
from spaces s
where not exists (
  select 1 from users u where u.email = lower(s.access_code) || '@stade.fr'
);

-- ---------------------------------------------------------------------
-- 4. Comptes d'authentification Supabase
--    La création de auth.users se fait normalement via le Dashboard
--    (Authentication → Users) ou l'Admin API, avec user_metadata :
--      ROLE_STADE       : { "role":"ROLE_STADE", "name":"Admin Stade" }
--      ROLE_RESPONSABLE : { "role":"ROLE_RESPONSABLE", "space_id":"<uuid>",
--                           "space_code":"SN2026" }
--    Responsable : email = {code}@stade.fr, password = {code}.
--
--    Le bloc ci-dessous tente une création directe du compte admin (local).
--    email: admin@stade-mauricedavid.fr  /  password: admin2026
-- ---------------------------------------------------------------------
do $$
declare
  v_user_id uuid := gen_random_uuid();
begin
  if not exists (select 1 from auth.users where email = 'admin@stade-mauricedavid.fr') then
    insert into auth.users (
      id, instance_id, aud, role, email,
      encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) values (
      v_user_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated',
      'admin@stade-mauricedavid.fr',
      crypt('admin2026', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"role":"ROLE_STADE","name":"Admin Stade"}'::jsonb,
      now(), now()
    );
  end if;
exception
  when insufficient_privilege or undefined_table then
    raise notice 'Création auth.users ignorée (droits insuffisants) — créer le compte via le Dashboard Supabase.';
end $$;

-- ---------------------------------------------------------------------
-- 5. Événement de démonstration + espaces activés
-- ---------------------------------------------------------------------
insert into events (event_name, event_type, event_date, start_time, end_time, expected_attendees, status)
select 'Provence Rugby vs Montauban', 'match', date '2026-06-28', time '19:00', time '23:00', 8000, 'préparé'
where not exists (
  select 1 from events where event_name = 'Provence Rugby vs Montauban' and event_date = date '2026-06-28'
);

-- Active tous les espaces sur l'événement de démonstration.
insert into event_spaces (event_id, space_id)
select e.event_id, s.space_id
from events e
cross join spaces s
where e.event_name = 'Provence Rugby vs Montauban' and e.event_date = date '2026-06-28'
on conflict (event_id, space_id) do nothing;
