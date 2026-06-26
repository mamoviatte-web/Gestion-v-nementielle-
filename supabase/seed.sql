-- =====================================================================
-- Données de référence (seed) — Stade Maurice David (CDC V1.1)
-- À exécuter APRÈS schema.sql (et rls_policies.sql).
-- Idempotent : utilise des ON CONFLICT sur les clés naturelles.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Les 16 espaces (codes exacts CDC)
-- ---------------------------------------------------------------------
insert into spaces (name, code, type) values
  ('Salon Nord',       'SN2026',  'VIP'),
  ('Salon Sud',        'SS2026',  'VIP'),
  ('Le Pub',           'PUB2026', 'Bar'),
  ('Loge Est',         'LE2026',  'VIP'),
  ('Comptoir',         'CO2026',  'Bar'),
  ('Bistrot',          'BI2026',  'Bar'),
  ('Loge Ouest Nord',  'LON2026', 'VIP'),
  ('Loge Ouest Sud',   'LOS2026', 'VIP'),
  ('Wine bar Nord',    'WBN2026', 'Bar'),
  ('Wine bar Sud',     'WBS2026', 'Bar'),
  ('Club 70 Nord',     'C70N26',  'VIP'),
  ('Club 70 Sud',      'C70S26',  'VIP'),
  ('Terrasses',        'TER2026', 'Bar'),
  ('Bodega',           'BOD2026', 'Bar'),
  ('Buvette 1',        'BV12026', 'Buvette'),
  ('Buvette 2',        'BV22026', 'Buvette')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 2. 25 produits de démonstration (toutes catégories)
-- ---------------------------------------------------------------------
insert into products (name, category, unit, unit_price_ht, packaging) values
  -- Vins (5)
  ('Mumm Cordon Rouge',        'Vin',        'bouteille', 23.96, '75cl'),
  ('Mumm Blanc de Blanc',      'Vin',        'bouteille', 38.11, '75cl'),
  ('Côtes de Provence Rosé',   'Vin',        'bouteille', 6.90,  '75cl'),
  ('Côtes du Rhône Rouge',     'Vin',        'bouteille', 7.40,  '75cl'),
  ('Chardonnay Blanc',         'Vin',        'bouteille', 8.20,  '75cl'),
  -- Bières (3)
  ('Fût BUD',                  'Bière',      'fût',       97.95, '30L'),
  ('Fût LEFFE',                'Bière',      'fût',       129.75,'30L'),
  ('Bière en verre',           'Bière',      'verre',     1.34,  '25cl'),
  -- Soft (4)
  ('Pepsi',                    'Soft',       'bouteille', 1.80,  '1L'),
  ('Cristaline',               'Soft',       'bouteille', 0.17,  '50cl'),
  ('Jus de fruits',            'Soft',       'bouteille', 2.60,  '1L'),
  ('Schweppes',                'Soft',       'bouteille', 2.41,  '1L'),
  -- Sirops (4)
  ('Sirop Pêche',              'Sirop',      'bouteille', 6.45,  '70cl'),
  ('Sirop Grenadine',          'Sirop',      'bouteille', 5.01,  '70cl'),
  ('Sirop Menthe',             'Sirop',      'bouteille', 5.50,  '70cl'),
  ('Sirop Citron',             'Sirop',      'bouteille', 4.80,  '70cl'),
  -- Spiritueux (5)
  ('Whisky Jameson',           'Spiritueux', 'bouteille', 18.59, '70cl'),
  ('Lillet Blanc',             'Spiritueux', 'bouteille', 12.52, '75cl'),
  ('Ricard',                   'Spiritueux', 'bouteille', 16.79, '1L'),
  ('GET 27',                   'Spiritueux', 'bouteille', 12.21, '70cl'),
  ('Ricard Herbes',            'Spiritueux', 'bouteille', 15.30, '70cl'),
  -- Matériel (4) — sans prix HT
  ('Housses Mange debout',     'Matériel',   'pièce',     null,  null),
  ('Housses Buffet',           'Matériel',   'pièce',     null,  null),
  ('Housse Desk',              'Matériel',   'pièce',     null,  null),
  ('Nappes',                   'Matériel',   'pièce',     null,  null)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 3. Compte ROLE_STADE de test
--    ⚠ La création d'un compte auth se fait normalement via le Dashboard
--    Supabase (Authentication → Users) ou l'Admin API, en renseignant
--    user_metadata = { "role": "ROLE_STADE", "name": "Admin Stade" }.
--
--    Le bloc ci-dessous tente une création directe (utile en local).
--    email    : admin@stade-mauricedavid.fr
--    password : admin2026   (à changer)
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
-- 4. Événement de démonstration + espaces associés
-- ---------------------------------------------------------------------
insert into events (name, type, date, start_time, expected_attendees, status)
select 'Provence Rugby vs Montauban', 'match', date '2026-06-28', '19:00', 8000, 'préparé'
where not exists (
  select 1 from events where name = 'Provence Rugby vs Montauban' and date = date '2026-06-28'
);

-- Associe tous les espaces à l'événement de démonstration.
insert into event_spaces (event_id, space_id)
select e.id, s.id
from events e
cross join spaces s
where e.name = 'Provence Rugby vs Montauban' and e.date = date '2026-06-28'
on conflict (event_id, space_id) do nothing;
