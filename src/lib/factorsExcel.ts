/**
 * factorsExcel — export Excel « premium » des facteurs historiques
 * (space_product_coefficients). Objectif : lire entre les lignes AVEC CERTITUDE.
 *
 * Chiffres bruts (moyenne, écart-type, /100 pax, nb matchs, confiance) + analyses
 * DÉRIVÉES pilotées par formule :
 *   • CV %  = écart-type / moyenne   → volatilité (bas = prévisible / fiable).
 *   • Fourchette [moy−σ ; moy+σ]     → intervalle où tombe ~68 % des matchs.
 *   • Borne haute (moy+σ)            → dotation « sécurisée » couvrant la variabilité.
 * Barres de données (Moyenne, Borne haute), échelle de couleur sur le CV, pastille
 * de confiance. Feuille de synthèse (par confiance, par catégorie).
 */

import type * as ExcelJS from 'exceljs';
import { loadModule } from '@/lib/lazyModule';

export interface FactorRow {
  space_name: string;
  service_type: string | null;
  product_name: string;
  category: string;
  moy_historique: number;
  std_deviation: number;
  confidence_level: string;
  conso_per_100_pax: number;
  avg_pax_match: number;
  nb_matchs_historique: number;
  pax_normalized: boolean;
  last_computed_at: string | null;
}

const NAVY = 'FF0B1F3A', GOLD = 'FFC9A227', WHITE = 'FFFFFFFF', GREY = 'FF8A94A2';
const NUM1 = '#,##0.0', INT = '#,##0', PCT = '0.0%';
const CONF_FILL: Record<string, string> = {
  'très élevé': 'FF1D7A46', 'élevé': 'FF4FA96B', 'moyen': 'FFC98A1E', 'faible': 'FFB03A2E',
};
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const fill = (argb: string): ExcelJS.FillPattern => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

function hdr(ws: ExcelJS.Worksheet, r: number, c: number, v: string) {
  const x = ws.getCell(r, c);
  x.value = v;
  x.font = { name: 'Arial', size: 9, bold: true, color: { argb: WHITE } };
  x.fill = fill(NAVY);
  x.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  x.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
}
function bordered(x: ExcelJS.Cell) {
  const t = { style: 'thin' as const, color: { argb: 'FFD8DEE6' } };
  x.border = { top: t, bottom: t, left: t, right: t };
  return x;
}
function band(ws: ExcelJS.Worksheet, title: string, sub: string, ncols: number) {
  ws.mergeCells(1, 1, 1, ncols);
  const t = ws.getCell(1, 1);
  t.value = title; t.font = { name: 'Arial', size: 18, bold: true, color: { argb: WHITE } };
  t.fill = fill(NAVY); t.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 30;
  ws.mergeCells(2, 1, 2, ncols);
  const s = ws.getCell(2, 1);
  s.value = sub; s.font = { name: 'Arial', size: 10, color: { argb: WHITE } };
  s.fill = fill(NAVY); s.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(2).height = 16;
  for (let c = 1; c <= ncols; c++) ws.getCell(3, c).fill = fill(GOLD);
  ws.getRow(3).height = 3;
}
function dataBar(ws: ExcelJS.Worksheet, ref: string, argb: string) {
  ws.addConditionalFormatting({
    ref, rules: [{ type: 'dataBar', cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb }, gradient: false }],
  } as unknown as ExcelJS.ConditionalFormattingOptions);
}

function download(buf: ExcelJS.Buffer, name: string) {
  const b = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const u = URL.createObjectURL(b);
  const a = document.createElement('a');
  a.href = u; a.download = name; a.click();
  URL.revokeObjectURL(u);
}

export async function downloadFactorsWorkbook(rows: FactorRow[], lastComputed: string | null): Promise<void> {
  const XLSX = (await loadModule(() => import('exceljs'))).default;
  const wb = new XLSX.Workbook();
  wb.creator = 'StockPilot MD';

  // Tri : espace, puis moyenne décroissante (les postes majeurs en tête).
  const sorted = [...rows].sort((a, b) => a.space_name.localeCompare(b.space_name, 'fr') || num(b.moy_historique) - num(a.moy_historique));

  // ── Feuille FACTEURS ──────────────────────────────────────────────────
  const f = wb.addWorksheet('Facteurs', { views: [{ showGridLines: false, state: 'frozen', ySplit: 4 }] });
  [20, 26, 13, 11, 11, 9, 11, 11, 10, 9, 13].forEach((w, i) => (f.getColumn(i + 1).width = w));
  band(f, 'FACTEURS HISTORIQUES — ESPACE × PRODUIT',
    `Conso réelle des matchs clôturés · moyenne ± écart-type, fiabilité (CV), fourchette & borne sécurisée${lastComputed ? ` · calcul du ${new Date(lastComputed).toLocaleDateString('fr-FR')}` : ''}`, 11);
  ['Espace', 'Produit', 'Catégorie', 'Moyenne', 'Écart-type', 'CV %', 'Borne basse', 'Borne haute', '/100 pax', 'Matchs', 'Confiance']
    .forEach((h, i) => hdr(f, 4, i + 1, h));

  sorted.forEach((r, i) => {
    const row = 5 + i;
    bordered(f.getCell(row, 1)).value = r.space_name;
    f.getCell(row, 1).font = { name: 'Arial', size: 9, bold: true };
    bordered(f.getCell(row, 2)).value = r.product_name;
    bordered(f.getCell(row, 3)).value = r.category;
    f.getCell(row, 3).font = { name: 'Arial', size: 9, color: { argb: GREY } };
    const moy = bordered(f.getCell(row, 4)); moy.value = num(r.moy_historique); moy.numFmt = NUM1; moy.font = { name: 'Arial', size: 9, bold: true };
    const sig = bordered(f.getCell(row, 5)); sig.value = num(r.std_deviation); sig.numFmt = NUM1;
    // CV % = écart-type / moyenne (formule vivante).
    bordered(f.getCell(row, 6)).value = { formula: `IFERROR(E${row}/D${row},0)` };
    f.getCell(row, 6).numFmt = PCT;
    // Fourchette moy ∓ σ.
    bordered(f.getCell(row, 7)).value = { formula: `MAX(0,D${row}-E${row})` };
    f.getCell(row, 7).numFmt = NUM1;
    bordered(f.getCell(row, 8)).value = { formula: `D${row}+E${row}` };
    f.getCell(row, 8).numFmt = NUM1; f.getCell(row, 8).font = { name: 'Arial', size: 9, bold: true };
    const p100 = bordered(f.getCell(row, 9));
    if (r.pax_normalized) { p100.value = num(r.conso_per_100_pax); p100.numFmt = NUM1; } else { p100.value = '—'; p100.alignment = { horizontal: 'right' }; p100.font = { name: 'Arial', size: 9, color: { argb: GREY } }; }
    bordered(f.getCell(row, 10)).value = num(r.nb_matchs_historique); f.getCell(row, 10).numFmt = INT; f.getCell(row, 10).alignment = { horizontal: 'center' };
    const cf = bordered(f.getCell(row, 11));
    cf.value = r.confidence_level || '—';
    cf.alignment = { horizontal: 'center' };
    if (CONF_FILL[r.confidence_level]) { cf.fill = fill(CONF_FILL[r.confidence_level]); cf.font = { name: 'Arial', size: 9, bold: true, color: { argb: WHITE } }; }
  });
  const last = 4 + sorted.length;
  // Barres de données : Moyenne (bleu) & Borne haute sécurisée (or).
  dataBar(f, `D5:D${last}`, 'FF2F6FED');
  dataBar(f, `H5:H${last}`, GOLD);
  // Échelle de couleur sur le CV : vert (fiable) → rouge (volatil).
  f.addConditionalFormatting({
    ref: `F5:F${last}`,
    rules: [{
      type: 'colorScale',
      cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 0.35 }, { type: 'num', value: 0.7 }],
      color: [{ argb: 'FF1D7A46' }, { argb: 'FFF4D03F' }, { argb: 'FFB03A2E' }],
    }],
  } as unknown as ExcelJS.ConditionalFormattingOptions);

  // Légende de lecture.
  const lg = last + 2;
  f.getCell(lg, 1).value = 'Lecture : Borne haute (Moyenne + σ) = dotation sécurisée couvrant ~84 % des matchs. CV bas (vert) = besoin stable & prévisible ; CV haut (rouge) = volatil, marge à prévoir. Confiance = robustesse de l\'échantillon (nb matchs).';
  f.getCell(lg, 1).font = { name: 'Arial', size: 8, italic: true, color: { argb: GREY } };
  f.mergeCells(lg, 1, lg, 11); f.getCell(lg, 1).alignment = { wrapText: true, vertical: 'top' }; f.getRow(lg).height = 28;

  // ── Feuille SYNTHÈSE ──────────────────────────────────────────────────
  const s = wb.addWorksheet('Synthèse', { views: [{ showGridLines: false }] });
  [22, 14, 16, 14].forEach((w, i) => (s.getColumn(i + 1).width = w));
  band(s, 'SYNTHÈSE DES FACTEURS', 'Fiabilité par niveau de confiance · profil par catégorie (formules liées à Facteurs)', 4);

  s.getCell(5, 1).value = 'PAR NIVEAU DE CONFIANCE';
  s.getCell(5, 1).font = { name: 'Arial', size: 11, bold: true, color: { argb: NAVY } };
  ['Confiance', 'Nb produits', '% du référentiel'].forEach((h, i) => hdr(s, 6, i + 1, h));
  ['très élevé', 'élevé', 'moyen', 'faible'].forEach((lvl, i) => {
    const r = 7 + i;
    const c1 = bordered(s.getCell(r, 1)); c1.value = lvl;
    if (CONF_FILL[lvl]) { c1.fill = fill(CONF_FILL[lvl]); c1.font = { name: 'Arial', bold: true, color: { argb: WHITE } }; }
    bordered(s.getCell(r, 2)).value = { formula: `COUNTIF(Facteurs!K5:K${last},A${r})` }; s.getCell(r, 2).numFmt = INT;
    bordered(s.getCell(r, 3)).value = { formula: `IFERROR(B${r}/SUM($B$7:$B$10),0)` }; s.getCell(r, 3).numFmt = PCT;
  });

  const catStart = 12;
  s.getCell(catStart, 1).value = 'PAR CATÉGORIE';
  s.getCell(catStart, 1).font = { name: 'Arial', size: 11, bold: true, color: { argb: NAVY } };
  ['Catégorie', 'Nb produits', 'Moyenne moy.', 'CV moyen'].forEach((h, i) => hdr(s, catStart + 1, i + 1, h));
  const cats = [...new Set(sorted.map((r) => r.category))].filter(Boolean).sort();
  cats.forEach((cat, i) => {
    const r = catStart + 2 + i;
    bordered(s.getCell(r, 1)).value = cat; s.getCell(r, 1).font = { name: 'Arial', size: 9, bold: true };
    bordered(s.getCell(r, 2)).value = { formula: `COUNTIF(Facteurs!C5:C${last},A${r})` }; s.getCell(r, 2).numFmt = INT;
    bordered(s.getCell(r, 3)).value = { formula: `IFERROR(AVERAGEIF(Facteurs!C5:C${last},A${r},Facteurs!D5:D${last}),0)` }; s.getCell(r, 3).numFmt = NUM1;
    bordered(s.getCell(r, 4)).value = { formula: `IFERROR(AVERAGEIF(Facteurs!C5:C${last},A${r},Facteurs!F5:F${last}),0)` }; s.getCell(r, 4).numFmt = PCT;
  });
  dataBar(s, `B${catStart + 2}:B${catStart + 1 + cats.length}`, 'FF2F6FED');

  // Impression homogène.
  wb.eachSheet((ws) => {
    ws.pageSetup = { ...ws.pageSetup, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true, margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.55, header: 0.2, footer: 0.3 } };
    if (ws.name === 'Facteurs') ws.pageSetup.printTitlesRow = '4:4';
    ws.headerFooter = { oddFooter: '&C&P / &N' };
  });

  download(await wb.xlsx.writeBuffer(), `Facteurs_historiques_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
