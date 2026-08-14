-- ═══════════════════════════════════════════════════════════════════════════
-- keg_true_balance_revoke_anon.sql — RG-003 : la vue d'audit des fûts expose
-- pu_ht / valeur_pleins_ht (coûts). Réservé aux comptes authentifiés (ROLE_STADE),
-- comme les autres vues de coûts. Les accès zone (token) = rôle anon.
-- ═══════════════════════════════════════════════════════════════════════════

REVOKE ALL ON keg_true_balance FROM anon;
GRANT SELECT ON keg_true_balance TO authenticated;
