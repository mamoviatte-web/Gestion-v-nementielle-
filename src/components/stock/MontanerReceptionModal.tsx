/**
 * MontanerReceptionModal — réception d'une facture Montaner Pietrini (softs &
 * bières du stade) en 2 volets : softs/bouteilles → register_delivery (dépôt AUC),
 * fûts + CO2 → register_keg_reception (dépôt Stockage Fûts, keg_inventory).
 *
 * Chaque libellé facture est mappé vers un produit par mots-clés (revue humaine
 * obligatoire avant validation) ; consignations, vide-palettes, frais et RUPTURE
 * sont exclus. Le prix « rendu » (PU NET HT + accise) n'écrase le prix maître que
 * si l'option est cochée. Prêt à charger la facture de référence 6080101762.
 * RG-003 : register_* réservés ROLE_STADE (garde base).
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2, X, FileText, Check, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Alert, Button, Input } from '@/components/ui';
import { formatEuro } from '@/lib/calculations';

const AUC = 'a291e38e-4d5d-42de-9277-fa6eec4d2592';
const FUTS = '936472cf-25c7-43d3-bbd4-23a809906d82';

/** Routage produit → dépôt de stockage (product_depot_routing) : source de vérité
 *  pour associer chaque produit à son espace de stockage respectif. */
interface DepotRef { id: string; name: string }
function useDepotRouting() {
  return useQuery({
    queryKey: ['depotRouting'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Map<string, DepotRef>> => {
      const { data } = await supabase.from('product_depot_routing').select('product_id, depot_id, depot_name');
      const m = new Map<string, DepotRef>();
      for (const r of (data ?? []) as { product_id: string; depot_id: string; depot_name: string }[]) {
        m.set(r.product_id, { id: r.depot_id, name: r.depot_name });
      }
      return m;
    },
  });
}

type Volet = 'soft' | 'keg' | 'exclu' | 'unmapped';
interface Mapped { product_id: string | null; label: string; volet: Volet; note?: string; }

/** Règles de mapping Montaner → produit (ordre = priorité ; BUD bouteille traité
 *  séparément dans mapLabel, avant le fût BUD générique). */
interface Rule { any: string[]; product_id: string; label: string; volet: 'soft' | 'keg'; }
const RULES: Rule[] = [
  { any: ['HOEGAARDEN'], product_id: '3b9cba0f-5984-40b2-a009-79ba922d1281', label: 'Fût Hoegaarden Blanche', volet: 'keg' },
  { any: ['LEFFE'], product_id: '1b99d9a0-4294-4cc9-baa8-7b57b13d3f28', label: 'Fût LEFFE', volet: 'keg' },
  { any: ['GOOSE'], product_id: '599baa88-87d2-4a86-a6fd-e212c387b2ad', label: 'Fût Goose Island IPA', volet: 'keg' },
  { any: ['BUD'], product_id: '5459c24f-0993-4538-8a85-7c0bfa174d17', label: 'Fût BUD', volet: 'keg' },
  { any: ['CO2'], product_id: '0583ad72-5c12-4203-a186-0f4310aad9f8', label: 'CO2', volet: 'keg' },
  { any: ['CRISTALINE'], product_id: '271f1cdb-49c6-4bd0-a029-d5f839bfc84a', label: 'Cristaline 50cl', volet: 'soft' },
  { any: ['PEPSI'], product_id: '12b21f99-f7f7-4004-bfcb-7025e145c2d8', label: 'Pepsi 50cl', volet: 'soft' },
  { any: ['ORANGINA'], product_id: '7d193944-c98c-48d6-860b-20bbc5fff904', label: 'Orangina 50cl', volet: 'soft' },
  { any: ['LIPTON', 'ICE TEA'], product_id: 'f9eee516-c6ce-4571-b8d7-a8251a8cb498', label: 'Ice Tea 50cl', volet: 'soft' },
];
const EXCLUDE = ['VIDE-PALETTE', 'VIDE PALETTE', 'CONSIGN', 'SURCOUT', 'FRAIS DE GESTION'];

const norm = (s: string): string =>
  s.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/** Mappe un libellé facture vers un produit + volet. */
function mapLabel(raw: string): Mapped {
  const n = norm(raw);
  if (!n) return { product_id: null, label: '', volet: 'unmapped' };
  if (/\bRUPTURE\b/.test(n)) return { product_id: null, label: 'RUPTURE (non livré)', volet: 'exclu', note: 'RUPTURE' };
  if (EXCLUDE.some((e) => n.includes(e)) || /\bF\s*G\b/.test(n)) return { product_id: null, label: 'Hors stock (consigne/frais)', volet: 'exclu' };
  // BUD : bouteille (33 / VP) vs fût
  if (n.includes('BUD') && (n.includes('33') || n.includes('VP')))
    return { product_id: '792eefa4-2c85-4fdb-8c16-93873c61fbbb', label: 'BUD bouteille 33cl', volet: 'soft' };
  for (const r of RULES) {
    if (r.any.some((k) => n.includes(k))) return { product_id: r.product_id, label: r.label, volet: r.volet };
  }
  return { product_id: null, label: '', volet: 'unmapped' };
}

interface LineDraft { key: string; raw: string; qty: string; price: string; }
const newLine = (): LineDraft => ({ key: crypto.randomUUID(), raw: '', qty: '', price: '' });

/** Facture de référence 6080101762 (section D du guide). */
const REFERENCE: { raw: string; qty: number; price: number }[] = [
  { raw: 'FUT 20L HOEGAARDEN BLANCH 4.8°', qty: 15, price: 83.9 },
  { raw: 'FUT LEFFE BLONDE 30 L 6.6°', qty: 40, price: 132.03 },
  { raw: 'FUT BUD 30 L 5°', qty: 64, price: 99.99 },
  { raw: 'FUT 20 L GOOSE IPA ISLAND 5.9°', qty: 18, price: 100.06 },
  { raw: 'FUT BUD 24X33CL VP 5°', qty: 240, price: 1.363 },
  { raw: 'PET EAU CRISTALINE 24X50CL', qty: 3456, price: 0.187 },
  { raw: 'PEPSI COLA PET 12X50CL', qty: 264, price: 1.098 },
  { raw: 'PET ORANGINA 12X50CL', qty: 240, price: 1.398 },
  { raw: 'LIPTON ICE TEA PECH PET12X50CL', qty: 384, price: 1.246 },
  { raw: 'CO2 5KG L2PI TYPE B', qty: 10, price: 6.775 },
];

const VOLET_META: Record<Volet, { label: string; cls: string }> = {
  soft: { label: 'Soft → AUC', cls: 'bg-blue-100 text-blue-700' },
  keg: { label: 'Fût/CO2 → Fûts', cls: 'bg-amber-100 text-amber-700' },
  exclu: { label: 'Hors stock', cls: 'bg-stone-100 text-stone-400' },
  unmapped: { label: 'À rattacher', cls: 'bg-rose-100 text-rose-700' },
};

export function MontanerReceptionModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [date, setDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [receivedBy, setReceivedBy] = useState(user?.name ?? '');
  const [invoice, setInvoice] = useState('');
  const [notes, setNotes] = useState('');
  const [updatePrices, setUpdatePrices] = useState(false);
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const routing = useDepotRouting();

  // Dépôt de destination d'une ligne mappée : fûts/CO2 → Stockage Fûts ;
  // sinon le dépôt du produit (product_depot_routing), défaut AUC.
  const destDepot = useMemo(() => {
    const routeMap = routing.data ?? new Map<string, DepotRef>();
    return (m: Mapped): DepotRef =>
      m.volet === 'keg'
        ? { id: FUTS, name: 'Stockage Fûts' }
        : (m.product_id ? routeMap.get(m.product_id) : undefined) ?? { id: AUC, name: 'AUC — Réserve générale' };
  }, [routing.data]);

  const mapped = useMemo(() => lines.map((l) => ({ ...l, m: mapLabel(l.raw) })), [lines]);

  const update = (key: string, patch: Partial<LineDraft>) => setLines((p) => p.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: string) => setLines((p) => (p.length > 1 ? p.filter((l) => l.key !== key) : p));
  const add = () => setLines((p) => [...p, newLine()]);

  function loadReference() {
    setInvoice('6080101762');
    setNotes('Commande Match Amical PR/Nice');
    setLines(REFERENCE.map((r) => ({ key: crypto.randomUUID(), raw: r.raw, qty: String(r.qty), price: String(r.price) })));
  }

  const totalHt = mapped.reduce((s, l) => {
    if (l.m.volet !== 'soft' && l.m.volet !== 'keg') return s;
    return s + (Number(l.qty) || 0) * (Number(l.price) || 0);
  }, 0);

  async function validate() {
    setError(null);
    if (receivedBy.trim().length < 2) return setError('Réceptionnaire requis (Prénom NOM).');

    // Fûts / CO2 → register_keg_reception (Stockage Fûts).
    const kegLines = mapped
      .filter((l) => l.m.volet === 'keg' && l.m.product_id && Number(l.qty) > 0)
      .map((l) => ({ product_id: l.m.product_id, qty: Number(l.qty), unit_price_ht: updatePrices && l.price ? Number(l.price) : null }));

    // Autres produits → register_delivery, GROUPÉS par leur dépôt de stockage réel
    // (AUC, Stock EST, …) d'après product_depot_routing.
    const byDepot = new Map<string, { name: string; lines: { product_id: string; qty_received: number; unit_price_ht: number | null }[] }>();
    for (const l of mapped) {
      if (l.m.volet !== 'soft' || !l.m.product_id || Number(l.qty) <= 0) continue;
      const d = destDepot(l.m);
      const g = byDepot.get(d.id) ?? { name: d.name, lines: [] };
      g.lines.push({ product_id: l.m.product_id, qty_received: Number(l.qty), unit_price_ht: updatePrices && l.price ? Number(l.price) : null });
      byDepot.set(d.id, g);
    }

    const nbDelivery = [...byDepot.values()].reduce((s, g) => s + g.lines.length, 0);
    if (nbDelivery === 0 && kegLines.length === 0) return setError('Aucune ligne valide (produit mappé + quantité > 0).');
    if (mapped.some((l) => l.raw.trim() && l.m.volet === 'unmapped')) return setError('Des libellés ne sont pas rattachés à un produit — corrigez-les ou videz-les.');

    setBusy(true);
    let delivRes = 0, kegRes = 0;
    const depotNames = new Set<string>();
    try {
      for (const [depotId, g] of byDepot) {
        const { data, error: e } = await supabase.rpc('register_delivery', {
          p_supplier: 'Montaner Pietrini', p_date: date, p_location: depotId, p_received_by: receivedBy.trim(),
          p_invoice: invoice.trim() || null, p_notes: notes.trim() || null, p_lines: g.lines,
        });
        const r = data as { success?: boolean; error?: string; nb_lignes?: number } | null;
        if (e || !r?.success) throw new Error(r?.error ?? e?.message ?? `Échec livraison ${g.name}`);
        delivRes += r.nb_lignes ?? g.lines.length;
        depotNames.add(g.name);
      }
      if (kegLines.length > 0) {
        const { data, error: e } = await supabase.rpc('register_keg_reception', {
          p_supplier: 'Montaner Pietrini', p_date: date, p_received_by: receivedBy.trim(),
          p_invoice: invoice.trim() || null, p_notes: notes.trim() || null, p_kegs: kegLines,
        });
        const r = data as { success?: boolean; error?: string; nb_produits?: number } | null;
        if (e || !r?.success) throw new Error(r?.error ?? e?.message ?? 'Échec volet fûts');
        kegRes = r.nb_produits ?? kegLines.length;
        depotNames.add('Stockage Fûts');
      }
      showToast(`Facture Montaner réceptionnée — ${delivRes} produit(s) + ${kegRes} fût/CO2 · dépôts : ${[...depotNames].join(', ')}`, 'success');
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la réception.');
    } finally {
      setBusy(false);
    }
  }

  const excluded = mapped.filter((l) => l.raw.trim() && l.m.volet === 'exclu');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-black text-stone-900"><FileText className="h-5 w-5 text-amber-600" /> Réception facture Montaner</h2>
            <p className="mt-0.5 text-xs text-stone-500">Chaque produit est rangé dans son dépôt : Fûts/CO2 → Stockage Fûts · Vins/Spiritueux → Stock EST · autres → AUC · consignations/frais exclus</p>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700"><X className="h-5 w-5" /></button>
        </div>

        {error && <Alert variant="error" className="mb-3">{error}</Alert>}

        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Input type="date" label="Date *" value={date} onChange={(e) => setDate(e.target.value)} />
          <Input label="Réceptionnaire *" placeholder="Prénom NOM" value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} />
          <Input label="N° facture" value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="6080101762" />
          <Input label="Commentaire" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={loadReference}><FileText className="h-3.5 w-3.5" /> Charger la facture 6080101762</Button>
            <Button size="sm" variant="secondary" onClick={add}><Plus className="h-3.5 w-3.5" /> Ligne</Button>
          </div>
          <label className="flex items-center gap-2 text-xs text-stone-600">
            <input type="checkbox" checked={updatePrices} onChange={(e) => setUpdatePrices(e.target.checked)} />
            Mettre à jour les prix maîtres (dernier prix d'achat)
          </label>
        </div>

        {/* Lignes + mapping */}
        <div className="overflow-x-auto rounded-xl border border-stone-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100 bg-stone-50 text-left text-[11px] uppercase tracking-wide text-stone-400">
                <th className="px-2 py-1.5">Libellé facture</th>
                <th className="px-2 py-1.5">Produit mappé</th>
                <th className="px-2 py-1.5 w-20 text-right">Qté</th>
                <th className="px-2 py-1.5 w-24 text-right">PU HT</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-50">
              {mapped.map((l) => (
                <tr key={l.key} className={l.m.volet === 'unmapped' && l.raw.trim() ? 'bg-rose-50/50' : ''}>
                  <td className="px-2 py-1.5"><input value={l.raw} onChange={(e) => update(l.key, { raw: e.target.value })} placeholder="ex. FUT BUD 30 L 5°" className="w-full rounded border border-stone-200 px-2 py-1 text-xs" /></td>
                  <td className="px-2 py-1.5">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${VOLET_META[l.m.volet].cls}`}>
                      {l.m.volet === 'soft' || l.m.volet === 'keg' ? `→ ${destDepot(l.m).name}` : VOLET_META[l.m.volet].label}
                    </span>
                    <span className="ml-1 text-xs text-stone-600">{l.m.label}</span>
                  </td>
                  <td className="px-2 py-1.5"><input type="number" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} className="w-full rounded border border-stone-200 px-2 py-1 text-right text-xs" /></td>
                  <td className="px-2 py-1.5"><input type="number" step="0.001" value={l.price} onChange={(e) => update(l.key, { price: e.target.value })} className="w-full rounded border border-stone-200 px-2 py-1 text-right text-xs" /></td>
                  <td className="px-2 py-1.5"><button onClick={() => remove(l.key)} className="text-stone-300 hover:text-rose-500"><Trash2 className="h-3.5 w-3.5" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {excluded.length > 0 && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-stone-400">
            <AlertTriangle className="h-3.5 w-3.5 text-stone-300" /> {excluded.length} ligne(s) exclue(s) du stock (consignation / frais / RUPTURE).
          </p>
        )}

        <div className="mt-4 flex items-center justify-between border-t border-stone-100 pt-3">
          <p className="text-sm text-stone-600">Total stock estimé HT : <b className="text-stone-900">{formatEuro(totalHt)}</b></p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Annuler</Button>
            <Button loading={busy} onClick={() => void validate()}><Check className="h-4 w-4" /> Valider la réception</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
