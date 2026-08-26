/**
 * EspaceAssortmentPage — assortiment (socle niveau « S ») de CHAQUE espace, pas
 * seulement les buvettes. On ajoute / retire des produits dans
 * area_product_reference (association_level='S') : c'est le référentiel — pas
 * l'historique — qui pilote l'assortiment. La régénération des fiches runner de
 * l'événement applique le socle (liaison assortiment → fiche runner → stock).
 *
 * Cas d'usage : une prestation différente dans un espace → on ajuste ici les
 * produits voulus, puis on régénère les dotations du match.
 *
 * Notes :
 *  - Les Loges (Est / Ouest Nord / Ouest Sud) sont pilotées par leur dotation
 *    par loge dédiée (loge_dotations) : elles ne sont pas éditables ici.
 *  - En VIP/Bars, le format 50cl est réservé aux buvettes/Bodega (garde runner) :
 *    on ne le propose donc pas à l'ajout pour ces espaces.
 * RG-003 : écriture réservée ROLE_STADE (RLS is_stade sur area_product_reference).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Boxes, Plus, Trash2, Info } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import { Button, Spinner, Select } from '@/components/ui';

type ServiceType = 'vip' | 'bar' | 'buvette' | 'bodega';
interface Space { space_id: string; space_name: string; service_type: ServiceType | null }
interface Product { product_id: string; product_name: string; category: string }
interface SocleRow { id: string; area_name: string; product_id: string; product_name: string; category: string }

// Loges : dotation dédiée (loge_dotations), non éditable ici.
const LOGE_IDS = new Set([
  'a96044d1-9ab0-45d0-85eb-73672df6ab82',
  '673b6e4e-0f5a-406f-9029-c35b25a38103',
  '8be2956e-a379-4e8e-a3eb-65401bac3c56',
]);

const FAMILY_BY_CATEGORY: Record<string, string> = {
  Vins: 'Vins', Bières: 'Bière / Fûts', Soft: 'Softs / Eau / Sirops',
  Sirops: 'Softs / Eau / Sirops', Spiritueux: 'Spiritueux / Apéritifs', Matériel: 'Autres',
};
const GROUP_BY_SERVICE: Record<string, string> = { buvette: 'Buvettes', bodega: 'Bodega', vip: 'VIP', bar: 'VIP' };
const TYPE_LABEL: Record<string, string> = { vip: 'VIP / Salons', bar: 'Bars', buvette: 'Buvettes', bodega: 'Bodega' };
const TYPE_ORDER: ServiceType[] = ['vip', 'bar', 'bodega', 'buvette'];
const CATEGORY_ORDER = ['Bières', 'Soft', 'Sirops', 'Spiritueux', 'Vins', 'Matériel'];
const catRank = (c: string) => { const i = CATEGORY_ORDER.indexOf(c); return i === -1 ? CATEGORY_ORDER.length : i; };

export default function EspaceAssortmentPage() {
  const { showToast } = useToast();
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [socle, setSocle] = useState<SocleRow[]>([]);
  const [selected, setSelected] = useState<string>(''); // space_name
  const [toAdd, setToAdd] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [sp, pr, apr] = await Promise.all([
      supabase.from('spaces').select('space_id, space_name, service_type').eq('active', true),
      supabase.from('products').select('product_id, product_name, category').eq('active', true).order('product_name'),
      supabase.from('area_product_reference').select('id, area_name, product_id, product_name').eq('association_level', 'S').not('product_id', 'is', null),
    ]);
    // Tous les espaces éditables : hors Loges (dotation dédiée) et superviseurs Buvette 1/2.
    const list = ((sp.data as Space[] | null) ?? [])
      .filter((s) => !LOGE_IDS.has(s.space_id) && !['Buvette 1', 'Buvette 2'].includes(s.space_name))
      .sort((a, b) => a.space_name.localeCompare(b.space_name, 'fr', { numeric: true }));
    const prod = (pr.data as Product[] | null) ?? [];
    const catById = new Map(prod.map((p) => [p.product_id, p.category]));
    const names = new Set(list.map((b) => b.space_name.toUpperCase()));
    const rows = ((apr.data as Omit<SocleRow, 'category'>[] | null) ?? [])
      .filter((r) => names.has((r.area_name ?? '').trim().toUpperCase()))
      .map((r) => ({ ...r, category: catById.get(r.product_id) ?? 'Autres' }));
    setSpaces(list);
    setProducts(prod);
    setSocle(rows);
    setSelected((cur) => cur || list[0]?.space_name || '');
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const selectedSpace = useMemo(() => spaces.find((s) => s.space_name.toUpperCase() === selected.toUpperCase()), [spaces, selected]);
  const socleOfSelected = useMemo(
    () => socle
      .filter((r) => r.area_name.trim().toUpperCase() === selected.toUpperCase())
      .sort((a, b) => catRank(a.category) - catRank(b.category) || a.product_name.localeCompare(b.product_name)),
    [socle, selected],
  );
  const presentIds = useMemo(() => new Set(socleOfSelected.map((r) => r.product_id)), [socleOfSelected]);
  const svc = selectedSpace?.service_type ?? null;
  // Aucune différenciation VIP / buvette : tous les produits sont proposés partout.
  const available = useMemo(() => products.filter((p) => !presentIds.has(p.product_id)), [products, presentIds]);
  const countByArea = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of socle) { const k = r.area_name.trim().toUpperCase(); m.set(k, (m.get(k) ?? 0) + 1); }
    return m;
  }, [socle]);
  const grouped = useMemo(() => {
    const g = new Map<ServiceType, Space[]>();
    for (const s of spaces) { const t = (s.service_type ?? 'bar') as ServiceType; if (!g.has(t)) g.set(t, []); g.get(t)!.push(s); }
    return TYPE_ORDER.filter((t) => g.has(t)).map((t) => ({ type: t, spaces: g.get(t)! }));
  }, [spaces]);

  async function addProduct() {
    const p = products.find((x) => x.product_id === toAdd);
    if (!p || !selectedSpace) return;
    setBusy(true);
    // area_product_reference est désormais une VUE sur space_product_catalog (CTR-1).
    // Un INSERT simple suffit : le trigger INSTEAD OF gère l'idempotence
    // (upsert interne sur le catalogue). PostgREST upsert/onConflict est rejeté
    // sur une vue (pas de contrainte unique) → on reste sur .insert().
    const { error } = await supabase.from('area_product_reference').insert({
      area_name: selectedSpace.space_name,
      area_group: GROUP_BY_SERVICE[selectedSpace.service_type ?? 'bar'] ?? 'VIP',
      product_id: p.product_id,
      product_name: p.product_name,
      product_family: FAMILY_BY_CATEGORY[p.category] ?? 'Autres',
      association_level: 'S',
      cdc_version: 'custom',
    });
    setBusy(false);
    if (error) return showToast(`Échec : ${error.message}`, 'warning');
    setToAdd('');
    await load();
    showToast(`${p.product_name} ajouté au socle de ${selectedSpace.space_name} — régénérez les fiches runner pour l'appliquer.`, 'success');
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
        <h1 className="flex items-center gap-2 text-xl font-black text-stone-900"><Boxes className="text-amber-600" /> Assortiment des espaces</h1>
        <p className="mt-1 text-sm text-stone-500">
          Socle (niveau S) de chaque espace. Ajoutez ou retirez les produits voulus — utile pour une prestation
          différente dans un espace. C'est le référentiel, pas l'historique, qui pilote l'assortiment.
          Régénérez ensuite les fiches runner de l'événement pour appliquer.
        </p>
      </div>

      <div className="mb-4 flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
        <Info size={16} className="mt-0.5 shrink-0" />
        <span>Modulez chaque espace par ses produits : <b>tous les produits sont disponibles pour tous les espaces</b> (un produit buvette peut être mis en VIP et inversement). Le socle est global (par espace, pas par match) et s'applique dès la prochaine régénération des dotations. Les <b>Loges</b> gardent leur dotation par loge dédiée.</span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[240px_1fr]">
        {/* Colonne espaces, groupés par type */}
        <div className="space-y-3">
          {grouped.map(({ type, spaces: list }) => (
            <div key={type}>
              <p className="mb-1 px-1 text-[11px] font-bold uppercase tracking-wider text-stone-400">{TYPE_LABEL[type]}</p>
              <div className="space-y-1.5">
                {list.map((b) => {
                  const on = b.space_name.toUpperCase() === selected.toUpperCase();
                  return (
                    <button
                      key={b.space_id}
                      onClick={() => { setSelected(b.space_name); setToAdd(''); }}
                      className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition-colors ${on ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-200 bg-white text-stone-700 hover:border-stone-400'}`}
                    >
                      <span className="font-bold">{b.space_name}</span>
                      <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${on ? 'bg-white/20 text-white' : 'bg-stone-100 text-stone-500'}`}>
                        {countByArea.get(b.space_name.toUpperCase()) ?? 0}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Détail assortiment */}
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-bold text-stone-800">Socle de {selected || '—'} {svc && <span className="ml-1 text-xs font-normal text-stone-400">· {TYPE_LABEL[svc]}</span>}</p>
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
            <p className="rounded-xl bg-stone-50 px-4 py-6 text-center text-sm text-stone-400">Aucun produit au socle de cet espace.</p>
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
