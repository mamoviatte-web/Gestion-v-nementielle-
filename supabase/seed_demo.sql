-- =====================================================================
-- Données de démonstration — Stade Maurice David
-- À exécuter APRÈS schema.sql + rls_policies.sql + seed.sql.
-- Idempotent : ne réinsère pas si « Provence Rugby vs Vannes » existe déjà.
--
-- Contenu :
--   • Provence Rugby vs Vannes  (archivé)  — données complètes (Salon Nord)
--   • Provence Rugby vs Montauban (en_cours) — stocks ouverts + prestataires prévus
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Événement ARCHIVÉ — Provence Rugby vs Vannes (Salon Nord complet)
-- ---------------------------------------------------------------------
do $$
declare ev uuid; sn uuid;
begin
  if exists (select 1 from events where event_name = 'Provence Rugby vs Vannes') then
    raise notice 'Vannes déjà présent — ignoré.';
    return;
  end if;

  insert into events (event_name, event_type, event_date, start_time, expected_attendees, status)
  values ('Provence Rugby vs Vannes','match','2026-05-07','19:30',7500,'archivé')
  returning event_id into ev;

  insert into event_spaces (event_id, space_id)
  select ev, space_id from spaces where access_code in ('SN2026','SS2026','BV12026');

  select space_id into sn from spaces where access_code = 'SN2026';

  -- Dotations (contrôlées)
  insert into runner_dotations (event_id, space_id, product_id, planned_qty, runner_status)
  select ev, sn, p.product_id, v.qty, 'contrôlé'
  from (values ('Mumm Cordon Rouge',10),('Mumm Blanc de Blanc',6),('Fût BUD',2),('Fût LEFFE',1),
               ('Whisky Jameson',3),('Lillet Blanc',3),('Housses Mange debout',20)) as v(pname,qty)
  join products p on p.product_name = v.pname;

  -- Stocks (ouverture + réassort + clôture)
  insert into event_stock_lines (event_id, space_id, product_id, initial_qty, reassort_qty, final_qty, product_state, responsable_nom, submitted_at)
  select ev, sn, p.product_id, v.i, v.r, v.f, v.st, 'CATELIN Chloé', '2026-05-07 23:30:00+00'
  from (values
    ('Mumm Cordon Rouge',10,4,2,'fermé'),('Mumm Blanc de Blanc',6,0,1,'fermé'),
    ('Fût BUD',2,0,0,'fût_vide'),('Fût LEFFE',1,0,0,'fût_vide'),
    ('Whisky Jameson',3,0,1,'fermé'),('Lillet Blanc',3,0,2,'fermé'),
    ('Housses Mange debout',20,0,17,'fermé')) as v(pname,i,r,f,st)
  join products p on p.product_name = v.pname;

  -- Prestataires (tout stade)
  insert into provider_presence (event_id, space_id, provider_company, provider_type, planned_arrival_time, actual_arrival_time, actual_departure_time, status, comment)
  values
    (ev,null,'Atelier des Gourmands','traiteur','08:00','08:12','14:45','terminé',''),
    (ev,null,'Sécurité Solutions','sécurité','14:00','14:18','00:15','terminé','Retard 18 min à l''arrivée'),
    (ev,null,'Net & Propre','nettoyage','00:00',null,null,'absent','Équipe absente — nettoyage assuré en interne');

  -- Horaires staff (Salon Nord)
  insert into schedules (event_id, space_id, staff_name, role, planned_arrival, planned_departure, actual_departure, confirmed_by_staff, confirmed_by_manager)
  select ev, sn, v.n, v.r, v.pa::time, v.pd::time, v.ad::time, true, true
  from (values
    ('GODMARD Thomas','Nappe Salon','15:00','23:30','23:45'),
    ('CATELIN Chloé','Maître d''hôtel','15:00','23:30','23:30'),
    ('RISTO Océane','Bar','17:15','23:30','23:30'),
    ('SABATER Lylian','Bar N°2','17:15','23:30','00:15'),
    ('BENJALLILOU Aïçon','Serveur animation','17:15','23:30','23:20'),
    ('AFAMASSEFF Sacha','Serveur','17:15','23:30','23:30')) as v(n,r,pa,pd,ad);

  -- Débrief (Salon Nord)
  insert into debriefs (event_id, space_id, responsable, nb_personnes, effectif_adapte, efficacite,
    suggestion_effectif, amenagement, problemes_espace, stocks_suffisants, suggestions_stocks,
    besoins_materiel, consignes_claires, problemes_coordination, retours_clients, retours_clients_detail,
    espace_etat_bon, suggestions_generales, besoins_specifiques, signature, submitted_at)
  values (ev, sn, 'CATELIN Chloé', 6, 'oui', 'bonne',
    'Prévoir un runner supplémentaire pour les matchs à grande affluence', 'adapté',
    'Manque de place derrière le bar lors de l''afflux post mi-temps', 'oui',
    'Augmenter les dotations en rosé', '2 seaux à glace supplémentaires', 'oui',
    'Communication difficile avec les runners pendant la mi-temps', 'positifs',
    'Excellents retours. 2 clients ont demandé des menus végétariens.', 'oui',
    'Prévoir une zone de dépose rapide pour les verres vides', 'Dosettes café, nappes supplémentaires',
    true, '2026-05-07 23:55:00+00');
end $$;

-- ---------------------------------------------------------------------
-- 2. Événement EN COURS — Provence Rugby vs Montauban (stocks ouverts)
-- ---------------------------------------------------------------------
update events set status='en_cours', start_time='19:00', expected_attendees=8000
where event_name='Provence Rugby vs Montauban';

insert into event_stock_lines (event_id, space_id, product_id, initial_qty, reassort_qty, responsable_nom)
select e.event_id, s.space_id, p.product_id, v.i, v.r, 'CATELIN Chloé'
from events e
join spaces s on s.access_code='SN2026'
join (values ('Mumm Cordon Rouge',12,6),('Mumm Blanc de Blanc',8,0),('Fût BUD',2,0),
             ('Whisky Jameson',3,0),('Lillet Blanc',3,0),('Housses Mange debout',15,0)) as v(pname,i,r) on true
join products p on p.product_name=v.pname
where e.event_name='Provence Rugby vs Montauban'
on conflict (event_id, space_id, product_id) do nothing;

insert into provider_presence (event_id, space_id, provider_company, provider_type, planned_arrival_time, status)
select e.event_id, null, v.company, v.ptype, v.arr::time, 'prévu'
from events e
join (values ('Atelier des Gourmands','traiteur','09:00'),('Sécurité Solutions','sécurité','14:00'),
             ('Net & Propre','nettoyage','23:30')) as v(company,ptype,arr) on true
where e.event_name='Provence Rugby vs Montauban'
  and not exists (select 1 from provider_presence pp where pp.event_id = e.event_id);
