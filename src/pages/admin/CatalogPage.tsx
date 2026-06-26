import { useMemo, useState } from 'react';
import { Plus, PowerOff, RotateCcw } from 'lucide-react';
import { useCatalog, type NewProduct } from '@/hooks/useCatalog';
import { formatEuro } from '@/lib/calculations';
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

const CATEGORIES: ProductCategory[] = [
  'Vins',
  'Bières',
  'Soft',
  'Sirops',
  'Spiritueux',
  'Matériel',
];

const EMPTY: NewProduct = {
  product_name: '',
  category: 'Vins',
  unit: 'btl',
  packaging: '',
  unit_price_ht: null,
  stock_min: 0,
};

export default function CatalogPage() {
  const { products, addProduct, setActive, submitting } = useCatalog();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<NewProduct & { price: string }>({
    ...EMPTY,
    price: '',
  });
  const [error, setError] = useState<string | null>(null);

  const list = products.data ?? [];
  const activeProducts = list.filter((p) => p.active);
  const missingPrice = activeProducts.filter((p) => p.unit_price_ht === null);

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
    try {
      await addProduct({
        product_name: form.product_name,
        category: form.category,
        unit: form.unit,
        packaging: form.packaging,
        unit_price_ht: form.price === '' ? null : Number(form.price),
        stock_min: form.stock_min,
      });
      setForm({ ...EMPTY, price: '' });
      setShowForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de l\'ajout.');
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
              label="Prix HT (€) — laisser vide si inconnu"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
            <Input
              type="number"
              label="Stock min."
              value={String(form.stock_min ?? 0)}
              onChange={(e) =>
                setForm({ ...form, stock_min: Number(e.target.value) || 0 })
              }
            />
          </div>
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
                {items.map((p) => (
                  <li
                    key={p.product_id}
                    className="flex items-center justify-between gap-3 rounded-lg bg-white p-3 ring-1 ring-slate-200"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">
                        {p.product_name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {p.unit}
                        {p.packaging ? ` · ${p.packaging}` : ''}
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
                ))}
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
