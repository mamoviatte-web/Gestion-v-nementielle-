-- ═══════════════════════════════════════════════════════════════════════════
-- sectorized_consumption_revoke_anon.sql — RG-003 sur les vues de conso
-- sectorisée par événement (valeur_ht = coûts). Réservé aux comptes authentifiés
-- (ROLE_STADE), comme les autres vues de coûts. Les accès zone (token) = rôle
-- anon → ne doivent pas lire les coûts.
-- ═══════════════════════════════════════════════════════════════════════════

REVOKE ALL ON event_space_product_consumption FROM anon;
REVOKE ALL ON consumption_by_event FROM anon;
REVOKE ALL ON consumption_by_event_space FROM anon;
REVOKE ALL ON consumption_general_by_product FROM anon;
REVOKE ALL ON consumption_general_by_space FROM anon;

GRANT SELECT ON event_space_product_consumption, consumption_by_event,
  consumption_by_event_space, consumption_general_by_product,
  consumption_general_by_space TO authenticated;
