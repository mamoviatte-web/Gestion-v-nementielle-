-- ═══════════════════════════════════════════════════════════════════════════
-- consumption_views_revoke_anon.sql — RG-003 sur les vues de consommation.
--
-- space_consumption_view / space_consumption_summary exposent pu_ht / valeur_ht
-- (coûts). Elles étaient accessibles à anon (les accès zone par token tournent en
-- rôle anon) → fuite de coûts. On aligne sur la convention des vues de coûts
-- (ex. match_buvettes_live) : réservé aux comptes authentifiés (ROLE_STADE).
-- ═══════════════════════════════════════════════════════════════════════════

REVOKE ALL ON space_consumption_view FROM anon;
REVOKE ALL ON space_consumption_summary FROM anon;
GRANT SELECT ON space_consumption_view TO authenticated;
GRANT SELECT ON space_consumption_summary TO authenticated;
