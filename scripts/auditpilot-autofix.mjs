/**
 * auditpilot-autofix.mjs — ouvre une PR de correctif MÉCANIQUE quand la CI
 * détecte un problème auto-corrigeable (lint / dépendances vulnérables).
 *
 * Règle non négociable (CDC §4) : AuditPilot PROPOSE, il n'APPLIQUE jamais en
 * prod. Ce script :
 *   - ne modifie QUE des fichiers du dépôt (jamais les données de prod) ;
 *   - travaille sur une branche dédiée `auditpilot/fix-*`, JAMAIS la branche
 *     par défaut ;
 *   - ouvre une Pull Request (revue humaine + CI verte requises pour merger) ;
 *   - est idempotent : s'il existe déjà une PR AuditPilot ouverte, il ne fait rien.
 *
 * Ne traite QUE le sous-ensemble sûr et déterministe : `eslint --fix` (LINT_FAIL)
 * et `npm audit fix` (DEPS_FAIL). Les anomalies métier/stock/données ne sont
 * JAMAIS auto-corrigées (elles relèvent d'une décision humaine / d'une migration).
 * Tolérant aux secrets manquants : sans GITHUB_TOKEN → no-op.
 */

import { execSync } from 'node:child_process';

const GH_TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY; // owner/repo
const API = process.env.GITHUB_API_URL || 'https://api.github.com';
const SHA = (process.env.GITHUB_SHA || 'local').slice(0, 7);
const RUN_ID = process.env.GITHUB_RUN_ID || '0';

if (!GH_TOKEN || !REPO) {
  console.log('AuditPilot autofix: GITHUB_TOKEN / GITHUB_REPOSITORY absents — no-op.');
  process.exit(0);
}

const FIXERS = [
  { env: 'LINT_FAIL', label: 'lint', cmd: 'npx --yes eslint . --fix' },
  { env: 'DEPS_FAIL', label: 'dépendances', cmd: 'npm audit fix' },
];
const active = FIXERS.filter((f) => process.env[f.env]);

if (active.length === 0) {
  console.log('AuditPilot autofix: aucun échec mécanique (lint/deps) — rien à corriger.');
  process.exit(0);
}

function sh(cmd, allowFail = false) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  } catch (e) {
    if (allowFail) return (e.stdout || '') + (e.stderr || '');
    throw e;
  }
}

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

async function main() {
  // 1) Idempotence : une PR AuditPilot déjà ouverte ? → on ne réempile pas.
  const owner = REPO.split('/')[0];
  const openPrs = await gh(`/repos/${REPO}/pulls?state=open&per_page=100&head=${owner}:auditpilot`);
  const existing = (Array.isArray(openPrs) ? openPrs : []).find((p) => p.head?.ref?.startsWith('auditpilot/fix-'));
  if (existing) {
    console.log(`AuditPilot autofix: PR déjà ouverte (#${existing.number}) — skip.`);
    return;
  }

  const repo = await gh(`/repos/${REPO}`);
  const base = repo.default_branch;

  // 2) Appliquer les correctifs mécaniques (exit code ignoré : on juge sur le diff).
  for (const f of active) {
    console.log(`AuditPilot autofix: application « ${f.label} »…`);
    sh(f.cmd, true);
  }

  // 3) Diff ? sinon rien à proposer.
  const dirty = sh('git status --porcelain', true).trim();
  if (!dirty) {
    console.log('AuditPilot autofix: aucun changement produit par les correctifs — skip.');
    return;
  }

  // 4) Branche dédiée + commit + push (jamais la branche par défaut).
  const branch = `auditpilot/fix-${SHA}-${RUN_ID}`;
  sh('git config user.name "AuditPilot"');
  sh('git config user.email "actions@github.com"');
  sh(`git checkout -b ${branch}`);
  sh('git add -A');
  const labels = active.map((f) => f.label).join(' + ');
  sh(`git commit -m "fix(auditpilot): correctifs mécaniques (${labels})"`);
  sh(
    `git push "https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git" ${branch}:${branch}`,
    true,
  );

  // 5) Ouvrir la PR (revue humaine + CI verte requises pour merger).
  const pr = await gh(`/repos/${REPO}/pulls`, {
    method: 'POST',
    body: {
      title: `fix(auditpilot): correctifs mécaniques (${labels})`,
      head: branch,
      base,
      body: [
        '### 🤖 Correctif proposé par AuditPilot',
        '',
        `Généré automatiquement suite aux contrôles CI en échec : **${labels}**.`,
        '',
        'Correctifs appliqués :',
        ...active.map((f) => `- \`${f.cmd}\``),
        '',
        '> AuditPilot **propose**, il n\'**applique** pas. Cette PR ne peut être mergée qu\'après **revue humaine** et **CI verte**. Aucune donnée de production n\'est modifiée.',
      ].join('\n'),
    },
  });
  console.log(`AuditPilot autofix: PR ouverte #${pr.number} — ${pr.html_url}`);
}

main().catch((e) => {
  // Non bloquant : l'auto-fix ne doit pas faire échouer la CI.
  console.error('AuditPilot autofix: échec (non bloquant) —', e.message);
  process.exit(0);
});
