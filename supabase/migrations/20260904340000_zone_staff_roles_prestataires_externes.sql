-- =====================================================================
-- FIX AXE 1 — RÔLES PRESTATAIRES EXTERNES AUTORISÉS SUR zone_staff_hours
-- ---------------------------------------------------------------------
-- L'ajout d'équipe côté régisseur séminaire (Axe 1) propose des rôles de
-- prestataires externes (Traiteur, Technique…) que la contrainte CHECK
-- historique n'autorisait pas → l'enregistrement échouait pour ces rôles.
-- On élargit la liste aux types de prestataires (cohérent avec
-- provider_presence.provider_type). Idempotent.
-- =====================================================================

alter table zone_staff_hours drop constraint if exists zone_staff_hours_role_check;

alter table zone_staff_hours add constraint zone_staff_hours_role_check
  check (role = any (array[
    'Serveur', 'Chef de rang', 'Barman', 'Agent de sécurité', 'Runner',
    'Hôte / Hôtesse', 'Responsable espace',
    -- prestataires externes
    'Traiteur', 'Technique', 'Nettoyage', 'Logistique', 'Sécurité', 'Animation',
    'Autre'
  ]));
