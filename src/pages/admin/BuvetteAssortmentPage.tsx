/**
 * BuvetteAssortmentPage — coordination durable de l'assortiment des buvettes
 * (socle CDC, niveau « S »). La composition d'une buvette se pilote ICI, pas par
 * l'historique : on ajoute / retire des produits dans area_product_reference
 * (association_level='S'), et la régénération des fiches runner applique le socle.
 *
 * Principe (BLOC 3) : Buvettes = assortiment standardisé → socle strict (pas de
 * dérive d'un match à l'autre). Le complément historique est réservé aux VIP/Bars.
 * RG-003 : écriture réservée ROLE_STADE (RLS is_stade sur area_product_reference).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Beer, Plus, Trash2, Info } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import { Button, Spinner, Select } from '@/components/ui';

interface BuvetteSpace { space_id: string; space_name: string }
interface Product { product_id: string; product_name: string; category: string }
interface SocleRow { id: string; area_name: string; product_id: string; product_name: string; category: string }

// category (products) → product_family (convention area_product_reference).
const FAMILY_BY_CATEGORY: Record<string, string> = {
  Vins: 'Vins',
  Bières: 'Bière / Fûts',
  Soft: 'Softs / Eau / Sirops',
  Sirops: 'Softs / Eau / Sirops',
  Spiritueux: 'Spiritueux / Apéritifs',
  Matériel: 'Autres',
};
const CATEGORY_ORDER = ['Bières', 'Soft', 'Sirops', 'Spiritueux', 'Vins', 'Matériel'];
const catRank = (c: string) => { const i = CATEGORY_ORDER.indexOf(c); return i === -1 ? CATEGORY_ORDER.length : i; };

export default function BuvetteAssortmentPage() {
  const { showToast } = useToast();
  const [buvettes, setBuvettes] = useState<BuvetteSpace[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [socle, setSocle] = useState<SocleRow[]>([]);
  const [selected, setSelected] = useState<string>(''); // space_name (ex. 'B8')
  const [toAdd, setToAdd] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [sp, pr, apr] = await Promise.all([
      supabase.from('spaces').select('space_id, space_name').eq('active', true).eq('space_type', 'Buvette'),
      supabase.from('products').select('product_id, product_name, category').eq('active', true).neq('category', 'Matériel').order('product_name'),
      supabase.from('area_product_reference').select('id, area_name, product_id, product_name').eq('association_level', 'S').not('product_id', 'is', null),
    ]);
    const bv = ((sp.data as BuvetteSpace[] | null) ?? [])
      .filter((s) => /^B[0-9]+$/.test(s.space_name))
      .sort((a, b) => a.space_name.localeCompare(b.space_name, undefined, { numeric: true }));
    const prod = (pr.data as Product[] | null) ?? [];
    const catById = new Map(prod.map((p) => [p.product_id, p.category]));
    const bvNames = new Set(bv.map((b) => b.space_name.toUpperCase()));
    const rows = ((apr.data as Omit<SocleRow, 'category'>[] | null) ?? [])
      .filter((r) => bvNames.has((r.area_name ?? '').trim().toUpperCase()))
      .map((r) => ({ ...r, category: catById.get(r.product_id) ?? 'Autres' }));
    setBuvettes(bv);
    setProducts(prod);
    setSocle(rows);
    setSelected((cur) => cur || bv[0]?.space_name || '');
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const socleOfSelected = useMemo(
    () => socle
      .filter((r) => r.area_name.trim().toUpperCase() === selected.toUpperCase())
      .sort((a, b) => catRank(a.category) - catRank(b.category) || a.product_name.localeCompare(b.product_name)),
    [socle, selected],
  );
  const presentIds = useMemo(() => new Set(socleOfSelected.map((r) => r.product_id)), [socleOfSelected]);
  const available = useMemo(() => products.filter((p) => !presentIds.has(p.product_id)), [products, presentIds]);
  const countByArea = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of socle) { const k = r.area_name.trim().toUpperCase(); m.set(k, (m.get(k) ?? 0) + 1); }
    return m;
  }, [socle]);

  async function addProduct() {
    const p = products.find((x) => x.product_id === toAdd);
    if (!p || !selected) return;
    setBusy(true);
    const { error } = await supabase.from('area_product_reference').upsert(
      {
        area_name: selected,
        area_group: 'Buvettes',
        product_id: p.product_id,
        product_name: p.product_name,
        product_family: FAMILY_BY_CATEGORY[p.category] ?? 'Autres',
        association_level: 'S',
        // is_default est une colonne GÉNÉRÉE (ne pas insérer).
        cdc_version: 'custom',
      },
      { onConflict: 'area_name,product_name', ignoreDuplicates: true },
    );
    setBusy(false);
    if (error) return showToast(`Échec : ${error.message}`, 'warning');
    setToAdd('');
    await load();
    showToast(`${p.product_name} ajouté au socle de ${selected} — régénérez les fiches runner pour l'appliquer.`, 'success');
  }

  async function removeProduct(row: SocleRow) {
    if (!window.confirm(`Retirer « ${row.product_name} » du socle de ${row.area_name} ?`)) return;
    setBusy(true);
    const { error } = await supabase
      .from('area_product_reference')
      .delete()
      .eq('area_name', row.area_name)
      .eq('association_level', 'S')
      .eq('product_id', row.product_id);
    setBusy(false);
    if (error) return showToast(`Échec : ${error.message}`, 'warning');
    await load();
    showToast(`${row.product_name} retiré du socle de ${row.area_name} — régénérez les fiches runner.`, 'success');
  }

  if (loading) return <div className="p-6"><Spinner label="Chargement de l'assortiment…" /></div>;

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-4">
        <h1 className="flex items-center gap-2 text-xl font-black text-stone-900"><Beer className="text-amber-600" /> Assortiment des buvettes</h1>
        <p className="mt-1 text-sm text-stone-500">
          Socle coordonné (niveau S) de chaque buvette. Ajoutez ou retirez des produits ici — c'est le référentiel,
          pas l'historique, qui pilote l'assortiment. Régénérez ensuite les fiches runner de l'événement pour appliquer.
        </p>
      </div>

      <div className="mb-4 flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
        <Info size={16} className="mt-0.5 shrink-0" />
        <span>Buvettes = assortiment standardisé (socle strict). Le complément historique (vin, produits premium) est réservé aux espaces VIP/Bars et n'est jamais injecté ici.</span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[220px_1fr]">
        {/* Colonne buvettes */}
        <div className="space-y-1.5">
          {buvettes.map((b) => {
            const on = b.space_name.toUpperCase() === selected.toUpperCase();
            return (
              <button
                key={b.space_id}
                onClick={() => setSelected(b.space_name)}
                className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition-colors ${on ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-200 bg-white text-stone-700 hover:border-stone-400'}`}
              >
                <span className="font-bold">{b.space_name}</span>
                <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${on ? 'bg-white/20 text-white' : 'bg-stone-100 text-stone-500'}`}>
                  {countByArea.get(b.space_name.toUpperCase()) ?? 0} produits
                </span>
              </button>
            );
          })}
        </div>

        {/* Détail assortiment */}
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-bold text-stone-800">Socle de {selected || '—'}</p>
              <p className="text-xs text-stone-400">{socleOfSelected.length} produit{socleOfSelected.length > 1 ? 's' : ''}</p>
            </div>
            <div className="flex items-end gap-2">
              <div className="min-w-[220px]">
                <Select
                  label="Ajouter un produit"
                  value={toAdd}
                  onChange={(e) => setToAdd(e.target.value)}
                  options={[{ value: '', label: '— Choisir un produit —' }, ...available.map((p) => ({ value: p.product_id, label: `${p.product_name} · ${p.category}` }))]}
                />
              </div>
              <Button size="sm" disabled={!toAdd || busy} onClick={() => void addProduct()}><Plus size={14} /> Ajouter</Button>
            </div>
          </div>

          {socleOfSelected.length === 0 ? (
            <p className="rounded-xl bg-stone-50 px-4 py-6 text-center text-sm text-stone-400">Aucun produit au socle de cette buvette.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-stone-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-100 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-400">
                    <th className="px-3 py-2">Produit</th>
                    <th className="px-3 py-2">Catégorie</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-50">
                  {socleOfSelected.map((r) => (
                    <tr key={r.id} className="text-stone-800">
                      <td className="px-3 py-2 font-medium">{r.product_name}</td>
                      <td className="px-3 py-2 text-stone-500">{r.category}</td>
                      <td className="px-3 py-2 text-right">
                        <button disabled={busy} onClick={() => void removeProduct(r)} title="Retirer du socle" className="rounded-lg p-1.5 text-stone-400 hover:bg-rose-50 hover:text-rose-600">
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
