/**
 * InvoiceScanner — lecture automatique d'une facture / BL par IA.
 * Upload image/PDF → fonction edge `read-invoice` (Claude, clé côté serveur)
 * → extraction → correspondance catalogue → revue → pré-remplissage.
 * ⚠ Aucun appel direct à l'API Anthropic depuis le navigateur (clé jamais
 *   exposée dans le bundle).
 */

import { useCallback, useRef, useState } from 'react';
import { Upload, Loader, CheckCircle, AlertTriangle, X, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export interface CatalogItem {
  product_id: string;
  product_name: string;
  category: string;
  unit: string;
}
export interface ExtractedProduct {
  raw_name: string;
  matched_id: string | null;
  matched_name: string | null;
  qty: number;
  unit: string;
  price_ht: number | null;
  confidence: 'high' | 'medium' | 'low';
}
export interface ExtractedInvoice {
  supplier: string;
  delivery_date: string;
  invoice_number: string | null;
  products: ExtractedProduct[];
  total_ht: number | null;
}

interface RawInvoice {
  supplier?: string;
  delivery_date?: string;
  invoice_number?: string | null;
  total_ht?: number | string | null;
  products?: { raw_name?: string; qty?: number | string; unit?: string; price_ht?: number | string | null }[];
}

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
const CONF_STYLE: Record<ExtractedProduct['confidence'], string> = {
  high: 'bg-green-100 text-green-700 border-green-200',
  medium: 'bg-amber-100 text-amber-700 border-amber-200',
  low: 'bg-red-100 text-red-700 border-red-200',
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}
function num(v: unknown): number | null {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : null;
}

export function InvoiceScanner({
  catalog,
  onExtracted,
  onClose,
}: {
  catalog: CatalogItem[];
  onExtracted: (invoice: ExtractedInvoice) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<'upload' | 'reading' | 'review' | 'error'>('upload');
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [extracted, setExtracted] = useState<ExtractedInvoice | null>(null);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const matchProduct = useCallback(
    (rawName: string): { id: string | null; name: string | null; conf: ExtractedProduct['confidence'] } => {
      const rawWords = norm(rawName).split(' ').filter((w) => w.length > 2);
      let bestScore = 0;
      let best: CatalogItem | null = null;
      for (const p of catalog) {
        const catWords = norm(p.product_name).split(' ').filter((w) => w.length > 2);
        const common = rawWords.filter((w) => catWords.some((cw) => cw.includes(w) || w.includes(cw)));
        const score = rawWords.length > 0 ? common.length / rawWords.length : 0;
        if (score > bestScore) { bestScore = score; best = p; }
      }
      if (!best || bestScore < 0.3) return { id: null, name: null, conf: 'low' };
      return { id: best.product_id, name: best.product_name, conf: bestScore >= 0.8 ? 'high' : bestScore >= 0.5 ? 'medium' : 'low' };
    },
    [catalog],
  );

  const handleFile = useCallback(
    async (file: File) => {
      if (file.size > 15 * 1024 * 1024) { setError('Fichier trop lourd (max 15 Mo).'); setStep('error'); return; }
      if (!ACCEPTED.includes(file.type)) { setError('Format non supporté. Utilisez JPG, PNG, WEBP, GIF ou PDF.'); setStep('error'); return; }

      setFileName(file.name);
      setStep('reading');

      const base64 = await new Promise<string>((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res((reader.result as string).split(',')[1]);
        reader.onerror = () => rej(new Error('Lecture du fichier impossible'));
        reader.readAsDataURL(file);
      });
      if (file.type !== 'application/pdf') setPreview(`data:${file.type};base64,${base64}`);

      const { data, error: fnError } = await supabase.functions.invoke('read-invoice', {
        body: { media_type: file.type, data: base64, today: new Date().toISOString().slice(0, 10) },
      });
      const res = data as { success?: boolean; error?: string; invoice?: RawInvoice } | null;
      if (fnError || !res?.success || !res.invoice) {
        // Fonction edge injoignable / non déployée → message clair + repli manuel.
        const unreachable = /Failed to send a request|Edge Function|non-2xx|FunctionsFetchError|not found/i.test(
          fnError?.message ?? '',
        );
        setError(
          res?.error ??
            (unreachable
              ? "Lecture automatique indisponible (service de lecture de facture non activé). Saisissez la livraison manuellement — c'est immédiat."
              : fnError?.message ?? 'Lecture du document impossible.'),
        );
        setStep('error');
        return;
      }

      const raw = res.invoice;
      const products: ExtractedProduct[] = (raw.products ?? []).map((p) => {
        const m = matchProduct(p.raw_name ?? '');
        return {
          raw_name: p.raw_name ?? '',
          matched_id: m.id,
          matched_name: m.name,
          qty: num(p.qty) ?? 0,
          unit: p.unit ?? 'u',
          price_ht: num(p.price_ht),
          confidence: m.conf,
        };
      });
      setExtracted({
        supplier: raw.supplier ?? '',
        delivery_date: raw.delivery_date ?? new Date().toISOString().slice(0, 10),
        invoice_number: raw.invoice_number ?? null,
        products,
        total_ht: num(raw.total_ht),
      });
      setStep('review');
    },
    [matchProduct],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  if (step === 'upload')
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-amber-500" />
          <p className="text-sm font-semibold text-stone-800">Lecture automatique par IA</p>
        </div>
        <p className="text-xs text-stone-500">
          Déposez une photo ou un scan de la facture / bon de livraison. Claude lit le document et
          pré-remplit le formulaire — vous vérifiez et validez.
        </p>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-all ${dragOver ? 'border-amber-400 bg-amber-50' : 'border-stone-200 hover:border-amber-300 hover:bg-stone-50'}`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
            onChange={(e) => e.target.files?.[0] && void handleFile(e.target.files[0])}
            className="hidden"
          />
          <Upload size={32} className="mx-auto mb-3 text-stone-300" />
          <p className="text-sm font-semibold text-stone-700">Déposez ici ou cliquez pour choisir</p>
          <p className="mt-1 text-xs text-stone-400">JPG · PNG · WEBP · GIF · PDF · Max 15 Mo</p>
          <div className="mt-4 flex justify-center gap-3">
            {['📄 Facture', '📦 Bon de livraison', '📱 Photo'].map((l) => (
              <span key={l} className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-xs text-stone-500">{l}</span>
            ))}
          </div>
        </div>
        <button onClick={onClose} className="w-full py-2.5 text-sm text-stone-500 hover:text-stone-700">
          Saisir manuellement à la place
        </button>
      </div>
    );

  if (step === 'reading')
    return (
      <div className="space-y-5 py-8 text-center">
        {preview && <img src={preview} alt="Aperçu" className="mx-auto max-h-36 rounded-xl border border-stone-200 object-contain shadow-sm" />}
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50">
              <Sparkles size={24} className="animate-pulse text-amber-500" />
            </div>
            <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-stone-900">
              <Loader size={10} className="animate-spin text-white" />
            </div>
          </div>
          <div>
            <p className="font-bold text-stone-900">Claude analyse le document…</p>
            <p className="mt-1 text-xs text-stone-400">{fileName}</p>
          </div>
        </div>
        <div className="space-y-1 text-xs text-stone-400">
          <p>✓ Identification du fournisseur</p>
          <p>✓ Extraction des produits et quantités</p>
          <p>✓ Correspondance avec le catalogue</p>
        </div>
      </div>
    );

  if (step === 'review' && extracted) {
    const nbLow = extracted.products.filter((p) => p.confidence === 'low').length;
    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle size={16} className="text-green-600" />
            <p className="text-sm font-bold text-stone-800">Document lu avec succès</p>
          </div>
          {preview && <img src={preview} alt="" className="h-12 w-12 rounded-lg border border-stone-200 object-cover" />}
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-xl bg-stone-50 p-3 text-xs">
          <div><p className="text-stone-400">Fournisseur</p><p className="font-bold text-stone-800">{extracted.supplier || '—'}</p></div>
          <div><p className="text-stone-400">Date</p><p className="font-bold text-stone-800">{extracted.delivery_date ? new Date(extracted.delivery_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}</p></div>
          {extracted.invoice_number && <div className="col-span-2"><p className="text-stone-400">N° facture / BL</p><p className="font-bold text-stone-800">{extracted.invoice_number}</p></div>}
        </div>

        {nbLow > 0 && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
            <AlertTriangle size={14} className="shrink-0 text-amber-600" />
            <p className="text-xs text-amber-700">{nbLow} produit{nbLow > 1 ? 's' : ''} non reconnu{nbLow > 1 ? 's' : ''} dans le catalogue — à associer manuellement.</p>
          </div>
        )}

        <div className="max-h-[260px] space-y-2 overflow-y-auto pr-1">
          {extracted.products.map((p, i) => (
            <div key={i} className={`rounded-xl border p-3 ${p.confidence === 'high' ? 'border-green-200 bg-green-50' : p.confidence === 'medium' ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs italic text-stone-400">"{p.raw_name}"</p>
                  {p.matched_name ? (
                    <p className="truncate text-sm font-semibold text-stone-800">→ {p.matched_name}</p>
                  ) : (
                    <p className="text-sm font-semibold text-red-600">❌ Non reconnu dans le catalogue</p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-black text-stone-900">{p.qty} <span className="text-xs font-normal text-stone-400">{p.unit}</span></p>
                  {p.price_ht !== null && <p className="text-xs text-stone-500">{p.price_ht.toFixed(2)} € HT/u</p>}
                </div>
              </div>
              <div className="mt-1.5">
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${CONF_STYLE[p.confidence]}`}>
                  {p.confidence === 'high' ? '✅ Reconnu avec certitude' : p.confidence === 'medium' ? '⚠️ Correspondance probable' : '❌ Non reconnu'}
                </span>
              </div>
            </div>
          ))}
        </div>

        {extracted.total_ht !== null && (
          <div className="flex items-center justify-between rounded-xl bg-stone-50 px-4 py-2.5 text-sm">
            <span className="text-stone-500">Total extrait de la facture</span>
            <span className="font-black text-stone-900">{extracted.total_ht.toFixed(2)} € HT</span>
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={() => { setStep('upload'); setExtracted(null); setPreview(null); }} className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 px-3 py-2.5 text-sm text-stone-600 hover:bg-stone-50">
            <X size={14} /> Recommencer
          </button>
          <button onClick={() => onExtracted(extracted)} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-stone-900 py-2.5 text-sm font-bold text-white transition-colors hover:bg-stone-700">
            <CheckCircle size={15} /> Utiliser ces données →
          </button>
        </div>
        <p className="text-center text-[10px] text-stone-400">Vous pourrez corriger chaque ligne dans le formulaire avant de valider.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 py-6 text-center">
      <AlertTriangle size={32} className="mx-auto text-red-400" />
      <p className="font-bold text-stone-900">Lecture impossible</p>
      <p className="mx-auto max-w-xs text-xs text-stone-500">{error}</p>
      <div className="flex justify-center gap-3">
        <button onClick={() => { setStep('upload'); setError(''); }} className="rounded-xl border border-stone-200 px-4 py-2 text-sm text-stone-600 hover:bg-stone-50">Réessayer</button>
        <button onClick={onClose} className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white">Saisir manuellement</button>
      </div>
    </div>
  );
}
