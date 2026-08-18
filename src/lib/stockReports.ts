/**
 * Générateurs de rapports Excel (exceljs) — Module Stock (onglet « Rapports »).
 *
 * ⚠ Réservé au ROLE_STADE : ces exports contiennent prix et coûts (RG-003).
 *
 * Chaque fonction récupère ses données via Supabase, construit ses feuilles en
 * matrices (en-tête + lignes) puis déclenche le téléchargement via
 * `downloadAoaWorkbook` (voir `lib/xlsxAoa`). Les tableaux vides sont tolérés :
 * on écrit alors uniquement l'en-tête.
 */

import { downloadAoaWorkbook, type AoaSheetOut } from './xlsxAoa';
import { computeConsumed } from './calculations';
import { supabase } from '@/lib/supabase';

/** Date du jour au format YYYY-MM-DD (nom de fichier). */
const today = () => new Date().toISOString().slice(0, 10);

/** Placeholder pour une valeur monétaire indisponible (RG-005). */
const DASH = '—';

type Cell = string | number;
type Row = Cell[];

/** Nettoie un libellé pour un nom de fichier. */
function sanitize(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Ajoute une feuille (matrice + largeurs) à la liste des feuilles à écrire. */
function appendSheet(
  sheets: AoaSheetOut[],
  name: string,
  aoa: Row[],
  widths: number[],
): void {
  sheets.push({ name, aoa, widths });
}

/* ------------------------------------------------------------------ */
/* Types de lignes récupérées (colonnes minimales nécessaires)         */
/* ------------------------------------------------------------------ */

interface StockLineRow {
  event_id: string;
  space_id: string;
  product_id: string;
  initial_qty: number;
  reassort_qty: number;
  final_qty: number | null;
  product_state: string | null;
  anomaly_comment: string | null;
  responsable_nom: string | null;
}

interface ProductLite {
  product_id: string;
  product_name: string;
  unit_price_ht: number | null;
  min_stock: number | null;
  max_stock: number | null;
}

/* ------------------------------------------------------------------ */
/* Résolution des libellés (Maps)                                      */
/* ------------------------------------------------------------------ */

async function fetchProductsMap(): Promise<Map<string, ProductLite>> {
  const { data, error } = await supabase
    .from('products')
    .select('product_id, product_name, unit_price_ht, min_stock, max_stock');
  if (error) throw error;
  const map = new Map<string, ProductLite>();
  ((data ?? []) as ProductLite[]).forEach((p) => map.set(p.product_id, p));
  return map;
}

async function fetchSpacesMap(): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('spaces').select('space_id, space_name');
  if (error) throw error;
  const map = new Map<string, string>();
  ((data ?? []) as { space_id: string; space_name: string }[]).forEach((s) =>
    map.set(s.space_id, s.space_name),
  );
  return map;
}

async function fetchEventsMap(): Promise<
  Map<string, { name: string; date: string }>
> {
  const { data, error } = await supabase
    .from('events')
    .select('event_id, event_name, event_date');
  if (error) throw error;
  const map = new Map<string, { name: string; date: string }>();
  ((data ?? []) as { event_id: string; event_name: string; event_date: string }[]).forEach(
    (e) => map.set(e.event_id, { name: e.event_name, date: e.event_date }),
  );
  return map;
}

async function fetchLocationsMap(): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('stock_locations').select('id, name');
  if (error) throw error;
  const map = new Map<string, string>();
  ((data ?? []) as { id: string; name: string }[]).forEach((l) => map.set(l.id, l.name));
  return map;
}

/* ------------------------------------------------------------------ */
/* 1 — Rapport par événement                                           */
/* ------------------------------------------------------------------ */

export async function exportRapportEvenement(eventId: string): Promise<void> {
  const [products, spaces, events] = await Promise.all([
    fetchProductsMap(),
    fetchSpacesMap(),
    fetchEventsMap(),
  ]);

  const { data, error } = await supabase
    .from('event_stock_lines')
    .select(
      'event_id, space_id, product_id, initial_qty, reassort_qty, final_qty, product_state, anomaly_comment, responsable_nom',
    )
    .eq('event_id', eventId);
  if (error) throw error;
  const lines = (data ?? []) as StockLineRow[];

  const header: Row = [
    'Espace', 'Produit', 'Initial', 'Réassort', 'Final', 'Consommé',
    'Coût HT (€)', 'État produit', 'Anomalie', 'Responsable',
  ];
  const aoa: Row[] = [header];

  for (const l of lines) {
    const product = products.get(l.product_id);
    const consumed =
      l.final_qty !== null
        ? computeConsumed(l.initial_qty, l.reassort_qty, l.final_qty)
        : null;
    const price = product?.unit_price_ht ?? null;
    const cost =
      consumed !== null && price !== null ? Number((consumed * price).toFixed(2)) : DASH;
    aoa.push([
      spaces.get(l.space_id) ?? l.space_id,
      product?.product_name ?? l.product_id,
      l.initial_qty,
      l.reassort_qty,
      l.final_qty ?? '',
      consumed ?? '',
      cost,
      l.product_state ?? '',
      l.anomaly_comment ?? '',
      l.responsable_nom ?? '',
    ]);
  }

  const ev = events.get(eventId);
  const label = ev ? `${sanitize(ev.name)}_${ev.date}` : sanitize(eventId);
  const sheets: AoaSheetOut[] = [];
  appendSheet(sheets,'Événement', aoa, [16, 26, 9, 9, 8, 10, 12, 14, 28, 18]);
  await downloadAoaWorkbook(sheets,`Rapport_Evenement_${label}_${today()}.xlsx`);
}

/* ------------------------------------------------------------------ */
/* 2 — Rapport par espace                                              */
/* ------------------------------------------------------------------ */

export async function exportRapportEspace(spaceId: string): Promise<void> {
  const [products, spaces] = await Promise.all([fetchProductsMap(), fetchSpacesMap()]);

  const { data, error } = await supabase
    .from('event_stock_lines')
    .select('product_id, initial_qty, reassort_qty, final_qty')
    .eq('space_id', spaceId);
  if (error) throw error;
  const lines = (data ?? []) as Pick<
    StockLineRow,
    'product_id' | 'initial_qty' | 'reassort_qty' | 'final_qty'
  >[];

  // Agrégation du consommé par produit.
  const totals = new Map<string, number>();
  for (const l of lines) {
    if (l.final_qty === null) continue;
    const consumed = computeConsumed(l.initial_qty, l.reassort_qty, l.final_qty);
    totals.set(l.product_id, (totals.get(l.product_id) ?? 0) + consumed);
  }

  const header: Row = ['Produit', 'Total consommé', 'Coût HT (€)'];
  const aoa: Row[] = [header];
  for (const [productId, consumed] of totals) {
    const product = products.get(productId);
    const price = product?.unit_price_ht ?? null;
    const cost = price !== null ? Number((consumed * price).toFixed(2)) : DASH;
    aoa.push([product?.product_name ?? productId, consumed, cost]);
  }

  const spaceName = spaces.get(spaceId) ?? spaceId;
  const sheets: AoaSheetOut[] = [];
  appendSheet(sheets,'Espace', aoa, [28, 16, 14]);
  await downloadAoaWorkbook(sheets,`Rapport_Espace_${sanitize(spaceName)}_${today()}.xlsx`);
}

/* ------------------------------------------------------------------ */
/* 3 — Rapport par produit                                             */
/* ------------------------------------------------------------------ */

export async function exportRapportProduit(productId: string): Promise<void> {
  const [products, spaces, events] = await Promise.all([
    fetchProductsMap(),
    fetchSpacesMap(),
    fetchEventsMap(),
  ]);

  const { data, error } = await supabase
    .from('event_stock_lines')
    .select(
      'event_id, space_id, initial_qty, reassort_qty, final_qty, responsable_nom',
    )
    .eq('product_id', productId);
  if (error) throw error;
  const lines = (data ?? []) as (Pick<
    StockLineRow,
    'event_id' | 'space_id' | 'initial_qty' | 'reassort_qty' | 'final_qty' | 'responsable_nom'
  >)[];

  const price = products.get(productId)?.unit_price_ht ?? null;

  const header: Row = ['Date', 'Événement', 'Espace', 'Consommé', 'Coût HT (€)', 'Responsable'];
  const aoa: Row[] = [header];

  const rows = lines
    .map((l) => {
      const ev = events.get(l.event_id);
      const consumed =
        l.final_qty !== null
          ? computeConsumed(l.initial_qty, l.reassort_qty, l.final_qty)
          : null;
      return {
        date: ev?.date ?? '',
        eventName: ev?.name ?? l.event_id,
        spaceName: spaces.get(l.space_id) ?? l.space_id,
        consumed,
        responsable: l.responsable_nom ?? '',
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const r of rows) {
    const cost =
      r.consumed !== null && price !== null
        ? Number((r.consumed * price).toFixed(2))
        : DASH;
    aoa.push([r.date, r.eventName, r.spaceName, r.consumed ?? '', cost, r.responsable]);
  }

  const productName = products.get(productId)?.product_name ?? productId;
  const sheets: AoaSheetOut[] = [];
  appendSheet(sheets,'Produit', aoa, [12, 26, 16, 10, 12, 18]);
  await downloadAoaWorkbook(sheets,`Rapport_Produit_${sanitize(productName)}_${today()}.xlsx`);
}

/* ------------------------------------------------------------------ */
/* 4 — Rapport stock général (3 feuilles)                              */
/* ------------------------------------------------------------------ */

interface BalanceRow {
  product_id: string;
  location_id: string;
  current_quantity: number;
  unit_value_ht: number | null;
}

interface InventoryRow {
  location_id: string;
  product_id: string;
  variance: number | null;
  validated_at: string | null;
}

export async function exportRapportStockGeneral(): Promise<void> {
  const [products, locations] = await Promise.all([
    fetchProductsMap(),
    fetchLocationsMap(),
  ]);

  const [balancesRes, inventoryRes] = await Promise.all([
    supabase
      .from('stock_balances')
      .select('product_id, location_id, current_quantity, unit_value_ht'),
    supabase
      .from('inventory_counts')
      .select('location_id, product_id, variance, validated_at'),
  ]);
  if (balancesRes.error) throw balancesRes.error;
  if (inventoryRes.error) throw inventoryRes.error;
  const balances = (balancesRes.data ?? []) as BalanceRow[];
  const inventory = (inventoryRes.data ?? []) as InventoryRow[];

  // Feuille 1 — Vue globale (par produit).
  const totalsByProduct = new Map<
    string,
    { qty: number; value: number; hasValue: boolean }
  >();
  for (const b of balances) {
    const acc = totalsByProduct.get(b.product_id) ?? { qty: 0, value: 0, hasValue: false };
    acc.qty += Number(b.current_quantity);
    if (b.unit_value_ht !== null) {
      acc.value += Number(b.current_quantity) * b.unit_value_ht;
      acc.hasValue = true;
    }
    totalsByProduct.set(b.product_id, acc);
  }

  const globalHeader: Row = [
    'Produit', 'Quantité totale', 'Valeur HT (€)', 'Stock min', 'Stock max', 'Statut',
  ];
  const globalAoa: Row[] = [globalHeader];
  const criticalProductIds = new Set<string>();
  for (const [productId, acc] of totalsByProduct) {
    const product = products.get(productId);
    const minStock = product?.min_stock ?? null;
    const critical = minStock !== null && acc.qty < minStock;
    if (critical) criticalProductIds.add(productId);
    globalAoa.push([
      product?.product_name ?? productId,
      acc.qty,
      acc.hasValue ? Number(acc.value.toFixed(2)) : DASH,
      minStock ?? '',
      product?.max_stock ?? '',
      critical ? 'Critique' : 'OK',
    ]);
  }

  // Feuille 2 — Par emplacement.
  const locHeader: Row = ['Emplacement', 'Produit', 'Quantité'];
  const locAoa: Row[] = [locHeader];
  for (const b of balances) {
    locAoa.push([
      locations.get(b.location_id) ?? b.location_id,
      products.get(b.product_id)?.product_name ?? b.product_id,
      Number(b.current_quantity),
    ]);
  }

  // Feuille 3 — Alertes (produits critiques + écarts inventaire non résolus).
  const alertHeader: Row = ['Type', 'Produit', 'Emplacement', 'Détail'];
  const alertAoa: Row[] = [alertHeader];
  for (const productId of criticalProductIds) {
    const acc = totalsByProduct.get(productId);
    const product = products.get(productId);
    alertAoa.push([
      'Stock critique',
      product?.product_name ?? productId,
      'Tous emplacements',
      `Qté ${acc?.qty ?? 0} < min ${product?.min_stock ?? ''}`,
    ]);
  }
  for (const inv of inventory) {
    if (inv.variance === null || Number(inv.variance) === 0 || inv.validated_at) continue;
    alertAoa.push([
      'Écart inventaire',
      products.get(inv.product_id)?.product_name ?? inv.product_id,
      locations.get(inv.location_id) ?? inv.location_id,
      `Écart ${inv.variance}`,
    ]);
  }

  const sheets: AoaSheetOut[] = [];
  appendSheet(sheets,'Vue globale', globalAoa, [28, 16, 14, 10, 10, 12]);
  appendSheet(sheets,'Par emplacement', locAoa, [22, 28, 12]);
  appendSheet(sheets,'Alertes', alertAoa, [16, 28, 22, 26]);
  await downloadAoaWorkbook(sheets,`Rapport_Stock_General_${today()}.xlsx`);
}

/* ------------------------------------------------------------------ */
/* 5 — Rapport prestataires                                            */
/* ------------------------------------------------------------------ */

interface ProviderRow {
  provider_company: string;
  provider_type: string;
  planned_arrival_time: string | null;
  actual_arrival_time: string | null;
  status: string | null;
  responsable_nom: string | null;
}

export async function exportRapportPrestataires(eventId: string): Promise<void> {
  const events = await fetchEventsMap();

  const { data, error } = await supabase
    .from('provider_presence')
    .select(
      'provider_company, provider_type, planned_arrival_time, actual_arrival_time, status, responsable_nom',
    )
    .eq('event_id', eventId);
  if (error) throw error;
  const providers = (data ?? []) as ProviderRow[];

  const header: Row = [
    'Société', 'Type', 'Arrivée prévue', 'Arrivée réelle', 'Statut', 'Responsable',
  ];
  const aoa: Row[] = [header];
  for (const p of providers) {
    aoa.push([
      p.provider_company,
      p.provider_type,
      p.planned_arrival_time ?? '',
      p.actual_arrival_time ?? '',
      p.status ?? '',
      p.responsable_nom ?? '',
    ]);
  }

  const ev = events.get(eventId);
  const label = ev ? `${sanitize(ev.name)}_${ev.date}` : sanitize(eventId);
  const sheets: AoaSheetOut[] = [];
  appendSheet(sheets,'Prestataires', aoa, [24, 14, 14, 14, 14, 18]);
  await downloadAoaWorkbook(sheets,`Rapport_Prestataires_${label}_${today()}.xlsx`);
}

/* ------------------------------------------------------------------ */
/* 6 — Rapport inventaire (par emplacement)                            */
/* ------------------------------------------------------------------ */

interface InventoryCountRow {
  product_id: string;
  theoretical_qty: number | null;
  real_qty: number | null;
  variance: number | null;
  responsible_name: string | null;
  counted_at: string | null;
  comment: string | null;
  validated_at: string | null;
}

export async function exportRapportInventaire(locationId: string): Promise<void> {
  const [products, locations] = await Promise.all([
    fetchProductsMap(),
    fetchLocationsMap(),
  ]);

  const { data, error } = await supabase
    .from('inventory_counts')
    .select(
      'product_id, theoretical_qty, real_qty, variance, responsible_name, counted_at, comment, validated_at',
    )
    .eq('location_id', locationId)
    .order('counted_at', { ascending: false });
  if (error) throw error;
  const counts = (data ?? []) as InventoryCountRow[];

  const header: Row = [
    'Produit', 'Théorique', 'Réel', 'Écart', 'Responsable', 'Date', 'Commentaire', 'Validé',
  ];
  const aoa: Row[] = [header];
  for (const c of counts) {
    aoa.push([
      products.get(c.product_id)?.product_name ?? c.product_id,
      c.theoretical_qty ?? '',
      c.real_qty ?? '',
      c.variance ?? '',
      c.responsible_name ?? '',
      c.counted_at ? c.counted_at.slice(0, 10) : '',
      c.comment ?? '',
      c.validated_at ? 'oui' : 'non',
    ]);
  }

  const locName = locations.get(locationId) ?? locationId;
  const sheets: AoaSheetOut[] = [];
  appendSheet(sheets,'Inventaire', aoa, [28, 11, 9, 9, 18, 12, 30, 8]);
  await downloadAoaWorkbook(sheets,`Rapport_Inventaire_${sanitize(locName)}_${today()}.xlsx`);
}
