/**
 * DeliveryModal — enregistrement d'une livraison fournisseur sur un dépôt
 * (ROLE_STADE). L'INSERT des lignes déclenche côté base la mise à jour des
 * soldes du dépôt + un mouvement `entrée_fournisseur` par produit (RG-002).
 */

import { useMemo, useState } from 'react';
import { Plus, Trash2, Truck, X, Sparkles } from 'lucide-react';
import { Alert, Button, Input, Select, Textarea } from '@/components/ui';
import { formatEuro } from '@/lib/calculations';
import { useCatalog } from '@/hooks/useCatalog';
import { useRecordDelivery, type DeliveryLineInput } from '@/hooks/useDepots';
import { InvoiceScanner, type ExtractedInvoice } from './InvoiceScanner';
import type { Product } from '@/lib/types';

interface LineDraft {
  key: string;
  productId: string;
  qtyReceived: string;
  unitPriceHt: string;
  /** Contexte facture (scanner IA). */
  rawName?: string;
  confidence?: 'high' | 'medium' | 'low';
}

function todayISO(): string {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local
}

function newLine(): LineDraft {
  return { key: crypto.randomUUID(), productId: '', qtyReceived: '', unitPriceHt: '' };
}

export function DeliveryModal({
  depotId,
  depotName,
  categoryScope,
  onClose,
  onSaved,
}: {
  depotId: string;
  depotName: string;
  /** Familles autorisées pour ce dépôt (null = toutes). */
  categoryScope: string[] | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { products } = useCatalog();
  const { recordDelivery, recording } = useRecordDelivery();

  const [supplierName, setSupplierName] = useState('');
  const [deliveryDate, setDeliveryDate] = useState(todayISO());
  const [invoiceRef, setInvoiceRef] = useState('');
  const [receivedBy, setReceivedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>(() => [newLine()]);
  const [error, setError] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [scannerUsed, setScannerUsed] = useState(false);

  const catalog = useMemo(() => {
    const all = (products.data ?? []).filter((p) => p.active);
    const scoped = categoryScope ? all.filter((p) => categoryScope.includes(p.category)) : all;
    return scoped.sort(
      (a, b) => a.category.localeCompare(b.category) || a.product_name.localeCompare(b.product_name),
    );
  }, [products.data, categoryScope]);

  const productById = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of catalog) m.set(p.product_id, p);
    return m;
  }, [catalog]);

  const productOptions = useMemo(
    () => catalog.map((p) => ({ value: p.product_id, label: `${p.product_name} · ${p.category}` })),
    [catalog],
  );

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function onSelectProduct(key: string, productId: string) {
    const p = productById.get(productId);
    // Préremplit le prix HT depuis le catalogue (modifiable).
    updateLine(key, {
      productId,
      unitPriceHt: p?.unit_price_ht != null ? String(p.unit_price_ht) : '',
    });
  }

  function addLine() {
    setLines((prev) => [...prev, newLine()]);
  }

  function removeLine(key: string) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }

  function handleScanExtracted(invoice: ExtractedInvoice) {
    if (invoice.supplier) setSupplierName(invoice.supplier);
    if (invoice.delivery_date) setDeliveryDate(invoice.delivery_date);
    if (invoice.invoice_number) setInvoiceRef(invoice.invoice_number);

    // Lignes reconnues d'abord, puis non reconnues (produit à sélectionner).
    const allowed = new Set(catalog.map((p) => p.product_id));
    const scanned: LineDraft[] = invoice.products.map((p) => ({
      key: crypto.randomUUID(),
      // On ne garde le product_id que s'il est dans le périmètre du dépôt.
      productId: p.matched_id && allowed.has(p.matched_id) ? p.matched_id : '',
      qtyReceived: p.qty > 0 ? String(p.qty) : '',
      unitPriceHt: p.price_ht != null ? String(p.price_ht) : '',
      rawName: p.raw_name,
      confidence: p.confidence,
    }));
    scanned.sort((a, b) => (a.productId ? 0 : 1) - (b.productId ? 0 : 1));
    setLines(scanned.length > 0 ? scanned : [newLine()]);
    setShowScanner(false);
    setScannerUsed(true);
  }

  const totalHt = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const qty = Number(l.qtyReceived) || 0;
        const price = Number(l.unitPriceHt) || 0;
        return sum + qty * price;
      }, 0),
    [lines],
  );

  async function handleSubmit() {
    setError(null);
    if (!supplierName.trim()) return setError('Le nom du fournisseur est obligatoire.');
    if (receivedBy.trim().length < 2) return setError('Le nom du réceptionnaire est obligatoire (min. 2 caractères).');

    const payloadLines: DeliveryLineInput[] = [];
    for (const l of lines) {
      const qty = Number(l.qtyReceived);
      if (!l.productId) continue;
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const price = l.unitPriceHt.trim() === '' ? null : Number(l.unitPriceHt);
      payloadLines.push({
        productId: l.productId,
        qtyReceived: qty,
        unitPriceHt: price != null && Number.isFinite(price) ? price : null,
      });
    }
    if (payloadLines.length === 0) return setError('Ajoutez au moins une ligne avec une quantité reçue > 0.');

    // Doublons de produit interdits (une ligne par produit).
    const ids = payloadLines.map((l) => l.productId);
    if (new Set(ids).size !== ids.length) return setError('Un même produit apparaît sur plusieurs lignes.');

    try {
      await recordDelivery({
        depotId,
        supplierName: supplierName.trim(),
        deliveryDate,
        invoiceRef: invoiceRef.trim() || null,
        receivedBy: receivedBy.trim(),
        notes: notes.trim() || null,
        lines: payloadLines,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur lors de l'enregistrement de la livraison.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="flex items-center gap-2 font-display text-lg font-black text-pr-black">
              <Truck className="h-5 w-5 text-pr-olive-dark" /> Enregistrer une livraison
            </h2>
            <p className="mt-0.5 text-xs text-pr-black-soft/60">Dépôt : {depotName}</p>
          </div>
          <button onClick={onClose} aria-label="Fermer" className="text-pr-black-soft/40 hover:text-pr-black">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <Alert variant="error" className="mb-3">
            {error}
          </Alert>
        )}

        {showScanner ? (
          <InvoiceScanner
            catalog={catalog.map((p) => ({
              product_id: p.product_id,
              product_name: p.product_name,
              category: p.category,
              unit: p.unit,
            }))}
            onExtracted={handleScanExtracted}
            onClose={() => setShowScanner(false)}
          />
        ) : (
          <>
        {/* Bouton IA */}
        {!scannerUsed ? (
          <button
            type="button"
            onClick={() => setShowScanner(true)}
            className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 py-3 text-sm font-bold text-stone-900 shadow-sm transition-all hover:from-amber-500 hover:to-amber-600"
          >
            <Sparkles className="h-4 w-4" /> 📄 Lire la facture automatiquement
          </button>
        ) : (
          <div className="mb-4 flex items-center justify-between rounded-xl border border-green-200 bg-green-50 px-4 py-2.5">
            <p className="text-sm font-semibold text-green-700">✅ Formulaire pré-rempli depuis la facture</p>
            <button type="button" onClick={() => setShowScanner(true)} className="text-xs text-green-600 underline">Relire</button>
          </div>
        )}

        {/* En-tête livraison */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="Fournisseur *"
            value={supplierName}
            onChange={(e) => setSupplierName(e.target.value)}
            placeholder="Ex : Maison Castel"
          />
          <Input
            type="date"
            label="Date de livraison *"
            value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
          />
          <Input
            label="Réceptionnaire *"
            value={receivedBy}
            onChange={(e) => setReceivedBy(e.target.value)}
            placeholder="Nom de la personne"
            hint="Traçabilité nominative (RG-001)"
          />
          <Input
            label="N° de facture / BL"
            value={invoiceRef}
            onChange={(e) => setInvoiceRef(e.target.value)}
            placeholder="Optionnel"
          />
        </div>

        {/* Lignes produits */}
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-pr-black">Produits reçus</p>
            <Button variant="secondary" size="sm" onClick={addLine} type="button">
              <Plus className="h-4 w-4" /> Ajouter une ligne
            </Button>
          </div>

          <div className="space-y-2">
            {lines.map((l) => (
              <div
                key={l.key}
                className={`grid grid-cols-1 items-end gap-2 rounded-lg border bg-pr-cream/40 p-2 sm:grid-cols-[1fr_5rem_6rem_auto] ${l.confidence === 'medium' ? 'border-amber-300' : l.rawName && !l.productId ? 'border-red-300' : 'border-pr-stone'}`}
              >
                {l.rawName && (
                  <p className="col-span-full -mb-1 text-[10px] italic text-pr-black-soft/50">Extrait : « {l.rawName} »</p>
                )}
                <Select
                  label="Produit"
                  options={productOptions}
                  placeholder="Sélectionner…"
                  value={l.productId}
                  onChange={(e) => onSelectProduct(l.key, e.target.value)}
                />
                <Input
                  type="number"
                  min="0"
                  label="Qté reçue"
                  value={l.qtyReceived}
                  onChange={(e) => updateLine(l.key, { qtyReceived: e.target.value })}
                />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  label="Prix HT"
                  value={l.unitPriceHt}
                  onChange={(e) => updateLine(l.key, { unitPriceHt: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => removeLine(l.key)}
                  aria-label="Retirer la ligne"
                  className="mb-1 inline-flex h-9 w-9 items-center justify-center rounded-lg text-pr-black-soft/40 hover:bg-pr-rust/10 hover:text-pr-rust disabled:opacity-30"
                  disabled={lines.length <= 1}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div className="mt-3">
          <Textarea
            label="Commentaire"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optionnel — anomalies, casse au déchargement…"
          />
        </div>

        {/* Total + actions */}
        <div className="mt-4 flex items-center justify-between border-t border-pr-stone pt-3">
          <p className="text-sm text-pr-black-soft/70">
            Total estimé : <span className="font-display font-black text-pr-black">{formatEuro(totalHt)}</span>
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} type="button">
              Annuler
            </Button>
            <Button loading={recording} onClick={handleSubmit} type="button">
              <Truck className="h-4 w-4" /> Enregistrer la livraison
            </Button>
          </div>
        </div>
          </>
        )}
      </div>
    </div>
  );
}
