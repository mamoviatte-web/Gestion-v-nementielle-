/**
 * Export PDF du rapport séminaire (jsPDF, A4 paysage) — reproduit fidèlement la
 * DA du deck de retour événement Provence Rugby :
 *   • polices Bebas Neue (titres), Poppins (corps), Sacramento (script),
 *   • fond papier crème, titres MAJ soulignés « au pinceau »,
 *   • tableau Coûts aux couleurs du modèle (jaune / rouge / magenta / vert),
 *   • pied de page : logo olivier + « PROVENCE RUGBY » + barre dégradé chaud.
 *
 * Ordre des pages (choix produit : « deck strict + extras à la fin ») :
 *   1. Couverture · 2. Coûts · 3. Mise en place · 4. Photos F&B · 5. Débrief
 *   — puis annexes : Détail charges RH · Rapport photo terrain · Satisfaction.
 *
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
  { type: 'mise_en_place', title: 'MISE EN PLACE', header: [35, 55, 100], accent: [235, 240, 255], cardColor: [100, 130, 220], cardLabel: 'Mise en place' },
  { type: 'fb', title: 'F&B — SERVICE', header: [100, 50, 20], accent: [255, 245, 235], cardColor: [200, 130, 60], cardLabel: 'F&B — Service' },
  { type: 'fin_evenement', title: "FIN D'ÉVÉNEMENT", header: [30, 80, 45], accent: [235, 255, 240], cardColor: [80, 160, 100], cardLabel: "Fin d'événement" },
];

const W = 297;
const H = 210;
// Palette du deck de référence.
const INK = '#111111';
const PAPER = '#ECEBE7';
const MUTED = '#6B6B66';
const LINE = '#D7D4CC';
// Tableau coûts (couleurs Excel du modèle).
const T_YELLOW = '#FFF200';
const T_RED = '#E20613';
const T_MAGENTA = '#D45CD0';
const T_GREEN = '#86CF5B';
// Pied de page — barre dégradé chaud (orange → rouge → or → jaune).
const GRADIENT: [number, number, number][] = [
  [233, 78, 27], [226, 6, 19], [243, 146, 0], [255, 210, 0],
];

/** Polices personnalisées (chargées dynamiquement, hors bundle principal). */
let fontsReady = false;
async function ensureFonts(doc: jsPDF): Promise<{ markPng: string | null }> {
  let markPng: string | null = null;
  try {
    const [{ registerPdfFonts }, assets] = await Promise.all([
      import('@/lib/pdfFonts'),
      import('@/lib/pdfAssets').catch(() => null),
    ]);
    registerPdfFonts(doc);
    fontsReady = true;
    markPng = assets?.PR_MARK_PNG ?? null;
  } catch {
    fontsReady = false; // repli silencieux sur les polices système
  }
  return { markPng };
}

/** Titre (Bebas si dispo, sinon Helvetica bold). */
function fTitle(doc: jsPDF, size: number) {
  doc.setFont(fontsReady ? 'Bebas' : 'helvetica', fontsReady ? 'normal' : 'bold');
  doc.setFontSize(size);
}
/** Corps (Poppins si dispo). weight 'bold' → SemiBold. */
function fBody(doc: jsPDF, size: number, weight: 'normal' | 'bold' = 'normal') {
  doc.setFont(fontsReady ? 'Poppins' : 'helvetica', weight);
  doc.setFontSize(size);
}
/** Script manuscrite (Sacramento si dispo, sinon italique). */
function fScript(doc: jsPDF, size: number) {
  doc.setFont(fontsReady ? 'Sacramento' : 'times', fontsReady ? 'normal' : 'italic');
  doc.setFontSize(size);
}

function eurFr(v: number | null | undefined): string {
  return v == null ? '—' : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
function euro(v: number | null | undefined): string {
  return v == null ? '—' : `${Number(v).toFixed(2)} € HT`;
}
function frDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function background(doc: jsPDF) {
  doc.setFillColor(PAPER);
  doc.rect(0, 0, W, H, 'F');
}

/** Barre dégradé chaud (série de fines bandes interpolées). */
function gradientBar(doc: jsPDF, x: number, y: number, w: number, h: number) {
  const n = 64;
  const seg = w / n;
  for (let i = 0; i < n; i++) {
    const pos = (i / (n - 1)) * (GRADIENT.length - 1);
    const k = Math.min(GRADIENT.length - 2, Math.floor(pos));
    const f = pos - k;
    const c = GRADIENT[k].map((v, j) => Math.round(v + (GRADIENT[k + 1][j] - v) * f));
    doc.setFillColor(c[0], c[1], c[2]);
    doc.rect(x + i * seg, y, seg + 0.4, h, 'F');
  }
}

/** Pied de page du modèle : logo olivier + PROVENCE RUGBY + barre dégradé. */
function footer(doc: jsPDF, markPng: string | null) {
  const cx = W / 2;
  if (markPng) {
    try { doc.addImage(markPng, 'PNG', cx - 3.6, H - 24, 7.2, 7.2, undefined, 'FAST'); } catch { /* ignore */ }
  }
  fTitle(doc, 9);
  doc.setTextColor(INK);
  doc.text('PROVENCE RUGBY', cx, H - 12, { align: 'center' });
  gradientBar(doc, cx - 28, H - 7, 56, 3);
}

/** Titre de section : Bebas MAJ + trait « pinceau » noir (comme le deck). */
function pageTitle(doc: jsPDF, title: string, opts?: { suffix?: string }) {
  const t = title.toUpperCase();
  fTitle(doc, 34);
  doc.setTextColor(INK);
  doc.text(t, 20, 30);
  const wText = doc.getTextWidth(t);
  // Souligné pinceau : trait épais à bouts ronds, légèrement irrégulier.
  doc.setDrawColor(INK);
  doc.setLineCap('round');
  doc.setLineWidth(2.4);
  doc.line(21, 35.5, 21 + Math.min(wText, 150), 35.2);
  doc.setLineWidth(1.1);
  doc.line(22, 37, 21 + Math.min(wText, 150) * 0.82, 36.8);
  doc.setLineCap('butt');
  if (opts?.suffix) {
    fBody(doc, 10, 'normal');
    doc.setTextColor(MUTED);
    doc.text(opts.suffix, 22 + Math.min(wText, 150) + 6, 32);
  }
}

/** Grille de photos (n colonnes) à partir d'un y de départ — coins arrondis. */
async function photoGrid(doc: jsPDF, photos: ReportPhoto[], cols: number, startY: number) {
  const gap = 7;
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
    // Ombre douce + carte blanche arrondie.
    doc.setFillColor('#DED9CF');
    doc.roundedRect(x + 0.8, y + 1, cellW, cellH, 3, 3, 'F');
    doc.setFillColor('#FFFFFF');
    doc.setDrawColor(LINE);
    doc.roundedRect(x, y, cellW, cellH, 3, 3, 'FD');
    await addImageToPDF(doc, photos[i].url, x + 1.5, y + 1.5, cellW - 3, cellH - 3);
    if (photos[i].caption) {
      fBody(doc, 9, 'normal');
      doc.setTextColor(INK);
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
 * grille 3×4 = 12 photos/page, numérotées + légendées. Pages PORTRAIT (A4).
 * Annexe — conserve sa mise en page dédiée. Sections vides omises.
 */
async function addDebriefPhotoPages(doc: jsPDF, eventId: string, eventName: string, eventDate: string, regisseur: string) {
  const sections: { cfg: (typeof DEBRIEF_PHOTO_SECTIONS)[number]; photos: DebriefPdfPhoto[] }[] = [];
  for (const cfg of DEBRIEF_PHOTO_SECTIONS) {
    const { data } = await supabase
      .from('debrief_photos')
      .select('storage_path, caption, pdf_caption, taken_by, taken_at')
      .eq('event_id', eventId)
      .eq('photo_type', cfg.type)
      .eq('include_in_pdf', true)
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

  const dFr = (d: string) => {
    const dt = new Date(d);
    return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };
  const tFr = (d: string) => {
    const dt = new Date(d);
    return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };

  doc.addPage('a4', 'p');
  doc.setFillColor(20, 20, 35);
  doc.rect(0, 0, 210, 297, 'F');
  doc.setTextColor(255, 255, 255);
  fTitle(doc, 30);
  doc.text('RAPPORT PHOTO', 105, 60, { align: 'center' });
  fBody(doc, 13, 'normal');
  doc.setTextColor(200, 200, 220);
  doc.text(eventName, 105, 74, { align: 'center' });
  doc.setDrawColor(201, 166, 70);
  doc.setLineWidth(1.5);
  doc.line(60, 82, 150, 82);
  doc.setLineWidth(0.5);
  fBody(doc, 10, 'normal');
  doc.setTextColor(180, 180, 200);
  doc.text(`Régisseur : ${regisseur}`, 105, 95, { align: 'center' });
  sections.forEach((s, i) => {
    const x = 15 + i * 65;
    const y = 130;
    const [r, g, b] = s.cfg.cardColor;
    doc.setFillColor(r, g, b);
    doc.roundedRect(x, y, 58, 70, 4, 4, 'F');
    doc.setTextColor(255, 255, 255);
    fTitle(doc, 34);
    doc.text(`${s.photos.length}`, x + 29, y + 36, { align: 'center' });
    fBody(doc, 8, 'normal');
    doc.text('photo' + (s.photos.length > 1 ? 's' : ''), x + 29, y + 46, { align: 'center' });
    fBody(doc, 9, 'bold');
    doc.text(s.cfg.cardLabel, x + 29, y + 58, { align: 'center', maxWidth: 50 });
  });
  doc.setTextColor(255, 255, 255);
  fTitle(doc, 16);
  doc.text(`${total} PHOTOS AU TOTAL`, 105, 230, { align: 'center' });
  fBody(doc, 9, 'normal');
  doc.setTextColor(150, 150, 170);
  doc.text('Provence Rugby · Stade Maurice-David', 105, 270, { align: 'center' });

  for (const { cfg, photos } of sections) {
    if (photos.length === 0) continue;
    const twoCol = photos.length <= 6;
    const COLS = twoCol ? 2 : 3;
    const PER = twoCol ? 6 : 12;
    const PW = twoCol ? 88 : 59;
    const PH = twoCol ? 62 : 44;
    const GX = 6;
    const GY = twoCol ? 16 : 10;
    const SX = twoCol ? 15 : 10;
    const SY = 28;
    const pages = Math.ceil(photos.length / PER);
    const [hr, hg, hb] = cfg.header;
    const [ar, ag, ab] = cfg.accent;
    for (let pg = 0; pg < pages; pg++) {
      doc.addPage('a4', 'p');
      doc.setFillColor(hr, hg, hb);
      doc.rect(0, 0, 210, 22, 'F');
      doc.setTextColor(255, 255, 255);
      fTitle(doc, 15);
      doc.text(cfg.title, 10, 11);
      fBody(doc, 8.5, 'normal');
      doc.text(`${eventName}  ·  ${dFr(eventDate)}  ·  Régisseur : ${regisseur}`, 10, 17);
      if (pages > 1) {
        fBody(doc, 8, 'normal');
        doc.text(`${pg + 1} / ${pages}`, 200, 9, { align: 'right' });
      }
      fBody(doc, 7.5, 'normal');
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
        doc.setFillColor(hr, hg, hb);
        doc.roundedRect(x + 1, y + 1, 7, 5, 0.5, 0.5, 'F');
        doc.setTextColor(255, 255, 255);
        fBody(doc, 5.5, 'bold');
        doc.text(`${pg * PER + i + 1}`, x + 2.4, y + 4.6);
        fBody(doc, 6.5, 'normal');
        doc.setTextColor(80, 80, 80);
        const meta = [ph.taken_at ? tFr(ph.taken_at) : '', ph.taken_by ? `par ${ph.taken_by}` : ''].filter(Boolean).join('  ·  ');
        if (meta) doc.text(meta, x, y + PH + 4, { maxWidth: PW });
        if (ph.caption) {
          fBody(doc, 6, 'normal');
          doc.setTextColor(120, 120, 120);
          doc.text(ph.caption, x, y + PH + 8, { maxWidth: PW });
        }
      }

      fBody(doc, 7, 'normal');
      doc.setTextColor(180, 180, 180);
      doc.text(`Rapport photo — ${eventName} — Provence Rugby / Stade Maurice-David`, 105, 292, { align: 'center' });
      doc.setDrawColor(200, 200, 200);
      doc.line(10, 289, 200, 289);
    }
  }
}

/**
 * Annexe « Détail des charges RH » : décompose la charge régisseur poste par
 * poste (équipe + prestataires externes), heures & coût, réconciliée avec le
 * total RH. Omise si aucune donnée RH.
 */
async function addRhDetailPage(doc: jsPDF, eventId: string, totalRh: number | null, markPng: string | null) {
  const { data } = await supabase
    .from('zone_staff_hours')
    .select('staff_name, role, hours_worked, rh_cost, is_external')
    .eq('event_id', eventId)
    .order('is_external', { ascending: true })
    .order('role', { ascending: true })
    .order('staff_name', { ascending: true });
  const rows = (data ?? []) as { staff_name: string; role: string | null; hours_worked: number | null; rh_cost: number | null; is_external: boolean | null }[];
  const total = Number(totalRh ?? 0);
  if (rows.length === 0 && total <= 0) return;

  const namedCost = rows.reduce((s, r) => s + (Number(r.rh_cost) || 0), 0);
  const namedHours = rows.reduce((s, r) => s + (Number(r.hours_worked) || 0), 0);
  const otherCost = total > namedCost + 0.01 ? total - namedCost : 0;

  doc.addPage();
  background(doc);
  pageTitle(doc, 'Détail charges RH');
  fBody(doc, 11, 'normal');
  doc.setTextColor(MUTED);
  doc.text(`${rows.length} intervenant${rows.length > 1 ? 's' : ''} · ${namedHours.toFixed(1)} h · équipe régisseur & prestataires externes`, 20, 46);

  const cN = 24, cR = 120, cE = 186, cH = 222, cC = W - 24;
  let y = 58;
  fBody(doc, 10, 'bold');
  doc.setTextColor(INK);
  doc.text('Intervenant', cN, y);
  doc.text('Poste', cR, y);
  doc.text('Externe', cE, y);
  doc.text('Heures', cH, y, { align: 'right' });
  doc.text('Coût HT', cC, y, { align: 'right' });
  doc.setDrawColor(INK);
  doc.setLineWidth(0.6);
  doc.line(20, y + 2, W - 20, y + 2);
  y += 9;

  rows.forEach((r) => {
    if (y > H - 26) {
      footer(doc, markPng);
      doc.addPage();
      background(doc);
      pageTitle(doc, 'Détail charges RH', { suffix: '(suite)' });
      y = 54;
    }
    doc.setFillColor(y % 18 < 9 ? '#FFFFFF' : '#E6E2D8');
    doc.rect(20, y - 5, W - 40, 9, 'F');
    fBody(doc, 9.5, 'normal');
    doc.setTextColor(INK);
    doc.text(doc.splitTextToSize(r.staff_name ?? '—', 92)[0] ?? '—', cN, y);
    doc.text(doc.splitTextToSize(r.role ?? '—', 62)[0] ?? '—', cR, y);
    doc.text(r.is_external ? 'Oui' : '—', cE, y);
    doc.text(r.hours_worked != null ? `${Number(r.hours_worked).toFixed(1)} h` : '—', cH, y, { align: 'right' });
    doc.text(r.rh_cost != null ? euro(r.rh_cost) : '—', cC, y, { align: 'right' });
    y += 9;
  });

  if (otherCost > 0) {
    doc.setFillColor('#E6E2D8');
    doc.rect(20, y - 5, W - 40, 9, 'F');
    fBody(doc, 9.5, 'normal');
    doc.setTextColor(INK);
    doc.text('Personnel planning / autres', cN, y);
    doc.text(euro(otherCost), cC, y, { align: 'right' });
    y += 9;
  }

  y += 2;
  doc.setDrawColor(INK);
  doc.line(20, y - 5, W - 20, y - 5);
  fBody(doc, 12, 'bold');
  doc.setTextColor(INK);
  doc.text('Total charges RH', cN, y + 2);
  doc.text(euro(total), cC, y + 2, { align: 'right' });
  footer(doc, markPng);
}

export interface PdfExternalCharge {
  provider_name: string;
  charge_type: string;
  amount_ht: number;
}

/** Génère et télécharge le PDF. Renvoie le nom de fichier. */
export async function exportSeminarReportPDF(
  draft: SeminarReportDraft,
  externalCharges: PdfExternalCharge[] = [],
): Promise<string> {
  const externalTotal = externalCharges.reduce((s, c) => s + (Number(c.amount_ht) || 0), 0);
  const doc = new jsPDF({ format: 'a4', orientation: 'landscape', unit: 'mm' });
  const { markPng } = await ensureFonts(doc);

  // ── PAGE 1 — COUVERTURE ────────────────────────────────
  background(doc);
  const title = (draft.report_title ?? `RETOUR ${(draft.client_name ?? '').toUpperCase()}`).toUpperCase();
  fTitle(doc, 46);
  doc.setTextColor(INK);
  const titleLines = doc.splitTextToSize(title, W - 50);
  doc.text(titleLines, W / 2, 52, { align: 'center' });
  const tW = Math.min(150, Math.max(...titleLines.map((l: string) => doc.getTextWidth(l))));
  const underY = 52 + titleLines.length * 15 + 2;
  doc.setDrawColor(INK);
  doc.setLineCap('round');
  doc.setLineWidth(2.6);
  doc.line(W / 2 - tW / 2, underY, W / 2 + tW / 2, underY);
  doc.setLineCap('butt');
  if (draft.client_logo_url) {
    const logo = await imageForPdf(draft.client_logo_url);
    if (logo) {
      const ratio = Math.min(80 / logo.w, 48 / logo.h);
      doc.addImage(logo.data, logo.format, W / 2 - (logo.w * ratio) / 2, underY + 14, logo.w * ratio, logo.h * ratio, undefined, 'FAST');
    }
  }
  fBody(doc, 14, 'normal');
  doc.setTextColor(MUTED);
  doc.text(frDate(draft.report_date), W / 2, H - 34, { align: 'center' });
  footer(doc, markPng);

  // ── PAGE 2 — COÛTS ─────────────────────────────────────
  doc.addPage();
  background(doc);
  pageTitle(doc, 'Coûts');
  fBody(doc, 13, 'normal');
  doc.setTextColor(INK);
  doc.text(`nombre de pax : ${draft.pax ?? '—'}`, 20, 50);
  doc.text(`Responsable commercial : ${draft.responsable_commercial ?? '—'}`, 20, 59);
  if (draft.regisseur_name) doc.text(`Régisseur : ${draft.regisseur_name}`, 20, 68);
  doc.text(`CA = ${eurFr(draft.ca_ht)}${draft.ca_note ? ` (${draft.ca_note})` : ''}`, 20, draft.regisseur_name ? 77 : 68);

  // Tableau coûts — reprise exacte du modèle (couleurs Excel).
  const tx = 48, tw = W - 96; // centré
  const c1 = tx, c1w = tw * 0.50;          // libellé principal
  const c2 = tx + tw * 0.50, c2w = tw * 0.22; // sous-libellé
  const c3 = tx + tw * 0.72, c3w = tw * 0.28; // valeur
  const rh = 14;
  let ty = 96;
  const cell = (x: number, w: number, fill: string | null) => {
    if (fill) { doc.setFillColor(fill); doc.rect(x, ty, w, rh, 'F'); }
    doc.setDrawColor(LINE); doc.setLineWidth(0.3); doc.rect(x, ty, w, rh, 'S');
  };
  const vfmt = { align: 'right' as const };
  // Ligne 1 — COUT TOTAL SEMINAIRE (jaune) | total (rouge)
  cell(c1, c1w + c2w, T_YELLOW); cell(c3, c3w, '#FFFFFF');
  fBody(doc, 13, 'bold'); doc.setTextColor(INK);
  doc.text('COÛT TOTAL SÉMINAIRE', c1 + 4, ty + rh / 2 + 1.5);
  fBody(doc, 14, 'bold'); doc.setTextColor(T_RED);
  doc.text(eurFr(draft.total_cost_ht), c3 + c3w - 4, ty + rh / 2 + 1.5, vfmt);
  ty += rh;
  // Ligne 2 — CA (valeur magenta)
  cell(c1, c1w, '#FFFFFF'); cell(c2, c2w, '#FFFFFF'); cell(c3, c3w, T_MAGENTA);
  fBody(doc, 12, 'bold'); doc.setTextColor(INK);
  doc.text('CA', c2 + 4, ty + rh / 2 + 1.5);
  fBody(doc, 12, 'bold'); doc.setTextColor(INK);
  doc.text(eurFr(draft.ca_ht), c3 + c3w - 4, ty + rh / 2 + 1.5, vfmt);
  ty += rh;
  // Ligne 3 — Gain net
  cell(c1, c1w, '#FFFFFF'); cell(c2, c2w, '#FFFFFF'); cell(c3, c3w, '#FFFFFF');
  fBody(doc, 12, 'bold'); doc.setTextColor(INK);
  doc.text('Gain net', c2 + 4, ty + rh / 2 + 1.5);
  doc.text(eurFr(draft.gain_net_ht), c3 + c3w - 4, ty + rh / 2 + 1.5, vfmt);
  ty += rh;
  // Ligne 4 — MARGE (valeur verte)
  cell(c1, c1w, '#FFFFFF'); cell(c2, c2w, '#FFFFFF'); cell(c3, c3w, T_GREEN);
  fBody(doc, 12, 'bold'); doc.setTextColor(INK);
  doc.text('MARGE', c2 + 4, ty + rh / 2 + 1.5);
  doc.text(draft.marge_pct == null ? '—' : `${Number(draft.marge_pct).toFixed(2).replace('.', ',')} %`, c3 + c3w - 4, ty + rh / 2 + 1.5, vfmt);
  ty += rh + 8;

  // Détail (hors modèle, en appui discret) : F&B · RH · externes.
  fBody(doc, 9.5, 'normal');
  doc.setTextColor(MUTED);
  const detail = [
    `Coût F&B ${eurFr(draft.total_fb_cost_ht)}`,
    `RH ${eurFr(draft.total_rh_cost)}`,
    externalTotal > 0 ? `Charges externes ${eurFr(externalTotal)}` : '',
  ].filter(Boolean).join('    ·    ');
  doc.text(`Détail — ${detail}`, tx, ty);
  if (externalCharges.length > 0) {
    ty += 7;
    fBody(doc, 9, 'normal');
    for (const c of externalCharges) {
      doc.setTextColor(MUTED);
      doc.text(`• ${c.provider_name} (${c.charge_type})`, tx + 2, ty);
      doc.text(eurFr(c.amount_ht), tx + tw, ty, { align: 'right' });
      ty += 5.5;
      if (ty > H - 24) break;
    }
  }
  footer(doc, markPng);

  // ── PAGE 3 — MISE EN PLACE ─────────────────────────────
  if ((draft.setup_photo_urls ?? []).length > 0) {
    doc.addPage();
    background(doc);
    pageTitle(doc, 'Mise en place');
    if (draft.setup_note) {
      fScript(doc, 26);
      doc.setTextColor(INK);
      doc.text(draft.setup_note, W / 2, 48, { align: 'center' });
    }
    await photoGrid(doc, draft.setup_photo_urls, 2, draft.setup_note ? 58 : 48);
    footer(doc, markPng);
  }

  // ── PAGE 4 — PHOTOS F&B ────────────────────────────────
  const fb = draft.fb_photo_urls ?? [];
  if (fb.length > 0) {
    doc.addPage();
    background(doc);
    pageTitle(doc, 'Photos F&B', { suffix: `Traiteur : ${draft.traiteur_company ?? '—'}` });
    fBody(doc, 12, 'bold');
    doc.setTextColor(INK);
    doc.text(`TRAITEUR : ${draft.traiteur_company ?? '—'}`, 20, 46);
    doc.text(`RÉGISSEUR : ${draft.regisseur_name ?? '—'}`, 20, 53);
    // Sous-titre script centré (comme « Cocktail dinatoire » du modèle).
    fScript(doc, 30);
    doc.setTextColor(INK);
    doc.text('Cocktail dînatoire', W / 2, 50, { align: 'center' });
    await photoGrid(doc, fb.slice(0, 6), 3, 62);
    footer(doc, markPng);
    if (fb.length > 6) {
      doc.addPage();
      background(doc);
      pageTitle(doc, 'Photos F&B', { suffix: '(suite)' });
      fScript(doc, 30);
      doc.setTextColor(INK);
      doc.text('Cocktail dînatoire', W / 2, 48, { align: 'center' });
      await photoGrid(doc, fb.slice(6, 12), 3, 58);
      footer(doc, markPng);
    }
  }

  // ── PAGE 5 — DÉBRIEF ───────────────────────────────────
  doc.addPage();
  background(doc);
  pageTitle(doc, 'Débrief');
  const bullets = draft.debrief_bullets ?? [];
  let by = 50;
  fBody(doc, 13, 'normal');
  bullets.forEach((b) => {
    doc.setTextColor(b.is_issue ? '#9A5B3B' : INK);
    doc.text(b.is_issue ? '▸' : '•', 22, by);
    const wrapped = doc.splitTextToSize(b.text, W - 55);
    doc.text(wrapped, 29, by);
    by += 7 * Math.max(1, wrapped.length) + 2;
  });
  const scoreY = Math.min(by + 10, H - 30);
  doc.setDrawColor(LINE);
  doc.line(20, scoreY - 6, W - 20, scoreY - 6);
  fBody(doc, 13, 'bold');
  doc.setTextColor(INK);
  doc.text('Ménage :', 22, scoreY + 2);
  drawScoreCircles(doc, draft.cleaning_score, 52, scoreY + 1);
  doc.text(`(${formatScoreText(draft.cleaning_score)})`, 88, scoreY + 2);
  doc.text('Technique :', W / 2 + 10, scoreY + 2);
  drawScoreCircles(doc, draft.technical_score, W / 2 + 46, scoreY + 1);
  doc.text(`(${formatScoreText(draft.technical_score)})`, W / 2 + 82, scoreY + 2);
  footer(doc, markPng);

  // ───────── ANNEXES (extras à la fin) ─────────
  // Annexe A — Détail des charges RH.
  await addRhDetailPage(doc, draft.event_id, draft.total_rh_cost, markPng);

  // Annexe B — Rapport photo terrain (pages portrait dédiées).
  await addDebriefPhotoPages(
    doc,
    draft.event_id,
    draft.report_title || draft.client_name || 'Événement',
    (draft.report_date as string | null) ?? new Date().toISOString(),
    draft.regisseur_name || draft.responsable_commercial || 'Régisseur',
  );

  // Annexe C — Satisfaction client.
  if (draft.cadre_score || draft.nps_experience != null || draft.survey_respondent) {
    doc.addPage();
    background(doc);
    pageTitle(doc, 'Satisfaction client');
    fBody(doc, 12, 'normal');
    doc.setTextColor(INK);
    doc.text(
      `Répondu par : ${draft.survey_respondent ?? '—'}${draft.survey_respondent_role ? ` (${draft.survey_respondent_role})` : ''}`,
      20,
      48,
    );
    const items: [string, string | null][] = [
      ['Cadre', draft.cadre_score],
      ['Propreté', draft.proprete_score],
      ['Traiteur', draft.traiteur_score],
      ['Organisation', draft.organisation_score],
      ['Équipes', draft.equipes_score],
      ['Renouvellement', draft.renouveler_score],
    ];
    let sy = 62;
    items.forEach(([label, val]) => {
      if (!val) return;
      fBody(doc, 12, 'bold');
      doc.setTextColor(INK);
      doc.text(`${label} :`, 24, sy);
      fBody(doc, 12, 'normal');
      doc.text(val, 92, sy);
      sy += 10;
    });
    fBody(doc, 12, 'bold');
    doc.setTextColor(INK);
    doc.text(`Note expérience : ${draft.nps_experience ?? '—'}/10`, 24, sy + 4);
    doc.text(`Note recommandation : ${draft.nps_recommandation ?? '—'}/10`, W / 2 + 10, sy + 4);
    if (draft.survey_commentaire) {
      fScript(doc, 22);
      doc.setTextColor(INK);
      doc.text(doc.splitTextToSize(`« ${draft.survey_commentaire} »`, W - 48), 24, sy + 18);
    }
    footer(doc, markPng);
  }

  const client = (draft.client_name ?? 'seminaire').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
  const filename = `Retour_${client}_${draft.report_date ?? ''}.pdf`;
  doc.save(filename);
  return filename;
}
