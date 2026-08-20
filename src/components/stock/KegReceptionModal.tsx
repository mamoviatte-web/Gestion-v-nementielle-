/**
 * KegReceptionModal — saisie MANUELLE d'une livraison de fûts (tous fournisseurs).
 *
 * Fournisseur · date · reçu par · n° facture · notes + lignes (fût/CO2, qté, prix,
 * lot). Appelle register_keg_reception → incrémente les fûts pleins (dépôt Stockage
 * Fûts). Options : joindre le PDF de facture (bucket privé `invoices`) avec montants
 * HT/TTC (attach_delivery_invoice), et « Lire la facture » (InvoiceScanner) pour
 * pré-remplir. Garde anti-doublon sur le n° de facture (invoice_ref_exists).
 * RG-003 : register_* / attach_* réservés ROLE_STADE (garde base).
 */

import { useMemo, useState } from 'react';
import { Plus, Trash2, X, FileText, Sparkles, AlertTriangle, Paperclip } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useCatalog } from '@/hooks/useCatalog';
import { Alert, Button, Input } from '@/components/ui';
import { InvoiceScanner, type CatalogItem, type ExtractedInvoice } from '@/components/stock/InvoiceScanner';

interface Line {
  product_id: string;
  qty: string;
  unit_price_ht: string;
  lot: string;
}
const emptyLine = (): Line => ({ product_id: '', qty: '', unit_price_ht: '', lot: '' });

const isKeg = (name: string): boolean => /fût|fut|co2/i.test(name);

export function KegReceptionModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { products } = useCatalog();

  const [supplier, setSupplier] = useState('');
  const [deliveryDate, setDeliveryDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [receivedBy, setReceivedBy] = useState(user?.name ?? '');
  const [invoiceRef, setInvoiceRef] = useState('');
  const [notes, setNotes] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [amountHt, setAmountHt] = useState('');
  const [amountTtc, setAmountTtc] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [dupWarn, setDupWarn] = useState(false);
  const [scanner, setScanner] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Produits « fûts / CO2 » pour le sélecteur et le catalogue du scanner.
  const kegProducts = useMemo(
    () => (products.data ?? []).filter((p) => p.active && isKeg(p.product_name)),
    [products.data],
  );
  const scannerCatalog = useMemo<CatalogItem[]>(
    () => kegProducts.map((p) => ({ product_id: p.product_id, product_name: p.product_name, category: p.category, unit: p.unit })),
    [kegProducts],
  );

  const validLines = lines.filter((l) => l.product_id && Number(l.qty) > 0);
  const totalCalc = validLines.reduce((s, l) => s + Number(l.qty) * (Number(l.unit_price_ht) || 0), 0);

  function updateLine(i: number, field: keyof Line, value: string) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));
  }

  async function checkDuplicate(ref: string) {
    if (!ref.trim()) { setDupWarn(false); return; }
    const { data } = await supabase.rpc('invoice_ref_exists', { p_ref: ref.trim() });
    setDupWarn(!!data);
  }

  function applyExtraction(inv: ExtractedInvoice) {
    if (inv.supplier) setSupplier(inv.supplier);
    if (inv.delivery_date) setDeliveryDate(inv.delivery_date);
    if (inv.invoice_number) { setInvoiceRef(inv.invoice_number); void checkDuplicate(inv.invoice_number); }
    if (inv.total_ht != null) setAmountHt(String(inv.total_ht));
    // Ne garder que les lignes reconnues comme fûts/CO2.
    const kegLines = inv.products
      .filter((p) => p.matched_id && kegProducts.some((k) => k.product_id === p.matched_id))
      .map((p) => ({ product_id: p.matched_id as string, qty: String(p.qty), unit_price_ht: p.price_ht != null ? String(p.price_ht) : '', lot: '' }));
    if (kegLines.length > 0) setLines(kegLines);
    setScanner(false);
    showToast(`Facture lue — ${kegLines.length} fût(s) pré-rempli(s), à vérifier.`, 'success');
  }

  async function handleSave() {
    setError(null);
    if (!supplier.trim() || !deliveryDate || receivedBy.trim().length < 2) {
      setError('Fournisseur, date et réceptionnaire (min. 2 car.) requis.');
      return;
    }
    if (validLines.length === 0) {
      setError('Au moins un fût/CO2 avec une quantité > 0.');
      return;
    }
    setSaving(true);

    // 1) Réception fûts → incrémente les fûts pleins
    const { data: recData, error: recErr } = await supabase.rpc('register_keg_reception', {
      p_supplier: supplier.trim(),
      p_date: deliveryDate,
      p_received_by: receivedBy.trim(),
      p_invoice: invoiceRef.trim() || null,
      p_notes: notes.trim() || null,
      p_kegs: validLines.map((l) => ({
        product_id: l.product_id,
        qty: Number(l.qty),
        unit_price_ht: l.unit_price_ht ? Number(l.unit_price_ht) : null,
        lot: l.lot.trim() || null,
      })),
    });
    const rec = recData as { success?: boolean; error?: string; delivery_id?: string } | null;
    if (recErr || !rec?.success || !rec.delivery_id) {
      setSaving(false);
      setError(rec?.error ?? recErr?.message ?? 'Échec de la réception.');
      return;
    }
    const deliveryId = rec.delivery_id;

    // 2) PDF de facture (bucket privé) + métadonnées (montants, dates)
    let pdfPath: string | null = null;
    if (pdfFile) {
      const safe = pdfFile.name.replace(/[^\w.-]+/g, '_');
      const path = `${deliveryId}/${safe}`;
      const { error: upErr } = await supabase.storage.from('invoices').upload(path, pdfFile, { upsert: true });
      if (upErr) {
        setSaving(false);
        setError(`Réception enregistrée, mais l'upload du PDF a échoué : ${upErr.message}`);
        onDone();
        return;
      }
      pdfPath = path;
    }
    if (pdfPath || invoiceDate || amountHt || amountTtc || invoiceRef.trim()) {
      await supabase.rpc('attach_delivery_invoice', {
        p_delivery_id: deliveryId,
        p_pdf_url: pdfPath,
        p_invoice_ref: invoiceRef.trim() || null,
        p_invoice_date: invoiceDate || null,
        p_amount_ht: amountHt ? Number(amountHt) : null,
        p_amount_ttc: amountTtc ? Number(amountTtc) : null,
      });
    }

    setSaving(false);
    showToast(`Réception enregistrée — ${rec.delivery_id ? '' : ''}${validLines.reduce((s, l) => s + Number(l.qty), 0)} fût(s) ajouté(s).`, 'success');
    onDone();
  }

  if (scanner) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-pr-black/50 p-4" role="dialog" aria-modal="true">
        <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-pr-white p-5 shadow-xl">
          <InvoiceScanner catalog={scannerCatalog} onExtracted={applyExtraction} onClose={() => setScanner(false)} />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-pr-black/50 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-pr-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-display text-lg text-pr-black">
            <FileText className="h-5 w-5 text-pr-olive" /> Réceptionner des fûts
          </h3>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setScanner(true)}>
              <Sparkles className="mr-1 h-4 w-4" /> Lire la facture
            </Button>
            <button onClick={onClose} aria-label="Fermer" className="text-pr-black-soft/40 hover:text-pr-black">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* En-tête livraison */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Input label="Fournisseur *" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Ex : Montaner" />
          <Input label="Date de livraison *" type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
          <Input label="Reçu par *" value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder="Nom" />
          <Input
            label="N° de facture"
            value={invoiceRef}
            onChange={(e) => { setInvoiceRef(e.target.value); setDupWarn(false); }}
            onBlur={(e) => void checkDuplicate(e.target.value)}
            placeholder="Ex : 6080101762"
          />
          <Input label="Date facture" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          <Input label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optionnel" />
        </div>

        {dupWarn && (
          <Alert variant="warning" className="mt-3">
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4" /> Une livraison porte déjà ce n° de facture — vérifiez avant d’enregistrer (risque de doublon).
            </span>
          </Alert>
        )}

        {/* Lignes fûts */}
        <div className="mt-4 space-y-2">
          <p className="text-sm font-semibold text-pr-black-soft">Fûts & CO2 reçus</p>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 items-end gap-2">
              <div className="col-span-5">
                <label className="mb-1 block text-xs font-medium text-slate-600">Produit</label>
                <select
                  className="block w-full rounded-lg border-0 px-2 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-provence"
                  value={l.product_id}
                  onChange={(e) => updateLine(i, 'product_id', e.target.value)}
                >
                  <option value="">— Fût / CO2 —</option>
                  {kegProducts.map((p) => (
                    <option key={p.product_id} value={p.product_id}>{p.product_name}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <Input label="Qté" type="number" min={1} value={l.qty} onChange={(e) => updateLine(i, 'qty', e.target.value)} />
              </div>
              <div className="col-span-2">
                <Input label="Prix HT" type="number" min={0} step="0.01" value={l.unit_price_ht} onChange={(e) => updateLine(i, 'unit_price_ht', e.target.value)} />
              </div>
              <div className="col-span-2">
                <Input label="Lot" value={l.lot} onChange={(e) => updateLine(i, 'lot', e.target.value)} />
              </div>
              <div className="col-span-1 flex justify-end pb-1">
                {lines.length > 1 && (
                  <button onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))} className="text-pr-black-soft/30 hover:text-pr-rust" aria-label="Supprimer">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
            <Plus className="h-4 w-4" /> Ajouter un fût
          </Button>
        </div>

        {/* Facture : PDF + montants */}
        <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-pr-cream/40 p-3 sm:grid-cols-3">
          <div className="col-span-2 sm:col-span-1">
            <label className="mb-1 block text-xs font-medium text-slate-600">PDF de la facture</label>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 hover:ring-provence">
              <Paperclip className="h-4 w-4 text-pr-olive" />
              <span className="truncate">{pdfFile ? pdfFile.name : 'Joindre un PDF…'}</span>
              <input type="file" accept="application/pdf" className="hidden" onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          <Input label="Montant HT (€)" type="number" min={0} step="0.01" value={amountHt} onChange={(e) => setAmountHt(e.target.value)} />
          <Input label="Montant TTC (€)" type="number" min={0} step="0.01" value={amountTtc} onChange={(e) => setAmountTtc(e.target.value)} />
        </div>

        {error && <Alert variant="error" className="mt-3">{error}</Alert>}

        <div className="mt-5 flex items-center justify-between border-t border-pr-stone/60 pt-4">
          <span className="text-sm text-pr-black-soft">
            {validLines.reduce((s, l) => s + Number(l.qty), 0)} fût(s) · total calculé {totalCalc.toFixed(2)} € HT
            {amountHt && Math.abs(Number(amountHt) - totalCalc) > 0.01 && (
              <span className="ml-2 font-semibold text-pr-rust">· écart facture {(Number(amountHt) - totalCalc).toFixed(2)} €</span>
            )}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>Annuler</Button>
            <Button loading={saving} disabled={validLines.length === 0} onClick={() => void handleSave()}>
              Enregistrer la réception
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
