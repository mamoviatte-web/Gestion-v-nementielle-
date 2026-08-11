import { useMemo, useState } from 'react';
import { Plus, PowerOff, RotateCcw, QrCode, AlertTriangle, ShieldAlert } from 'lucide-react';
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
} from '@/components/ui';
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

export default function CatalogPage() {
  const { products, addProduct, setActive, setTrackCentral, setQrCode, submitting } = useCatalog();
  const reserve = useReserveLocation();
  const { data: reserveBalances } = useStockBalances(reserve?.id);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>({ ...EMPTY });
  const [error, setError] = useState<string | null>(null);

  const list = products.data ?? [];
  const activeProducts = list.filter((p) => p.active);
  const missingPrice = activeProducts.filter((p) => p.unit_price_ht === null);

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
          <Button size="sm" onClick={() => setShowForm((v) => !v)}>
            <Plus className="h-4 w-4" /> Ajouter un produit
          </Button>
        }
      />

      {showForm && (
        <div className="mb-5 space-y-3 rounded-lg bg-white p-4 ring-1 ring-slate-200">
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
          <label className="flex items-center gap-2 text-sm text-slate-700">
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
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                {category} ({items.length})
              </h2>
              <ul className="space-y-2">
                {items.map((p) => {
                  const min = p.min_stock ?? p.stock_min ?? 0;
                  const critical = p.product_id in reserveQty && isStockCritical(reserveQty[p.product_id], min);
                  return (
                    <li
                      key={p.product_id}
                      className="flex items-center justify-between gap-3 rounded-lg bg-white p-3 ring-1 ring-slate-200"
                    >
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 truncate font-medium text-slate-900">
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
                        <p className="text-xs text-slate-500">
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
                          <span className="text-sm font-medium text-slate-700">
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
                              ? 'bg-slate-100 text-slate-400'
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
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Produits désactivés
          </h2>
          <ul className="space-y-2">
            {list
              .filter((p) => !p.active)
              .map((p) => (
                <li
                  key={p.product_id}
                  className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200"
                >
                  <span className="text-sm text-slate-500 line-through">
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
