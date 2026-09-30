import { useMemo, useState } from 'react';
import { Plus, PowerOff, RotateCcw, QrCode, AlertTriangle, ShieldAlert, Download } from 'lucide-react';
import { useCatalog, type NewProduct } from '@/hooks/useCatalog';
import { useStockBalances, useReserveLocation } from '@/hooks/useStockV2';
import { formatEuro } from '@/lib/calculations';
import { isStockCritical } from '@/lib/stockCalculations';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  Alert,
  Badge,
  Button,
  Input,
  Select,
  Spinner,
  StatTile,
} from '@/components/ui';
import { downloadAoaWorkbook, sumFormula, type AoaCell, type AoaSheetOut } from '@/lib/xlsxAoa';
import { EUR, INT, PCT, type ColumnStyle } from '@/lib/excelTheme';
import type { Product, ProductCategory } from '@/lib/types';

interface FormState extends NewProduct {
  price: string;
  minStr: string;
  maxStr: string;
}

const CATEGORIES: ProductCategory[] = [
  'Vins',
  'Bières',
  'Soft',
  'Sirops',
  'Spiritueux',
  'Matériel',
];

const EMPTY: FormState = {
  product_name: '',
  category: 'Vins',
  unit: 'btl',
  packaging: '',
  unit_price_ht: null,
  stock_min: 0,
  fournisseur: '',
  is_sensitive: false,
  packaging_qty: 1,
  packaging_unit: '',
  price: '',
  minStr: '',
  maxStr: '',
};

const PACKAGING_UNITS = ['', 'carton', 'palette', 'fût', 'boudin'];

/* Styles de colonnes Excel (charte excelTheme) réutilisés par l'export. */
const colLeft: ColumnStyle = { align: 'left' };
const colCenter: ColumnStyle = { align: 'center' };
const colEur: ColumnStyle = { numFmt: EUR, align: 'right' };
const colInt: ColumnStyle = { numFmt: INT, align: 'right' };
const colPart: ColumnStyle = { numFmt: PCT }; // fraction 0–1

/**
 * RG-003 : le prix HT n'est exporté QUE s'il est visible à l'écran pour ce rôle.
 * CatalogPage est une page admin (ROLE_STADE) qui affiche `unit_price_ht` via
 * `formatEuro` — le prix est donc déjà visible et légitimement exportable.
 */
const PRICE_VISIBLE = true;

export default function CatalogPage() {
  const { products, addProduct, setActive, setTrackCentral, setQrCode, submitting } = useCatalog();
  const reserve = useReserveLocation();
  const { data: reserveBalances } = useStockBalances(reserve?.id);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>({ ...EMPTY });
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const list = products.data ?? [];
  const activeProducts = list.filter((p) => p.active);
  const missingPrice = activeProducts.filter((p) => p.unit_price_ht === null);

  /** Synthèse catalogue (compteurs + répartition par catégorie) — KPIs & export. */
  const summary = useMemo(() => {
    const inactive = list.filter((p) => !p.active).length;
    const catRows = CATEGORIES.map((c) => ({
      key: c,
      label: c,
      count: activeProducts.filter((p) => p.category === c).length,
    }));
    return {
      total: list.length,
      active: activeProducts.length,
      inactive,
      missing: missingPrice.length,
      usedCategories: catRows.filter((r) => r.count > 0).length,
      catRows,
    };
  }, [list, activeProducts, missingPrice]);

  /** Export Excel complet et habillé du catalogue (charte excelTheme). */
  async function exportExcel() {
    setExporting(true);
    try {
      // ── Feuille SYNTHÈSE : compteurs + répartition par catégorie ──
      const active = summary.active;
      const synthAoa: AoaCell[][] = [
        ['Catalogue produits — Provence Rugby · Stade Maurice-David'],
        [],
        ['Indicateur', 'Valeur'],
        ['Produits actifs', summary.active],
        ['Produits inactifs', summary.inactive],
        ['Sans prix HT (RG-005)', summary.missing],
        ['Catégories utilisées', summary.usedCategories],
        ['Total référencés', summary.total],
        [],
        ['Répartition par catégorie', 'Nombre', 'Part'],
        ...[...summary.catRows]
          .sort((a, b) => b.count - a.count)
          .map((r): AoaCell[] => [r.label, r.count, active > 0 ? r.count / active : 0]),
        // « Nombre » = colonne additive → total auto-vérifiant (=SUM). Les catégories
        // occupent les lignes Excel 11..(10+n). « Part » reste une valeur (ratio, non sommé).
        ['Total', sumFormula(1, 11, 10 + summary.catRows.length), active > 0 ? 1 : 0],
      ];

      // ── Feuille CATALOGUE : tous les produits, triés catégorie → nom ──
      const sorted = [...list].sort((a, b) => {
        const ca = CATEGORIES.indexOf(a.category);
        const cb = CATEGORIES.indexOf(b.category);
        if (ca !== cb) return ca - cb;
        return a.product_name.localeCompare(b.product_name, 'fr');
      });

      const header: AoaCell[] = ['Produit', 'Catégorie', 'Unité', 'Conditionnement'];
      const widths: number[] = [30, 14, 8, 20];
      const columns: (ColumnStyle | undefined)[] = [colLeft, colLeft, colCenter, colLeft];
      if (PRICE_VISIBLE) {
        header.push('Prix HT');
        widths.push(12);
        columns.push(colEur);
      }
      header.push('Stock min', 'Actif');
      widths.push(11, 8);
      columns.push(colInt, colCenter);

      const rows: AoaCell[][] = sorted.map((p) => {
        const min = p.min_stock ?? p.stock_min ?? 0;
        const row: AoaCell[] = [p.product_name, p.category, p.unit, p.packaging ?? ''];
        if (PRICE_VISIBLE) row.push(p.unit_price_ht ?? ''); // RG-005 : vide si prix manquant
        row.push(min, p.active ? 'Oui' : 'Non');
        return row;
      });

      // « Stock min » = colonne additive → total auto-vérifiant (=SUM sur les lignes
      // de données 4..3+n). « Prix HT » n'est pas sommé (somme de prix unitaires sans
      // sens) : la cellule reste un compteur « N sans prix ». « Actif » reste un compteur.
      const minColIdx = PRICE_VISIBLE ? 5 : 4;
      const totalRow: AoaCell[] = ['Total', `${summary.total} produit(s)`, '', ''];
      if (PRICE_VISIBLE) totalRow.push(`${summary.missing} sans prix`);
      totalRow.push(sumFormula(minColIdx, 4, 3 + rows.length), `${summary.active} actif(s)`);

      const sheets: AoaSheetOut[] = [
        {
          name: 'Synthèse',
          aoa: synthAoa,
          widths: [30, 14, 12],
          columns: [colLeft, colInt, colPart],
        },
        {
          name: 'Catalogue',
          aoa: [['Catalogue produits — Provence Rugby'], [], header, ...rows, totalRow],
          widths,
          columns,
        },
      ];

      const dateStr = new Date().toISOString().slice(0, 10);
      await downloadAoaWorkbook(sheets, `Catalogue-produits_Provence-Rugby_${dateStr}.xlsx`);
    } finally {
      setExporting(false);
    }
  }

  /** Quantité en réserve centrale par produit (pour le badge « critique »). */
  const reserveQty = useMemo(() => {
    const map: Record<string, number> = {};
    for (const b of reserveBalances ?? []) map[b.product_id] = Number(b.current_quantity);
    return map;
  }, [reserveBalances]);

  const grouped = useMemo(() => {
    const map = new Map<ProductCategory, Product[]>();
    CATEGORIES.forEach((c) => map.set(c, []));
    for (const p of activeProducts) {
      map.get(p.category)?.push(p);
    }
    return map;
  }, [activeProducts]);

  async function handleAdd() {
    setError(null);
    if (!form.product_name.trim()) {
      setError('Le nom du produit est obligatoire.');
      return;
    }
    // Prix HT obligatoire : sans lui, la valorisation et le coût F&B restent à 0.
    const priceNum = Number(form.price);
    if (form.price.trim() === '' || !Number.isFinite(priceNum) || priceNum < 0) {
      setError('Le prix HT est obligatoire (valorisation & coût F&B).');
      return;
    }
    try {
      const min = form.minStr === '' ? 0 : Number(form.minStr);
      await addProduct({
        product_name: form.product_name,
        category: form.category,
        unit: form.unit,
        packaging: form.packaging,
        unit_price_ht: priceNum,
        stock_min: min,
        min_stock: min,
        max_stock: form.maxStr === '' ? null : Number(form.maxStr),
        fournisseur: form.fournisseur,
        is_sensitive: form.is_sensitive,
        packaging_qty: form.packaging_qty ?? 1,
        packaging_unit: form.packaging_unit,
      });
      setForm({ ...EMPTY });
      setShowForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de l\'ajout.');
    }
  }

  async function handleGenerateQr(p: Product) {
    const code = `PR-${p.category.slice(0, 3).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    try {
      await setQrCode(p.product_id, code);
    } catch {
      /* silencieux : la génération du code ne bloque pas l'opérationnel */
    }
  }

  if (products.isLoading) return <Spinner fullPage label="Chargement…" />;

  return (
    <div>
      <PageHeader
        title="Catalogue"
        description={`${activeProducts.length} produits actifs · ${missingPrice.length} sans prix`}
        action={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={list.length === 0 || exporting}
              onClick={() => void exportExcel()}
            >
              <Download className="h-4 w-4" /> {exporting ? 'Génération…' : 'Exporter Excel'}
            </Button>
            <Button size="sm" onClick={() => setShowForm((v) => !v)}>
              <Plus className="h-4 w-4" /> Ajouter un produit
            </Button>
          </div>
        }
      />

      {/* Bande de synthèse (KPIs + mini-graphe) — vue d'ensemble du catalogue. */}
      {list.length > 0 && (
        <div className="mb-5 space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile label="Produits actifs" value={summary.active} sub={`${summary.total} référencés`} />
            <StatTile label="Catégories" value={summary.usedCategories} sub={`sur ${CATEGORIES.length}`} />
            <StatTile
              label="Sans prix HT"
              value={summary.missing}
              tone={summary.missing > 0 ? 'warn' : 'good'}
              sub="RG-005"
            />
            <StatTile
              label="Inactifs"
              value={summary.inactive}
              tone={summary.inactive > 0 ? 'crit' : 'default'}
              sub="désactivés (RG-009)"
            />
            <StatTile
              label="Catégorie n°1"
              value={
                (() => {
                  const top = [...summary.catRows].sort((a, b) => b.count - a.count)[0];
                  return top && top.count > 0 ? <span className="block truncate text-sm">{top.label}</span> : '—';
                })()
              }
              sub={(() => {
                const top = [...summary.catRows].sort((a, b) => b.count - a.count)[0];
                return top && top.count > 0 ? `${top.count} produit(s)` : 'aucun';
              })()}
            />
          </div>
          <CategoryBreakdown items={summary.catRows} total={summary.active} />
        </div>
      )}

      {showForm && (
        <div className="mb-5 space-y-3 rounded-lg bg-white p-4 ring-1 ring-pr-stone">
          {error && <Alert variant="error">{error}</Alert>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="Nom *"
              value={form.product_name}
              onChange={(e) => setForm({ ...form, product_name: e.target.value })}
            />
            <Select
              label="Catégorie"
              options={CATEGORIES.map((c) => ({ value: c, label: c }))}
              value={form.category}
              onChange={(e) =>
                setForm({ ...form, category: e.target.value as ProductCategory })
              }
            />
            <Input
              label="Unité"
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
            />
            <Input
              label="Conditionnement"
              value={form.packaging ?? ''}
              onChange={(e) => setForm({ ...form, packaging: e.target.value })}
            />
            <Input
              type="number"
              step="0.01"
              label="Prix HT (€) *"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
            <Input
              label="Fournisseur"
              value={form.fournisseur ?? ''}
              onChange={(e) => setForm({ ...form, fournisseur: e.target.value })}
            />
            <Input
              type="number"
              label="Stock minimum *"
              value={form.minStr}
              onChange={(e) => setForm({ ...form, minStr: e.target.value })}
            />
            <Input
              type="number"
              label="Stock maximum"
              value={form.maxStr}
              onChange={(e) => setForm({ ...form, maxStr: e.target.value })}
            />
            <Input
              type="number"
              label="Conditionnement — quantité"
              value={String(form.packaging_qty ?? 1)}
              onChange={(e) => setForm({ ...form, packaging_qty: Number(e.target.value) || 1 })}
            />
            <Select
              label="Conditionnement — unité"
              options={PACKAGING_UNITS.map((u) => ({ value: u, label: u || '—' }))}
              value={form.packaging_unit ?? ''}
              onChange={(e) => setForm({ ...form, packaging_unit: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-pr-black-soft/80">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-pr-stone text-pr-olive focus:ring-pr-olive"
              checked={form.is_sensitive ?? false}
              onChange={(e) => setForm({ ...form, is_sensitive: e.target.checked })}
            />
            Produit sensible (coûteux ou à risque)
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowForm(false)}>
              Annuler
            </Button>
            <Button loading={submitting} onClick={handleAdd}>
              Ajouter
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {CATEGORIES.map((category) => {
          const items = grouped.get(category) ?? [];
          if (items.length === 0) return null;
          return (
            <section key={category}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-pr-black-soft/50">
                {category} ({items.length})
              </h2>
              <ul className="space-y-2">
                {items.map((p) => {
                  const min = p.min_stock ?? p.stock_min ?? 0;
                  const critical = p.product_id in reserveQty && isStockCritical(reserveQty[p.product_id], min);
                  return (
                    <li
                      key={p.product_id}
                      className="flex items-center justify-between gap-3 rounded-lg bg-white p-3 ring-1 ring-pr-stone"
                    >
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 truncate font-medium text-pr-black">
                          {p.product_name}
                          {p.is_sensitive && (
                            <Badge tone="danger">
                              <ShieldAlert className="mr-1 inline h-3 w-3" /> Sensible
                            </Badge>
                          )}
                          {critical && (
                            <Badge tone="danger">
                              <AlertTriangle className="mr-1 inline h-3 w-3" /> Stock critique
                            </Badge>
                          )}
                        </p>
                        <p className="text-xs text-pr-black-soft/50">
                          {p.unit}
                          {p.packaging ? ` · ${p.packaging}` : ''}
                          {` · Min: ${min}${p.max_stock != null ? ` | Max: ${p.max_stock}` : ''}`}
                          {p.fournisseur ? ` · ${p.fournisseur}` : ''}
                          {p.qr_code ? ` · QR: ${p.qr_code}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        {p.unit_price_ht === null ? (
                          <Badge tone="warning">Prix manquant</Badge>
                        ) : (
                          <span className="text-sm font-medium text-pr-black-soft/80">
                            {formatEuro(p.unit_price_ht)}
                          </span>
                        )}
                        <button
                          disabled={submitting}
                          onClick={() => void setTrackCentral(p.product_id, p.track_central_stock === false)}
                          title={p.track_central_stock === false
                            ? 'Hors suivi central — cliquer pour réintégrer aux alertes'
                            : 'Suivi central actif — cliquer pour exclure des alertes (produit livré par événement)'}
                          className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold disabled:opacity-40 ${
                            p.track_central_stock === false
                              ? 'bg-pr-stone/50 text-pr-black-soft/45'
                              : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {p.track_central_stock === false ? 'Hors suivi' : 'Suivi central'}
                        </button>
                        {!p.qr_code && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={submitting}
                            onClick={() => void handleGenerateQr(p)}
                            title="Générer un code QR"
                          >
                            <QrCode className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={submitting}
                          onClick={() => void setActive(p.product_id, false)}
                          title="Désactiver (RG-009)"
                        >
                          <PowerOff className="h-4 w-4" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      {/* Produits désactivés */}
      {list.some((p) => !p.active) && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-pr-black-soft/45">
            Produits désactivés
          </h2>
          <ul className="space-y-2">
            {list
              .filter((p) => !p.active)
              .map((p) => (
                <li
                  key={p.product_id}
                  className="flex items-center justify-between gap-3 rounded-lg bg-pr-cream p-3 ring-1 ring-pr-stone"
                >
                  <span className="text-sm text-pr-black-soft/50 line-through">
                    {p.product_name}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={submitting}
                    onClick={() => void setActive(p.product_id, true)}
                  >
                    <RotateCcw className="h-4 w-4" /> Réactiver
                  </Button>
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Mini-graphe : répartition des produits actifs par catégorie (tri décroissant). */
function CategoryBreakdown({
  items,
  total,
}: {
  items: { key: string; label: string; count: number }[];
  total: number;
}) {
  const visible = items.filter((i) => i.count > 0).sort((a, b) => b.count - a.count);
  const max = Math.max(1, ...visible.map((i) => i.count));
  if (visible.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-2xl border border-pr-stone bg-white">
      <div className="border-b border-pr-stone bg-pr-cream px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-pr-black-soft/50">
        Répartition par catégorie
      </div>
      <div className="divide-y divide-pr-stone/50">
        {visible.map((r) => (
          <div key={r.key} className="px-4 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-pr-black-soft/80">{r.label}</span>
              <span className="shrink-0 text-sm font-bold tabular-nums text-pr-olive-dark">
                {r.count}
                <span className="ml-1 text-[11px] font-normal text-pr-black-soft/40">
                  {total > 0 ? `${Math.round((r.count / total) * 100)} %` : ''}
                </span>
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-pr-stone/50">
              <div className="h-full rounded-full bg-pr-olive" style={{ width: `${(r.count / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
