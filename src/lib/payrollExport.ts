/**
 * payrollExport — génère le « Récapitulatif de paie mensuel (RH) » habillé pour
 * le DAF, à partir de la vue rh_monthly_hours (une ligne par personne × mois).
 *
 * Document prêt à l'emploi : le DAF lit le montant « À verser » par personne et
 * exécute les virements. Deux circuits visuellement séparés :
 *   • Franchise → à FACTURER (nom en rouge)   • Contrat → PAIE (nom en vert)
 *
 * Formules VIVANTES (jamais de valeurs figées) : « À verser » = Coût HT ; totaux
 * SUM ; sous-totaux SUMIF par type_paiement → recalcul automatique dans Excel.
 * Construit avec exceljs (styles + formules), là où un simple AOA ne suffit pas.
 *
 * 3 feuilles : « Paie » (synthèse/personne) · « Détail » (1 ligne/créneau =
 * personne × jour × mission) · « Par événement » (mêmes créneaux groupés par
 * événement). Règles de conception & habillage : voir docs/excel-rapport-rh.md.
 */

import type * as ExcelJS from 'exceljs';
import { loadModule } from '@/lib/lazyModule';

export interface PayrollRow {
  staff_name: string;
  type_paiement: string; // 'franchise' | 'contrat' | 'non défini' | 'contrat/franchise'
  mois: string;
  missions: string;
  heures: number;
  cout_ht: number;
  nb_evenements: number;
}

/** Une ligne de détail = un SHIFT (personne × événement × jour × tâche).
 *  Source : vue rh_person_event_shift (réconcilie avec rh_monthly_hours) ;
 *  repli sur rh_monthly_event_detail (sans jour/horaires) si la vue fine n'est
 *  pas encore déployée. event_id sert au lien profond vers la fiche événement. */
export interface PayrollDetailRow {
  staff_name: string;
  categorie: string; // 'Match' | 'Séminaire' | 'Opérationnel' | 'Autre'
  event_id: string;
  event_name: string;
  event_date: string; // 'YYYY-MM-DD'
  jour: string;       // 'YYYY-MM-DD' — jour réellement presté (montage la veille…)
  nature: string;     // Service espace / Runner / Montage / Responsable espace…
  espace: string;
  arrivee: string;    // 'HH:MM' ou '' si inconnu
  depart: string;     // 'HH:MM' ou '' si inconnu
  payment_type: string;
  heures: number;
  cout_ht: number;
}

const NAVY = 'FF1A1A2E';
const RED = 'FFC00000';
const GREEN = 'FF1E7A34';
const GREY = 'FF6B7280';
const LIGHT = 'FFF3F4F6';

// Couleurs par catégorie de charge (onglet détail). Couvre TOUS les event_type
// du schéma pour qu'aucune catégorie future ne s'affiche sans couleur dédiée.
const CAT_COLORS: Record<string, string> = {
  Match: 'FF1D4ED8',                    // bleu
  Séminaire: 'FF7C3AED',                // violet
  Cocktail: 'FF0F766E',                 // teal
  'Réception VIP': 'FFBE185D',          // magenta
  'Événement partenaire': 'FF0369A1',   // sky
  Réunion: 'FF52525B',                  // zinc
  Opérationnel: 'FF9A6700',             // ambre
  Autre: GREY,
};
const catColor = (c: string): string => CAT_COLORS[c] ?? GREY;

// Ordre d'affichage des sous-totaux par catégorie (le reste passe après, alpha).
const CAT_ORDER = ['Match', 'Séminaire', 'Cocktail', 'Réception VIP',
  'Événement partenaire', 'Réunion', 'Opérationnel', 'Autre'];

const EUR_FMT = '#,##0 €';
const H_FMT = '0.0';

/** Couleur du nom selon le circuit de paiement. */
function nameColor(type: string): string {
  if (type === 'franchise') return RED;
  if (type === 'contrat') return GREEN;
  return GREY; // non défini / mixte
}

/**
 * Mise en page d'impression commune aux deux feuilles → rendu clair et
 * IDENTIQUE à l'écran comme au papier/PDF :
 *  • paysage, ajusté à 1 page en largeur (aucune colonne ne déborde),
 *  • centré horizontalement, marges resserrées,
 *  • bandeaux + en-tête (lignes 1→5) répétés en haut de CHAQUE page imprimée,
 *  • pied de page « page X / N ».
 * fitToHeight:0 = on garde toutes les personnes, la liste coule sur autant de
 * pages que nécessaire, mais toujours nette et cadrée.
 */
function applyPrintLayout(ws: ExcelJS.Worksheet, lastCol: string, lastRow: number): void {
  ws.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.55, header: 0.2, footer: 0.3 },
    printTitlesRow: '1:5',
    printArea: `A1:${lastCol}${lastRow}`,
  };
  ws.headerFooter = { oddFooter: '&C&P / &N', evenFooter: '&C&P / &N' };
}

function download(buf: ExcelJS.Buffer, name: string): void {
  const b = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const u = URL.createObjectURL(b);
  const a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.click();
  URL.revokeObjectURL(u);
}

/**
 * Construit et télécharge le classeur de paie du mois.
 * @param mois  au format 'YYYY-MM'
 * @param rows  lignes rh_monthly_hours du mois (une par personne)
 */
export async function downloadPayrollWorkbook(
  mois: string,
  rows: PayrollRow[],
  detail: PayrollDetailRow[] = [],
  /** Base URL de l'appli (window.location.origin) pour les liens événement. */
  origin = '',
): Promise<void> {
  const ExcelJSMod = (await loadModule(() => import('exceljs'))).default;
  const wb = new ExcelJSMod.Workbook();
  wb.creator = 'StockPilot MD';
  const ws = wb.addWorksheet(`Paie ${mois}`, { views: [{ state: 'frozen', ySplit: 5 }] });

  const arial = (extra: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({ name: 'Arial', size: 10, ...extra });

  // Largeurs : A..H
  [30, 18, 10, 26, 10, 14, 14, 14].forEach((w, i) => (ws.getColumn(i + 1).width = w));

  // ── Bandeau titre (A1:H1)
  ws.mergeCells('A1:H1');
  const t = ws.getCell('A1');
  t.value = 'PROVENCE RUGBY — Récapitulatif de paie mensuel (RH)';
  t.font = arial({ size: 14, bold: true, color: { argb: 'FFFFFFFF' } });
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  t.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(1).height = 26;

  // ── Sous-titre (A2:H2)
  ws.mergeCells('A2:H2');
  const st = ws.getCell('A2');
  st.value = `à l'attention du DAF · Mois : ${mois}`;
  st.font = arial({ italic: true, color: { argb: 'FF334155' } });
  st.alignment = { horizontal: 'center' };

  // ── Légende (A3:H3)
  ws.mergeCells('A3:H3');
  const lg = ws.getCell('A3');
  lg.value = 'Légende : ROUGE = Franchise (à facturer) · VERT = Contrat (à intégrer en paie)';
  lg.font = arial({ bold: true });
  lg.alignment = { horizontal: 'center' };
  ws.getRow(4).height = 4; // fine séparation

  // ── En-tête colonnes (ligne 5) sur fond navy
  const headers = ['Personne', 'Type paiement', 'Mois', 'Missions', 'Heures', 'Coût HT (€)', 'Nb événements', 'À verser (€)'];
  const head = ws.getRow(5);
  headers.forEach((h, i) => {
    const c = head.getCell(i + 1);
    c.value = h;
    c.font = arial({ bold: true, color: { argb: 'FFFFFFFF' } });
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    c.alignment = { horizontal: i >= 4 ? 'right' : 'left', vertical: 'middle' };
  });
  head.height = 20;

  // ── Lignes de données (à partir de la ligne 6)
  const first = 6;
  rows.forEach((r, idx) => {
    const rr = first + idx;
    const row = ws.getRow(rr);
    row.getCell(1).value = r.staff_name;
    row.getCell(1).font = arial({ bold: true, color: { argb: nameColor(r.type_paiement) } });
    row.getCell(2).value = r.type_paiement;
    row.getCell(2).font = arial({ color: { argb: nameColor(r.type_paiement) } });
    row.getCell(3).value = r.mois;
    row.getCell(4).value = r.missions;
    row.getCell(4).font = arial({ color: { argb: GREY } });
    row.getCell(5).value = r.heures;
    row.getCell(5).numFmt = H_FMT;
    row.getCell(6).value = r.cout_ht;
    row.getCell(6).numFmt = EUR_FMT;
    row.getCell(7).value = r.nb_evenements;
    row.getCell(7).alignment = { horizontal: 'right' };
    // « À verser » = Coût HT (formule vivante)
    row.getCell(8).value = { formula: `F${rr}` };
    row.getCell(8).numFmt = EUR_FMT;
    row.getCell(8).font = arial({ bold: true });
    // filet bas léger
    for (let c = 1; c <= 8; c++) {
      row.getCell(c).border = { bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } } };
      if (!row.getCell(c).font) row.getCell(c).font = arial();
    }
  });

  const last = first + rows.length - 1;
  const hi = Math.max(first, last); // borne haute valide même sans lignes
  // Plages colonne-qualifiées (E6:E7, jamais E6:7 qui serait invalide dans Excel)
  const rng = (col: string) => `${col}${first}:${col}${hi}`;

  // ── TOTAL GÉNÉRAL
  const totalRow = last + 2;
  const tg = ws.getRow(totalRow);
  tg.getCell(1).value = 'TOTAL GÉNÉRAL';
  tg.getCell(1).font = arial({ bold: true, size: 11 });
  tg.getCell(5).value = { formula: `SUM(${rng('E')})` };
  tg.getCell(5).numFmt = H_FMT;
  tg.getCell(6).value = { formula: `SUM(${rng('F')})` };
  tg.getCell(6).numFmt = EUR_FMT;
  tg.getCell(8).value = { formula: `SUM(${rng('H')})` };
  tg.getCell(8).numFmt = EUR_FMT;
  for (let c = 1; c <= 8; c++) {
    tg.getCell(c).font = tg.getCell(c).font ?? arial({ bold: true });
    tg.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
    tg.getCell(c).font = arial({ bold: true });
  }

  // ── Sous-totaux par circuit (SUMIF sur la colonne B)
  const franchiseRow = totalRow + 2;
  const fr = ws.getRow(franchiseRow);
  fr.getCell(1).value = 'Total FRANCHISE (à facturer)';
  fr.getCell(1).font = arial({ bold: true, color: { argb: RED } });
  fr.getCell(6).value = { formula: `SUMIF($B:$B,"franchise",$F:$F)` };
  fr.getCell(6).numFmt = EUR_FMT;
  fr.getCell(6).font = arial({ bold: true, color: { argb: RED } });
  fr.getCell(8).value = { formula: `SUMIF($B:$B,"franchise",$H:$H)` };
  fr.getCell(8).numFmt = EUR_FMT;
  fr.getCell(8).font = arial({ bold: true, color: { argb: RED } });

  const contratRow = franchiseRow + 1;
  const co = ws.getRow(contratRow);
  co.getCell(1).value = 'Total CONTRAT (à intégrer en paie)';
  co.getCell(1).font = arial({ bold: true, color: { argb: GREEN } });
  co.getCell(6).value = { formula: `SUMIF($B:$B,"contrat",$F:$F)` };
  co.getCell(6).numFmt = EUR_FMT;
  co.getCell(6).font = arial({ bold: true, color: { argb: GREEN } });
  co.getCell(8).value = { formula: `SUMIF($B:$B,"contrat",$H:$H)` };
  co.getCell(8).numFmt = EUR_FMT;
  co.getCell(8).font = arial({ bold: true, color: { argb: GREEN } });

  // Impression : paysage, 1 page de large, en-tête répété (feuille récap = 8 col.)
  applyPrintLayout(ws, 'H', contratRow);

  // ═══════════════════════════════════════════════════════════════════════
  // FEUILLE 2 — DÉTAIL PAR ÉVÉNEMENT (justification des charges de paie)
  // Une ligne par personne × événement × nature ; blocs par personne, avec
  // sous-total vivant par personne + sous-totaux par catégorie (Match /
  // Séminaire / Opérationnel) en bas. La somme du détail d'une personne =
  // son « À verser » de la feuille 1 (vue rh_monthly_event_detail).
  // ═══════════════════════════════════════════════════════════════════════
  if (detail.length > 0) {
    buildDetailSheet(wb, mois, rows, detail, arial, origin);
    buildEventSheet(wb, mois, rows, detail, arial, origin);
  }

  download(await wb.xlsx.writeBuffer(), `Recap_paie_${mois}.xlsx`);
}

/** Ordre chronologique par jour presté, puis événement, puis tâche. */
function byDayThenEvent(a: PayrollDetailRow, b: PayrollDetailRow): number {
  const ja = a.jour || a.event_date;
  const jb = b.jour || b.event_date;
  if (ja !== jb) return ja < jb ? -1 : 1;
  if (a.event_name !== b.event_name) return a.event_name.localeCompare(b.event_name);
  return a.nature.localeCompare(b.nature);
}

const JOURS_FR = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
/** 'YYYY-MM-DD' → 'mer. 24/09' (jour de semaine + JJ/MM), robuste hors fuseau. */
function frJour(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) return d;
  const [, y, mo, da] = m;
  const wd = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(da))).getUTCDay();
  return `${JOURS_FR[wd]} ${da}/${mo}`;
}

/** Créneau 'HH:MM → HH:MM' (— si l'un des deux manque). */
function frCreneau(arr: string, dep: string): string {
  const a = (arr || '').trim();
  const d = (dep || '').trim();
  if (a && d) return `${a} → ${d}`;
  if (a) return `dès ${a}`;
  if (d) return `→ ${d}`;
  return '—';
}

function buildDetailSheet(
  wb: ExcelJS.Workbook,
  mois: string,
  rows: PayrollRow[],
  detail: PayrollDetailRow[],
  arial: (extra?: Partial<ExcelJS.Font>) => Partial<ExcelJS.Font>,
  origin: string,
): void {
  const ws = wb.addWorksheet(`Détail ${mois}`, { views: [{ state: 'frozen', ySplit: 5 }] });

  // Colonnes A..H : Jour · Événement(lien) · Type · Poste/Tâche · Espace · Horaire · Heures · Coût HT
  [14, 26, 13, 20, 20, 16, 9, 13].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const LINK = 'FF1D4ED8';

  // Circuit de paiement par personne (couleur du nom, repris de la feuille 1)
  const typeByName = new Map(rows.map((r) => [r.staff_name, r.type_paiement]));
  const base = origin.replace(/\/+$/, '');

  // ── Bandeaux
  ws.mergeCells('A1:H1');
  const t = ws.getCell('A1');
  t.value = 'PROVENCE RUGBY — Détail RH par personne, événement et jour';
  t.font = arial({ size: 14, bold: true, color: { argb: 'FFFFFFFF' } });
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  t.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(1).height = 26;

  ws.mergeCells('A2:H2');
  const st = ws.getCell('A2');
  st.value = `Chaque ligne = un créneau presté (jour + horaires + tâche) · Mois : ${mois}`;
  st.font = arial({ italic: true, color: { argb: 'FF334155' } });
  st.alignment = { horizontal: 'center' };

  ws.mergeCells('A3:H3');
  const lg = ws.getCell('A3');
  lg.value = 'Type : BLEU = Match · VIOLET = Séminaire · AMBRE = Opérationnel (montage, livraison). '
    + 'Événement cliquable (ouvre la fiche). Total d’une personne = son « À verser » de la feuille Récap.';
  lg.font = arial({ bold: true });
  lg.alignment = { horizontal: 'center' };
  ws.getRow(4).height = 4;

  // ── En-tête colonnes (ligne 5)
  const headers = ['Jour', 'Événement', 'Type', 'Poste / tâche', 'Espace', 'Horaire', 'Heures', 'Coût HT (€)'];
  const head = ws.getRow(5);
  headers.forEach((h, i) => {
    const c = head.getCell(i + 1);
    c.value = h;
    c.font = arial({ bold: true, color: { argb: 'FFFFFFFF' } });
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    c.alignment = { horizontal: i >= 6 ? 'right' : 'left', vertical: 'middle' };
  });
  head.height = 20;

  // ── Blocs par personne (ordre alphabétique, comme la feuille 1)
  const names = Array.from(new Set(detail.map((d) => d.staff_name))).sort((a, b) => a.localeCompare(b));
  const subheaderRows: number[] = []; // pour le total général vivant
  let r = 6;

  for (const name of names) {
    const lines = detail.filter((d) => d.staff_name === name).sort(byDayThenEvent);
    if (lines.length === 0) continue;

    // Sous-en-tête personne : nom coloré par circuit + nb d'événements + sous-total vivant
    const shRow = r;
    subheaderRows.push(shRow);
    ws.mergeCells(`A${shRow}:E${shRow}`);
    const nameCell = ws.getCell(`A${shRow}`);
    const pa5 = typeByName.get(name) ?? 'non défini';
    const nbEvts = new Set(lines.map((l) => l.event_id || l.event_name)).size;
    const nbJours = new Set(lines.map((l) => l.jour || l.event_date)).size;
    nameCell.value = `▸ ${name}  —  ${pa5}  ·  ${nbEvts} événement${nbEvts > 1 ? 's' : ''} · ${nbJours} jour${nbJours > 1 ? 's' : ''} travaillé${nbJours > 1 ? 's' : ''} · ${lines.length} créneau${lines.length > 1 ? 'x' : ''}`;
    nameCell.font = arial({ bold: true, size: 11, color: { argb: nameColor(pa5) } });
    nameCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
    nameCell.alignment = { vertical: 'middle' };
    ws.getCell(`F${shRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };

    const firstLine = shRow + 1;
    const lastLine = shRow + lines.length;
    // Sous-totaux personne (formules vivantes sur SES lignes) en G (heures) et H (coût)
    const shH = ws.getCell(`G${shRow}`);
    shH.value = { formula: `SUM(G${firstLine}:G${lastLine})` };
    shH.numFmt = H_FMT;
    shH.font = arial({ bold: true });
    shH.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
    shH.alignment = { horizontal: 'right' };
    const shC = ws.getCell(`H${shRow}`);
    shC.value = { formula: `SUM(H${firstLine}:H${lastLine})` };
    shC.numFmt = EUR_FMT;
    shC.font = arial({ bold: true });
    shC.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
    shC.alignment = { horizontal: 'right' };
    r++;

    // Lignes de détail — un créneau par ligne
    for (const l of lines) {
      const row = ws.getRow(r);
      row.getCell(1).value = frJour(l.jour || l.event_date);
      row.getCell(1).font = arial({ color: { argb: GREY } });
      // Événement cliquable (lien profond vers la fiche) si on a l'origine + id
      const cEvt = row.getCell(2);
      if (base && l.event_id) {
        cEvt.value = { text: l.event_name, hyperlink: `${base}/admin/events/${l.event_id}` };
        cEvt.font = arial({ color: { argb: LINK }, underline: true });
      } else {
        cEvt.value = l.event_name;
        cEvt.font = arial();
      }
      row.getCell(3).value = l.categorie;
      row.getCell(3).font = arial({ bold: true, color: { argb: catColor(l.categorie) } });
      row.getCell(4).value = l.nature;
      row.getCell(4).font = arial({ color: { argb: GREY } });
      row.getCell(5).value = l.espace;
      row.getCell(5).font = arial({ color: { argb: GREY } });
      row.getCell(6).value = frCreneau(l.arrivee, l.depart);
      row.getCell(6).font = arial({ color: { argb: GREY } });
      row.getCell(6).alignment = { horizontal: 'right' };
      row.getCell(7).value = l.heures;
      row.getCell(7).numFmt = H_FMT;
      row.getCell(8).value = l.cout_ht;
      row.getCell(8).numFmt = EUR_FMT;
      for (let c = 1; c <= 8; c++) {
        row.getCell(c).border = { bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } } };
        if (!row.getCell(c).font) row.getCell(c).font = arial();
      }
      r++;
    }
  }

  // ── TOTAL GÉNÉRAL (= somme des sous-totaux personnes → jamais de double compte)
  const totalRow = r + 1;
  const tg = ws.getRow(totalRow);
  tg.getCell(1).value = 'TOTAL GÉNÉRAL';
  const sumSub = (col: string) => subheaderRows.map((n) => `${col}${n}`).join(',') || '0';
  tg.getCell(7).value = { formula: subheaderRows.length ? `SUM(${sumSub('G')})` : '0' };
  tg.getCell(7).numFmt = H_FMT;
  tg.getCell(8).value = { formula: subheaderRows.length ? `SUM(${sumSub('H')})` : '0' };
  tg.getCell(8).numFmt = EUR_FMT;
  for (let c = 1; c <= 8; c++) {
    tg.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
    tg.getCell(c).font = arial({ bold: true, size: 11 });
    tg.getCell(c).alignment = { horizontal: c >= 7 ? 'right' : 'left' };
  }

  // ── Sous-totaux par CATÉGORIE (SUMIF sur la colonne Type = C, uniquement
  //    renseignée sur les lignes de détail → pas de double compte).
  //    Dynamique : une ligne par catégorie RÉELLEMENT présente ce mois-ci, dans
  //    l'ordre métier (Match, Séminaire, …, Opérationnel), le reste alphabétique.
  const present = Array.from(new Set(detail.map((d) => d.categorie)));
  present.sort((a, b) => {
    const ia = CAT_ORDER.indexOf(a); const ib = CAT_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  present.forEach((cat, i) => {
    const rowN = totalRow + 2 + i;
    const cr = ws.getRow(rowN);
    const suffix = cat === 'Opérationnel' ? ' (montage, livraison)' : '';
    cr.getCell(1).value = `Total ${cat.toUpperCase()}${suffix}`;
    cr.getCell(1).font = arial({ bold: true, color: { argb: catColor(cat) } });
    // Échappe les guillemets pour rester robuste dans la formule SUMIF.
    const key = cat.replace(/"/g, '""');
    cr.getCell(7).value = { formula: `SUMIF($C:$C,"${key}",$G:$G)` };
    cr.getCell(7).numFmt = H_FMT;
    cr.getCell(7).font = arial({ bold: true, color: { argb: catColor(cat) } });
    cr.getCell(7).alignment = { horizontal: 'right' };
    cr.getCell(8).value = { formula: `SUMIF($C:$C,"${key}",$H:$H)` };
    cr.getCell(8).numFmt = EUR_FMT;
    cr.getCell(8).font = arial({ bold: true, color: { argb: catColor(cat) } });
    cr.getCell(8).alignment = { horizontal: 'right' };
  });

  // Impression : paysage, 1 page de large, en-tête répété (feuille détail = 8 col.)
  const lastRow = totalRow + 1 + present.length;
  applyPrintLayout(ws, 'H', lastRow);
}

/** Plage de jours d'un événement : « mer. 24/09 » ou « mar. 23/09 → mer. 24/09 ». */
function frDayRange(lines: PayrollDetailRow[]): string {
  const days = Array.from(new Set(lines.map((l) => l.jour || l.event_date))).filter(Boolean).sort();
  if (days.length === 0) return '';
  if (days.length === 1) return frJour(days[0]);
  return `${frJour(days[0])} → ${frJour(days[days.length - 1])}`;
}

/**
 * FEUILLE 3 — PAR ÉVÉNEMENT. Même donnée que le détail, regroupée par ÉVÉNEMENT :
 * un bloc par événement (en-tête coloré par type + jour/plage + sous-total vivant),
 * puis une ligne par créneau (jour, personne, poste, espace, horaire, heures, coût),
 * triée par jour puis personne. Objectif : voir, événement par événement, les
 * lignes précises des heures effectuées dans le mois. Colonnes homogènes avec le
 * détail par personne (mêmes styles, mêmes formats).
 */
function buildEventSheet(
  wb: ExcelJS.Workbook,
  label: string,
  rows: PayrollRow[],
  detail: PayrollDetailRow[],
  arial: (extra?: Partial<ExcelJS.Font>) => Partial<ExcelJS.Font>,
  origin: string,
): void {
  const ws = wb.addWorksheet(`Par événement ${label}`.slice(0, 31), { views: [{ state: 'frozen', ySplit: 5 }] });

  // Colonnes A..G : Jour · Personne · Poste/tâche · Espace · Horaire · Heures · Coût HT
  [14, 26, 20, 20, 16, 9, 13].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const typeByName = new Map(rows.map((r) => [r.staff_name, r.type_paiement]));
  const base = origin.replace(/\/+$/, '');

  // ── Bandeaux
  ws.mergeCells('A1:G1');
  const t = ws.getCell('A1');
  t.value = 'PROVENCE RUGBY — Heures RH par événement';
  t.font = arial({ size: 14, bold: true, color: { argb: 'FFFFFFFF' } });
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  t.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(1).height = 26;

  ws.mergeCells('A2:G2');
  const st = ws.getCell('A2');
  st.value = `Un bloc par événement · chaque ligne = un créneau (jour + horaires) · Période : ${label}`;
  st.font = arial({ italic: true, color: { argb: 'FF334155' } });
  st.alignment = { horizontal: 'center' };

  ws.mergeCells('A3:G3');
  const lg = ws.getCell('A3');
  lg.value = 'Type : BLEU = Match · VIOLET = Séminaire · AMBRE = Opérationnel. '
    + 'Nom coloré par circuit (ROUGE = franchise · VERT = contrat). Événement cliquable.';
  lg.font = arial({ bold: true });
  lg.alignment = { horizontal: 'center' };
  ws.getRow(4).height = 4;

  // ── En-tête colonnes (ligne 5)
  const headers = ['Jour', 'Personne', 'Poste / tâche', 'Espace', 'Horaire', 'Heures', 'Coût HT (€)'];
  const head = ws.getRow(5);
  headers.forEach((h, i) => {
    const c = head.getCell(i + 1);
    c.value = h;
    c.font = arial({ bold: true, color: { argb: 'FFFFFFFF' } });
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    c.alignment = { horizontal: i >= 5 ? 'right' : 'left', vertical: 'middle' };
  });
  head.height = 20;

  // ── Groupement par événement, trié par 1er jour presté puis nom.
  const byEvent = new Map<string, PayrollDetailRow[]>();
  for (const d of detail) {
    const key = d.event_id || d.event_name;
    (byEvent.get(key) ?? byEvent.set(key, []).get(key)!).push(d);
  }
  const minDay = (ls: PayrollDetailRow[]) => ls.reduce((m, l) => {
    const j = l.jour || l.event_date; return !m || j < m ? j : m;
  }, '');
  const events = [...byEvent.entries()].sort((a, b) => {
    const da = minDay(a[1]); const db = minDay(b[1]);
    if (da !== db) return da < db ? -1 : 1;
    return (a[1][0].event_name || '').localeCompare(b[1][0].event_name || '');
  });

  const eventHeaderRows: number[] = [];
  let r = 6;

  for (const [, lines] of events) {
    lines.sort((a, b) => {
      const ja = a.jour || a.event_date; const jb = b.jour || b.event_date;
      if (ja !== jb) return ja < jb ? -1 : 1;
      return a.staff_name.localeCompare(b.staff_name);
    });
    const ev = lines[0];
    const cat = ev.categorie;
    const col = catColor(cat);

    // ── En-tête d'événement (bloc coloré, fusion A:E) + sous-total vivant F/G
    const hr = r;
    eventHeaderRows.push(hr);
    ws.mergeCells(`A${hr}:E${hr}`);
    const hCell = ws.getCell(`A${hr}`);
    const nbPers = new Set(lines.map((l) => l.staff_name)).size;
    if (base && ev.event_id) {
      hCell.value = { text: `▪ ${ev.event_name}  —  ${cat} · ${frDayRange(lines)} · ${nbPers} pers.`, hyperlink: `${base}/admin/events/${ev.event_id}` };
    } else {
      hCell.value = `▪ ${ev.event_name}  —  ${cat} · ${frDayRange(lines)} · ${nbPers} pers.`;
    }
    hCell.font = arial({ bold: true, size: 11, color: { argb: col } });
    hCell.alignment = { vertical: 'middle' };
    for (let c = 1; c <= 7; c++) {
      ws.getCell(hr, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
      ws.getCell(hr, c).border = { top: { style: 'thin', color: { argb: col } } };
    }
    const firstLine = hr + 1;
    const lastLine = hr + lines.length;
    const eH = ws.getCell(`F${hr}`);
    eH.value = { formula: `SUM(F${firstLine}:F${lastLine})` };
    eH.numFmt = H_FMT; eH.font = arial({ bold: true }); eH.alignment = { horizontal: 'right' };
    const eC = ws.getCell(`G${hr}`);
    eC.value = { formula: `SUM(G${firstLine}:G${lastLine})` };
    eC.numFmt = EUR_FMT; eC.font = arial({ bold: true }); eC.alignment = { horizontal: 'right' };
    r++;

    // ── Lignes (un créneau chacune)
    for (const l of lines) {
      const pa = typeByName.get(l.staff_name) ?? 'non défini';
      const row = ws.getRow(r);
      row.getCell(1).value = frJour(l.jour || l.event_date);
      row.getCell(1).font = arial({ color: { argb: GREY } });
      row.getCell(2).value = l.staff_name;
      row.getCell(2).font = arial({ bold: true, color: { argb: nameColor(pa) } });
      row.getCell(3).value = l.nature;
      row.getCell(3).font = arial({ color: { argb: GREY } });
      row.getCell(4).value = l.espace;
      row.getCell(4).font = arial({ color: { argb: GREY } });
      row.getCell(5).value = frCreneau(l.arrivee, l.depart);
      row.getCell(5).font = arial({ color: { argb: GREY } });
      row.getCell(5).alignment = { horizontal: 'right' };
      row.getCell(6).value = l.heures;
      row.getCell(6).numFmt = H_FMT;
      row.getCell(7).value = l.cout_ht;
      row.getCell(7).numFmt = EUR_FMT;
      for (let c = 1; c <= 7; c++) {
        row.getCell(c).border = { bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } } };
        if (!row.getCell(c).font) row.getCell(c).font = arial();
      }
      r++;
    }
  }

  // ── TOTAL GÉNÉRAL (somme des sous-totaux d'événement → pas de double compte)
  const totalRow = r + 1;
  const tg = ws.getRow(totalRow);
  tg.getCell(1).value = 'TOTAL GÉNÉRAL';
  const sumHdr = (col: string) => eventHeaderRows.map((n) => `${col}${n}`).join(',') || '0';
  tg.getCell(6).value = { formula: eventHeaderRows.length ? `SUM(${sumHdr('F')})` : '0' };
  tg.getCell(6).numFmt = H_FMT;
  tg.getCell(7).value = { formula: eventHeaderRows.length ? `SUM(${sumHdr('G')})` : '0' };
  tg.getCell(7).numFmt = EUR_FMT;
  for (let c = 1; c <= 7; c++) {
    tg.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
    tg.getCell(c).font = arial({ bold: true, size: 11 });
    tg.getCell(c).alignment = { horizontal: c >= 6 ? 'right' : 'left' };
  }

  applyPrintLayout(ws, 'G', totalRow);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * RAPPORT RH SUR PÉRIODE (« Exporter Excel » de RH Analytique) — version DAF
 * habillée. Remplace l'ancien AOA brut par un classeur homogène :
 *   • Synthèse (qui payer) : 1 ligne/personne, circuit franchise/contrat, à verser.
 *   • Par événement : événements de la période, noms rattachés + heures + horaires.
 *   • Par mois : 1 ligne/personne × mois (circuit, missions, heures, coût).
 * Mêmes règles d'habillage que la paie mensuelle (voir docs/excel-rapport-rh.md).
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Bandeau + en-tête de colonnes standard (lignes 1→5), homogène sur toutes les feuilles. */
function sheetBanner(
  ws: ExcelJS.Worksheet,
  lastCol: string,
  title: string,
  subtitle: string,
  legend: string,
  headers: string[],
  arial: (extra?: Partial<ExcelJS.Font>) => Partial<ExcelJS.Font>,
  rightFrom = 2,
): void {
  ws.mergeCells(`A1:${lastCol}1`);
  const t = ws.getCell('A1');
  t.value = title;
  t.font = arial({ size: 14, bold: true, color: { argb: 'FFFFFFFF' } });
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  t.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(1).height = 26;
  ws.mergeCells(`A2:${lastCol}2`);
  const st = ws.getCell('A2');
  st.value = subtitle;
  st.font = arial({ italic: true, color: { argb: 'FF334155' } });
  st.alignment = { horizontal: 'center' };
  ws.mergeCells(`A3:${lastCol}3`);
  const lg = ws.getCell('A3');
  lg.value = legend;
  lg.font = arial({ bold: true });
  lg.alignment = { horizontal: 'center' };
  ws.getRow(4).height = 4;
  const head = ws.getRow(5);
  headers.forEach((h, i) => {
    const c = head.getCell(i + 1);
    c.value = h;
    c.font = arial({ bold: true, color: { argb: 'FFFFFFFF' } });
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    c.alignment = { horizontal: i + 1 >= rightFrom ? 'right' : 'left', vertical: 'middle' };
  });
  head.height = 20;
}

/** Libellé de circuit agrégé sur la période. */
function circuitOf(circuits: Set<string>): string {
  if (circuits.size === 0) return 'non défini';
  if (circuits.size === 1) return [...circuits][0];
  return 'mixte';
}

export async function downloadHoursReportWorkbook(
  debut: string,
  fin: string,
  monthRows: PayrollRow[],
  detail: PayrollDetailRow[] = [],
  origin = '',
): Promise<void> {
  const ExcelJSMod = (await loadModule(() => import('exceljs'))).default;
  const wb = new ExcelJSMod.Workbook();
  wb.creator = 'StockPilot MD';
  const arial = (extra: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({ name: 'Arial', size: 10, ...extra });
  const label = debut === fin ? debut : `${debut} → ${fin}`;

  // ── Agrégat par personne (sur la période)
  interface Agg { staff_name: string; circuits: Set<string>; heures: number; cout: number; mois: Set<string> }
  const byPers = new Map<string, Agg>();
  for (const r of monthRows) {
    const a = byPers.get(r.staff_name) ?? { staff_name: r.staff_name, circuits: new Set<string>(), heures: 0, cout: 0, mois: new Set<string>() };
    a.heures += r.heures; a.cout += r.cout_ht; a.mois.add(r.mois);
    if (r.type_paiement && r.type_paiement !== 'non défini') a.circuits.add(r.type_paiement);
    byPers.set(r.staff_name, a);
  }
  const persons = [...byPers.values()].sort((a, b) => a.staff_name.localeCompare(b.staff_name));
  let totFranchise = 0, totContrat = 0;
  for (const r of monthRows) {
    if (r.type_paiement === 'franchise') totFranchise += r.cout_ht;
    else if (r.type_paiement === 'contrat') totContrat += r.cout_ht;
  }

  // ═══ Feuille 1 — SYNTHÈSE (qui payer) ═══
  const s = wb.addWorksheet(`Synthèse ${label}`.slice(0, 31), { views: [{ state: 'frozen', ySplit: 5 }] });
  [30, 20, 10, 14, 14].forEach((w, i) => (s.getColumn(i + 1).width = w));
  sheetBanner(s, 'E',
    'PROVENCE RUGBY — Synthèse RH (qui payer)',
    `À l'attention du DAF · Période : ${label}`,
    'Circuit : ROUGE = Franchise (à facturer) · VERT = Contrat (à intégrer en paie). « À verser » = Coût HT.',
    ['Personne', 'Circuit', 'Heures', 'Coût HT (€)', 'À verser (€)'], arial, 3);
  const first = 6;
  persons.forEach((p, i) => {
    const rr = first + i;
    const circ = circuitOf(p.circuits);
    const row = s.getRow(rr);
    row.getCell(1).value = p.staff_name;
    row.getCell(1).font = arial({ bold: true, color: { argb: nameColor(circ) } });
    row.getCell(2).value = circ;
    row.getCell(2).font = arial({ color: { argb: nameColor(circ) } });
    row.getCell(3).value = p.heures; row.getCell(3).numFmt = H_FMT;
    row.getCell(4).value = Math.round(p.cout * 100) / 100; row.getCell(4).numFmt = EUR_FMT;
    row.getCell(5).value = { formula: `D${rr}` }; row.getCell(5).numFmt = EUR_FMT; row.getCell(5).font = arial({ bold: true });
    for (let c = 1; c <= 5; c++) row.getCell(c).border = { bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } } };
  });
  const last = first + persons.length - 1;
  const hi = Math.max(first, last);
  const totalRow = hi + 2;
  const tg = s.getRow(totalRow);
  tg.getCell(1).value = 'TOTAL GÉNÉRAL';
  tg.getCell(3).value = { formula: `SUM(C${first}:C${hi})` }; tg.getCell(3).numFmt = H_FMT;
  tg.getCell(4).value = { formula: `SUM(D${first}:D${hi})` }; tg.getCell(4).numFmt = EUR_FMT;
  tg.getCell(5).value = { formula: `SUM(E${first}:E${hi})` }; tg.getCell(5).numFmt = EUR_FMT;
  for (let c = 1; c <= 5; c++) { tg.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } }; tg.getCell(c).font = arial({ bold: true, size: 11 }); }
  const frRow = s.getRow(totalRow + 2);
  frRow.getCell(1).value = 'Total FRANCHISE (à facturer)';
  frRow.getCell(1).font = arial({ bold: true, color: { argb: RED } });
  frRow.getCell(4).value = Math.round(totFranchise * 100) / 100; frRow.getCell(4).numFmt = EUR_FMT; frRow.getCell(4).font = arial({ bold: true, color: { argb: RED } });
  const coRow = s.getRow(totalRow + 3);
  coRow.getCell(1).value = 'Total CONTRAT (à intégrer en paie)';
  coRow.getCell(1).font = arial({ bold: true, color: { argb: GREEN } });
  coRow.getCell(4).value = Math.round(totContrat * 100) / 100; coRow.getCell(4).numFmt = EUR_FMT; coRow.getCell(4).font = arial({ bold: true, color: { argb: GREEN } });
  applyPrintLayout(s, 'E', totalRow + 3);

  // ═══ Feuille 2 — PAR ÉVÉNEMENT (noms + heures) ═══
  const nameRows: PayrollRow[] = persons.map((p) => ({
    staff_name: p.staff_name, type_paiement: circuitOf(p.circuits), mois: label,
    missions: '', heures: p.heures, cout_ht: p.cout, nb_evenements: 0,
  }));
  if (detail.length > 0) buildEventSheet(wb, label, nameRows, detail, arial, origin);

  // ═══ Feuille 3 — PAR MOIS (personne × mois) ═══
  const m = wb.addWorksheet(`Par mois ${label}`.slice(0, 31), { views: [{ state: 'frozen', ySplit: 5 }] });
  [28, 16, 10, 26, 10, 14, 12].forEach((w, i) => (m.getColumn(i + 1).width = w));
  sheetBanner(m, 'G',
    'PROVENCE RUGBY — Heures RH par personne et par mois',
    `Période : ${label}`,
    'Circuit : ROUGE = Franchise · VERT = Contrat. Une ligne par personne et par mois.',
    ['Personne', 'Circuit', 'Mois', 'Missions', 'Heures', 'Coût HT (€)', 'Nb évts'], arial, 5);
  const sorted = [...monthRows].sort((a, b) => a.staff_name.localeCompare(b.staff_name) || a.mois.localeCompare(b.mois));
  let r = 6;
  for (const mr of sorted) {
    const row = m.getRow(r);
    row.getCell(1).value = mr.staff_name;
    row.getCell(1).font = arial({ bold: true, color: { argb: nameColor(mr.type_paiement) } });
    row.getCell(2).value = mr.type_paiement;
    row.getCell(2).font = arial({ color: { argb: nameColor(mr.type_paiement) } });
    row.getCell(3).value = mr.mois;
    row.getCell(4).value = mr.missions; row.getCell(4).font = arial({ color: { argb: GREY } });
    row.getCell(5).value = mr.heures; row.getCell(5).numFmt = H_FMT;
    row.getCell(6).value = Math.round(mr.cout_ht * 100) / 100; row.getCell(6).numFmt = EUR_FMT;
    row.getCell(7).value = mr.nb_evenements; row.getCell(7).alignment = { horizontal: 'right' };
    for (let c = 1; c <= 7; c++) { row.getCell(c).border = { bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } } }; if (!row.getCell(c).font) row.getCell(c).font = arial(); }
    r++;
  }
  const mTot = m.getRow(r + 1);
  mTot.getCell(1).value = 'TOTAL';
  mTot.getCell(5).value = { formula: `SUM(E6:E${r - 1})` }; mTot.getCell(5).numFmt = H_FMT;
  mTot.getCell(6).value = { formula: `SUM(F6:F${r - 1})` }; mTot.getCell(6).numFmt = EUR_FMT;
  for (let c = 1; c <= 7; c++) { mTot.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } }; mTot.getCell(c).font = arial({ bold: true }); }
  applyPrintLayout(m, 'G', r + 1);

  download(await wb.xlsx.writeBuffer(), `RH_heures_${debut}_${fin}.xlsx`);
}
