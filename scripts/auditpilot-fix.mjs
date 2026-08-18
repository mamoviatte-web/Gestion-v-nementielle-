/**
 * auditpilot-fix.mjs — traite les « demandes de PR de correctif » (audit_fix_requests
 * au statut pending) et ouvre, pour chacune, une PR DRAFT dédiée
 * `auditpilot/fix-<finding>` contenant un échafaudage de migration.
 *
 * À exécuter UNIQUEMENT en CI. Le token GitHub et la service_role Supabase sont
 * des secrets CI, jamais exposés au front. Ce script :
 *   - lit les demandes en attente + le finding associé (service_role, lecture) ;
 *   - crée une branche + un fichier de migration ÉCHAFAUDÉ (commentaires only →
 *     application no-op tant qu'un humain n'a pas écrit le SQL) ;
 *   - ouvre une PR DRAFT (ne peut pas être mergée par accident) ;
 *   - met à jour la demande (pr_opened + url, ou failed + erreur).
 * Aucune donnée de production n'est modifiée. Tolérant aux secrets manquants (no-op).
 */

import { execSync } from 'node:child_process';

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GH_TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY;
const API = process.env.GITHUB_API_URL || 'https://api.github.com';

if (!SB_URL || !SB_KEY || !GH_TOKEN || !REPO) {
  console.log('AuditPilot fix: secrets absents (SUPABASE_URL / SERVICE_ROLE_KEY / GITHUB_TOKEN) — no-op.');
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

async function sb(path, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Supabase ${method} ${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
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
  return { ok: res.ok, status: res.status, json: res.status === 204 ? null : await res.json().catch(() => null) };
}

/** Un timestamp de nom de migration croissant et unique. */
function migrationStamp(i) {
  const base = process.env.GITHUB_RUN_ID || '0';
  return `2026${String(base).slice(-8).padStart(8, '0')}${String(i).padStart(2, '0')}`;
}

const commentBlock = (txt) =>
  String(txt || '(aucun correctif suggéré)')
    .split('\n')
    .map((l) => `-- ${l}`)
    .join('\n');

function scaffold(f) {
  return `-- ═══════════════════════════════════════════════════════════════════════
-- AuditPilot — correctif proposé (ÉCHAFAUDAGE — À COMPLÉTER AVANT MERGE)
-- Anomalie : ${f.title}
-- Type : ${f.finding_type} · Sévérité : ${f.severity}
-- Entité : ${f.affected_entity_type ?? '—'}${f.affected_entity_id ? ` · ${f.affected_entity_id}` : ''}
--
-- Description :
${commentBlock(f.description)}
--
-- Correctif suggéré par l'audit :
${commentBlock(f.suggested_fix)}
--
-- ⚠️ Écris ci-dessous la migration SQL réelle, puis marque la PR « prête »
--    (elle est en draft). Tant que ce fichier ne contient que des commentaires,
--    l'application est un no-op sûr. Ne modifie jamais de données de prod sans
--    contrôle (RG-002 : passe par stock_movements le cas échéant).
-- ═══════════════════════════════════════════════════════════════════════
`;
}

async function processOne(req, base, i) {
  const f = req.audit_findings;
  const shortId = req.finding_id.slice(0, 8);
  const branch = `auditpilot/fix-${shortId}`;

  // Branche déjà présente ? (demande rejouée) → on marque pr_opened best-effort et on saute.
  const exists = await gh(`/repos/${REPO}/git/ref/heads/${branch}`);
  if (exists.ok) {
    console.log(`AuditPilot fix: branche ${branch} déjà présente — skip.`);
    return;
  }

  const stamp = migrationStamp(i);
  const file = `supabase/migrations/${stamp}_auditpilot_fix_${shortId}.sql`;

  sh('git config user.name "AuditPilot"');
  sh('git config user.email "actions@github.com"');
  sh(`git checkout -B ${branch} ${base}`, true);
  execSync(`mkdir -p supabase/migrations`);
  execSync(`cat > "${file}"`, { input: scaffold(f) });
  sh('git add -A');
  sh(`git commit -m "fix(auditpilot): echafaudage correctif — ${f.title.replace(/"/g, "'").slice(0, 60)}"`);
  sh(`git push "https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git" ${branch}:${branch}`, true);

  const bodyPr = {
    title: `fix(auditpilot): correctif proposé — ${f.title.slice(0, 70)}`,
    head: branch,
    base,
    draft: true,
    body: [
      '### 🤖 PR de correctif proposée par AuditPilot',
      '',
      `**Anomalie** : ${f.title}`,
      `**Type** : ${f.finding_type} · **Sévérité** : ${f.severity}`,
      f.affected_entity_type ? `**Entité** : ${f.affected_entity_type}${f.affected_entity_id ? ` · ${f.affected_entity_id}` : ''}` : '',
      '',
      '**Correctif suggéré :**',
      '',
      '> ' + String(f.suggested_fix || '(aucun)').replace(/\n/g, '\n> '),
      '',
      '---',
      `- [ ] Compléter la migration \`${file}\` avec le SQL réel`,
      '- [ ] Marquer la PR « prête » (actuellement **draft**)',
      '- [ ] CI verte + revue humaine avant merge',
      '',
      '> AuditPilot **propose**, il n\'**applique** pas. Aucune donnée de production modifiée tant que la PR n\'est pas complétée, revue et mergée.',
    ].filter((l) => l !== '').join('\n'),
  };

  let pr = await gh(`/repos/${REPO}/pulls`, { method: 'POST', body: bodyPr });
  // Certains dépôts n'autorisent pas les draft PR → retenter sans draft.
  if (!pr.ok && pr.status === 422) {
    pr = await gh(`/repos/${REPO}/pulls`, { method: 'POST', body: { ...bodyPr, draft: false } });
  }

  if (pr.ok && pr.json?.number) {
    await sb(`audit_fix_requests?id=eq.${req.id}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: { status: 'pr_opened', pr_url: pr.json.html_url, pr_number: pr.json.number, branch, processed_at: new Date().toISOString() },
    });
    console.log(`AuditPilot fix: PR #${pr.json.number} ouverte — ${pr.json.html_url}`);
  } else {
    // Échec (souvent : réglage « Allow GitHub Actions to create and approve PRs » désactivé).
    console.error(`AuditPilot fix: ouverture PR impossible (${pr.status}). Suppression de la branche.`);
    await gh(`/repos/${REPO}/git/refs/heads/${branch}`, { method: 'DELETE' });
    await sb(`audit_fix_requests?id=eq.${req.id}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: { status: 'failed', branch, error: `PR ${pr.status} — vérifier « Allow GitHub Actions to create and approve pull requests ».`, processed_at: new Date().toISOString() },
    });
  }
}

async function main() {
  const pending = await sb(
    'audit_fix_requests?status=eq.pending&order=created_at.asc&select=id,finding_id,requested_by,audit_findings(title,description,finding_type,severity,affected_entity_type,affected_entity_id,suggested_fix)',
  );
  if (!pending.length) {
    console.log('AuditPilot fix: aucune demande en attente.');
    return;
  }
  const repo = await gh(`/repos/${REPO}`);
  const base = repo.json?.default_branch;
  console.log(`AuditPilot fix: ${pending.length} demande(s) — base ${base}.`);

  let i = 0;
  for (const req of pending) {
    try {
      await processOne(req, base, i++);
    } catch (e) {
      console.error(`AuditPilot fix: échec demande ${req.id} —`, e.message);
      await sb(`audit_fix_requests?id=eq.${req.id}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: { status: 'failed', error: e.message.slice(0, 500), processed_at: new Date().toISOString() },
      }).catch(() => {});
    }
    // Revenir sur la base pour la demande suivante.
    sh(`git checkout ${base}`, true);
  }
}

main().catch((e) => {
  console.error('AuditPilot fix: échec global (non bloquant) —', e.message);
  process.exit(0);
});
