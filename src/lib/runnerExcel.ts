/**
 * runnerExcel — export Excel des fiches runner (exceljs, via downloadAoaWorkbook).
 *
 * ⚠ Réservé ROLE_STADE (le board runner porte la réserve/valeurs — RG-003).
 *
 * Une feuille par espace (Produit, Catégorie, Besoin, À acheminer, Stock espace,
 * Stock réserve, Statut) + une feuille « Liste de courses » consolidée (besoin
 * total par produit vs réserve centrale, manques en tête). Les quantités
 * reflètent le board runner (source unique stock_balances).
 */

import { downloadAoaWorkbook, type AoaCell } from './xlsxAoa';
import { INT, type ColumnStyle } from './excelTheme';

export interface RunnerExcelLine {
  space_id: string;
  product_id: string;
  product_name: string;
  category: string;
  needed_qty: number;
  qty_to_move: number;
  area_stock: number;
  reserve_qty: number;
  shortfall_qty: number;
  stock_sufficient_live: boolean;
}

export interface RunnerExcelCard {
  space_id: string;
  space_name: string;
  family: string;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Nom de feuille Excel valide : sans caractères interdits, ≤ 31 car., unique. */
function sheetName(raw: string, used: Set<string>): string {
  let base = (raw || 'Espace').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Espace';
  let name = base;
  let i = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${i})`;
    base = base.slice(0, 31 - suffix.length);
    name = base + suffix;
    i++;
  }
  used.add(name.toLowerCase());
  return name;
}

const COLS: (ColumnStyle | undefined)[] = [
  undefined,                        // A Produit
  undefined,                        // B Catégorie
  { numFmt: INT, align: 'right' },  // C Besoin
  { numFmt: INT, align: 'right' },  // D À acheminer
  { numFmt: INT, align: 'right' },  // E Stock espace
  { numFmt: INT, align: 'right' },  // F Stock réserve
  { align: 'center' },              // G Statut
];
const WIDTHS = [28, 16, 9, 13, 13, 14, 15];

/** Génère et télécharge le classeur des fiches runner. */
export async function downloadRunnerWorkbook(opts: {
  matchNom: string;
  matchDate: string;
  cards: RunnerExcelCard[];
  linesBySpace: Map<string, RunnerExcelLine[]>;
  allLines: RunnerExcelLine[];
  filename: string;
}): Promise<void> {
  const { matchNom, matchDate, cards, linesBySpace, allLines, filename } = opts;
  const used = new Set<string>();
  const sheets = [];

  /* Feuille 1 — Liste de courses (synthèse par produit vs réserve). */
  {
    const byProduct = new Map<string, { name: string; category: string; besoin: number; reserve: number; manque: number }>();
    for (const l of allLines) {
      const e = byProduct.get(l.product_id) ?? { name: l.product_name, category: l.category, besoin: 0, reserve: num(l.reserve_qty), manque: 0 };
      e.besoin += num(l.qty_to_move);
      e.reserve = num(l.reserve_qty);
      e.manque = Math.max(e.manque, num(l.shortfall_qty));
      byProduct.set(l.product_id, e);
    }
    const rows: AoaCell[][] = [...byProduct.values()]
      .sort((a, b) => b.manque - a.manque || a.name.localeCompare(b.name, 'fr'))
      .map((p) => [p.name, p.category, p.besoin, p.reserve, p.manque > 0 ? p.manque : '—']);
    const aoa: AoaCell[][] = [
      [`PROVENCE RUGBY — LISTE DE COURSES — ${matchNom} — ${matchDate}`],
      [],
      ['Produit', 'Catégorie', 'Besoin total', 'Réserve', 'Manque'],
      ...rows,
    ];
    sheets.push({
      name: sheetName('Liste de courses', used),
      aoa,
      widths: [28, 16, 13, 12, 10],
      columns: [undefined, undefined, { numFmt: INT, align: 'right' }, { numFmt: INT, align: 'right' }, { numFmt: INT, align: 'right' }],
    });
  }

  /* Une feuille par espace. */
  for (const card of cards) {
    const lines = linesBySpace.get(card.space_id) ?? [];
    let tot = 0;
    const rows: AoaCell[][] = lines.map((l) => {
      tot += num(l.qty_to_move);
      return [
        l.product_name,
        l.category,
        num(l.needed_qty),
        num(l.qty_to_move),
        num(l.area_stock),
        num(l.reserve_qty),
        l.stock_sufficient_live ? 'OK' : `Manque ${num(l.shortfall_qty)}`,
      ];
    });
    const aoa: AoaCell[][] = [
      [`PROVENCE RUGBY — FICHE RUNNER — ${card.space_name} — ${card.family} — ${matchNom} — ${matchDate}`],
      [],
      ['Produit', 'Catégorie', 'Besoin', 'À acheminer', 'Stock espace', 'Stock réserve', 'Statut'],
      ...rows,
      [],
      ['TOTAL', '', '', tot, '', '', ''],
    ];
    sheets.push({ name: sheetName(card.space_name, used), aoa, widths: WIDTHS, columns: COLS });
  }

  await downloadAoaWorkbook(sheets, filename);
}
