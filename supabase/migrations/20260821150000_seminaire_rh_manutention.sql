-- RH séminaires : agents de manutention.
--
-- Les horaires RH par espace d'un séminaire sont saisis dans `zone_staff_hours`
-- (mêmes colonnes que les matchs — hours_worked / rh_cost sont GÉNÉRÉES, et le
-- trigger trg_zsh_category force event_category='seminaire'). La synthèse
-- rh_monthly_hours agrège déjà zone_staff_hours + occasional_hours sans filtre
-- de type d'événement : les heures séminaire y remontent donc automatiquement.
--
-- Seule évolution DB nécessaire : autoriser la mission « manutention » sur les
-- prestations ponctuelles (agents de manutention / runner hors espace).

alter table occasional_hours drop constraint if exists occasional_hours_mission_type_check;
alter table occasional_hours add constraint occasional_hours_mission_type_check
  check (mission_type = any (array[
    'runner','manutention','logistique','mise_en_place','débarrassage',
    'nettoyage','technique','sécurité','livraison','montage','démontage','autre'
  ]));
