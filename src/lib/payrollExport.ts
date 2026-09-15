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

/** Une ligne de détail = une personne × un événement × une nature de charge.
 *  Source : vue rh_monthly_event_detail (réconcilie avec rh_monthly_hours). */
export interface PayrollDetailRow {
  staff_name: string;
  categorie: string; // 'Match' | 'Séminaire' | 'Opérationnel' | 'Autre'
  event_name: string;
  event_date: string; // 'YYYY-MM-DD'
  nature: string;     // Service espace / Runner / Montage / Responsable espace…
  espace: string;
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

  // ═══════════════════════════════════════════════════════════════════════
  // FEUILLE 2 — DÉTAIL PAR ÉVÉNEMENT (justification des charges de paie)
  // Une ligne par personne × événement × nature ; blocs par personne, avec
  // sous-total vivant par personne + sous-totaux par catégorie (Match /
  // Séminaire / Opérationnel) en bas. La somme du détail d'une personne =
  // son « À verser » de la feuille 1 (vue rh_monthly_event_detail).
  // ═══════════════════════════════════════════════════════════════════════
  if (detail.length > 0) {
    buildDetailSheet(wb, mois, rows, detail, arial);
  }

  download(await wb.xlsx.writeBuffer(), `Recap_paie_${mois}.xlsx`);
}

/** Ordre chronologique par date d'événement, puis nature. */
function byDateThenNature(a: PayrollDetailRow, b: PayrollDetailRow): number {
  if (a.event_date !== b.event_date) return a.event_date < b.event_date ? -1 : 1;
  return a.nature.localeCompare(b.nature);
}

/** Date FR courte (JJ/MM) à partir d'un 'YYYY-MM-DD'. */
function frShort(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}/${m[2]}` : d;
}

function buildDetailSheet(
  wb: ExcelJS.Workbook,
  mois: string,
  rows: PayrollRow[],
  detail: PayrollDetailRow[],
  arial: (extra?: Partial<ExcelJS.Font>) => Partial<ExcelJS.Font>,
): void {
  const ws = wb.addWorksheet(`Détail ${mois}`, { views: [{ state: 'frozen', ySplit: 5 }] });

  // Colonnes A..G : Date · Événement · Type · Poste · Espace · Heures · Coût HT
  [12, 26, 14, 20, 22, 10, 14].forEach((w, i) => (ws.getColumn(i + 1).width = w));

  // Circuit de paiement par personne (couleur du nom, repris de la feuille 1)
  const typeByName = new Map(rows.map((r) => [r.staff_name, r.type_paiement]));

  // ── Bandeaux
  ws.mergeCells('A1:G1');
  const t = ws.getCell('A1');
  t.value = 'PROVENCE RUGBY — Détail des charges RH par événement';
  t.font = arial({ size: 14, bold: true, color: { argb: 'FFFFFFFF' } });
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  t.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(1).height = 26;

  ws.mergeCells('A2:G2');
  const st = ws.getCell('A2');
  st.value = `Justification des charges par événement · Mois : ${mois}`;
  st.font = arial({ italic: true, color: { argb: 'FF334155' } });
  st.alignment = { horizontal: 'center' };

  ws.mergeCells('A3:G3');
  const lg = ws.getCell('A3');
  lg.value = 'Type : BLEU = Match · VIOLET = Séminaire · AMBRE = Opérationnel (montage, livraison). '
    + 'Total d’une personne = son « À verser » de la feuille Récap.';
  lg.font = arial({ bold: true });
  lg.alignment = { horizontal: 'center' };
  ws.getRow(4).height = 4;

  // ── En-tête colonnes (ligne 5)
  const headers = ['Date', 'Événement', 'Type', 'Poste', 'Espace', 'Heures', 'Coût HT (€)'];
  const head = ws.getRow(5);
  headers.forEach((h, i) => {
    const c = head.getCell(i + 1);
    c.value = h;
    c.font = arial({ bold: true, color: { argb: 'FFFFFFFF' } });
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    c.alignment = { horizontal: i >= 5 ? 'right' : 'left', vertical: 'middle' };
  });
  head.height = 20;

  // ── Blocs par personne (ordre alphabétique, comme la feuille 1)
  const names = Array.from(new Set(detail.map((d) => d.staff_name))).sort((a, b) => a.localeCompare(b));
  const subheaderRows: number[] = []; // pour le total général vivant
  let r = 6;

  for (const name of names) {
    const lines = detail.filter((d) => d.staff_name === name).sort(byDateThenNature);
    if (lines.length === 0) continue;

    // Sous-en-tête personne : nom coloré par circuit + sous-total vivant
    const shRow = r;
    subheaderRows.push(shRow);
    ws.mergeCells(`A${shRow}:E${shRow}`);
    const nameCell = ws.getCell(`A${shRow}`);
    const pa5 = typeByName.get(name) ?? 'non défini';
    nameCell.value = `▸ ${name}  —  ${pa5}`;
    nameCell.font = arial({ bold: true, size: 11, color: { argb: nameColor(pa5) } });
    nameCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
    nameCell.alignment = { vertical: 'middle' };

    const firstLine = shRow + 1;
    const lastLine = shRow + lines.length;
    // Sous-totaux personne (formules vivantes sur SES lignes)
    const shH = ws.getCell(`F${shRow}`);
    shH.value = { formula: `SUM(F${firstLine}:F${lastLine})` };
    shH.numFmt = H_FMT;
    shH.font = arial({ bold: true });
    shH.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
    shH.alignment = { horizontal: 'right' };
    const shC = ws.getCell(`G${shRow}`);
    shC.value = { formula: `SUM(G${firstLine}:G${lastLine})` };
    shC.numFmt = EUR_FMT;
    shC.font = arial({ bold: true });
    shC.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
    shC.alignment = { horizontal: 'right' };
    r++;

    // Lignes de détail
    for (const l of lines) {
      const row = ws.getRow(r);
      row.getCell(1).value = frShort(l.event_date);
      row.getCell(1).font = arial({ color: { argb: GREY } });
      row.getCell(2).value = l.event_name;
      row.getCell(2).font = arial();
      row.getCell(3).value = l.categorie;
      row.getCell(3).font = arial({ bold: true, color: { argb: catColor(l.categorie) } });
      row.getCell(4).value = l.nature;
      row.getCell(4).font = arial({ color: { argb: GREY } });
      row.getCell(5).value = l.espace;
      row.getCell(5).font = arial({ color: { argb: GREY } });
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

  // ── TOTAL GÉNÉRAL (= somme des sous-totaux personnes → jamais de double compte)
  const totalRow = r + 1;
  const tg = ws.getRow(totalRow);
  tg.getCell(1).value = 'TOTAL GÉNÉRAL';
  const sumSub = (col: string) => subheaderRows.map((n) => `${col}${n}`).join('+') || '0';
  tg.getCell(6).value = { formula: subheaderRows.length ? `SUM(${sumSub('F').replace(/\+/g, ',')})` : '0' };
  tg.getCell(6).numFmt = H_FMT;
  tg.getCell(7).value = { formula: subheaderRows.length ? `SUM(${sumSub('G').replace(/\+/g, ',')})` : '0' };
  tg.getCell(7).numFmt = EUR_FMT;
  for (let c = 1; c <= 7; c++) {
    tg.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
    tg.getCell(c).font = arial({ bold: true, size: 11 });
    tg.getCell(c).alignment = { horizontal: c >= 6 ? 'right' : 'left' };
  }

  // ── Sous-totaux par CATÉGORIE (SUMIF sur la colonne Type = C, uniquement
  //    renseignée sur les lignes de détail → pas de double compte).
  //    Dynamique : une ligne par catégorie RÉELLEMENT présente ce mois-ci, dans
  //    l'ordre métier (Match, Séminaire, …, Opérationnel), le reste alphabétique.
  //    → une nouvelle catégorie (cocktail, réception…) obtient son sous-total
  //      automatiquement, sans retoucher ce code.
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
    cr.getCell(6).value = { formula: `SUMIF($C:$C,"${key}",$F:$F)` };
    cr.getCell(6).numFmt = H_FMT;
    cr.getCell(6).font = arial({ bold: true, color: { argb: catColor(cat) } });
    cr.getCell(6).alignment = { horizontal: 'right' };
    cr.getCell(7).value = { formula: `SUMIF($C:$C,"${key}",$G:$G)` };
    cr.getCell(7).numFmt = EUR_FMT;
    cr.getCell(7).font = arial({ bold: true, color: { argb: catColor(cat) } });
    cr.getCell(7).alignment = { horizontal: 'right' };
  });
}
