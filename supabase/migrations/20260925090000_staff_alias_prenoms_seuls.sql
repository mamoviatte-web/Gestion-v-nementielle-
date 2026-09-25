-- =====================================================================
-- RH — ALIAS DE NOMS : associer un PRÉNOM SEUL à la personne complète
-- ---------------------------------------------------------------------
-- Certains agents sont saisis par leur prénom seul (ex. « Malo », « Haroun »)
-- dans les heures de zone → ils apparaissaient comme des personnes distinctes
-- dans la synthèse de paie mensuelle, séparés de leur fiche complète.
--
-- Le mécanisme d'intelligence existe déjà : rh_person_key(p) consulte la table
-- staff_alias (variant_key → canonical_key). Il suffit d'y déclarer les
-- correspondances. Une fois l'alias posé, TOUTES les vues RH (rh_monthly_hours,
-- rh_monthly_event_detail, rh_person_event_shift…) fusionnent automatiquement
-- les heures du prénom seul dans la personne complète, et l'affichage retient le
-- nom le plus complet.
--
-- Idempotent (insert where not exists). Ajouter ici toute nouvelle
-- correspondance prénom → nom complet validée par l'équipe.
-- =====================================================================

insert into public.staff_alias (variant_key, canonical_key, note)
select v, c, n
from (values
  (public.rh_name_key('Malo'),    public.rh_name_key('Malo CHOMEL'),      'Malo = Malo CHOMEL (prénom seul → nom complet)'),
  (public.rh_name_key('Haroun'),  public.rh_name_key('Haroun Meramria'),  'Haroun = Haroun Meramria (prénom seul → nom complet)'),
  (public.rh_name_key('Caron'),   public.rh_name_key('Caron Wilfrid'),    'Caron = Caron Wilfrid (nom seul → personne complète)'),
  (public.rh_name_key('Wilfrid'), public.rh_name_key('Caron Wilfrid'),    'Wilfrid = Caron Wilfrid (prénom seul → personne complète)'),
  (public.rh_name_key('Elliot'),  public.rh_name_key('Lagrange Elliot'),  'Elliot = Lagrange Elliot (prénom seul → personne complète)')
) as t(v, c, n)
where not exists (select 1 from public.staff_alias a where a.variant_key = t.v);
