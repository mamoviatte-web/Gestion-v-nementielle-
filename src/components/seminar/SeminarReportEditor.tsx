/**
 * SeminarReportEditor — édition inline du rapport séminaire (ROLE_STADE).
 * Visible uniquement pour les séminaires (isSeminaire). Sauvegarde auto (2 s),
 * aperçu paginé, export PDF.
 */

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Download, Eye, Loader2, Trash2, Upload, X } from 'lucide-react';
import { Alert, Badge, Button, Spinner } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { formatEuro } from '@/lib/calculations';
import { isSeminaire } from '@/lib/eventUtils';
import { useToast } from '@/context/ToastContext';
import {
  useSeminarReportDraft,
  type ReportBullet,
  type ReportPhoto,
  type SeminarReportDraft,
} from '@/hooks/useSeminarReportDraft';
import { exportSeminarReportPDF } from '@/lib/seminarReportPdf';
import { FullPnL } from '@/components/seminar/FullPnL';
import { ExternalChargesManager } from '@/components/seminar/ExternalChargesManager';
import { PhotoChecklist } from '@/components/debrief/PhotoChecklist';
import { PhotoGallery } from '@/components/debrief/PhotoGallery';
import { PdfPhotoSummary } from '@/components/debrief/PdfPhotoSummary';
import { LogoUploader } from '@/components/seminar/LogoUploader';
import { renderScoreCircles, formatScoreText } from '@/lib/scoreRenderer';
import type { Event } from '@/lib/types';

/* ─────────────── Champ éditable inline ─────────────── */

function InlineEditable({
  value,
  onSave,
  placeholder = 'Cliquer pour saisir…',
  multiline = false,
  type = 'text',
}: {
  value: string | number | null | undefined;
  onSave: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  type?: 'text' | 'number';
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value == null ? '' : String(value));

  if (editing) {
    const commit = () => {
      onSave(local);
      setEditing(false);
    };
    return (
      <span className="inline-flex items-start gap-1">
        {multiline ? (
          <textarea
            autoFocus
            rows={2}
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            className="min-w-[16rem] rounded border border-pr-olive px-2 py-1 text-sm"
          />
        ) : (
          <input
            autoFocus
            type={type}
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
            className="rounded border border-pr-olive px-2 py-1 text-sm"
          />
        )}
        <button onClick={commit} className="text-xs font-semibold text-pr-olive-dark">✓</button>
        <button onClick={() => { setLocal(value == null ? '' : String(value)); setEditing(false); }} className="text-xs text-pr-black-soft/40">✗</button>
      </span>
    );
  }
  return (
    <button className="group rounded px-1 text-left hover:bg-pr-cream" onClick={() => setEditing(true)}>
      {value !== null && value !== undefined && value !== '' ? (
        <span className="text-pr-black">{String(value)}</span>
      ) : (
        <span className="italic text-pr-black-soft/30">{placeholder}</span>
      )}
      <span className="ml-1 text-xs text-pr-black-soft/30 opacity-0 group-hover:opacity-100">✏️</span>
    </button>
  );
}

/* ─────────────── Étoiles cliquables ─────────────── */

function ScoreEditor({ label, value, onChange }: { label: string; value: number | null; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-pr-black-soft/70">{label}</span>
      <span className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            aria-label={`${label} ${n}/5`}
            className="h-3.5 w-3.5 rounded-full transition-colors"
            style={{ backgroundColor: n <= (value ?? 0) ? '#C9A646' : '#E8E4DA' }}
          />
        ))}
      </span>
      <span className="text-xs text-pr-black-soft/50">({value ?? 0}/5)</span>
    </div>
  );
}

/* ─────────────── Carte section ─────────────── */

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-pr-stone bg-white">
      <div className="flex items-center justify-between border-b border-pr-stone px-4 py-2.5">
        <span className="text-sm font-semibold text-pr-black">{title}</span>
        {hint && <span className="text-xs text-pr-black-soft/50">{hint}</span>}
      </div>
      <div className="space-y-2.5 p-4 text-sm">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="w-40 shrink-0 text-pr-black-soft/60">{label}</span>
      {children}
    </div>
  );
}

/* ─────────────── Photos ─────────────── */

type Field = 'setup_photo_urls' | 'fb_photo_urls';

function PhotosSection({
  title,
  field,
  photos,
  onChange,
  uploadPhoto,
}: {
  title: string;
  field: Field;
  photos: ReportPhoto[];
  onChange: (field: Field, next: ReportPhoto[]) => void;
  uploadPhoto: (f: File) => Promise<string>;
}) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      const added: ReportPhoto[] = [];
      let order = photos.length;
      for (const f of Array.from(files)) {
        const url = await uploadPhoto(f);
        added.push({ url, caption: '', order: order++ });
      }
      onChange(field, [...photos, ...added]);
    } catch {
      showToast("Échec de l'upload d'une photo.", 'warning');
    } finally {
      setBusy(false);
    }
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= photos.length) return;
    const next = [...photos];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(field, next.map((p, idx) => ({ ...p, order: idx })));
  }

  return (
    <Card title={title} hint={`${photos.length} photo(s)`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {photos.map((p, i) => (
          <div key={`${p.url}-${i}`} className="overflow-hidden rounded-lg border border-pr-stone">
            <img src={p.url} alt={p.caption ?? ''} className="h-24 w-full object-cover" />
            <div className="space-y-1 p-2">
              <InlineEditable
                value={p.caption}
                placeholder="Légende…"
                onSave={(v) => onChange(field, photos.map((x, idx) => (idx === i ? { ...x, caption: v } : x)))}
              />
              <div className="flex items-center justify-between">
                <div className="flex gap-1">
                  <button onClick={() => move(i, -1)} className="text-pr-black-soft/40 hover:text-pr-black" aria-label="Monter">
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button onClick={() => move(i, 1)} className="text-pr-black-soft/40 hover:text-pr-black" aria-label="Descendre">
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
                <button
                  onClick={() => onChange(field, photos.filter((_, idx) => idx !== i).map((x, idx) => ({ ...x, order: idx })))}
                  className="text-pr-black-soft/40 hover:text-pr-rust"
                  aria-label="Supprimer"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
        <label className="flex h-full min-h-[7rem] cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-pr-stone text-xs text-pr-black-soft/50 hover:border-pr-olive">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
          Ajouter
          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => void handleFiles(e.target.files)} />
        </label>
      </div>
    </Card>
  );
}

/* ─────────────── Débrief ─────────────── */

function DebriefSection({ draft, update }: { draft: SeminarReportDraft; update: (p: Partial<SeminarReportDraft>) => void }) {
  const bullets = draft.debrief_bullets ?? [];
  const setBullets = (next: ReportBullet[]) => update({ debrief_bullets: next });

  return (
    <Card title="Débrief interne" hint="Auto-rempli depuis les débriefs soumis">
      <div className="space-y-2">
        {bullets.map((b, i) => (
          <div key={i} className="flex items-start gap-2">
            <button
              onClick={() => setBullets(bullets.map((x, idx) => (idx === i ? { ...x, is_issue: !x.is_issue, is_positive: x.is_issue } : x)))}
              className={`mt-0.5 text-xs ${b.is_issue ? 'text-pr-rust' : 'text-pr-olive-dark'}`}
              title={b.is_issue ? "Point d'attention" : 'Point positif'}
            >
              {b.is_issue ? '▸' : '•'}
            </button>
            <div className="flex-1">
              <InlineEditable
                value={b.text}
                multiline
                placeholder="Saisir un point clé…"
                onSave={(v) => setBullets(bullets.map((x, idx) => (idx === i ? { ...x, text: v } : x)))}
              />
            </div>
            <button onClick={() => setBullets(bullets.filter((_, idx) => idx !== i))} className="mt-0.5 text-pr-black-soft/30 hover:text-pr-rust">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button
          onClick={() => setBullets([...bullets, { text: '', is_issue: true, is_positive: false }])}
          className="text-sm font-medium text-pr-olive-dark"
        >
          + Ajouter un point
        </button>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 border-t border-pr-stone pt-3 sm:grid-cols-2">
        <ScoreEditor label="Ménage" value={draft.cleaning_score} onChange={(n) => update({ cleaning_score: n })} />
        <ScoreEditor label="Technique" value={draft.technical_score} onChange={(n) => update({ technical_score: n })} />
      </div>
    </Card>
  );
}

/* ─────────────── Aperçu paginé ─────────────── */

function PreviewModal({ draft, onClose }: { draft: SeminarReportDraft; onClose: () => void }) {
  const pages = useMemo(() => {
    const p: { title: string; render: React.ReactNode }[] = [];
    p.push({
      title: 'Couverture',
      render: (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
          <h1 className="font-display text-3xl font-black text-pr-black">{draft.report_title}</h1>
          <div className="h-1 w-24 bg-pr-gold" />
          {draft.client_logo_url && <img src={draft.client_logo_url} alt="" className="max-h-32" />}
          <p className="text-pr-olive-dark">{draft.report_date}</p>
        </div>
      ),
    });
    p.push({
      title: 'Coûts',
      render: (
        <div className="space-y-1.5 text-sm">
          <p>Pax : {draft.pax ?? '—'} · Resp. commercial : {draft.responsable_commercial ?? '—'} · Régisseur : {draft.regisseur_name ?? '—'}</p>
          {([
            ['CA HT', draft.ca_ht],
            ['Coût F&B HT', draft.total_fb_cost_ht],
            ['Charges régisseur', draft.total_rh_cost],
            ['Coût total HT', draft.total_cost_ht],
            ['Gain net HT', draft.gain_net_ht],
          ] as [string, number | null][]).map(([l, v]) => (
            <div key={l} className="flex justify-between border-b border-pr-stone/60 py-1">
              <span>{l}</span>
              <span className="font-medium">{formatEuro(v ?? 0)}</span>
            </div>
          ))}
        </div>
      ),
    });
    if ((draft.setup_photo_urls ?? []).length) p.push({ title: 'Mise en place', render: <PhotoWall photos={draft.setup_photo_urls} /> });
    if ((draft.fb_photo_urls ?? []).length) p.push({ title: 'Photos F&B', render: <PhotoWall photos={draft.fb_photo_urls} /> });
    p.push({
      title: 'Débrief',
      render: (
        <div className="space-y-1.5 text-sm">
          {(draft.debrief_bullets ?? []).map((b, i) => (
            <p key={i} className={b.is_issue ? 'text-pr-rust' : ''}>{b.is_issue ? '▸' : '•'} {b.text}</p>
          ))}
          <div className="flex flex-wrap gap-6 pt-2 text-pr-olive-dark">
            <span className="inline-flex items-center gap-1">
              Ménage <span dangerouslySetInnerHTML={{ __html: renderScoreCircles(draft.cleaning_score) }} /> ({formatScoreText(draft.cleaning_score)})
            </span>
            <span className="inline-flex items-center gap-1">
              Technique <span dangerouslySetInnerHTML={{ __html: renderScoreCircles(draft.technical_score) }} /> ({formatScoreText(draft.technical_score)})
            </span>
          </div>
        </div>
      ),
    });
    if (draft.cadre_score || draft.nps_experience != null) {
      p.push({
        title: 'Satisfaction client',
        render: (
          <div className="space-y-1 text-sm">
            <p>Répondu par : {draft.survey_respondent ?? '—'}</p>
            <p>Cadre {draft.cadre_score ?? '—'} · Propreté {draft.proprete_score ?? '—'} · Traiteur {draft.traiteur_score ?? '—'}</p>
            <p className="text-pr-olive-dark">Expérience {draft.nps_experience ?? '—'}/10 · Reco {draft.nps_recommandation ?? '—'}/10</p>
            {draft.survey_commentaire && <p className="italic">« {draft.survey_commentaire} »</p>}
          </div>
        ),
      });
    }
    return p;
  }, [draft]);

  const [page, setPage] = useState(0);
  const cur = pages[Math.min(page, pages.length - 1)];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="flex h-[88vh] w-[90vw] max-w-4xl flex-col">
        <div className="flex items-center gap-4 rounded-t-xl bg-pr-black px-4 py-2.5 text-pr-white">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))}>←</button>
          <span className="text-sm">{page + 1} / {pages.length} · {cur.title}</span>
          <button onClick={() => setPage((p) => Math.min(pages.length - 1, p + 1))}>→</button>
          <button onClick={onClose} className="ml-auto"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-auto rounded-b-xl bg-pr-cream p-8">
          <div className="mx-auto h-full max-w-3xl rounded-lg bg-white p-8 shadow">{cur.render}</div>
        </div>
      </div>
    </div>
  );
}

function PhotoWall({ photos }: { photos: ReportPhoto[] }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {photos.map((p, i) => (
        <figure key={i}>
          <img src={p.url} alt={p.caption ?? ''} className="h-28 w-full rounded object-cover" />
          {p.caption && <figcaption className="mt-1 text-xs text-pr-black-soft/60">{p.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
}

/* ─────────────── Composant principal ─────────────── */

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning'> = {
  brouillon: 'neutral',
  en_revision: 'warning',
  validé: 'info',
  exporté: 'success',
};

export function SeminarReportEditor({ event }: { event: Event }) {
  if (!isSeminaire(event.event_type)) return null; // garde stricte : jamais un match
  return <SeminarReportEditorInner event={event} />;
}

function SeminarReportEditorInner({ event }: { event: Event }) {
  const { draft, updateDraft, flush, uploadPhoto, setStatus, loading, saving, savedAt, provisioned, externalCostHt, recomputeCosts } =
    useSeminarReportDraft(event);
  const reportRegisseur = draft.regisseur_name || draft.responsable_commercial || 'Régisseur';
  const { showToast } = useToast();
  const [preview, setPreview] = useState(false);
  const [exporting, setExporting] = useState(false);

  if (loading) return <Spinner label="Chargement du rapport…" />;

  async function handleExport() {
    // Avertissement non bloquant si des photos terrain manquent.
    const { data: photoRows } = await supabase
      .from('debrief_photos')
      .select('photo_type')
      .eq('event_id', event.event_id);
    const types = new Set((photoRows ?? []).map((p) => (p as { photo_type: string }).photo_type));
    const warnings: string[] = [];
    if (!types.has('mise_en_place')) warnings.push('Aucune photo de mise en place');
    if (!types.has('fb')) warnings.push('Aucune photo F&B');
    if (warnings.length > 0 && !confirm(`⚠️ Rapport photo incomplet :\n\n• ${warnings.join('\n• ')}\n\nGénérer le PDF quand même ?`)) {
      return;
    }
    setExporting(true);
    try {
      await flush();
      const { data: charges } = await supabase
        .from('event_external_charges')
        .select('provider_name, charge_type, amount_ht')
        .eq('event_id', event.event_id)
        .order('charge_type');
      await exportSeminarReportPDF(draft, (charges ?? []) as { provider_name: string; charge_type: string; amount_ht: number }[]);
      await setStatus('exporté');
      showToast('PDF exporté.', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Échec de l'export.", 'warning');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-5">
      {!provisioned && (
        <Alert variant="warning" title="Persistance non activée">
          La table <code>seminar_report_draft</code> n'est pas encore provisionnée. L'aperçu et l'export PDF
          fonctionnent, mais les modifications ne sont pas sauvegardées tant que la migration
          <code> supabase/seminar_report.sql</code> n'est pas appliquée.
        </Alert>
      )}

      {/* Barre de statut + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Badge tone={STATUS_TONE[draft.draft_status] ?? 'neutral'}>{draft.draft_status}</Badge>
          <span className="text-xs text-pr-black-soft/50">
            {saving ? 'Sauvegarde…' : savedAt ? `Enregistré ${new Date(savedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : provisioned ? 'Auto-généré à la clôture' : 'Mode aperçu'}
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setPreview(true)}>
            <Eye className="h-4 w-4" /> Aperçu
          </Button>
          <Button loading={exporting} onClick={handleExport}>
            <Download className="h-4 w-4" /> Exporter PDF
          </Button>
        </div>
      </div>

      {/* Couverture */}
      <Card title="Couverture">
        <Row label="Titre du rapport">
          <InlineEditable value={draft.report_title} onSave={(v) => updateDraft({ report_title: v })} />
        </Row>
        <Row label="Logo client">
          <LogoUploader eventId={event.event_id} value={draft.client_logo_url} onChange={(url) => updateDraft({ client_logo_url: url })} />
        </Row>
      </Card>

      {/* Commercial */}
      <Card title="Données commerciales">
        <Row label="Client"><InlineEditable value={draft.client_name} onSave={(v) => updateDraft({ client_name: v })} /></Row>
        <Row label="PAX"><InlineEditable type="number" value={draft.pax} onSave={(v) => updateDraft({ pax: v ? Number(v) : null })} /></Row>
        <Row label="Responsable comm."><InlineEditable value={draft.responsable_commercial} onSave={(v) => updateDraft({ responsable_commercial: v })} /></Row>
        <Row label="CA HT (€)">
          <InlineEditable type="number" value={draft.ca_ht} onSave={(v) => updateDraft({ ca_ht: Number(v) || 0 })} />
          {(!draft.ca_ht || Number(draft.ca_ht) === 0) && (
            <span className="text-xs text-pr-olive-dark">— {draft.ca_note || draft.ca_type || 'partenariat'}</span>
          )}
        </Row>
        <Row label="Type CA">
          <select
            value={draft.ca_type ?? 'payant'}
            onChange={(e) => updateDraft({ ca_type: e.target.value })}
            className="rounded border border-pr-stone px-2 py-1 text-sm"
          >
            {['payant', 'partenariat', 'gracieux', 'interne'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Row>
        <Row label="Note CA"><InlineEditable value={draft.ca_note} placeholder="ex : compris dans partenariat" onSave={(v) => updateDraft({ ca_note: v })} /></Row>
        <Row label="Traiteur"><InlineEditable value={draft.traiteur_company} onSave={(v) => updateDraft({ traiteur_company: v })} /></Row>
        <Row label="Régisseur"><InlineEditable value={draft.regisseur_name} onSave={(v) => updateDraft({ regisseur_name: v })} /></Row>
        <Row label="Config. espace">
          <select
            value={draft.setup_type ?? ''}
            onChange={(e) => updateDraft({ setup_type: e.target.value || null })}
            className="rounded border border-pr-stone px-2 py-1 text-sm"
          >
            <option value="">—</option>
            {['théâtre', 'cocktail', 'banquet', 'u_shape', 'mixte'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Row>
        <div className="mt-2 grid grid-cols-2 gap-2 border-t border-pr-stone pt-2 text-xs sm:grid-cols-4">
          <Kpi label="Coût F&B" value={formatEuro(draft.total_fb_cost_ht ?? 0)} />
          <Kpi label="Charges RH" value={formatEuro(draft.total_rh_cost ?? 0)} />
          <Kpi label="Charges externes" value={formatEuro(externalCostHt ?? 0)} />
          <Kpi label="Gain net" value={formatEuro(draft.gain_net_ht ?? 0)} />
        </div>
      </Card>

      {/* Bilan financier — P&L complet + charges externes (traiteur, sécurité…) */}
      <Card title="Bilan financier">
        <div className="space-y-6">
          <FullPnL
            caHT={Number(draft.ca_ht ?? 0)}
            fbCostHT={Number(draft.total_fb_cost_ht ?? 0)}
            rhCostHT={Number(draft.total_rh_cost ?? 0)}
            externalCostHT={externalCostHt ?? 0}
            pax={Number(draft.pax ?? event.expected_attendees ?? 0)}
          />
          <div>
            <h4 className="mb-2 text-sm font-bold text-stone-800">
              Charges externes <span className="font-normal text-stone-400">(traiteur, sécurité, technique…)</span>
            </h4>
            <ExternalChargesManager eventId={event.event_id} onCostChange={() => void recomputeCosts()} />
          </div>
        </div>
      </Card>

      <PhotosSection title="📷 Photos mise en place" field="setup_photo_urls" photos={draft.setup_photo_urls ?? []} onChange={(f, next) => updateDraft({ [f]: next } as Partial<SeminarReportDraft>)} uploadPhoto={uploadPhoto} />
      <PhotosSection title="📷 Photos F&B" field="fb_photo_urls" photos={draft.fb_photo_urls ?? []} onChange={(f, next) => updateDraft({ [f]: next } as Partial<SeminarReportDraft>)} uploadPhoto={uploadPhoto} />

      {/* Rapport photo terrain — checklist + galeries 3 catégories (→ PDF dense) */}
      <Card title="📸 Rapport photo terrain">
        <div className="space-y-7">
          <div>
            <p className="mb-3 text-sm font-bold text-stone-800">
              ☑️ Checklist photos terrain{' '}
              <span className="text-xs font-normal text-stone-400">— cochez au fur et à mesure</span>
            </p>
            <PhotoChecklist eventId={event.event_id} regisseurNom={reportRegisseur} />
          </div>
          <hr className="border-stone-100" />
          <PhotoGallery eventId={event.event_id} photoType="mise_en_place" label="📐 Mise en place — avant ouverture" responsableNom={reportRegisseur} showPdfSelector />
          <hr className="border-stone-100" />
          <PhotoGallery eventId={event.event_id} photoType="fb" label="🍽️ F&B — buffet, bar, service" responsableNom={reportRegisseur} showPdfSelector />
          <hr className="border-stone-100" />
          <PhotoGallery eventId={event.event_id} photoType="fin_evenement" label="🔚 Fin d'événement — rangement & état" responsableNom={reportRegisseur} showPdfSelector />
          <p className="text-center text-xs text-stone-400">Sélection multiple · JPEG / PNG / HEIC · 20 Mo max · sans limite de nombre</p>
          <hr className="border-stone-100" />
          <PdfPhotoSummary eventId={event.event_id} />
        </div>
      </Card>

      <DebriefSection draft={draft} update={updateDraft} />

      {/* Satisfaction client */}
      <Card title="Satisfaction client">
        <Row label="Répondu par"><InlineEditable value={draft.survey_respondent} onSave={(v) => updateDraft({ survey_respondent: v })} /></Row>
        <Row label="Rôle"><InlineEditable value={draft.survey_respondent_role} onSave={(v) => updateDraft({ survey_respondent_role: v })} /></Row>
        {(['cadre_score', 'proprete_score', 'traiteur_score', 'organisation_score', 'equipes_score', 'renouveler_score'] as const).map((k) => (
          <Row key={k} label={k.replace('_score', '').replace('renouveler', 'renouvellement')}>
            <InlineEditable value={draft[k]} placeholder="ex : très satisfait" onSave={(v) => updateDraft({ [k]: v } as Partial<SeminarReportDraft>)} />
          </Row>
        ))}
        <Row label="Note expérience /10"><InlineEditable type="number" value={draft.nps_experience} onSave={(v) => updateDraft({ nps_experience: v ? Number(v) : null })} /></Row>
        <Row label="Note reco /10"><InlineEditable type="number" value={draft.nps_recommandation} onSave={(v) => updateDraft({ nps_recommandation: v ? Number(v) : null })} /></Row>
        <Row label="Commentaire"><InlineEditable value={draft.survey_commentaire} multiline onSave={(v) => updateDraft({ survey_commentaire: v })} /></Row>
      </Card>

      {preview && <PreviewModal draft={draft} onClose={() => setPreview(false)} />}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-pr-stone bg-pr-cream/40 p-2">
      <p className="text-[10px] uppercase tracking-wide text-pr-olive-dark">{label}</p>
      <p className="font-display text-sm font-black text-pr-black">{value}</p>
    </div>
  );
}
