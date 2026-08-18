/**
 * AuditPilotPage — module AuditPilot MD (ROLE_STADE). Restitue le dernier audit
 * automatique (cohérence code/stock/runner/produits/rapports), lecture seule :
 * l'audit n'écrit QUE dans audit_runs/audit_findings, jamais dans les données de
 * prod. En-tête via audit_latest_run ; anomalies via audit_findings ; workflow de
 * statut via set_audit_finding_status (tracé dans audit_logs, justification
 * obligatoire pour « ignorée »). « Relancer » = run_business_audit (contrôles
 * métier/stock/données). Export PDF du rapport.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, AlertTriangle, RefreshCw, Download, GitPullRequest, ChevronDown, ChevronRight, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Button, Spinner, EmptyState } from '@/components/ui';
import { loadModule } from '@/lib/lazyModule';
import { FindingReviewModal } from '@/components/audit/FindingReviewModal';

interface AuditRun {
  id: string; started_at: string; finished_at: string | null; status: string;
  global_score: number; critical_count: number; warning_count: number; info_count: number;
  report_url: string | null; created_by: string;
}
interface Finding {
  id: string; audit_run_id: string; finding_type: string; severity: string;
  title: string; description: string | null; affected_entity_type: string | null;
  affected_entity_id: string | null; suggested_fix: string | null; status: string;
  created_at: string; resolved_at: string | null;
}

const SEV_ORDER: Record<string, number> = { critique: 0, moyenne: 1, faible: 2 };
const SEV_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  critique: { bg: 'bg-rose-100', text: 'text-rose-700', label: 'Critique' },
  moyenne: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Moyenne' },
  faible: { bg: 'bg-stone-100', text: 'text-stone-500', label: 'Faible' },
};
const TYPES = ['métier', 'stock', 'code', 'sécurité', 'données'] as const;
const STATUSES = ['ouverte', 'en analyse', 'correction proposée', 'corrigée', 'ignorée avec justification'] as const;
const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const scoreColor = (s: number) => (s >= 90 ? '#059669' : s >= 70 ? '#B45309' : '#DC2626');

export default function AuditPilotPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const by = user?.name ?? user?.email ?? 'Stade';
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [fType, setFType] = useState<string>('');
  const [fSev, setFSev] = useState<string>('');
  const [fStatus, setFStatus] = useState<string>('');
  const [open, setOpen] = useState<string | null>(null);
  const [review, setReview] = useState<Finding | null>(null);

  const runQ = useQuery({
    queryKey: ['auditLatestRun'],
    queryFn: async (): Promise<AuditRun | null> => {
      const { data } = await supabase.from('audit_latest_run').select('*').maybeSingle();
      return (data as AuditRun | null) ?? null;
    },
  });
  const run = runQ.data;

  const findingsQ = useQuery({
    queryKey: ['auditFindings', run?.id],
    enabled: !!run?.id,
    queryFn: async (): Promise<Finding[]> => {
      const { data } = await supabase.from('audit_findings').select('*').eq('audit_run_id', run!.id);
      return ((data as Finding[] | null) ?? []).sort(
        (a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9) || a.finding_type.localeCompare(b.finding_type),
      );
    },
  });
  const findings = findingsQ.data ?? [];

  const filtered = useMemo(
    () => findings.filter((f) => (!fType || f.finding_type === fType) && (!fSev || f.severity === fSev) && (!fStatus || f.status === fStatus)),
    [findings, fType, fSev, fStatus],
  );
  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of findings) m.set(f.finding_type, (m.get(f.finding_type) ?? 0) + 1);
    return m;
  }, [findings]);

  async function relaunch() {
    setRunning(true);
    const { data, error } = await supabase.rpc('run_business_audit', { p_by: by });
    setRunning(false);
    if (error || (data as { success?: boolean } | null)?.success === false) {
      showToast(`Échec de l'audit : ${error?.message ?? 'erreur'}`, 'warning');
      return;
    }
    showToast('Audit relancé.', 'success');
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['auditLatestRun'] }),
      queryClient.invalidateQueries({ queryKey: ['auditFindings'] }),
    ]);
  }

  async function changeStatus(f: Finding, status: string) {
    let note: string | null = null;
    if (status === 'ignorée avec justification') {
      note = window.prompt('Justification obligatoire pour ignorer cette anomalie :')?.trim() || null;
      if (!note) { showToast('Justification requise.', 'warning'); return; }
    }
    const { data, error } = await supabase.rpc('set_audit_finding_status', { p_finding: f.id, p_status: status, p_by: by, p_note: note });
    const res = data as { success?: boolean; error?: string } | null;
    if (error || !res?.success) { showToast(`Échec : ${res?.error ?? error?.message ?? 'erreur'}`, 'warning'); return; }
    showToast('Statut mis à jour.', 'success');
    await queryClient.invalidateQueries({ queryKey: ['auditFindings', run?.id] });
  }

  async function exportPdf() {
    if (!run) return;
    setExporting(true);
    try {
      const rows = filtered.map((f) => `<tr>
        <td style="padding:4px 6px;border:1px solid #ddd">${SEV_STYLE[f.severity]?.label ?? f.severity}</td>
        <td style="padding:4px 6px;border:1px solid #ddd">${f.finding_type}</td>
        <td style="padding:4px 6px;border:1px solid #ddd">${f.title}</td>
        <td style="padding:4px 6px;border:1px solid #ddd">${f.affected_entity_type ?? '—'}</td>
        <td style="padding:4px 6px;border:1px solid #ddd">${f.status}</td>
        <td style="padding:4px 6px;border:1px solid #ddd">${(f.suggested_fix ?? '').slice(0, 200)}</td></tr>`).join('');
      const html = `<div style="font-family:Arial,sans-serif;padding:4px">
        <h2 style="margin:0 0 2px;color:#0B1F3A">Rapport AuditPilot — ${fmt(run.finished_at)}</h2>
        <p style="margin:0 0 8px;font-size:12px;color:#6b7280">Score ${run.global_score}/100 · ${run.critical_count} critique(s) · ${run.warning_count} moyenne(s) · ${run.info_count} faible(s) · ${filtered.length} anomalie(s) affichée(s)</p>
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead><tr style="background:#0B1F3A;color:#fff">
            <th style="padding:5px 6px;text-align:left">Sévérité</th><th style="padding:5px 6px;text-align:left">Type</th>
            <th style="padding:5px 6px;text-align:left">Anomalie</th><th style="padding:5px 6px;text-align:left">Entité</th>
            <th style="padding:5px 6px;text-align:left">Statut</th><th style="padding:5px 6px;text-align:left">Correctif proposé</th>
          </tr></thead><tbody>${rows}</tbody></table></div>`;
      const holder = document.createElement('div');
      holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:277mm';
      holder.innerHTML = html;
      document.body.appendChild(holder);
      const html2pdf = (await loadModule(() => import('html2pdf.js'), (m) => showToast(m, 'success'))).default;
      await html2pdf().set({
        margin: [10, 8, 10, 8], filename: `AuditPilot_${new Date(run.finished_at ?? Date.now()).toISOString().slice(0, 10)}.pdf`,
        image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
      }).from(holder.firstElementChild as HTMLElement).save();
      holder.remove();
      showToast('Rapport exporté.', 'success');
    } catch (e) {
      showToast('Échec de l’export : ' + (e instanceof Error ? e.message : String(e)), 'warning');
    } finally {
      setExporting(false);
    }
  }

  if (runQ.isLoading) return <div className="p-6"><Spinner label="Chargement de l'audit…" /></div>;
  if (!run) {
    return (
      <div className="mx-auto max-w-5xl p-4 sm:p-6">
        <h1 className="mb-4 flex items-center gap-2 text-xl font-black text-stone-900"><ShieldCheck className="text-pr-olive" /> AuditPilot</h1>
        <EmptyState icon={Activity} title="Aucun audit disponible" message="Lancez le premier audit métier/stock/données." action={<Button loading={running} onClick={() => void relaunch()}>Lancer l'audit</Button>} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-black text-stone-900"><ShieldCheck className="text-pr-olive" /> AuditPilot</h1>
          <p className="mt-1 text-sm text-stone-500">Audit quotidien automatique — lecture seule, aucune modification des données de production. Dernier audit : {fmt(run.finished_at)} · {run.created_by}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" loading={running} onClick={() => void relaunch()}><RefreshCw size={14} /> Relancer l'audit</Button>
          <Button size="sm" variant="secondary" loading={exporting} onClick={() => void exportPdf()}><Download size={14} /> Exporter le rapport</Button>
          <a href="https://github.com/mamoviatte-web/Gestion-v-nementielle-/actions" target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50" title="Les correctifs passent par une PR CI, jamais un push direct">
            <GitPullRequest size={14} /> Patch proposé (PR CI)
          </a>
        </div>
      </div>

      {/* En-tête score */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="col-span-2 flex items-center gap-4 rounded-2xl border border-stone-100 bg-white p-4 sm:col-span-1">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-white" style={{ background: scoreColor(run.global_score) }}>
            <span className="text-xl font-black">{run.global_score}</span>
          </div>
          <div><p className="text-xs uppercase tracking-wide text-stone-400">Score global</p><p className="text-sm font-semibold text-stone-700">/ 100</p></div>
        </div>
        <StatChip label="Critiques" value={run.critical_count} tone="critique" />
        <StatChip label="Moyennes" value={run.warning_count} tone="moyenne" />
        <StatChip label="Faibles" value={run.info_count} tone="faible" />
      </div>

      {run.critical_count > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
          <AlertTriangle size={16} /> {run.critical_count} anomalie(s) critique(s) bloquent la clôture — à traiter en priorité.
        </div>
      )}

      {/* Filtres */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FilterChip active={!fType} onClick={() => setFType('')}>Tous types</FilterChip>
        {TYPES.map((t) => <FilterChip key={t} active={fType === t} onClick={() => setFType(fType === t ? '' : t)}>{t}{typeCounts.get(t) ? ` · ${typeCounts.get(t)}` : ''}</FilterChip>)}
        <span className="mx-1 h-4 w-px bg-stone-200" />
        {(['critique', 'moyenne', 'faible'] as const).map((s) => <FilterChip key={s} active={fSev === s} onClick={() => setFSev(fSev === s ? '' : s)}>{SEV_STYLE[s].label}</FilterChip>)}
        <span className="mx-1 h-4 w-px bg-stone-200" />
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="rounded-full border border-stone-200 px-3 py-1 text-xs text-stone-600">
          <option value="">Tous statuts</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Liste */}
      {findingsQ.isLoading ? <Spinner /> : filtered.length === 0 ? (
        <EmptyState icon={Activity} title="Aucune anomalie" message="Aucune anomalie ne correspond aux filtres." />
      ) : (
        <div className="space-y-2">
          {filtered.map((f) => {
            const sev = SEV_STYLE[f.severity] ?? SEV_STYLE.faible;
            const isOpen = open === f.id;
            return (
              <div key={f.id} className="overflow-hidden rounded-xl border border-stone-100 bg-white">
                <button onClick={() => setOpen(isOpen ? null : f.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-stone-50">
                  <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${sev.bg} ${sev.text}`}>{sev.label}</span>
                  <span className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[10px] font-semibold text-stone-500">{f.finding_type}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-stone-800">{f.title}</span>
                  <span className="shrink-0 text-[11px] text-stone-400">{f.status}</span>
                  {isOpen ? <ChevronDown size={16} className="text-stone-400" /> : <ChevronRight size={16} className="text-stone-400" />}
                </button>
                {isOpen && (
                  <div className="space-y-3 border-t border-stone-100 px-4 py-3 text-sm">
                    {f.description && <p className="text-stone-600">{f.description}</p>}
                    {f.affected_entity_type && <p className="text-xs text-stone-400">Entité : {f.affected_entity_type}{f.affected_entity_id ? ` · ${f.affected_entity_id}` : ''}</p>}
                    {f.suggested_fix && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><b>Correctif proposé :</b> {f.suggested_fix}</p>}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => setReview(f)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-pr-olive px-3 py-1.5 text-xs font-bold text-white hover:opacity-90"
                      >
                        <ShieldCheck size={13} /> Revoir &amp; valider
                      </button>
                      <span className="mx-1 h-4 w-px bg-stone-200" />
                      <span className="text-xs text-stone-400">Statut rapide :</span>
                      <select value={f.status} onChange={(e) => void changeStatus(f, e.target.value)} className="rounded-lg border border-stone-200 px-2 py-1 text-xs">
                        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {review && (
        <FindingReviewModal
          finding={review}
          by={by}
          onClose={() => setReview(null)}
          onApplied={() => void queryClient.invalidateQueries({ queryKey: ['auditFindings', run?.id] })}
        />
      )}
    </div>
  );
}

function StatChip({ label, value, tone }: { label: string; value: number; tone: 'critique' | 'moyenne' | 'faible' }) {
  const st = SEV_STYLE[tone];
  return (
    <div className="rounded-2xl border border-stone-100 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-stone-400">{label}</p>
      <p className={`mt-1 text-2xl font-black ${value > 0 ? st.text : 'text-stone-300'}`}>{value}</p>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${active ? 'bg-pr-black text-white ring-pr-black' : 'bg-white text-stone-500 ring-stone-200'}`}>{children}</button>
  );
}
