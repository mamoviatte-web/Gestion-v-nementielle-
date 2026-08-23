/**
 * xlsxAoa — pont Excel basé sur **exceljs** (remplace SheetJS/`xlsx`).
 *
 * SheetJS (`xlsx`) portait une vulnérabilité haute sans correctif npm ; on
 * centralise ici l'écriture (matrice → classeur téléchargé) et la lecture
 * (fichier importé → matrices formatée + brute) au-dessus d'exceljs, déjà
 * utilisé pour les rapports de match/séminaire.
 *
 * Écriture : `downloadAoaWorkbook` (feuilles = matrices AOA + largeurs).
 * Lecture  : `readSheetsFromFile` — .xlsx via exceljs, .csv parsé à la main.
 *            Le format .xls (ancien binaire Excel) n'est plus supporté.
 */

import type * as ExcelJS from 'exceljs';
import { loadModule } from '@/lib/lazyModule';
import { paintAoaWorksheet, type ColumnStyle } from '@/lib/excelTheme';

/* ─────────────────────────  ÉCRITURE  ───────────────────────── */

/** Cellule-formule : `{ f: '=H4+I4-J4' }` → Excel recalcule à l'ouverture. */
export interface AoaFormula {
  f: string;
}
export type AoaCell = string | number | null | undefined | AoaFormula;

export interface AoaSheetOut {
  name: string;
  aoa: AoaCell[][];
  /** Largeurs de colonnes (unités ≈ caractères, comme SheetJS `wch`). */
  widths?: number[];
  /** Formats / alignements par colonne (index 0 = colonne A) — habillage. */
  columns?: (ColumnStyle | undefined)[];
}

const isFormula = (v: AoaCell): v is AoaFormula =>
  v != null && typeof v === 'object' && typeof (v as AoaFormula).f === 'string';

function download(buf: ExcelJS.Buffer, name: string): void {
  const b = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const u = URL.createObjectURL(b);
  const a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.click();
  URL.revokeObjectURL(u);
}

/** Construit un classeur à partir de feuilles-matrices et déclenche le téléchargement.
 *
 * Chaque feuille reçoit automatiquement la charte graphique commune
 * (`paintAoaWorksheet`) : bandeau titre marine, en-tête figé + filtre, lignes
 * zébrées, sous-totaux/total surlignés, formats de colonnes (€, entier…).
 * Les cellules `{ f: '=…' }` deviennent de vraies formules Excel. */
export async function downloadAoaWorkbook(sheets: AoaSheetOut[], filename: string): Promise<void> {
  const ExcelJSMod = (await loadModule(() => import('exceljs'))).default;
  const wb = new ExcelJSMod.Workbook();
  wb.creator = 'StockPilot MD';
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    for (const row of s.aoa) {
      const excelRow = ws.addRow([]);
      row.forEach((cell, i) => {
        const c = excelRow.getCell(i + 1);
        c.value = isFormula(cell) ? ({ formula: cell.f } as ExcelJS.CellFormulaValue) : (cell ?? null);
      });
    }
    if (s.widths) s.widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
    paintAoaWorksheet(ws, s.aoa as unknown[][], {
      ncols: Math.max(s.widths?.length ?? 0, s.columns?.length ?? 0),
      columns: s.columns,
    });
  }
  download(await wb.xlsx.writeBuffer(), filename);
}

/* ─────────────────────────  LECTURE  ───────────────────────── */

/** Une feuille lue : `fmt` = valeurs affichées (texte), `raw` = valeurs brutes. */
export interface AoaSheetIn {
  name: string;
  fmt: unknown[][];
  raw: unknown[][];
  /** Feuille dont la lecture a échoué (corrompue) — à signaler, pas à bloquer. */
  failed?: boolean;
}

/** Texte affiché d'une cellule exceljs (équiv. SheetJS `raw:false`). */
function cellText(cell: ExcelJS.Cell): string {
  const t = cell.text;
  return t == null ? '' : String(t);
}

/** Valeur brute d'une cellule exceljs (équiv. SheetJS `raw:true`). */
function cellRaw(cell: ExcelJS.Cell): unknown {
  const v = cell.value;
  if (v == null) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>;
    if ('result' in o) return o.result ?? ''; // formule → résultat
    if ('text' in o) return o.text ?? ''; // lien hypertexte
    if ('richText' in o && Array.isArray(o.richText)) {
      return (o.richText as { text: string }[]).map((r) => r.text).join('');
    }
    return ''; // cellule d'erreur / autre
  }
  return v;
}

/** Parse un CSV simple (délimiteur `;` ou `,` auto-détecté, guillemets gérés). */
function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const firstLine = src.slice(0, src.indexOf('\n') === -1 ? src.length : src.indexOf('\n'));
  const semi = (firstLine.match(/;/g) || []).length;
  const comma = (firstLine.match(/,/g) || []).length;
  const delim = semi >= comma ? ';' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delim) {
      row.push(cur); cur = '';
    } else if (ch === '\n') {
      row.push(cur); cur = '';
      rows.push(row); row = [];
    } else {
      cur += ch;
    }
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/**
 * Lit un fichier importé en feuilles-matrices.
 *  - `.xlsx` → exceljs
 *  - `.csv`  → parseur manuel (une feuille)
 *  - `.xls`  → non supporté (message d'erreur explicite)
 */
/** Lecture .xlsx via exceljs, RÉSILIENTE : une feuille qui plante est ignorée,
 *  les autres continuent (jamais d'échec global). */
async function readXlsx(file: File): Promise<AoaSheetIn[]> {
  const ExcelJSMod = (await loadModule(() => import('exceljs'))).default;
  const wb = new ExcelJSMod.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());

  const sheets: AoaSheetIn[] = [];
  wb.eachSheet((ws) => {
    try {
      const fmt: unknown[][] = [];
      const raw: unknown[][] = [];
      const colCount = ws.columnCount;
      ws.eachRow({ includeEmpty: true }, (rowObj) => {
        const f: unknown[] = [];
        const r: unknown[] = [];
        for (let c = 1; c <= colCount; c++) {
          const cell = rowObj.getCell(c);
          f.push(cellText(cell));
          r.push(cellRaw(cell));
        }
        // Ignore les lignes entièrement vides, en gardant fmt et raw alignés.
        if (f.some((x) => String(x ?? '').trim() !== '')) {
          fmt.push(f);
          raw.push(r);
        }
      });
      sheets.push({ name: ws.name, fmt, raw });
    } catch {
      // Feuille corrompue : on la marque et on continue (dégradation gracieuse).
      sheets.push({ name: ws.name, fmt: [], raw: [], failed: true });
    }
  });
  return sheets;
}

async function readCsv(file: File): Promise<AoaSheetIn[]> {
  const rows = parseCsv(await file.text());
  return [{ name: file.name.replace(/\.[^.]+$/i, '') || 'CSV', fmt: rows, raw: rows }];
}

/**
 * Lit un fichier importé en feuilles-matrices, avec CHAÎNE DE REPLI et sans
 * jamais refuser brutalement : on tente le lecteur adapté à l'extension puis
 * l'autre (extension trompeuse tolérée). Ne throw qu'en dernier recours, avec
 * un message actionnable (l'appelant l'affiche sans bloquer l'app).
 * NB : le .xls binaire n'est pas lisible côté client → il tombe dans le repli
 * et déclenche le message « illisible, réessayez / collez les données ».
 */
export async function readSheetsFromFile(file: File): Promise<AoaSheetIn[]> {
  const lower = file.name.toLowerCase();
  const chain = lower.endsWith('.csv') ? [readCsv, readXlsx] : [readXlsx, readCsv];
  for (const reader of chain) {
    try {
      const sheets = await reader(file);
      if (sheets.length) return sheets;
    } catch {
      // lecteur suivant
    }
  }
  throw new Error('Fichier illisible. Réessayez, convertissez-le en .xlsx ou .csv, ou collez les données manuellement.');
}
