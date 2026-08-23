/**
 * excelTheme — charte graphique commune à TOUS les exports Excel de l'appli.
 *
 * Source de vérité unique pour l'habillage (couleurs Provence Rugby, formats
 * de nombres, hauteurs, bordures) afin que le Bilan d'événement, les rapports
 * de stock, la paie et les rapports match/séminaire forment un seul système
 * visuel : titre bandeau marine, en-têtes marine + liseré or, lignes zébrées,
 * totaux surlignés, montants au format « 1 234,56 € », zéro flottant sale.
 *
 * Le peintre générique `paintAoaWorksheet` applique cette charte à n'importe
 * quelle feuille décrite en matrice (AOA), sans que l'appelant ait à connaître
 * ExcelJS. Il détecte automatiquement : ligne de titre, ligne d'en-tête,
 * lignes de sous-total / total. Les formats de colonnes (€, entier, %…) et les
 * cellules-formules sont pilotés par des métadonnées optionnelles.
 */

import type * as ExcelJS from 'exceljs';

/* ─────────────────────────  JETONS COULEUR  ───────────────────────── */

export const NAVY = 'FF0B1F3A'; // bandeau titre + en-têtes
export const GOLD = 'FFC9A227'; // liseré + total général
export const WHITE = 'FFFFFFFF';
export const GREY = 'FF8A94A2'; // mentions discrètes
export const LIGHT = 'FFF2F5F9'; // fond sous-total / KPI
export const ZEBRA = 'FFF8FAFC'; // lignes paires
export const YEL = 'FFFFF7E6'; // cellule éditable / alerte douce
export const BORDER = 'FFD8DEE6'; // filet de tableau
export const RUST = 'FFB4451F'; // valeurs d'alerte (retard, manquant)

/* ─────────────────────────  FORMATS NOMBRES  ───────────────────────── */

export const EUR = '#,##0.00 "€"';
export const EUR0 = '#,##0 "€"';
export const INT = '#,##0';
export const DEC1 = '0.0';
export const PCT = '0.0%';
export const HOURS = '0.0 "h"';
export const EURpax = '#,##0.00 "€/pax"';
export const MIN = '0 "min"';

/* ─────────────────────────  HELPERS  ───────────────────────── */

export const fill = (argb: string): ExcelJS.FillPattern => ({
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb },
});

const thin = (argb = BORDER) => ({ style: 'thin' as const, color: { argb } });

/* ─────────────────────────  PEINTRE GÉNÉRIQUE  ───────────────────────── */

/** Format / alignement d'une colonne. */
export interface ColumnStyle {
  numFmt?: string;
  align?: 'left' | 'center' | 'right';
}

export interface PaintOptions {
  /** Nombre de colonnes utiles (sinon déduit de l'AOA). */
  ncols?: number;
  /** Formats par colonne (index 0 = colonne A). */
  columns?: (ColumnStyle | undefined)[];
  /** Fige les volets sous l'en-tête + filtre auto. Défaut : true. */
  freezeHeader?: boolean;
}

const FONT = 'Arial';
const isFilled = (v: unknown) => v != null && String(v).trim() !== '';
const isTotalLabel = (v: unknown) => /^(sous[-\s]?total|total)\b/i.test(String(v ?? ''));
const isGrandTotal = (v: unknown) => /^total\s+g[ée]n[ée]ral/i.test(String(v ?? ''));

/**
 * Applique la charte à une feuille dont les valeurs (et formules) ont déjà été
 * écrites dans la worksheet. Best-effort : ne jette jamais.
 *
 * Détection :
 *  - Ligne de titre  : première ligne à cellule unique remplie → bandeau marine.
 *  - Ligne d'en-tête : première ligne « dense » (≥ 3 libellés) après le titre.
 *  - Lignes total    : premier libellé « Sous-total… » / « Total… ».
 */
export function paintAoaWorksheet(ws: ExcelJS.Worksheet, aoa: unknown[][], opts: PaintOptions = {}): void {
  try {
    const ncols =
      opts.ncols ??
      Math.max(1, opts.columns?.length ?? 0, ...aoa.map((r) => r.length));
    const columns = opts.columns ?? [];

    // 1 — repérage titre + en-tête ------------------------------------
    let titleRow = -1;
    let headerRow = -1;
    for (let i = 0; i < aoa.length; i++) {
      const filledCount = aoa[i].filter(isFilled).length;
      if (filledCount === 0) continue;
      if (titleRow === -1 && filledCount === 1 && headerRow === -1) {
        titleRow = i;
        continue;
      }
      if (headerRow === -1 && filledCount >= 3 && aoa[i].every((c) => c == null || typeof c === 'string')) {
        headerRow = i;
        break;
      }
    }

    // 2 — bandeau titre ----------------------------------------------
    if (titleRow >= 0) {
      const r = titleRow + 1;
      ws.mergeCells(r, 1, r, ncols);
      const t = ws.getCell(r, 1);
      t.font = { name: FONT, size: 15, bold: true, color: { argb: WHITE } };
      t.fill = fill(NAVY);
      t.alignment = { vertical: 'middle', indent: 1 };
      ws.getRow(r).height = 28;
      // liseré or juste sous le titre
      for (let c = 1; c <= ncols; c++) {
        const spacer = aoa[titleRow + 1]?.some(isFilled) ? null : ws.getCell(r + 1, c);
        if (spacer) {
          spacer.fill = fill(GOLD);
        }
      }
      if (!aoa[titleRow + 1]?.some(isFilled)) ws.getRow(r + 1).height = 4;
    }

    // 3 — en-tête colonnes -------------------------------------------
    if (headerRow >= 0) {
      const r = headerRow + 1;
      const row = ws.getRow(r);
      row.height = 22;
      for (let c = 1; c <= ncols; c++) {
        const cell = ws.getCell(r, c);
        cell.font = { name: FONT, size: 9, bold: true, color: { argb: WHITE } };
        cell.fill = fill(NAVY);
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = { top: thin(NAVY), bottom: thin(GOLD), left: thin(NAVY), right: thin(NAVY) };
      }
      if (opts.freezeHeader !== false) {
        ws.views = [{ state: 'frozen', ySplit: r, showGridLines: false }];
        ws.autoFilter = {
          from: { row: r, column: 1 },
          to: { row: r, column: ncols },
        };
      } else {
        ws.views = [{ showGridLines: false }];
      }
    }

    // 4 — corps : zébrage, bordures, formats, totaux ------------------
    let dataIdx = 0;
    for (let i = 0; i < aoa.length; i++) {
      if (i === titleRow || i === headerRow) continue;
      const rowVals = aoa[i];
      if (!rowVals.some(isFilled)) continue;
      const excelRow = i + 1;
      const total = isTotalLabel(rowVals[0]);
      const grand = isGrandTotal(rowVals[0]);
      const zebra = dataIdx % 2 === 1;
      dataIdx++;

      for (let c = 1; c <= ncols; c++) {
        const cell = ws.getCell(excelRow, c);
        const colStyle = columns[c - 1];
        // format nombre
        const raw = cell.value;
        const isNumeric =
          typeof raw === 'number' ||
          (raw != null && typeof raw === 'object' && 'formula' in (raw as object));
        if (colStyle?.numFmt && isNumeric) cell.numFmt = colStyle.numFmt;
        // alignement
        if (colStyle?.align) {
          cell.alignment = { ...cell.alignment, horizontal: colStyle.align, vertical: 'middle' };
        } else if (isNumeric) {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
        } else {
          cell.alignment = { vertical: 'middle', indent: c === 1 ? 1 : 0 };
        }

        if (total) {
          cell.font = { name: FONT, size: grand ? 11 : 10, bold: true, color: { argb: grand ? WHITE : NAVY } };
          cell.fill = fill(grand ? NAVY : LIGHT);
          cell.border = { top: thin(GOLD), bottom: thin(GOLD) };
        } else {
          cell.font = cell.font?.color?.argb === RUST ? cell.font : { name: FONT, size: 9 };
          if (zebra) cell.fill = fill(ZEBRA);
          cell.border = { top: thin(), bottom: thin(), left: thin(), right: thin() };
        }
      }
    }
  } catch {
    /* habillage best-effort : jamais bloquant */
  }
}
