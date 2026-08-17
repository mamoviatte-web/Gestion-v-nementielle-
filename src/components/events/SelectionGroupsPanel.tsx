/**
 * SelectionGroupsPanel — CDC V5 #1 : non-mélange des gammes par espace.
 * Pour l'espace sélectionné, un seul produit « principal » par groupe de
 * sélection (vin rouge/blanc/rosé, champagne, bière pression, cola, eaux) ; les
 * autres restent proposés en alternative. La bascule appelle
 * set_event_area_selection (la base garantit l'unicité du principal). Source :
 * get_event_area_selections. RG-003 : écriture réservée ROLE_STADE (garde base).
 */

import { useCallback, useEffect, useState } from 'react';
import { Wine } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Spinner } from '@/components/ui';

interface Option { product_id: string; product_name: string; is_primary: boolean }
interface GroupSel {
  group_id: string; code: string; label: string; category: string; allow_multiple: boolean;
  primary_product_id: string | null; options: Option[];
}

const CAT_COLOR: Record<string, string> = { Vins: '#8B2E5A', Bières: '#C2751A', Soft: '#2F6FED' };

export function SelectionGroupsPanel({ eventId, spaceId }: { eventId: string; spaceId: string }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const by = user?.name ?? user?.email ?? 'Stade';
  const [rows, setRows] = useState<GroupSel[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    if (!spaceId) { setRows([]); setLoading(false); return; }
    const { data } = await supabase.rpc('get_event_area_selections', { p_event: eventId, p_space: spaceId });
    setRows((data as GroupSel[] | null) ?? []);
    setLoading(false);
  }, [eventId, spaceId]);
  useEffect(() => { setLoading(true); void load(); }, [load]);

  async function choose(g: GroupSel, productId: string) {
    if (!productId) return;
    setBusy(g.group_id);
    const { data, error } = await supabase.rpc('set_event_area_selection', {
      p_event: eventId, p_space: spaceId, p_group: g.group_id, p_product: productId, p_by: by,
    });
    setBusy('');
    const res = data as { success?: boolean; error?: string } | null;
    if (error || !res?.success) { showToast(`Échec : ${res?.error ?? error?.message ?? 'erreur'}`, 'warning'); return; }
    showToast('Gamme mise à jour.', 'success');
    await load();
  }

  if (loading) return <div className="rounded-2xl border border-stone-100 bg-white p-5"><Spinner label="Gammes…" /></div>;
  if (rows.length === 0) return null;

  return (
    <section className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
      <div className="mb-3">
        <p className="flex items-center gap-2 text-sm font-bold text-stone-800"><Wine size={16} className="text-rose-700" /> Gammes de l'espace (anti-mélange)</p>
        <p className="mt-0.5 text-xs text-stone-400">Un seul produit principal par gamme ; les autres restent en alternative. Régénérez les dotations pour appliquer.</p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-stone-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 bg-stone-50 text-left text-[11px] uppercase tracking-wide text-stone-400">
              <th className="px-3 py-2">Gamme</th>
              <th className="px-3 py-2">Produit principal</th>
              <th className="px-3 py-2">Alternatives</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-50">
            {rows.map((g) => {
              const alternatives = g.options.filter((o) => o.product_id !== g.primary_product_id);
              return (
                <tr key={g.group_id} className="text-stone-800">
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CAT_COLOR[g.category] ?? '#64748B' }} />
                      {g.label}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={g.primary_product_id ?? ''}
                      disabled={busy === g.group_id}
                      onChange={(e) => void choose(g, e.target.value)}
                      className="w-full min-w-[160px] rounded-lg border border-stone-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300"
                    >
                      <option value="">— Choisir —</option>
                      {g.options.map((o) => (
                        <option key={o.product_id} value={o.product_id}>{o.product_name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-xs text-stone-400">
                    {alternatives.length === 0 ? '—' : alternatives.map((o) => o.product_name).join(' · ')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
