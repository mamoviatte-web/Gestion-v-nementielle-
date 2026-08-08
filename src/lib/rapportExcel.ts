/**
 * rapportExcel — export Excel « premium » pour un match / séminaire clôturé.
 * Piloté par formules (stocks & PU éditables → Consommé/Coût/Taux recalculés) +
 * barres de données par catégorie / espace / fût. Aucun graphique natif (ExcelJS).
 * Source : get_match_report / get_seminaire_report (RG-003 : réservé ROLE_STADE).
 */

import type * as ExcelJS from 'exceljs';
import { supabase } from '@/lib/supabase';

type WS = ExcelJS.Worksheet;
type WB = ExcelJS.Workbook;
type Cell = ExcelJS.Cell;

interface Produit {
  produit: string;
  categorie: string;
  init: number;
  fin: number;
  pu: number;
}
interface Fut {
  fut: string;
  unites: number;
  pu: number;
}
interface Segment {
  segment: string;
  espaces: number;
  unites: number;
  cout: number;
}
interface EspaceMatch {
  espace: string;
  segment: string;
  unites: number;
  cout: number;
}
interface CategorieRow {
  categorie: string;
  unites: number;
  cout: number;
}
interface RhData {
  kpis: {
    nb_agents: number;
    nb_espaces: number;
    total_heures: number | null;
    cout_rh_ht: number | null;
    cout_resto: number;
    cout_hors_resto: number;
    cout_par_pax: number | null;
  };
  par_espace: { espace: string; agents: number; heures: number; cout: number }[];
  par_pole: { pole: string; agents: number; heures: number; cout: number }[];
  agents: { nom: string; prenom: string; role: string; rattachement: string; heures: number; taux: number; cout: number }[];
}
interface MatchReport {
  match: { name: string; date: string; pax: number };
  segments: Segment[];
  categories: CategorieRow[];
  espaces: EspaceMatch[];
  futs: Fut[];
  produits: Produit[];
  rh?: RhData | null;
}
interface EspaceSem {
  espace: string;
  profil: string;
  unites: number;
  cout: number;
}
interface SeminaireReport {
  seminaire: { name: string; date: string; participants: number; facture_pax: number | null };
  espaces: EspaceSem[];
  categories: CategorieRow[];
  produits: Produit[];
}

const NAVY = 'FF0B1F3A',
  GOLD = 'FFC9A227',
  WHITE = 'FFFFFFFF',
  GREY = 'FF8A94A2',
  LIGHT = 'FFF2F5F9',
  YEL = 'FFFFF7E6';
const EUR = '#,##0.00 "€"',
  INT = '#,##0',
  PCT = '0.0%',
  EURpax = '#,##0.00 "€/pax"';
const CAT: Record<string, string> = {
  Bières: 'FFE8792B',
  Vins: 'FF8B46D6',
  Spiritueux: 'FFE0447A',
  Soft: 'FF2F6FED',
  Sirops: 'FF12B3A6',
  Champagne: 'FFC9A227',
  Autres: 'FF94A2B3',
};
const SEG: Record<string, string> = { VIP: 'FFC9A227', Bar: 'FF2F6FED', 'Grand Public': 'FF1D7A46' };

const fill = (argb: string): ExcelJS.FillPattern => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

/** Date longue française : « dimanche 3 mai 2026 ». */
const longDate = (d: string): string => {
  const dt = new Date(d);
  return isNaN(dt.getTime())
    ? d
    : dt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};

function download(buf: ExcelJS.Buffer, name: string): void {
  const b = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const u = URL.createObjectURL(b);
  const a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.click();
  URL.revokeObjectURL(u);
}

function band(ws: WS, title: string, sub: string, ncols: number): void {
  ws.mergeCells(1, 1, 1, ncols);
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { name: 'Arial', size: 20, bold: true, color: { argb: WHITE } };
  t.fill = fill(NAVY);
  t.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 32;
  ws.mergeCells(2, 1, 2, ncols);
  const s = ws.getCell(2, 1);
  s.value = sub;
  s.font = { name: 'Arial', size: 10, color: { argb: WHITE } };
  s.fill = fill(NAVY);
  s.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(2).height = 18;
  for (let c = 1; c <= ncols; c++) ws.getCell(3, c).fill = fill(GOLD);
  ws.getRow(3).height = 3;
}

function hdr(ws: WS, r: number, c: number, v: string): Cell {
  const x = ws.getCell(r, c);
  x.value = v;
  x.font = { name: 'Arial', size: 9, bold: true, color: { argb: WHITE } };
  x.fill = fill(NAVY);
  x.alignment = { horizontal: 'center', vertical: 'middle' };
  x.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  return x;
}

function bordered(x: Cell): Cell {
  const t = { style: 'thin' as const, color: { argb: 'FFD8DEE6' } };
  x.border = { top: t, bottom: t, left: t, right: t };
  return x;
}

/** Barre de données in-cell sur une plage. */
function dataBar(ws: WS, ref: string, argb: string): void {
  // Le type ExcelJS DataBarRuleType omet `color`, mais le runtime l'accepte.
  ws.addConditionalFormatting({
    ref,
    rules: [{ type: 'dataBar', cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb }, gradient: false }],
  } as unknown as ExcelJS.ConditionalFormattingOptions);
}

const colLetter = (c: number): string => String.fromCharCode(64 + c);

/** Feuille « moteur » Produits (commune match & séminaire). Retourne la ligne du total. */
function sheetProduits(wb: WB, produits: Produit[]): number {
  const ws = wb.addWorksheet('Produits', { views: [{ showGridLines: false }] });
  [28, 14, 12, 12, 12, 12, 14, 12].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ['Produit', 'Catégorie', 'Stock initial', 'Stock final', 'Consommé', 'PU HT', 'Coût HT', 'Taux retour'].forEach(
    (h, i) => hdr(ws, 1, i + 1, h),
  );
  produits.forEach((p, i) => {
    const r = i + 2;
    bordered(ws.getCell(r, 1)).value = p.produit;
    ws.getCell(r, 1).font = { name: 'Arial', size: 9, bold: true };
    const cc = ws.getCell(r, 2);
    cc.value = p.categorie;
    cc.font = { name: 'Arial', size: 9, color: { argb: WHITE } };
    cc.fill = fill(CAT[p.categorie] || 'FF94A2B3');
    cc.alignment = { horizontal: 'center' };
    const inC = ws.getCell(r, 3);
    inC.value = p.init;
    inC.numFmt = INT;
    inC.font = { name: 'Arial', size: 9, color: { argb: 'FF0000FF' } };
    inC.fill = fill(YEL);
    bordered(inC);
    const fnC = ws.getCell(r, 4);
    fnC.value = p.fin;
    fnC.numFmt = INT;
    fnC.font = { name: 'Arial', size: 9, color: { argb: 'FF0000FF' } };
    fnC.fill = fill(YEL);
    bordered(fnC);
    bordered(ws.getCell(r, 5)).value = { formula: `C${r}-D${r}` };
    ws.getCell(r, 5).numFmt = INT;
    const pu = ws.getCell(r, 6);
    pu.value = p.pu;
    pu.numFmt = EUR;
    pu.font = { name: 'Arial', size: 9, color: { argb: 'FF0000FF' } };
    pu.fill = fill(YEL);
    bordered(pu);
    bordered(ws.getCell(r, 7)).value = { formula: `E${r}*F${r}` };
    ws.getCell(r, 7).numFmt = EUR;
    bordered(ws.getCell(r, 8)).value = { formula: `IFERROR(D${r}/C${r},0)` };
    ws.getCell(r, 8).numFmt = PCT;
  });
  const tot = produits.length + 2;
  ws.getCell(tot, 1).value = 'TOTAL';
  ws.getCell(tot, 5).value = { formula: `SUM(E2:E${tot - 1})` };
  ws.getCell(tot, 5).numFmt = INT;
  ws.getCell(tot, 7).value = { formula: `SUM(G2:G${tot - 1})` };
  ws.getCell(tot, 7).numFmt = EUR;
  for (let c = 1; c <= 8; c++) {
    const x = ws.getCell(tot, c);
    x.font = { name: 'Arial', bold: true };
    x.fill = fill(GOLD);
    bordered(x);
  }
  ws.getCell(tot + 2, 1).value =
    'Cellules bleues (stocks & PU) = saisie manuelle → Consommé, Coût et Taux se recalculent.';
  ws.getCell(tot + 2, 1).font = { name: 'Arial', size: 8, italic: true, color: { argb: GREY } };
  return tot;
}

function tableau(
  ws: WS,
  startRow: number,
  headers: string[],
  rows: (string | number)[][],
  widths: number[],
  costCol?: number,
  costColor?: string,
): number {
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  headers.forEach((h, i) => hdr(ws, startRow, i + 1, h));
  rows.forEach((row, i) => {
    const r = startRow + 1 + i;
    row.forEach((val, c) => {
      const x = bordered(ws.getCell(r, c + 1));
      x.value = val;
      if (typeof val === 'number' && c > 0) x.alignment = { horizontal: 'center' };
    });
    if (i % 2)
      row.forEach((_, c) => {
        const cell = ws.getCell(r, c + 1);
        if (!(cell.fill as ExcelJS.FillPattern | undefined)?.fgColor) cell.fill = fill(LIGHT);
      });
  });
  if (costCol !== undefined)
    dataBar(
      ws,
      `${colLetter(costCol)}${startRow + 1}:${colLetter(costCol)}${startRow + rows.length}`,
      costColor || 'FFE8792B',
    );
  return startRow + rows.length;
}

/** Feuille « Paramètres » — traçabilité & méthodologie (commune match & séminaire). */
function sheetParametres(wb: WB, rows: [string, string | number][]): void {
  const ws = wb.addWorksheet('Paramètres', { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 28;
  ws.getColumn(2).width = 64;
  band(ws, 'PARAMÈTRES DU RAPPORT', 'Traçabilité & méthodologie', 2);
  rows.forEach((row, i) => {
    const r = 5 + i;
    const k = bordered(ws.getCell(r, 1));
    k.value = row[0];
    k.font = { name: 'Arial', size: 9, bold: true };
    k.fill = fill(LIGHT);
    const v = bordered(ws.getCell(r, 2));
    v.value = row[1];
    v.font = { name: 'Arial', size: 9 };
    v.alignment = { wrapText: true, vertical: 'top' };
  });
}

type KpiDef = [string, ExcelJS.CellValue, string, string, number];

export async function genererRapportMatch(eventId: string): Promise<void> {
  const { data, error } = await supabase.rpc('get_match_report', { p_event_id: eventId });
  if (error || !data) {
    alert('Rapport indisponible : ' + (error?.message || ''));
    return;
  }
  const rep = data as MatchReport;
  const XLSX = (await import('exceljs')).default;
  const wb = new XLSX.Workbook();
  wb.creator = 'StockPilot MD';
  const totProd = sheetProduits(wb, rep.produits);

  // --- Synthèse ---
  const s = wb.addWorksheet('Synthèse', { views: [{ showGridLines: false }] });
  [22, 20, 16, 16, 16, 16, 16, 16].forEach((w, i) => (s.getColumn(i + 1).width = w));
  band(
    s,
    `RAPPORT DE MATCH — ${String(rep.match.name).toUpperCase()}`,
    `${longDate(rep.match.date)}  ·  ${rep.match.pax.toLocaleString('fr-FR')} spectateurs  ·  Provence Rugby · Stade Maurice-David`,
    8,
  );
  const pax = rep.match.pax || 1;
  // Ligne 4 : Coût RH + Coût total événement (F&B + RH).
  const rhCost = rep.rh?.kpis?.cout_rh_ht ?? 0;
  s.getCell(4, 1).value = 'COÛT RH HT';
  s.getCell(4, 1).font = { name: 'Arial', size: 8, bold: true, color: { argb: GREY } };
  s.getCell(4, 2).value = rhCost;
  s.getCell(4, 2).numFmt = EUR;
  s.getCell(4, 2).font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FF2F6FED' } };
  s.getCell(4, 4).value = 'COÛT TOTAL ÉVÉNEMENT';
  s.getCell(4, 4).font = { name: 'Arial', size: 8, bold: true, color: { argb: GREY } };
  s.getCell(4, 5).value = { formula: `Produits!G${totProd}+${rhCost}` };
  s.getCell(4, 5).numFmt = EUR;
  s.getCell(4, 5).font = { name: 'Arial', size: 12, bold: true, color: { argb: NAVY } };
  const kpis: KpiDef[] = [
    ['COÛT F&B HT', { formula: `Produits!G${totProd}` }, EUR, NAVY, 1],
    ['COÛT / SPECTATEUR', { formula: `Produits!G${totProd}/${pax}` }, EURpax, 'FF12B3A6', 3],
    ['UNITÉS', { formula: `Produits!E${totProd}` }, INT, 'FFE0447A', 5],
    ['FÛTS', rep.futs.reduce((a, f) => a + f.unites, 0), INT, GOLD, 7],
  ];
  kpis.forEach(([lab, val, fmt, ac, col]) => {
    s.mergeCells(5, col, 5, col + 1);
    const l = s.getCell(5, col);
    l.value = lab;
    l.font = { name: 'Arial', size: 8, bold: true, color: { argb: GREY } };
    s.mergeCells(6, col, 6, col + 1);
    const v = s.getCell(6, col);
    v.value = val;
    v.numFmt = fmt;
    v.font = { name: 'Arial', size: 16, bold: true, color: { argb: ac } };
    s.mergeCells(7, col, 7, col + 1);
    s.getCell(7, col).fill = fill(ac);
    s.getRow(7).height = 3;
  });
  s.getRow(6).height = 26;
  s.getCell(9, 1).value = 'RÉPARTITION PAR SEGMENT';
  s.getCell(9, 1).font = { name: 'Arial', size: 12, bold: true, color: { argb: NAVY } };
  const hr = 10;
  ['Segment', 'Espaces', 'Unités', 'Coût HT', '% coût', 'Coût / spectateur'].forEach((h, i) => hdr(s, hr, i + 1, h));
  const segTot = hr + 1 + rep.segments.length; // ligne TOTAL
  rep.segments.forEach((x, i) => {
    const r = hr + 1 + i;
    const seg = s.getCell(r, 1);
    seg.value = x.segment;
    seg.font = { name: 'Arial', bold: true, color: { argb: WHITE } };
    seg.fill = fill(SEG[x.segment] || 'FF94A2B3');
    s.getCell(r, 2).value = x.espaces;
    s.getCell(r, 3).value = x.unites;
    s.getCell(r, 3).numFmt = INT;
    s.getCell(r, 4).value = x.cout;
    s.getCell(r, 4).numFmt = EUR;
    s.getCell(r, 5).value = { formula: `IFERROR(D${r}/D${segTot},0)` };
    s.getCell(r, 5).numFmt = PCT;
    s.getCell(r, 6).value = { formula: `D${r}/${pax}` };
    s.getCell(r, 6).numFmt = EURpax;
    for (let c = 1; c <= 6; c++) bordered(s.getCell(r, c));
  });
  // Ligne TOTAL
  s.getCell(segTot, 1).value = 'TOTAL';
  s.getCell(segTot, 3).value = { formula: `SUM(C${hr + 1}:C${segTot - 1})` };
  s.getCell(segTot, 3).numFmt = INT;
  s.getCell(segTot, 4).value = { formula: `SUM(D${hr + 1}:D${segTot - 1})` };
  s.getCell(segTot, 4).numFmt = EUR;
  s.getCell(segTot, 5).value = 1;
  s.getCell(segTot, 5).numFmt = PCT;
  s.getCell(segTot, 6).value = { formula: `D${segTot}/${pax}` };
  s.getCell(segTot, 6).numFmt = EURpax;
  for (let c = 1; c <= 6; c++) {
    const x = s.getCell(segTot, c);
    x.font = { name: 'Arial', bold: true };
    x.fill = fill(GOLD);
    bordered(x);
  }
  dataBar(s, `D${hr + 1}:D${segTot - 1}`, 'FF2F6FED');
  // Note anomalie : consommation nette négative (fidèle à la source).
  const negs = rep.produits.filter((p) => p.init - p.fin < 0);
  if (negs.length > 0) {
    const nr = segTot + 2;
    s.mergeCells(nr, 1, nr, 6);
    const n = s.getCell(nr, 1);
    n.value = `Note : consommation nette négative sur ${negs.map((p) => p.produit).join(', ')} (stock final > initial — écart d'inventaire) ; donnée conservée fidèle à la source.`;
    n.font = { name: 'Arial', size: 8, italic: true, color: { argb: GREY } };
    n.alignment = { wrapText: true };
    s.getRow(nr).height = 26;
  }

  // --- Espaces ---
  const e = wb.addWorksheet('Espaces', { views: [{ showGridLines: false }] });
  band(e, 'DÉTAIL PAR ESPACE', 'Espaces triés par coût F&B décroissant', 5);
  const eRows: (string | number)[][] = rep.espaces.map((x) => [x.espace, x.segment, x.unites, x.cout]);
  tableau(e, 4, ['Espace', 'Segment', 'Unités', 'Coût HT'], eRows, [22, 16, 12, 16], 4, 'FFC9A227');
  rep.espaces.forEach((x, i) => {
    e.getCell(5 + i, 4).numFmt = EUR;
    e.getCell(5 + i, 3).numFmt = INT;
    const sg = e.getCell(5 + i, 2);
    sg.font = { name: 'Arial', size: 9, color: { argb: WHITE } };
    sg.fill = fill(SEG[x.segment] || 'FF94A2B3');
    sg.alignment = { horizontal: 'center' };
  });

  // --- Catégories (formules SUMIF vers Produits) ---
  const c = wb.addWorksheet('Catégories', { views: [{ showGridLines: false }] });
  band(c, 'MIX PAR CATÉGORIE', 'Coût F&B par famille (formules liées à Produits)', 4);
  ['Catégorie', 'Unités', 'Coût HT', '% coût'].forEach((h, i) => hdr(c, 4, i + 1, h));
  rep.categories.forEach((x, i) => {
    const r = 5 + i;
    const cc = c.getCell(r, 1);
    cc.value = x.categorie;
    cc.font = { name: 'Arial', color: { argb: WHITE } };
    cc.fill = fill(CAT[x.categorie] || 'FF94A2B3');
    c.getCell(r, 2).value = { formula: `SUMIF(Produits!$B$2:$B$${totProd - 1},A${r},Produits!$E$2:$E$${totProd - 1})` };
    c.getCell(r, 2).numFmt = INT;
    c.getCell(r, 3).value = { formula: `SUMIF(Produits!$B$2:$B$${totProd - 1},A${r},Produits!$G$2:$G$${totProd - 1})` };
    c.getCell(r, 3).numFmt = EUR;
    c.getCell(r, 4).value = { formula: `C${r}/Produits!$G$${totProd}` };
    c.getCell(r, 4).numFmt = PCT;
    for (let k = 1; k <= 4; k++) bordered(c.getCell(r, k));
  });
  [18, 14, 16, 12].forEach((w, i) => (c.getColumn(i + 1).width = w));
  dataBar(c, `C5:C${4 + rep.categories.length}`, 'FFE8792B');

  // --- Fûts ---
  const f = wb.addWorksheet('Fûts', { views: [{ showGridLines: false }] });
  band(f, 'SUIVI DES FÛTS', 'PU en bleu = éditable · Coût = Fûts × PU', 5);
  ['Type de fût', 'Fûts', 'PU HT', 'Coût HT', '% coût'].forEach((h, i) => hdr(f, 4, i + 1, h));
  rep.futs.forEach((x, i) => {
    const r = 5 + i;
    bordered(f.getCell(r, 1)).value = x.fut;
    f.getCell(r, 1).font = { name: 'Arial', bold: true };
    bordered(f.getCell(r, 2)).value = x.unites;
    f.getCell(r, 2).numFmt = INT;
    f.getCell(r, 2).alignment = { horizontal: 'center' };
    const pu = f.getCell(r, 3);
    pu.value = x.pu;
    pu.numFmt = EUR;
    pu.font = { color: { argb: 'FF0000FF' } };
    pu.fill = fill(YEL);
    bordered(pu);
    bordered(f.getCell(r, 4)).value = { formula: `B${r}*C${r}` };
    f.getCell(r, 4).numFmt = EUR;
    bordered(f.getCell(r, 5)).value = { formula: `D${r}/SUM($D$5:$D$${4 + rep.futs.length})` };
    f.getCell(r, 5).numFmt = PCT;
  });
  [24, 12, 14, 16, 12].forEach((w, i) => (f.getColumn(i + 1).width = w));
  dataBar(f, `B5:B${4 + rep.futs.length}`, 'FFC9A227');

  // --- RH (charges personnel) ---
  const rh = rep.rh;
  if (rh) {
    const w = wb.addWorksheet('RH', { views: [{ showGridLines: false }] });
    [26, 12, 12, 16, 12].forEach((wd, i) => (w.getColumn(i + 1).width = wd));
    band(
      w,
      'SUIVI RH — CHARGES PERSONNEL',
      `${rh.kpis.nb_agents} agents · ${rh.kpis.total_heures ?? 0} h · Respo 12 €/h · autres 16,5 €/h`,
      5,
    );
    const rhKpis: [string, number, string][] = [
      ['Coût RH total', rh.kpis.cout_rh_ht ?? 0, 'FF2F6FED'],
      ['dont Restauration', rh.kpis.cout_resto ?? 0, 'FF1D7A46'],
      ['dont Hors restauration', rh.kpis.cout_hors_resto ?? 0, 'FFE0447A'],
      ['Coût RH / spectateur', rh.kpis.cout_par_pax ?? 0, 'FFC9A227'],
    ];
    rhKpis.forEach(([lab, val, color], i) => {
      const r = 5 + i;
      w.getCell(r, 1).value = lab;
      w.getCell(r, 1).font = { name: 'Arial', bold: true };
      const v = w.getCell(r, 2);
      v.value = val;
      v.numFmt = lab.includes('spectateur') ? EURpax : EUR;
      v.font = { color: { argb: color }, bold: true };
    });
    // Par espace (restauration)
    const rE = 11;
    w.getCell(rE, 1).value = 'PAR ESPACE (restauration)';
    w.getCell(rE, 1).font = { name: 'Arial', bold: true, color: { argb: NAVY } };
    ['Espace', 'Agents', 'Heures', 'Coût HT'].forEach((h, i) => hdr(w, rE + 1, i + 1, h));
    rh.par_espace.forEach((x, i) => {
      const r = rE + 2 + i;
      bordered(w.getCell(r, 1)).value = x.espace;
      bordered(w.getCell(r, 2)).value = x.agents;
      bordered(w.getCell(r, 3)).value = x.heures;
      bordered(w.getCell(r, 4)).value = x.cout;
      w.getCell(r, 4).numFmt = EUR;
    });
    if (rh.par_espace.length) dataBar(w, `D${rE + 2}:D${rE + 1 + rh.par_espace.length}`, 'FF1D7A46');
    // Par pôle (hors restauration)
    const rP = rE + 3 + rh.par_espace.length;
    w.getCell(rP, 1).value = 'PAR PÔLE (hors restauration)';
    w.getCell(rP, 1).font = { name: 'Arial', bold: true, color: { argb: NAVY } };
    ['Pôle', 'Agents', 'Heures', 'Coût HT'].forEach((h, i) => hdr(w, rP + 1, i + 1, h));
    rh.par_pole.forEach((x, i) => {
      const r = rP + 2 + i;
      bordered(w.getCell(r, 1)).value = x.pole;
      bordered(w.getCell(r, 2)).value = x.agents;
      bordered(w.getCell(r, 3)).value = x.heures;
      bordered(w.getCell(r, 4)).value = x.cout;
      w.getCell(r, 4).numFmt = EUR;
    });
    if (rh.par_pole.length) dataBar(w, `D${rP + 2}:D${rP + 1 + rh.par_pole.length}`, 'FFE0447A');
    // Détail agents
    const rA = rP + 3 + rh.par_pole.length;
    w.getCell(rA, 1).value = 'DÉTAIL AGENTS';
    w.getCell(rA, 1).font = { name: 'Arial', bold: true, color: { argb: NAVY } };
    ['Nom', 'Rôle', 'Rattachement', 'Heures', 'Coût HT'].forEach((h, i) => hdr(w, rA + 1, i + 1, h));
    rh.agents.forEach((a, i) => {
      const r = rA + 2 + i;
      bordered(w.getCell(r, 1)).value = `${a.prenom} ${a.nom}`.trim();
      bordered(w.getCell(r, 2)).value = a.role;
      bordered(w.getCell(r, 3)).value = a.rattachement;
      bordered(w.getCell(r, 4)).value = a.heures;
      bordered(w.getCell(r, 5)).value = a.cout;
      w.getCell(r, 5).numFmt = EUR;
    });
  }

  sheetParametres(wb, [
    ['Événement', rep.match.name],
    ['Date', longDate(rep.match.date)],
    ['Coût RH HT', rep.rh?.kpis?.cout_rh_ht != null ? `${rep.rh.kpis.cout_rh_ht} €` : '— (émargement non importé)'],
    ['Spectateurs (PAX)', rep.match.pax],
    ['Espaces couverts', rep.espaces.length],
    ['Produits', rep.produits.length],
    ['Fûts (types)', rep.futs.length],
    ['Source de données', 'get_match_report · StockPilot MD'],
    ['Généré le', new Date().toLocaleString('fr-FR')],
    [
      'Méthodologie',
      "Consommé = Stock initial + réassort − Stock final. Coûts HT au catalogue. Cellules bleues (stocks & PU) éditables → Consommé, Coût, %, totaux se recalculent. Données fidèles à la source (aucun arrondi masquant).",
    ],
  ]);

  download(await wb.xlsx.writeBuffer(), `Rapport_Match_${rep.match.name}.xlsx`);
}

export async function genererRapportSeminaire(eventId: string): Promise<void> {
  const { data, error } = await supabase.rpc('get_seminaire_report', { p_event_id: eventId });
  if (error || !data) {
    alert('Rapport indisponible');
    return;
  }
  const rep = data as SeminaireReport;
  const XLSX = (await import('exceljs')).default;
  const wb = new XLSX.Workbook();
  wb.creator = 'StockPilot MD';
  const totProd = sheetProduits(wb, rep.produits);

  const s = wb.addWorksheet('Synthèse', { views: [{ showGridLines: false }] });
  [24, 20, 16, 16, 16, 16].forEach((w, i) => (s.getColumn(i + 1).width = w));
  band(
    s,
    `RAPPORT SÉMINAIRE — ${String(rep.seminaire.name).toUpperCase()}`,
    `${longDate(rep.seminaire.date)}  ·  ${rep.seminaire.participants} participants  ·  Provence Rugby · Stade Maurice-David`,
    6,
  );
  const part = rep.seminaire.participants || 1;
  const kpis: KpiDef[] = [
    ['COÛT F&B HT', { formula: `Produits!G${totProd}` }, EUR, NAVY, 1],
    ['COÛT / PARTICIPANT', { formula: `Produits!G${totProd}/${part}` }, EURpax, 'FF12B3A6', 3],
    ['PARTICIPANTS', rep.seminaire.participants, INT, GOLD, 5],
  ];
  kpis.forEach(([lab, val, fmt, ac, col]) => {
    s.mergeCells(5, col, 5, col + 1);
    s.getCell(5, col).value = lab;
    s.getCell(5, col).font = { name: 'Arial', size: 8, bold: true, color: { argb: GREY } };
    s.mergeCells(6, col, 6, col + 1);
    const v = s.getCell(6, col);
    v.value = val;
    v.numFmt = fmt;
    v.font = { name: 'Arial', size: 16, bold: true, color: { argb: ac } };
  });
  // Marge si facturation renseignée.
  if (rep.seminaire.facture_pax) {
    s.getCell(8, 1).value = 'Facturé / participant';
    s.getCell(8, 2).value = rep.seminaire.facture_pax;
    s.getCell(8, 2).numFmt = EUR;
    s.getCell(9, 1).value = 'Marge F&B / participant';
    s.getCell(9, 2).value = { formula: `B8-Produits!G${totProd}/${part}` };
    s.getCell(9, 2).numFmt = EUR;
    s.getCell(9, 2).font = { bold: true, color: { argb: 'FF1D7A46' } };
  }

  const e = wb.addWorksheet('Espaces', { views: [{ showGridLines: false }] });
  band(e, 'ESPACES SÉMINAIRE', 'Salons / loges / bars utilisés', 4);
  tableau(
    e,
    4,
    ['Espace', 'Profil', 'Unités', 'Coût HT'],
    rep.espaces.map((x) => [x.espace, x.profil, x.unites, x.cout]),
    [24, 14, 12, 16],
    4,
    'FFC9A227',
  );
  rep.espaces.forEach((_, i) => {
    e.getCell(5 + i, 4).numFmt = EUR;
    e.getCell(5 + i, 3).numFmt = INT;
  });

  const c = wb.addWorksheet('Catégories', { views: [{ showGridLines: false }] });
  band(c, 'MIX PAR CATÉGORIE', '', 4);
  tableau(
    c,
    4,
    ['Catégorie', 'Unités', 'Coût HT', '% coût'],
    rep.categories.map((x) => [x.categorie, x.unites, x.cout, '']),
    [18, 14, 16, 12],
    3,
    'FFE8792B',
  );
  rep.categories.forEach((_, i) => {
    c.getCell(5 + i, 3).numFmt = EUR;
    c.getCell(5 + i, 2).numFmt = INT;
  });

  sheetParametres(wb, [
    ['Événement', rep.seminaire.name],
    ['Date', longDate(rep.seminaire.date)],
    ['Participants', rep.seminaire.participants],
    ['Facturé / participant', rep.seminaire.facture_pax != null ? `${rep.seminaire.facture_pax} €` : '— (non renseigné)'],
    ['Espaces (salons/loges)', rep.espaces.length],
    ['Produits', rep.produits.length],
    ['Source de données', 'get_seminaire_report · StockPilot MD'],
    ['Généré le', new Date().toLocaleString('fr-FR')],
    [
      'Méthodologie',
      "Consommé = Stock initial + réassort − Stock final. Coût F&B au catalogue. Coût/participant = Coût F&B ÷ participants ; marge = Facturé/participant − Coût/participant. Cellules bleues éditables.",
    ],
  ]);

  download(await wb.xlsx.writeBuffer(), `Rapport_Seminaire_${rep.seminaire.name}.xlsx`);
}
