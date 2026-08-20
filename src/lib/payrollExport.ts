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

const NAVY = 'FF1A1A2E';
const RED = 'FFC00000';
const GREEN = 'FF1E7A34';
const GREY = 'FF6B7280';
const LIGHT = 'FFF3F4F6';

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
export async function downloadPayrollWorkbook(mois: string, rows: PayrollRow[]): Promise<void> {
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

  download(await wb.xlsx.writeBuffer(), `Recap_paie_${mois}.xlsx`);
}
