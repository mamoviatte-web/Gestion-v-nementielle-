-- ═══════════════════════════════════════════════════════════════════════════
-- auditpilot_revoke_anon.sql — AuditPilot : les tables/vue d'audit contiennent
-- des données internes (findings, logs) — réservées aux comptes authentifiés
-- (équipe stade). Les accès zone par token (rôle anon) n'ont rien à y voir.
-- ═══════════════════════════════════════════════════════════════════════════

REVOKE ALL ON audit_runs FROM anon;
REVOKE ALL ON audit_findings FROM anon;
REVOKE ALL ON audit_latest_run FROM anon;
DO $$ BEGIN
  IF to_regclass('public.audit_logs') IS NOT NULL THEN EXECUTE 'REVOKE ALL ON audit_logs FROM anon'; END IF;
END $$;

GRANT SELECT ON audit_runs, audit_findings, audit_latest_run TO authenticated;
