/**
 * Export Excel (exceljs) — Bilan d'un événement en 3 feuilles (Phase 7).
 *
 * ⚠ Réservé au ROLE_STADE : ce fichier contient les prix et coûts (RG-003).
 * Aucun export n'est proposé côté Responsable.
 *
 * Les feuilles sont décrites en matrices (AOA) + largeurs de colonnes, puis
 * assemblées et téléchargées via `downloadAoaWorkbook` (voir `lib/xlsxAoa`).
 */

import { downloadAoaWorkbook, type AoaCell } from './xlsxAoa';
import { EUR, INT, HOURS, MIN, type ColumnStyle } from './excelTheme';
import {
  computeConsumed,
  computeCost,
  computeHoursWorked,
  computePresenceDuration,
  computeProviderDelay,
  computeProviderStatus,
} from './calculations';
import {
  PRODUCT_STATE_META,
  PROVIDER_STATUS_META,
  PROVIDER_TYPE_LABELS,
  RUNNER_STATUS_META,
} from './labels';
import type { EventExportData } from '@/hooks/useEventExportData';

type Cell = AoaCell;
type Row = Cell[];

/** Lettre de colonne Excel (1 → A). */
const col = (n: number): string => {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

/** Nettoie un nom pour un nom de fichier. */
function sanitize(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Nom de fichier : Bilan_[Nom]_[YYYY-MM-DD].xlsx */
export function reportFileName(data: EventExportData): string {
  return `Bilan_${sanitize(data.event.event_name)}_${data.event.event_date}.xlsx`;
}

function spaceMap(data: EventExportData) {
  const map = new Map<string, { name: string; type: string }>();
  data.spaces.forEach((s) =>
    map.set(s.space_id, {
      name: s.spaces?.space_name ?? s.space_id,
      type: s.spaces?.space_type ?? '',
    }),
  );
  return map;
}

/* ------------------------------------------------------------------ */
/* Feuille 1 — Bilan Stocks                                            */
/* ------------------------------------------------------------------ */

/** Colonnes du Bilan Stocks (1 = A). H=Stock Initial, I=Réassort, J=Final,
 *  L=Consommation, M=Prix U, N=Coût Total. */
const STOCK_COLS: Record<string, number> = { H: 8, I: 9, J: 10, L: 12, M: 13, N: 14 };

/** Métadonnées d'habillage des colonnes du Bilan Stocks. */
export const STOCK_COLUMNS: (ColumnStyle | undefined)[] = [
  { align: 'left' },   // A Espace
  { align: 'center' }, // B Type
  { align: 'left' },   // C Produit
  { align: 'center' }, // D Catégorie
  { align: 'center' }, // E Unité
  { numFmt: INT },     // F Dotation
  { align: 'center' }, // G Runner Status
  { numFmt: INT },     // H Stock Initial
  { numFmt: INT },     // I Réassort
  { numFmt: INT },     // J Stock Final
  { align: 'center' }, // K État produit
  { numFmt: INT },     // L Consommation
  { numFmt: EUR },     // M Prix U HT
  { numFmt: EUR },     // N Coût Total HT
  { align: 'center' }, // O Clôture
  { align: 'left' },   // P Responsable
];

export function buildStockAOA(data: EventExportData): {
  aoa: Row[];
  totalCost: number;
  hasMissingPrice: boolean;
} {
  const spaces = spaceMap(data);
  const priceOf = new Map(data.products.map((p) => [p.product_id, p]));

  const header: Row = [
    'Espace', 'Type', 'Produit', 'Catégorie', 'Unité', 'Dotation',
    'Runner Status', 'Stock Initial', 'Réassort', 'Stock Final', 'État produit',
    'Consommation', 'Prix U HT (€)', 'Coût Total HT (€)', 'Clôture', 'Responsable saisie',
  ];

  const aoa: Row[] = [
    [`PROVENCE RUGBY — BILAN STOCKS — ${data.event.event_name} — ${data.event.event_date} — ${data.event.event_type ?? ''} — ${data.event.expected_attendees ?? ''} spectateurs`],
    [],
    header,
  ];

  let grandTotal = 0;
  let hasMissingPrice = false;
  const subtotalRows: number[] = []; // n° de ligne Excel des sous-totaux (col N)

  const sortedSpaceIds = [...spaces.keys()].sort((a, b) =>
    (spaces.get(a)!.name).localeCompare(spaces.get(b)!.name, 'fr'),
  );

  for (const spaceId of sortedSpaceIds) {
    const info = spaces.get(spaceId)!;
    const lines = data.stockLines.filter((l) => l.space_id === spaceId);
    const dotations = data.dotations.filter((d) => d.space_id === spaceId);
    const productIds = new Set<string>([
      ...lines.map((l) => l.product_id),
      ...dotations.map((d) => d.product_id),
    ]);
    if (productIds.size === 0) continue;

    let spaceSubtotal = 0;
    let firstDataRow = 0;
    let lastDataRow = 0;

    for (const pid of productIds) {
      const product = priceOf.get(pid);
      const line = lines.find((l) => l.product_id === pid);
      const dotation = dotations.find((d) => d.product_id === pid);
      // Clôture manquante : final_qty NULL alors qu'il y a eu un mouvement.
      // Le drapeau « estimé » va en colonne Clôture ; Stock Final reste NUMÉRIQUE
      // (0) pour que la formule de consommation ne casse jamais.
      const hasMovement = !!line && ((line.initial_qty ?? 0) > 0 || (line.reassort_qty ?? 0) > 0);
      const isMissingCloture = !!line && line.final_qty === null && hasMovement;
      const consumed = line
        ? computeConsumed(line.initial_qty, line.reassort_qty, line.final_qty ?? 0)
        : null;
      const price = product?.unit_price_ht ?? null;
      const cost = consumed !== null ? computeCost(consumed, price) : null;
      if (cost !== null) spaceSubtotal += cost;
      if (price === null) hasMissingPrice = true;

      // Numéro de ligne Excel de cette ligne de données (aoa 0-based + 1).
      const r = aoa.length + 1;
      if (!firstDataRow) firstDataRow = r;
      lastDataRow = r;

      // Consommation = Stock Initial + Réassort − Stock Final (formule vivante).
      const consumedCell: Cell =
        line !== undefined ? { f: `=${col(STOCK_COLS.H)}${r}+${col(STOCK_COLS.I)}${r}-${col(STOCK_COLS.J)}${r}` } : '';
      // Coût Total = Consommation × Prix U HT (formule vivante).
      const costCell: Cell =
        cost !== null
          ? { f: `=${col(STOCK_COLS.L)}${r}*${col(STOCK_COLS.M)}${r}` }
          : consumed !== null && price === null
            ? 'Prix manquant'
            : '';

      aoa.push([
        info.name,
        info.type,
        product?.product_name ?? pid,
        product?.category ?? '',
        product?.unit ?? '',
        dotation?.planned_qty ?? '',
        dotation ? RUNNER_STATUS_META[dotation.runner_status].label : '',
        line?.initial_qty ?? '',
        line?.reassort_qty ?? '',
        line ? (line.final_qty ?? 0) : '',
        line?.product_state ? PRODUCT_STATE_META[line.product_state].label : '',
        consumedCell,
        price !== null ? Number(price.toFixed(2)) : '',
        costCell,
        line ? (isMissingCloture ? '⚠️ estimé' : line.final_qty !== null ? 'OK' : '—') : '',
        line?.responsable_nom ?? '',
      ]);
    }

    // Sous-total = SUM de la colonne Coût sur le bloc de l'espace (ignore le texte).
    const subRow = aoa.length + 1;
    subtotalRows.push(subRow);
    const subtotalCell: Cell = firstDataRow
      ? { f: `=SUM(${col(STOCK_COLS.N)}${firstDataRow}:${col(STOCK_COLS.N)}${lastDataRow})` }
      : spaceSubtotal;
    aoa.push([`Sous-total ${info.name}`, '', '', '', '', '', '', '', '', '', '', '', '', subtotalCell, '', '']);
    grandTotal += spaceSubtotal;
  }

  aoa.push([]);
  // TOTAL GÉNÉRAL = somme des sous-totaux (formule vivante).
  const totalCell: Cell =
    subtotalRows.length > 0
      ? { f: `=${subtotalRows.map((r) => `${col(STOCK_COLS.N)}${r}`).join('+')}` }
      : grandTotal;
  aoa.push(['TOTAL GÉNÉRAL', '', '', '', '', '', '', '', '', '', '', '', '', totalCell, '', '']);

  return { aoa, totalCost: grandTotal, hasMissingPrice };
}

/* ------------------------------------------------------------------ */
/* Feuille 2 — Horaires Staff                                          */
/* ------------------------------------------------------------------ */

export function buildScheduleAOA(data: EventExportData): Row[] {
  const spaces = spaceMap(data);
  const aoa: Row[] = [
    [`PROVENCE RUGBY — HORAIRES STAFF — ${data.event.event_name}`],
    [],
    ['Espace', 'Nom', 'Poste', 'Arrivée prévue', 'Départ prévu', 'Départ réel', 'Heures travaillées', '✓ Employé', '✓ Responsable'],
  ];

  for (const s of data.schedules) {
    const hours =
      s.planned_arrival && s.actual_departure
        ? computeHoursWorked(s.planned_arrival, s.actual_departure)
        : null;
    aoa.push([
      spaces.get(s.space_id)?.name ?? s.space_id,
      s.staff_name,
      s.role ?? '',
      s.planned_arrival ?? '',
      s.planned_departure ?? '',
      s.actual_departure ?? '',
      hours !== null ? Number(hours.toFixed(2)) : '',
      s.confirmed_by_staff ? 'Oui' : 'Non',
      s.confirmed_by_manager ? 'Oui' : 'Non',
    ]);
  }
  return aoa;
}

/* ------------------------------------------------------------------ */
/* Feuille 3 — Prestataires présents                                   */
/* ------------------------------------------------------------------ */

export function buildProviderAOA(data: EventExportData): Row[] {
  const spaces = spaceMap(data);
  const aoa: Row[] = [
    [`PROVENCE RUGBY — PRESTATAIRES — ${data.event.event_name}`],
    [],
    ['Société', 'Type', 'Espace', 'Arrivée prévue', 'Arrivée réelle', 'Retard (min)', 'Durée présence (h)', 'Départ site', 'Statut', 'Contact', 'Observations'],
  ];

  for (const p of data.providers) {
    const delay =
      p.planned_arrival_time && p.actual_arrival_time
        ? computeProviderDelay(p.planned_arrival_time, p.actual_arrival_time)
        : null;
    const duration =
      p.actual_arrival_time && p.actual_departure_time
        ? computePresenceDuration(p.actual_arrival_time, p.actual_departure_time)
        : null;
    const contact = [p.provider_contact_name, p.provider_phone]
      .filter(Boolean)
      .join(' · ');
    aoa.push([
      p.provider_company,
      PROVIDER_TYPE_LABELS[p.provider_type],
      p.space_id ? (spaces.get(p.space_id)?.name ?? p.space_id) : 'Tout le stade',
      p.planned_arrival_time ?? '',
      p.actual_arrival_time ?? '',
      delay ?? '',
      duration !== null ? Number(duration.toFixed(2)) : '',
      p.actual_departure_time ?? '',
      PROVIDER_STATUS_META[computeProviderStatus(p)].label,
      contact,
      p.comment ?? '',
    ]);
  }
  return aoa;
}

/* ------------------------------------------------------------------ */
/* Construction et téléchargement du classeur                          */
/* ------------------------------------------------------------------ */

/** Synthèse pour l'aperçu (compteurs de lignes + total). */
export function getReportSummary(data: EventExportData) {
  const stock = buildStockAOA(data);
  return {
    stockLines: data.stockLines.length,
    scheduleLines: data.schedules.length,
    providerLines: data.providers.length,
    totalCost: stock.totalCost,
    hasMissingPrice: stock.hasMissingPrice,
  };
}

/** Génère et télécharge le rapport Excel 3 feuilles. */
export async function exportEventReport(data: EventExportData): Promise<void> {
  const stock = buildStockAOA(data);
  await downloadAoaWorkbook(
    [
      {
        name: 'Bilan Stocks',
        aoa: stock.aoa,
        widths: [16, 8, 26, 12, 8, 9, 14, 12, 9, 12, 12, 13, 13, 16, 11, 18],
        columns: STOCK_COLUMNS,
      },
      {
        name: 'Horaires Staff',
        aoa: buildScheduleAOA(data),
        widths: [18, 22, 18, 14, 13, 12, 16, 12, 14],
        columns: [
          { align: 'left' }, { align: 'left' }, { align: 'center' },
          { align: 'center' }, { align: 'center' }, { align: 'center' },
          { numFmt: HOURS }, { align: 'center' }, { align: 'center' },
        ],
      },
      {
        name: 'Prestataires présents',
        aoa: buildProviderAOA(data),
        widths: [22, 12, 16, 14, 14, 12, 16, 12, 12, 24, 28],
        columns: [
          { align: 'left' }, { align: 'center' }, { align: 'left' },
          { align: 'center' }, { align: 'center' }, { numFmt: MIN },
          { numFmt: HOURS }, { align: 'center' }, { align: 'center' },
          { align: 'left' }, { align: 'left' },
        ],
      },
    ],
    reportFileName(data),
  );
}
