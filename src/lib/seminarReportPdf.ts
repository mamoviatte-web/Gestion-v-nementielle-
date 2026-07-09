/**
 * Export PDF du rapport séminaire (jsPDF, A4 paysage, charte Provence Rugby).
 * Pages : Couverture · Coûts · Mise en place · Photos F&B · Débrief · Satisfaction.
 * Réservé aux séminaires (jamais un match).
 */

import jsPDF from 'jspdf';
import { drawScoreCircles, formatScoreText } from '@/lib/scoreRenderer';
import { addImageToPDF, imageForPdf } from '@/lib/storageUtils';
import { supabase } from '@/lib/supabase';
import type { SeminarReportDraft, ReportPhoto } from '@/hooks/useSeminarReportDraft';

/** Pages photos terrain (débrief) : mise en place · F&B · fin d'événement. */
const DEBRIEF_PHOTO_SECTIONS: {
  type: 'mise_en_place' | 'fb' | 'fin_evenement';
  title: string;
  header: [number, number, number];
  accent: [number, number, number];
  cardColor: [number, number, number];
  cardLabel: string;
}[] = [
  { type: 'mise_en_place', title: '📐 MISE EN PLACE', header: [35, 55, 100], accent: [235, 240, 255], cardColor: [100, 130, 220], cardLabel: 'Mise en place' },
  { type: 'fb', title: '🍽️ F&B — SERVICE', header: [100, 50, 20], accent: [255, 245, 235], cardColor: [200, 130, 60], cardLabel: 'F&B — Service' },
  { type: 'fin_evenement', title: "🔚 FIN D'ÉVÉNEMENT", header: [30, 80, 45], accent: [235, 255, 240], cardColor: [80, 160, 100], cardLabel: "Fin d'événement" },
];

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
    await addImageToPDF(doc, photos[i].url, x + 1.5, y + 1.5, cellW - 3, cellH - 3);
    if (photos[i].caption) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(BLACK);
      doc.text(doc.splitTextToSize(photos[i].caption!, cellW), x, y + cellH + 5);
    }
    if (r >= rows) break;
  }
}

interface DebriefPdfPhoto {
  url: string;
  taken_by: string | null;
  taken_at: string | null;
  caption: string | null;
}

/**
 * Rapport photo dense (débrief) : page de couverture + sections en-tête colorée,
 * grille 3×4 = 12 photos/page, numérotées + légendées. Pages PORTRAIT (A4) même
 * si le rapport est en paysage. Sections vides omises.
 */
async function addDebriefPhotoPages(doc: jsPDF, eventId: string, eventName: string, eventDate: string, regisseur: string) {
  // 1) Charger + signer les photos de chaque section.
  const sections: { cfg: (typeof DEBRIEF_PHOTO_SECTIONS)[number]; photos: DebriefPdfPhoto[] }[] = [];
  for (const cfg of DEBRIEF_PHOTO_SECTIONS) {
    const { data } = await supabase
      .from('debrief_photos')
      .select('storage_path, caption, pdf_caption, taken_by, taken_at')
      .eq('event_id', eventId)
      .eq('photo_type', cfg.type)
      .eq('include_in_pdf', true) // ← uniquement les photos choisies par le régisseur
      .order('pdf_order', { ascending: true })
      .order('taken_at', { ascending: true });
    const rows = (data ?? []) as { storage_path: string; caption: string | null; pdf_caption: string | null; taken_by: string | null; taken_at: string | null }[];
    const photos: DebriefPdfPhoto[] = [];
    for (const r of rows) {
      const { data: u } = await supabase.storage.from('debrief-photos').createSignedUrl(r.storage_path, 3600);
      photos.push({ url: u?.signedUrl ?? '', taken_by: r.taken_by, taken_at: r.taken_at, caption: r.pdf_caption ?? r.caption });
    }
    sections.push({ cfg, photos });
  }
  const total = sections.reduce((s, x) => s + x.photos.length, 0);
  if (total === 0) return;

  const frDate = (d: string) => {
    const dt = new Date(d);
    return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };
  const frTime = (d: string) => {
    const dt = new Date(d);
    return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };

  // 2) Page de couverture du chapitre photo.
  doc.addPage('a4', 'p');
  doc.setFillColor(20, 20, 35);
  doc.rect(0, 0, 210, 297, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text('RAPPORT PHOTO', 105, 60, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  doc.setTextColor(200, 200, 220);
  doc.text(eventName, 105, 74, { align: 'center' });
  doc.setDrawColor(201, 166, 70);
  doc.setLineWidth(1.5);
  doc.line(60, 82, 150, 82);
  doc.setLineWidth(0.5);
  doc.setFontSize(10);
  doc.setTextColor(180, 180, 200);
  doc.text(`Régisseur : ${regisseur}`, 105, 95, { align: 'center' });
  sections.forEach((s, i) => {
    const x = 15 + i * 65;
    const y = 130;
    const [r, g, b] = s.cfg.cardColor;
    doc.setFillColor(r, g, b);
    doc.roundedRect(x, y, 58, 70, 4, 4, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(32);
    doc.text(`${s.photos.length}`, x + 29, y + 35, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('photo' + (s.photos.length > 1 ? 's' : ''), x + 29, y + 46, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(s.cfg.cardLabel, x + 29, y + 58, { align: 'center', maxWidth: 50 });
  });
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(`${total} photos au total`, 105, 230, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 120);
  doc.text('Provence Rugby · Stade Maurice-David', 105, 270, { align: 'center' });

  // 3) Pages denses par section (3×4 = 12/page).
  const COLS = 3, PER = 12, PW = 59, PH = 44, GX = 4, GY = 10, SX = 10, SY = 28;
  for (const { cfg, photos } of sections) {
    if (photos.length === 0) continue;
    const pages = Math.ceil(photos.length / PER);
    const [hr, hg, hb] = cfg.header;
    const [ar, ag, ab] = cfg.accent;
    for (let pg = 0; pg < pages; pg++) {
      doc.addPage('a4', 'p');
      doc.setFillColor(hr, hg, hb);
      doc.rect(0, 0, 210, 22, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text(cfg.title, 10, 9);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.text(`${eventName}  ·  ${frDate(eventDate)}  ·  Régisseur : ${regisseur}`, 10, 16);
      if (pages > 1) {
        doc.setFontSize(8);
        doc.text(`${pg + 1} / ${pages}`, 200, 9, { align: 'right' });
      }
      doc.setFontSize(7.5);
      doc.text(`${photos.length} photo${photos.length > 1 ? 's' : ''}`, 200, 16, { align: 'right' });

      const slice = photos.slice(pg * PER, (pg + 1) * PER);
      for (let i = 0; i < slice.length; i++) {
        const ph = slice[i];
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const x = SX + col * (PW + GX);
        const y = SY + row * (PH + GY);
        doc.setFillColor(ar, ag, ab);
        doc.roundedRect(x - 1, y - 1, PW + 2, PH + 2, 1.5, 1.5, 'F');
        await addImageToPDF(doc, ph.url, x, y, PW, PH);
        // Numéro de photo (coin haut-gauche)
        doc.setFillColor(hr, hg, hb);
        doc.roundedRect(x + 1, y + 1, 7, 5, 0.5, 0.5, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5.5);
        doc.text(`${pg * PER + i + 1}`, x + 2.4, y + 4.6);
        // Légende
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.5);
        doc.setTextColor(80, 80, 80);
        const meta = [ph.taken_at ? frTime(ph.taken_at) : '', ph.taken_by ? `📷 ${ph.taken_by}` : ''].filter(Boolean).join('  ');
        if (meta) doc.text(meta, x, y + PH + 4, { maxWidth: PW });
        if (ph.caption) {
          doc.setFontSize(6);
          doc.setTextColor(120, 120, 120);
          doc.text(ph.caption, x, y + PH + 8, { maxWidth: PW });
        }
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(180, 180, 180);
      doc.text(`Rapport photo — ${eventName} — Provence Rugby / Stade Maurice-David`, 105, 292, { align: 'center' });
      doc.setDrawColor(200, 200, 200);
      doc.line(10, 289, 200, 289);
    }
  }
}

/** Génère et télécharge le PDF. Renvoie le nom de fichier. */
export interface PdfExternalCharge {
  provider_name: string;
  charge_type: string;
  amount_ht: number;
}

export async function exportSeminarReportPDF(
  draft: SeminarReportDraft,
  externalCharges: PdfExternalCharge[] = [],
): Promise<string> {
  const externalTotal = externalCharges.reduce((s, c) => s + (Number(c.amount_ht) || 0), 0);
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
    const logo = await imageForPdf(draft.client_logo_url);
    if (logo) {
      const ratio = Math.min(70 / logo.w, 55 / logo.h);
      doc.addImage(logo.data, logo.format, W / 2 - (logo.w * ratio) / 2, 80, logo.w * ratio, logo.h * ratio, undefined, 'FAST');
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
  const rows: [string, string, boolean][] = [
    ['Chiffre d’affaires HT', euro(draft.ca_ht) + (draft.ca_note ? ` (${draft.ca_note})` : ''), false],
    ['Coût F&B HT', euro(draft.total_fb_cost_ht), false],
    ['Charges régisseur (RH)', euro(draft.total_rh_cost), false],
    ['Charges externes HT', euro(externalTotal), false],
    ['Coût total HT', euro(draft.total_cost_ht), true],
    ['Gain net HT', euro(draft.gain_net_ht), true],
    ['Marge', draft.marge_pct == null ? '—' : `${Number(draft.marge_pct).toFixed(1)} %`, true],
  ];
  let ty = 92;
  rows.forEach(([label, val, isTotal], i) => {
    doc.setFillColor(i % 2 === 0 ? '#FFFFFF' : '#ECE8DC');
    doc.rect(20, ty - 6, W - 40, 11, 'F');
    doc.setFont('helvetica', isTotal ? 'bold' : 'normal');
    doc.setFontSize(isTotal ? 13 : 12);
    doc.setTextColor(isTotal ? OLIVE : BLACK);
    doc.text(label, 24, ty + 1);
    doc.text(val, W - 24, ty + 1, { align: 'right' });
    ty += 12;
  });

  // Détail des charges externes (traiteur, sécurité…)
  if (externalCharges.length > 0) {
    ty += 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(BLACK);
    doc.text('Détail charges externes', 24, ty);
    ty += 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    for (const c of externalCharges) {
      doc.setTextColor(BLACK);
      doc.text(`• ${c.provider_name} (${c.charge_type})`, 26, ty);
      doc.text(euro(c.amount_ht), W - 24, ty, { align: 'right' });
      ty += 6;
    }
  }
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

  // ── PAGES — RAPPORT PHOTO TERRAIN (dense, couverture + sections) ────
  await addDebriefPhotoPages(
    doc,
    draft.event_id,
    draft.report_title || draft.client_name || 'Événement',
    (draft.report_date as string | null) ?? new Date().toISOString(),
    draft.regisseur_name || draft.responsable_commercial || 'Régisseur',
  );

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
  doc.text('Ménage :', 22, scoreY + 2);
  drawScoreCircles(doc, draft.cleaning_score, 48, scoreY + 1);
  doc.text(`(${formatScoreText(draft.cleaning_score)})`, 84, scoreY + 2);
  doc.text('Technique :', W / 2 + 10, scoreY + 2);
  drawScoreCircles(doc, draft.technical_score, W / 2 + 42, scoreY + 1);
  doc.text(`(${formatScoreText(draft.technical_score)})`, W / 2 + 78, scoreY + 2);
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
