/**
 * Export Excel (SheetJS) — Bilan d'un événement en 3 feuilles (Phase 7).
 *
 * ⚠ Réservé au ROLE_STADE : ce fichier contient les prix et coûts (RG-003).
 * Aucun export n'est proposé côté Responsable.
 *
 * Note : la mise en gras des en-têtes nécessite `xlsx-js-style` (l'édition
 * communautaire de SheetJS ignore les styles à l'écriture). Les largeurs de
 * colonnes (`!cols`) et une ligne de titre en majuscules sont appliquées.
 */

import * as XLSX from 'xlsx';
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

type Cell = string | number;
type Row = Cell[];

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
    'Consommation', 'Prix U HT (€)', 'Coût Total HT (€)', 'Responsable saisie',
  ];

  const aoa: Row[] = [
    [`BILAN STOCKS — ${data.event.event_name} — ${data.event.event_date} — ${data.event.event_type ?? ''} — ${data.event.expected_attendees ?? ''} spectateurs`],
    [],
    header,
  ];

  let grandTotal = 0;
  let hasMissingPrice = false;

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

    for (const pid of productIds) {
      const product = priceOf.get(pid);
      const line = lines.find((l) => l.product_id === pid);
      const dotation = dotations.find((d) => d.product_id === pid);
      const consumed =
        line && line.final_qty !== null
          ? computeConsumed(line.initial_qty, line.reassort_qty, line.final_qty)
          : null;
      const price = product?.unit_price_ht ?? null;
      const cost = consumed !== null ? computeCost(consumed, price) : null;
      if (cost !== null) spaceSubtotal += cost;
      if (price === null) hasMissingPrice = true;

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
        line?.final_qty ?? '',
        line?.product_state ? PRODUCT_STATE_META[line.product_state].label : '',
        consumed ?? '',
        price ?? '',
        cost ?? '',
        line?.responsable_nom ?? '',
      ]);
    }

    aoa.push([`Sous-total ${info.name}`, '', '', '', '', '', '', '', '', '', '', '', '', spaceSubtotal, '']);
    grandTotal += spaceSubtotal;
  }

  aoa.push([]);
  aoa.push(['TOTAL GÉNÉRAL', '', '', '', '', '', '', '', '', '', '', '', '', grandTotal, '']);

  return { aoa, totalCost: grandTotal, hasMissingPrice };
}

/* ------------------------------------------------------------------ */
/* Feuille 2 — Horaires Staff                                          */
/* ------------------------------------------------------------------ */

export function buildScheduleAOA(data: EventExportData): Row[] {
  const spaces = spaceMap(data);
  const aoa: Row[] = [
    [`HORAIRES STAFF — ${data.event.event_name}`],
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
    [`PRESTATAIRES — ${data.event.event_name}`],
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

function withColWidths(ws: XLSX.WorkSheet, widths: number[]): XLSX.WorkSheet {
  ws['!cols'] = widths.map((wch) => ({ wch }));
  return ws;
}

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
export function exportEventReport(data: EventExportData): void {
  const wb = XLSX.utils.book_new();

  const stock = buildStockAOA(data);
  const wsStock = withColWidths(
    XLSX.utils.aoa_to_sheet(stock.aoa),
    [16, 8, 26, 12, 8, 9, 14, 12, 9, 11, 12, 13, 13, 16, 18],
  );
  XLSX.utils.book_append_sheet(wb, wsStock, 'Bilan Stocks');

  const wsSchedule = withColWidths(
    XLSX.utils.aoa_to_sheet(buildScheduleAOA(data)),
    [16, 22, 16, 14, 13, 12, 16, 12, 14],
  );
  XLSX.utils.book_append_sheet(wb, wsSchedule, 'Horaires Staff');

  const wsProvider = withColWidths(
    XLSX.utils.aoa_to_sheet(buildProviderAOA(data)),
    [22, 12, 16, 14, 14, 12, 16, 12, 12, 24, 28],
  );
  XLSX.utils.book_append_sheet(wb, wsProvider, 'Prestataires présents');

  XLSX.writeFile(wb, reportFileName(data));
}
