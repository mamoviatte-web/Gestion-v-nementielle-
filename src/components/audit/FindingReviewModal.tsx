/**
 * FindingReviewModal — écran « Revue & validation de correction » d'une anomalie
 * AuditPilot (ROLE_STADE). L'agent EXPLIQUE (problème + règle), PROPOSE un
 * correctif (suggested_fix), rappelle la liaison dépôt GitHub, puis l'humain
 * DÉCIDE. Toute décision passe par set_audit_finding_status (tracé dans
 * audit_logs, justification obligatoire pour « ignorée »). Aucune écriture en
 * production ici : on ne fait qu'avancer le statut de l'anomalie.
 *
 * Honnêteté : on n'invente pas de PR/CI fictive. La section GitHub renvoie aux
 * vraies PR/Actions du dépôt et rappelle le process réel (correctifs mécaniques
 * proposés en PR par la CI ; correctifs données/migration validés puis appliqués
 * via une PR dédiée — jamais de push direct).
 */

import { useState } from 'react';
import { X, ShieldCheck, GitPullRequest, CheckCircle2, Ban, RotateCcw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';

const REPO = 'mamoviatte-web/Gestion-v-nementielle-';

export interface AuditFinding {
  id: string;
  finding_type: string;
  severity: string;
  title: string;
  description: string | null;
  affected_entity_type: string | null;
  affected_entity_id: string | null;
  suggested_fix: string | null;
  status: string;
}

const SEV = {
  critique: { chip: 'bg-rose-100 text-rose-700', label: '⛔ Critique', risk: 'élevé' },
  moyenne: { chip: 'bg-amber-100 text-amber-700', label: '⚠ Moyenne', risk: 'modéré' },
  faible: { chip: 'bg-stone-100 text-stone-500', label: 'Faible', risk: 'faible' },
} as const;
const sevOf = (s: string) => SEV[s as keyof typeof SEV] ?? SEV.faible;

/** Le correctif ressemble-t-il à du code / SQL (mono) plutôt qu'à une consigne ? */
const looksLikeCode = (s: string) => /;|--|\binsert\b|\bupdate\b|\bselect\b|=>|\bfunction\b|\{|\}/i.test(s);

export function FindingReviewModal({
  finding,
  by,
  onClose,
  onApplied,
}: {
  finding: AuditFinding;
  by: string;
  onClose: () => void;
  onApplied: (status: string) => void;
}) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [ignoring, setIgnoring] = useState(false);
  const [note, setNote] = useState('');
  const [done, setDone] = useState<{ status: string; ignored: boolean; pr?: { already: boolean; url: string | null } } | null>(null);

  const sev = sevOf(finding.severity);

  /** Enregistre une demande de PR de correctif — la CI ouvrira la PR dédiée. */
  async function requestPR() {
    setBusy(true);
    const { data, error } = await supabase.rpc('request_audit_fix', { p_finding: finding.id, p_by: by });
    setBusy(false);
    const res = data as { success?: boolean; error?: string; already?: boolean; pr_url?: string | null; status?: string } | null;
    if (error || !res?.success) {
      showToast(`Échec : ${res?.error ?? error?.message ?? 'erreur'}`, 'warning');
      return;
    }
    const status = res.status ?? 'correction proposée';
    setDone({ status, ignored: false, pr: { already: !!res.already, url: res.pr_url ?? null } });
    onApplied(status);
  }

  async function apply(status: string, justification: string | null = null) {
    if (status === 'ignorée avec justification' && !justification) {
      showToast('Justification requise pour ignorer.', 'warning');
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc('set_audit_finding_status', {
      p_finding: finding.id,
      p_status: status,
      p_by: by,
      p_note: justification,
    });
    setBusy(false);
    const res = data as { success?: boolean; error?: string } | null;
    if (error || !res?.success) {
      showToast(`Échec : ${res?.error ?? error?.message ?? 'erreur'}`, 'warning');
      return;
    }
    setDone({ status, ignored: status === 'ignorée avec justification' });
    onApplied(status);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-6" onClick={onClose}>
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="flex items-center gap-2 border-b border-stone-200 px-5 py-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-pr-olive text-white"><ShieldCheck size={16} /></span>
          <div className="min-w-0">
            <p className="text-sm font-black text-stone-900">AuditPilot — Revue de correction</p>
            <p className="truncate text-[11px] text-stone-400">L'agent explique · propose · tu valides · tracé dans l'audit log</p>
          </div>
          <button onClick={onClose} className="ml-auto rounded-lg p-1.5 text-stone-400 hover:bg-stone-100"><X size={18} /></button>
        </div>

        {done ? (
          <div className="px-6 py-10 text-center">
            <div className={`mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full text-2xl text-white ${done.ignored ? 'bg-stone-400' : 'bg-emerald-500'}`}>
              {done.ignored ? '⌀' : '✓'}
            </div>
            <h3 className="text-lg font-bold text-stone-900">
              {done.ignored ? 'Anomalie ignorée (tracée)' : done.pr ? 'Demande de correctif enregistrée' : 'Statut mis à jour'}
            </h3>
            {done.pr ? (
              <p className="mt-1 text-sm text-stone-500">
                {done.pr.already
                  ? 'Une demande était déjà en cours pour cette anomalie.'
                  : 'Statut passé en '}<b>{!done.pr.already && done.status}</b>. AuditPilot va ouvrir une <b>PR draft</b> dédiée (branche <span className="font-mono text-xs">auditpilot/fix-…</span>) sous quelques minutes.
              </p>
            ) : (
              <p className="mt-1 text-sm text-stone-500">
                L'anomalie « {finding.title} » est désormais au statut <b>{done.status}</b>.
              </p>
            )}
            <p className="mt-1 text-xs text-stone-400">Action tracée dans l'audit log · par {by}.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {done.pr && (
                <a
                  href={done.pr.url ?? `https://github.com/${REPO}/pulls?q=is%3Apr+head%3Aauditpilot`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-semibold text-stone-600 hover:bg-stone-50"
                >
                  <GitPullRequest size={14} /> {done.pr.url ? 'Voir la PR' : 'Voir les PR AuditPilot'}
                </a>
              )}
              <button onClick={onClose} className="rounded-xl bg-pr-black px-5 py-2.5 text-sm font-bold text-white">Fermer</button>
            </div>
          </div>
        ) : (
          <>
            {/* Bandeau anomalie */}
            <div className="border-b border-stone-100 px-5 py-4">
              <div className="mb-2 flex flex-wrap gap-1.5">
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${sev.chip}`}>{sev.label}</span>
                <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-[11px] font-semibold text-stone-500">{finding.finding_type}</span>
                <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-[11px] font-semibold text-stone-500">statut : {finding.status}</span>
              </div>
              <h2 className="text-lg font-black tracking-tight text-stone-900">{finding.title}</h2>
              {finding.affected_entity_type && (
                <p className="text-xs text-stone-400">
                  Entité : {finding.affected_entity_type}{finding.affected_entity_id ? ` · ${finding.affected_entity_id}` : ''}
                </p>
              )}
            </div>

            {/* 1 — Problème */}
            <Step n={1} label="Le problème — expliqué par l'agent">
              <Bubble>
                {finding.description ? <p>{finding.description}</p> : <p className="text-stone-400">Aucun détail fourni par l'audit pour cette anomalie.</p>}
              </Bubble>
              <p className="mt-2 rounded-lg border border-dashed border-stone-200 bg-white px-3 py-2 text-xs text-stone-500">
                Catégorie <code className="rounded bg-stone-100 px-1.5 py-0.5 text-[11px]">{finding.finding_type}</code> ·
                sévérité <code className="rounded bg-stone-100 px-1.5 py-0.5 text-[11px]">{finding.severity}</code>
                {finding.affected_entity_type ? <> · entité <code className="rounded bg-stone-100 px-1.5 py-0.5 text-[11px]">{finding.affected_entity_type}</code></> : null}
              </p>
            </Step>

            {/* 2 — Correction proposée */}
            <Step n={2} label="Correction proposée">
              {finding.suggested_fix ? (
                looksLikeCode(finding.suggested_fix) ? (
                  <pre className="overflow-auto rounded-xl bg-stone-900 px-3 py-3 text-[12.5px] leading-relaxed text-stone-100">{finding.suggested_fix}</pre>
                ) : (
                  <Bubble tone="good"><p>{finding.suggested_fix}</p></Bubble>
                )
              ) : (
                <Bubble><p className="text-stone-400">Aucun correctif automatique proposé — décision manuelle requise.</p></Bubble>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Imp k="Type" v={finding.finding_type} />
                <Imp k="Sévérité" v={sev.label.replace(/^[^ ]+ /, '')} />
                <Imp k="Entité" v={finding.affected_entity_type ?? '—'} />
                <Imp k="Risque" v={sev.risk} />
              </div>
            </Step>

            {/* 3 — Liaison GitHub (réelle, pas de PR fictive) */}
            <Step n={3} label="Liaison dépôt GitHub">
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-stone-600">
                  🌿 Convention de branche
                  <span className="rounded-md bg-stone-100 px-2 py-0.5 font-mono text-xs text-stone-500">auditpilot/fix-{finding.id.slice(0, 8)}</span>
                </div>
                <div className="rounded-xl border border-stone-200">
                  <div className="border-b border-stone-100 bg-stone-50 px-3 py-2 text-xs font-bold text-stone-500">✓ Garde-fous CI (avant tout merge)</div>
                  {['Lint & type-check', 'Tests de calcul stock (prix figés, conso)', 'Build & migrations', 'AuditPilot revérifie l’anomalie après patch'].map((c) => (
                    <div key={c} className="flex items-center gap-2 border-t border-stone-100 px-3 py-1.5 text-[13px] text-stone-600">
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-stone-300 text-[10px] text-white">•</span>{c}
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <a href={`https://github.com/${REPO}/pulls?q=is%3Apr+head%3Aauditpilot`} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-600 hover:bg-stone-50">
                    <GitPullRequest size={13} /> Voir les PR AuditPilot
                  </a>
                  <a href={`https://github.com/${REPO}/actions`} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-600 hover:bg-stone-50">
                    ⚙ Contrôles CI
                  </a>
                </div>
                <p className="text-[11px] leading-relaxed text-stone-400">
                  Application via <b>PR + CI verte</b> ou <b>validation humaine</b> — jamais de push direct. Les correctifs de code mécaniques
                  (lint/dépendances) sont proposés automatiquement en PR ; les correctifs de données/migration sont préparés puis validés ici.
                </p>
              </div>
            </Step>

            {/* 4 — Décision */}
            <div className="border-t border-stone-100 bg-stone-50 px-5 py-4">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-stone-400">4 · Décision (tracée)</p>
              {ignoring ? (
                <div>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Justification obligatoire pour ignorer cette anomalie (tracée dans l'audit log)…"
                    className="min-h-[64px] w-full rounded-xl border border-stone-200 p-2.5 text-sm"
                  />
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => setIgnoring(false)} className="rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-stone-600">Annuler</button>
                    <button
                      disabled={busy || !note.trim()}
                      onClick={() => void apply('ignorée avec justification', note.trim())}
                      className="rounded-xl bg-pr-black px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
                    >
                      Confirmer « ignorée avec justification »
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button disabled={busy} onClick={() => void requestPR()} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40 sm:flex-none" style={{ background: '#1c5cab' }}>
                    <GitPullRequest size={15} /> Créer la PR de correctif
                  </button>
                  <button disabled={busy} onClick={() => void apply('corrigée')} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-pr-olive px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">
                    <CheckCircle2 size={15} /> Marquer corrigée
                  </button>
                  <button disabled={busy} onClick={() => void apply('en analyse')} className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 disabled:opacity-40">
                    En analyse
                  </button>
                  <button disabled={busy} onClick={() => setIgnoring(true)} className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-semibold text-stone-500 disabled:opacity-40">
                    <Ban size={14} /> Ignorer…
                  </button>
                  {finding.status !== 'ouverte' && (
                    <button disabled={busy} onClick={() => void apply('ouverte')} className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-600 disabled:opacity-40">
                      <RotateCcw size={14} /> Rouvrir
                    </button>
                  )}
                </div>
              )}
              <p className="mt-2 text-[11px] text-stone-400">
                Aucune écriture en production sans <b>ta validation</b> ou une <b>CI verte</b>. Chaque action est tracée dans l'audit log.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Step({ n, label, children }: { n: number; label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-stone-100 px-5 py-4">
      <p className="mb-2.5 flex items-center gap-2 text-[11px] font-black uppercase tracking-wide text-stone-400">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-pr-olive text-[11px] text-white">{n}</span>
        {label}
      </p>
      <div className="flex gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-pr-olive/10 text-xs font-black text-pr-olive">IA</span>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

function Bubble({ children, tone }: { children: React.ReactNode; tone?: 'good' }) {
  return (
    <div className={`rounded-xl rounded-tl-sm border px-3 py-2.5 text-sm leading-relaxed ${tone === 'good' ? 'border-emerald-100 bg-emerald-50 text-emerald-900' : 'border-stone-200 bg-stone-50 text-stone-700'}`}>
      {children}
    </div>
  );
}

function Imp({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-2">
      <p className="text-[11px] font-semibold text-stone-400">{k}</p>
      <p className="mt-0.5 text-sm font-bold text-stone-800">{v}</p>
    </div>
  );
}
