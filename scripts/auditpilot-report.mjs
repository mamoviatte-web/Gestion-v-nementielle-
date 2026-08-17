/**
 * auditpilot-report.mjs — écrit les findings TECHNIQUES / SÉCURITÉ de la CI dans
 * audit_findings via la service_role Supabase. À exécuter UNIQUEMENT en CI
 * (jamais côté front). N'écrit que dans audit_runs / audit_findings — jamais dans
 * les données de production. Sans secrets configurés, ne fait rien (no-op).
 *
 * Détecte les échecs via les variables d'environnement posées par le workflow
 * (LINT_FAIL, TYPE_FAIL, BUILD_FAIL, DEPS_FAIL, SECRET_FAIL) et crée un finding
 * par échec, rattaché à un audit_run technique dédié.
 */

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !KEY) {
  console.log('AuditPilot: SUPABASE_URL / SERVICE_ROLE_KEY absents — rapport ignoré (no-op).');
  process.exit(0);
}

/** Chaque contrôle → finding si la variable *_FAIL est posée. */
const CHECKS = [
  { env: 'LINT_FAIL', type: 'code', severity: 'moyenne', title: 'Lint en échec', fix: 'Corriger les erreurs ESLint (npm run lint).' },
  { env: 'TYPE_FAIL', type: 'code', severity: 'critique', title: 'Type-check en échec', fix: 'Corriger les erreurs TypeScript (npm run type-check).' },
  { env: 'BUILD_FAIL', type: 'code', severity: 'critique', title: 'Build en échec', fix: 'Corriger l’erreur de build avant livraison (npm run build).' },
  { env: 'DEPS_FAIL', type: 'sécurité', severity: 'moyenne', title: 'Dépendances vulnérables (npm audit)', fix: 'Mettre à jour / patcher les dépendances vulnérables (npm audit).' },
  { env: 'SECRET_FAIL', type: 'sécurité', severity: 'critique', title: 'Secret détecté dans le code (gitleaks)', fix: 'Retirer le secret du code, le révoquer et le déplacer en variable d’environnement.' },
];

const failures = CHECKS.filter((c) => process.env[c.env]);

async function rest(path, body, prefer) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.status === 201 || prefer ? res.json() : null;
}

try {
  const critical = failures.filter((f) => f.severity === 'critique').length;
  const medium = failures.filter((f) => f.severity === 'moyenne').length;
  const score = Math.max(0, 100 - critical * 15 - medium * 1);

  const [run] = await rest(
    'audit_runs',
    {
      status: 'completed',
      finished_at: new Date().toISOString(),
      global_score: score,
      critical_count: critical,
      warning_count: medium,
      info_count: 0,
      created_by: 'AuditPilot CI (technique/sécurité)',
    },
    'return=representation',
  );

  if (failures.length === 0) {
    console.log(`AuditPilot CI: tout est vert — run ${run.id} (score ${score}).`);
    process.exit(0);
  }

  await rest(
    'audit_findings',
    failures.map((f) => ({
      audit_run_id: run.id,
      finding_type: f.type,
      severity: f.severity,
      title: f.title,
      description: `Contrôle CI « ${f.env} » en échec (voir logs GitHub Actions).`,
      affected_entity_type: 'ci',
      suggested_fix: f.fix,
      status: 'ouverte',
    })),
    'return=minimal',
  );

  console.log(`AuditPilot CI: ${failures.length} finding(s) écrits — run ${run.id} (score ${score}).`);
} catch (e) {
  // Non bloquant : le rapport ne doit pas faire échouer la CI.
  console.error('AuditPilot CI: échec du rapport (non bloquant) —', e.message);
  process.exit(0);
}
