/**
 * auditpilot-digest.mjs — publie le DIGEST QUOTIDIEN de l'audit sur GitHub.
 *
 * À exécuter UNIQUEMENT en CI (GitHub Actions), jamais côté front.
 * - Lit (LECTURE SEULE) le dernier audit_run métier/stock/données + ses findings
 *   via la service_role Supabase (jamais exposée au front).
 * - Ajoute l'état des contrôles techniques/sécurité de la CI (variables *_FAIL).
 * - Publie le digest en commentaire sur une issue « roulante »
 *   « 🔎 AuditPilot — Digest quotidien » (créée si absente) via le GITHUB_TOKEN.
 *
 * N'ÉCRIT JAMAIS dans les données de prod. Tolérant aux secrets manquants :
 * sans GITHUB_TOKEN il ne fait rien (no-op) ; sans secrets Supabase il publie
 * seulement la partie technique/sécurité.
 */

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GH_TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY; // owner/repo
const SERVER = process.env.GITHUB_SERVER_URL || 'https://github.com';
const RUN_ID = process.env.GITHUB_RUN_ID;
const API = process.env.GITHUB_API_URL || 'https://api.github.com';

const ISSUE_TITLE = '🔎 AuditPilot — Digest quotidien';
const ISSUE_MARKER = '<!-- auditpilot-digest -->';

if (!GH_TOKEN || !REPO) {
  console.log('AuditPilot digest: GITHUB_TOKEN / GITHUB_REPOSITORY absents — no-op.');
  process.exit(0);
}

/** Contrôles techniques/sécurité de la CI (mêmes drapeaux que le rapport). */
const CI_CHECKS = [
  { env: 'LINT_FAIL', label: 'Lint' },
  { env: 'TYPE_FAIL', label: 'Type-check' },
  { env: 'BUILD_FAIL', label: 'Build' },
  { env: 'DEPS_FAIL', label: 'Dépendances (npm audit)' },
  { env: 'SECRET_FAIL', label: 'Secrets (gitleaks)' },
];

async function gh(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function sb(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase GET ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

const SEV_ORDER = { critique: 0, moyenne: 1, faible: 2 };
const SEV_ICON = { critique: '🔴', moyenne: '🟠', faible: '⚪' };

function scoreBadge(score) {
  if (score >= 90) return `🟢 ${score}/100`;
  if (score >= 70) return `🟠 ${score}/100`;
  return `🔴 ${score}/100`;
}

/** Bloc « audit métier/stock/données » depuis la base (si secrets présents). */
async function businessSection() {
  if (!SB_URL || !SB_KEY) {
    return '### Audit métier / stock / données\n\n> Secrets Supabase non configurés en CI — section indisponible. Ajoutez `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` dans les *repository secrets* pour l\'activer.\n';
  }
  const runs = await sb('audit_runs?status=eq.completed&order=started_at.desc&limit=1&select=*');
  if (!runs.length) return '### Audit métier / stock / données\n\n> Aucun audit terminé en base.\n';
  const run = runs[0];
  const findings = await sb(
    `audit_findings?audit_run_id=eq.${run.id}&select=finding_type,severity,title,affected_entity_type,suggested_fix,status`,
  );
  findings.sort(
    (a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9) || a.finding_type.localeCompare(b.finding_type),
  );
  const openFindings = findings.filter((f) => f.status === 'ouverte');
  const crit = openFindings.filter((f) => f.severity === 'critique');
  const moy = openFindings.filter((f) => f.severity === 'moyenne');

  // Ne lister en détail que critiques + moyennes ouvertes (les faibles = compteur).
  const detail = [...crit, ...moy];
  const rows = detail.length
    ? detail
        .map(
          (f) =>
            `| ${SEV_ICON[f.severity]} ${f.severity} | ${f.finding_type} | ${f.title.replace(/\|/g, '/')} | ${
              (f.suggested_fix || '—').replace(/\|/g, '/').slice(0, 120)
            } |`,
        )
        .join('\n')
    : '| — | — | Aucune anomalie critique ou moyenne ouverte | — |';

  const banner = run.critical_count > 0 ? `\n> ⛔ **${run.critical_count} critique(s) bloque(nt) la clôture.**\n` : '';

  return [
    '### Audit métier / stock / données (base, lecture seule)',
    '',
    `- **Score global** : ${scoreBadge(run.global_score)}`,
    `- **Critiques** : ${run.critical_count} · **Moyennes** : ${run.warning_count} · **Faibles** : ${run.info_count}`,
    `- **Dernier run** : \`${run.id}\` — ${run.started_at} — par _${run.created_by}_`,
    banner,
    '',
    '| Sévérité | Type | Anomalie | Correctif proposé |',
    '|---|---|---|---|',
    rows,
    '',
    detail.length > 6 ? `_(+ ${detail.length - 6} autres — voir la page AuditPilot)_` : '',
  ].join('\n');
}

/** Bloc « technique / sécurité » depuis les drapeaux CI. */
function ciSection() {
  const failed = CI_CHECKS.filter((c) => process.env[c.env]);
  const lines = CI_CHECKS.map((c) => `- ${process.env[c.env] ? '🔴' : '🟢'} ${c.label}`).join('\n');
  const head = failed.length
    ? `### Contrôles techniques / sécurité (CI) — ⚠️ ${failed.length} échec(s)`
    : '### Contrôles techniques / sécurité (CI) — ✅ tout est vert';
  return `${head}\n\n${lines}\n`;
}

async function findRollingIssue() {
  // Issues ouvertes, tri par ancienneté ; on retrouve la nôtre par titre + marqueur.
  const issues = await gh(`/repos/${REPO}/issues?state=open&per_page=100&sort=created&direction=asc`);
  return issues.find((i) => !i.pull_request && i.title === ISSUE_TITLE && (i.body || '').includes(ISSUE_MARKER));
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const runLink = RUN_ID ? `${SERVER}/${REPO}/actions/runs/${RUN_ID}` : null;

  const [biz] = await Promise.all([businessSection()]);
  const ci = ciSection();

  const digest = [
    `## Digest du ${today}`,
    '',
    biz,
    '',
    ci,
    runLink ? `\n_Run CI : ${runLink}_` : '',
  ]
    .filter(Boolean)
    .join('\n');

  let issue = await findRollingIssue();
  if (!issue) {
    issue = await gh(`/repos/${REPO}/issues`, {
      method: 'POST',
      body: {
        title: ISSUE_TITLE,
        body: [
          ISSUE_MARKER,
          '',
          "Issue **roulante** : AuditPilot y publie chaque matin le digest de l'audit quotidien (métier/stock/données depuis la base + technique/sécurité depuis la CI).",
          '',
          'AuditPilot **propose**, il n\'**applique** rien en production. Les correctifs éventuels arrivent en **Pull Request** dédiée (jamais de push direct).',
          '',
          '---',
          '',
          digest,
        ].join('\n'),
      },
    });
    console.log(`AuditPilot digest: issue créée #${issue.number}.`);
    return;
  }

  await gh(`/repos/${REPO}/issues/${issue.number}/comments`, { method: 'POST', body: { body: digest } });
  console.log(`AuditPilot digest: commentaire ajouté à l'issue #${issue.number}.`);
}

main().catch((e) => {
  // Non bloquant : le digest ne doit jamais faire échouer la CI.
  console.error('AuditPilot digest: échec (non bloquant) —', e.message);
  process.exit(0);
});
