/**
 * Export PDF du rapport séminaire (jsPDF, A4 paysage, charte Provence Rugby).
 * Pages : Couverture · Coûts · Mise en place · Photos F&B · Débrief · Satisfaction.
 * Réservé aux séminaires (jamais un match).
 */

import jsPDF from 'jspdf';
import type { SeminarReportDraft, ReportPhoto } from '@/hooks/useSeminarReportDraft';

const W = 297;
const H = 210;
const BLACK = '#1A1A1A';
const CREAM = '#F4F1EA';
const OLIVE = '#6B7548';
const GOLD = '#EF9F27';

function euro(v: number | null | undefined): string {
  return v == null ? '—' : `${Number(v).toFixed(2)} € HT`;
}

function frDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

/** Charge une image distante en dataURL (via canvas). Null si échec. */
async function loadImage(url: string): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const loaded = new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('img'));
    });
    img.src = url;
    await loaded;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return { data: canvas.toDataURL('image/jpeg', 0.85), w: img.naturalWidth, h: img.naturalHeight };
  } catch {
    return null;
  }
}

function background(doc: jsPDF) {
  doc.setFillColor(CREAM);
  doc.rect(0, 0, W, H, 'F');
}

function footerBar(doc: jsPDF) {
  doc.setFillColor(BLACK);
  doc.rect(0, H - 8, W, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(GOLD);
  doc.text('PROVENCE RUGBY · STADE MAURICE-DAVID', W / 2, H - 3, { align: 'center' });
}

function pageTitle(doc: jsPDF, title: string) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.setTextColor(BLACK);
  doc.text(title.toUpperCase(), 20, 28);
  doc.setDrawColor(GOLD);
  doc.setLineWidth(1.2);
  doc.line(20, 33, 90, 33);
}

/** Grille de photos (n colonnes) à partir d'un y de départ. */
async function photoGrid(doc: jsPDF, photos: ReportPhoto[], cols: number, startY: number) {
  const gap = 6;
  const marginX = 20;
  const usableW = W - marginX * 2;
  const cellW = (usableW - gap * (cols - 1)) / cols;
  const cellH = cellW * 0.66;
  const rows = Math.ceil(photos.length / cols);
  for (let i = 0; i < photos.length; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = marginX + c * (cellW + gap);
    const y = startY + r * (cellH + 14);
    doc.setFillColor('#FFFFFF');
    doc.setDrawColor('#DDD9CE');
    doc.roundedRect(x, y, cellW, cellH, 2, 2, 'FD');
    const img = await loadImage(photos[i].url);
    if (img) {
      const ratio = Math.min(cellW / img.w, cellH / img.h);
      const iw = img.w * ratio;
      const ih = img.h * ratio;
      doc.addImage(img.data, 'JPEG', x + (cellW - iw) / 2, y + (cellH - ih) / 2, iw, ih, '', 'FAST');
    } else {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor('#999');
      doc.text('photo indisponible', x + cellW / 2, y + cellH / 2, { align: 'center' });
    }
    if (photos[i].caption) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(BLACK);
      doc.text(doc.splitTextToSize(photos[i].caption!, cellW), x, y + cellH + 5);
    }
    if (r >= rows) break;
  }
}

function stars(n: number | null): string {
  const s = Math.max(0, Math.min(5, n ?? 0));
  return '★'.repeat(s) + '☆'.repeat(5 - s);
}

/** Génère et télécharge le PDF. Renvoie le nom de fichier. */
export async function exportSeminarReportPDF(draft: SeminarReportDraft): Promise<string> {
  const doc = new jsPDF({ format: 'a4', orientation: 'landscape', unit: 'mm' });

  // ── PAGE 1 — COUVERTURE ────────────────────────────────
  background(doc);
  doc.setFillColor(BLACK);
  doc.rect(0, 0, W, 10, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(34);
  doc.setTextColor(BLACK);
  const title = draft.report_title ?? `RETOUR ${(draft.client_name ?? '').toUpperCase()}`;
  doc.text(doc.splitTextToSize(title, W - 60), W / 2, 55, { align: 'center' });
  doc.setDrawColor(GOLD);
  doc.setLineWidth(1.5);
  doc.line(W / 2 - 45, 66, W / 2 + 45, 66);
  if (draft.client_logo_url) {
    const logo = await loadImage(draft.client_logo_url);
    if (logo) {
      const ratio = Math.min(70 / logo.w, 55 / logo.h);
      doc.addImage(logo.data, 'JPEG', W / 2 - (logo.w * ratio) / 2, 80, logo.w * ratio, logo.h * ratio, '', 'FAST');
    }
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(14);
  doc.setTextColor(OLIVE);
  doc.text(frDate(draft.report_date), W / 2, 150, { align: 'center' });
  footerBar(doc);

  // ── PAGE 2 — COÛTS ─────────────────────────────────────
  doc.addPage();
  background(doc);
  pageTitle(doc, 'Coûts');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  doc.setTextColor(BLACK);
  doc.text(`Nombre de pax : ${draft.pax ?? '—'}`, 20, 48);
  doc.text(`Responsable commercial : ${draft.responsable_commercial ?? '—'}`, 20, 57);
  doc.text(`Régisseur : ${draft.regisseur_name ?? '—'}`, 20, 66);
  if (draft.traiteur_company) doc.text(`Traiteur : ${draft.traiteur_company}`, 20, 75);
  // Tableau financier
  const rows: [string, string][] = [
    ['Chiffre d’affaires HT', euro(draft.ca_ht) + (draft.ca_note ? ` (${draft.ca_note})` : '')],
    ['Coût F&B HT', euro(draft.total_fb_cost_ht)],
    ['Charges régisseur (RH)', euro(draft.total_rh_cost)],
    ['Coût total HT', euro(draft.total_cost_ht)],
    ['Gain net HT', euro(draft.gain_net_ht)],
    ['Marge', draft.marge_pct == null ? '—' : `${Number(draft.marge_pct).toFixed(1)} %`],
  ];
  let ty = 92;
  rows.forEach(([label, val], i) => {
    const isTotal = i >= 3;
    doc.setFillColor(i % 2 === 0 ? '#FFFFFF' : '#ECE8DC');
    doc.rect(20, ty - 6, W - 40, 11, 'F');
    doc.setFont('helvetica', isTotal ? 'bold' : 'normal');
    doc.setFontSize(isTotal ? 13 : 12);
    doc.setTextColor(isTotal ? OLIVE : BLACK);
    doc.text(label, 24, ty + 1);
    doc.text(val, W - 24, ty + 1, { align: 'right' });
    ty += 12;
  });
  footerBar(doc);

  // ── PAGE 3 — MISE EN PLACE ─────────────────────────────
  if ((draft.setup_photo_urls ?? []).length > 0) {
    doc.addPage();
    background(doc);
    pageTitle(doc, 'Mise en place');
    if (draft.setup_note) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(12);
      doc.setTextColor(OLIVE);
      doc.text(draft.setup_note, 20, 42);
    }
    await photoGrid(doc, draft.setup_photo_urls, 2, 50);
    footerBar(doc);
  }

  // ── PAGE 4 — PHOTOS F&B ────────────────────────────────
  const fb = draft.fb_photo_urls ?? [];
  if (fb.length > 0) {
    doc.addPage();
    background(doc);
    pageTitle(doc, 'Photos F&B');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(BLACK);
    doc.text(`TRAITEUR : ${draft.traiteur_company ?? '—'}`, 20, 44);
    doc.text(`RÉGISSEUR : ${draft.regisseur_name ?? '—'}`, W - 20, 44, { align: 'right' });
    await photoGrid(doc, fb.slice(0, 6), 3, 54);
    footerBar(doc);
    if (fb.length > 6) {
      doc.addPage();
      background(doc);
      pageTitle(doc, 'Photos F&B (suite)');
      await photoGrid(doc, fb.slice(6, 12), 3, 46);
      footerBar(doc);
    }
  }

  // ── PAGE — DÉBRIEF ─────────────────────────────────────
  doc.addPage();
  background(doc);
  pageTitle(doc, 'Débrief');
  const bullets = draft.debrief_bullets ?? [];
  let by = 48;
  doc.setFontSize(12);
  bullets.forEach((b) => {
    doc.setTextColor(b.is_issue ? '#9A5B3B' : BLACK);
    doc.setFont('helvetica', 'normal');
    doc.text(b.is_issue ? '▸' : '•', 22, by);
    const wrapped = doc.splitTextToSize(b.text, W - 55);
    doc.text(wrapped, 28, by);
    by += 7 * Math.max(1, wrapped.length) + 2;
  });
  const scoreY = Math.min(by + 8, H - 30);
  doc.setDrawColor('#DDD9CE');
  doc.line(20, scoreY - 6, W - 20, scoreY - 6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(OLIVE);
  doc.text(`Ménage : ${stars(draft.cleaning_score)} (${draft.cleaning_score ?? 0}/5)`, 22, scoreY + 2);
  doc.text(`Technique : ${stars(draft.technical_score)} (${draft.technical_score ?? 0}/5)`, W / 2 + 10, scoreY + 2);
  footerBar(doc);

  // ── PAGE — SATISFACTION CLIENT ─────────────────────────
  if (draft.cadre_score || draft.nps_experience != null || draft.survey_respondent) {
    doc.addPage();
    background(doc);
    pageTitle(doc, 'Satisfaction client');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.setTextColor(BLACK);
    doc.text(
      `Répondu par : ${draft.survey_respondent ?? '—'}${draft.survey_respondent_role ? ` (${draft.survey_respondent_role})` : ''}`,
      20,
      46,
    );
    const items: [string, string | null][] = [
      ['Cadre', draft.cadre_score],
      ['Propreté', draft.proprete_score],
      ['Traiteur', draft.traiteur_score],
      ['Organisation', draft.organisation_score],
      ['Équipes', draft.equipes_score],
      ['Renouvellement', draft.renouveler_score],
    ];
    let sy = 60;
    items.forEach(([label, val]) => {
      if (!val) return;
      doc.setFont('helvetica', 'bold');
      doc.text(`${label} :`, 24, sy);
      doc.setFont('helvetica', 'normal');
      doc.text(val, 90, sy);
      sy += 10;
    });
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(OLIVE);
    doc.text(`Note expérience : ${draft.nps_experience ?? '—'}/10`, 24, sy + 4);
    doc.text(`Note recommandation : ${draft.nps_recommandation ?? '—'}/10`, W / 2 + 10, sy + 4);
    if (draft.survey_commentaire) {
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(BLACK);
      doc.text(doc.splitTextToSize(`« ${draft.survey_commentaire} »`, W - 48), 24, sy + 16);
    }
    footerBar(doc);
  }

  const client = (draft.client_name ?? 'seminaire').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
  const filename = `Retour_${client}_${draft.report_date ?? ''}.pdf`;
  doc.save(filename);
  return filename;
}
