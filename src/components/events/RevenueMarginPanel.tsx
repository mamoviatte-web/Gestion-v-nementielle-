/**
 * RevenueMarginPanel — recettes d'encaissement + compte de résultat d'un match.
 *
 * Bandeau « Compte de résultat » (CA − coût F&B − coût RH = marge), répartition
 * du CA par type et top des points de vente, puis liste éditable des points de
 * vente (food trucks, buvettes, bars…). Source : get_event_pl + table
 * event_revenue. RG-003 : get_event_pl / revenue_* réservés ROLE_STADE (base).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Check, X, TrendingUp, TrendingDown } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Button, Input, Select, Spinner } from '@/components/ui';

interface PL {
  recettes_ht: number; recettes_ttc: number; nb_ventes: number;
  cout_fb_ht: number; cout_rh_ht: number; marge_ht: number; marge_pct: number;
  panier_moyen: number; recette_par_pax: number;
  par_pos: { label: string; type: string; ht: number; ttc: number; ventes: number | null }[];
  par_type: { type: string; ht: number; ttc: number }[];
}
interface RevenueLine {
  id: string; pos_label: string; pos_type: string;
  revenue_ht: number | null; revenue_ttc: number | null; nb_ventes: number | null;
  space_id: string | null; source: string | null;
}
interface SpaceOpt { space_id: string; space_name: string; }

const POS_TYPES = [
  { value: 'food_truck', label: 'Food truck' },
  { value: 'buvette', label: 'Buvette' },
  { value: 'bar', label: 'Bar' },
  { value: 'vip', label: 'VIP' },
  { value: 'autre', label: 'Autre' },
] as const;
const POS_LABEL: Record<string, string> = Object.fromEntries(POS_TYPES.map((t) => [t.value, t.label]));
const TYPE_COLOR: Record<string, string> = {
  food_truck: '#F59E0B', buvette: '#1D7A46', bar: '#5B4B8A', vip: '#B8860B', autre: '#6B7280',
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const eur = (v: number): string => v.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';

export function RevenueMarginPanel({ eventId, spaces }: { eventId: string; spaces: SpaceOpt[] }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const by = user?.name ?? user?.email ?? 'RH';

  const [pl, setPl] = useState<PL | null>(null);
  const [lines, setLines] = useState<RevenueLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [plRes, linesRes] = await Promise.all([
      supabase.rpc('get_event_pl', { p_event: eventId }),
      supabase.from('event_revenue').select('id, pos_label, pos_type, revenue_ht, revenue_ttc, nb_ventes, space_id, source')
        .eq('event_id', eventId).order('revenue_ht', { ascending: false }),
    ]);
    setPl((plRes.data as PL | null) ?? null);
    setLines((linesRes.data as RevenueLine[] | null) ?? []);
    setLoading(false);
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(
    async (form: { id: string | null; label: string; type: string; ttc: string; ht: string; ventes: string; space: string }): Promise<boolean> => {
      if (!form.label.trim()) { showToast('Libellé requis.', 'warning'); return false; }
      setBusy(true);
      const { data, error } = await supabase.rpc('revenue_upsert', {
        p_id: form.id, p_event: eventId, p_space: form.space || null,
        p_label: form.label.trim(), p_type: form.type,
        p_ttc: form.ttc ? num(form.ttc) : null, p_ht: form.ht ? num(form.ht) : null,
        p_ventes: form.ventes ? num(form.ventes) : null, p_tva: 0.10, p_source: 'saisie', p_by: by,
      });
      setBusy(false);
      const res = data as { success?: boolean; error?: string } | null;
      if (error || (res && res.success === false)) {
        showToast(`Échec : ${res?.error ?? error?.message ?? 'erreur'}`, 'warning');
        return false;
      }
      showToast('Recette enregistrée.', 'success');
      await load();
      return true;
    },
    [eventId, by, showToast, load],
  );

  async function remove(id: string) {
    if (!window.confirm('Supprimer cette recette ?')) return;
    setBusy(true);
    const { error } = await supabase.rpc('revenue_delete', { p_id: id });
    setBusy(false);
    if (error) { showToast(`Échec : ${error.message}`, 'warning'); return; }
    showToast('Recette supprimée.', 'success');
    await load();
  }

  const maxType = useMemo(() => Math.max(1, ...(pl?.par_type ?? []).map((t) => num(t.ht))), [pl]);

  if (loading) return <Spinner />;
  if (!pl) return <p className="text-sm text-stone-400">Compte de résultat indisponible.</p>;

  const margePos = num(pl.marge_ht) >= 0;

  return (
    <div className="space-y-6">
      {/* Bandeau compte de résultat */}
      <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
        <div className="grid grid-cols-1 gap-px bg-stone-100 sm:grid-cols-4">
          <PLCell label="CA réalisé HT" value={eur(num(pl.recettes_ht))} sub={`${num(pl.nb_ventes)} ventes · panier ${num(pl.panier_moyen).toFixed(2)} €`} />
          <PLCell label="– Coût F&B HT" value={eur(num(pl.cout_fb_ht))} tone="cost" />
          <PLCell label="– Coût RH HT" value={eur(num(pl.cout_rh_ht))} tone="cost" />
          <div className={`p-4 ${margePos ? 'bg-emerald-600' : 'bg-rose-600'} text-white`}>
            <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-white/70">
              {margePos ? <TrendingUp size={12} /> : <TrendingDown size={12} />} Marge HT
            </p>
            <p className="mt-1 text-2xl font-black tabular-nums">{eur(num(pl.marge_ht))}</p>
            <p className="text-xs font-bold text-white/80">{num(pl.marge_pct).toFixed(1)} %</p>
          </div>
        </div>

        {/* Répartition par type + top POS */}
        {pl.par_type.length > 0 && (
          <div className="grid grid-cols-1 gap-4 border-t border-stone-100 p-4 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-stone-400">CA par type</p>
              <div className="space-y-1.5">
                {pl.par_type.map((t) => (
                  <div key={t.type} className="flex items-center gap-2">
                    <span className="w-20 shrink-0 text-xs text-stone-500">{POS_LABEL[t.type] ?? t.type}</span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-stone-100">
                      <div className="h-full rounded-full" style={{ width: `${(num(t.ht) / maxType) * 100}%`, background: TYPE_COLOR[t.type] ?? '#6B7280' }} />
                    </div>
                    <span className="w-16 shrink-0 text-right text-xs font-semibold tabular-nums text-stone-700">{eur(num(t.ht))}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-stone-400">Top points de vente</p>
              <div className="space-y-1">
                {pl.par_pos.slice(0, 5).map((p, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="truncate text-stone-600">{p.label}</span>
                    <span className="font-semibold tabular-nums text-stone-800">{eur(num(p.ht))}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Liste des points de vente */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wide text-stone-500">Points de vente ({lines.length})</h3>
          <Button size="sm" onClick={() => { setAdding((v) => !v); setEditId(null); }}>
            <Plus size={14} /> Ajouter une recette
          </Button>
        </div>

        {adding && (
          <RevenueForm spaces={spaces} busy={busy} onCancel={() => setAdding(false)}
            onSubmit={async (f) => { const ok = await save({ ...f, id: null }); if (ok) setAdding(false); }} />
        )}

        <div className="overflow-x-auto rounded-2xl border border-stone-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-400">
                <th className="px-4 py-2">Point de vente</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2 text-right">CA HT</th>
                <th className="px-3 py-2 text-right">CA TTC</th>
                <th className="px-3 py-2 text-right">Ventes</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-50">
              {lines.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-stone-400">Aucune recette saisie.</td></tr>
              ) : lines.map((l) => editId === l.id ? (
                <tr key={l.id}>
                  <td colSpan={6} className="p-0">
                    <RevenueForm spaces={spaces} busy={busy} initial={l} onCancel={() => setEditId(null)}
                      onSubmit={async (f) => { const ok = await save({ ...f, id: l.id }); if (ok) setEditId(null); }} />
                  </td>
                </tr>
              ) : (
                <tr key={l.id} className="text-stone-800">
                  <td className="px-4 py-2 font-medium">{l.pos_label}
                    {l.source === 'import' && <span className="ml-1 text-[10px] text-stone-400">(import)</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ background: TYPE_COLOR[l.pos_type] ?? '#6B7280' }}>
                      {POS_LABEL[l.pos_type] ?? l.pos_type}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{eur(num(l.revenue_ht))}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-stone-500">{eur(num(l.revenue_ttc))}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-stone-500">{l.nb_ventes ?? '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => { setEditId(l.id); setAdding(false); }} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"><Pencil size={14} /></button>
                      <button onClick={() => void remove(l.id)} className="rounded-lg p-1.5 text-stone-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PLCell({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'cost' }) {
  return (
    <div className="bg-white p-4">
      <p className="text-[11px] uppercase tracking-wide text-stone-400">{label}</p>
      <p className={`mt-1 text-2xl font-black tabular-nums ${tone === 'cost' ? 'text-rose-600' : 'text-stone-900'}`}>{value}</p>
      {sub && <p className="text-xs text-stone-400">{sub}</p>}
    </div>
  );
}

function RevenueForm({
  spaces, busy, initial, onCancel, onSubmit,
}: {
  spaces: SpaceOpt[];
  busy: boolean;
  initial?: RevenueLine;
  onCancel: () => void;
  onSubmit: (f: { label: string; type: string; ttc: string; ht: string; ventes: string; space: string }) => void;
}) {
  const [label, setLabel] = useState(initial?.pos_label ?? '');
  const [type, setType] = useState(initial?.pos_type ?? 'food_truck');
  const [ttc, setTtc] = useState(initial?.revenue_ttc != null ? String(initial.revenue_ttc) : '');
  const [ht, setHt] = useState(initial?.revenue_ht != null ? String(initial.revenue_ht) : '');
  const [ventes, setVentes] = useState(initial?.nb_ventes != null ? String(initial.nb_ventes) : '');
  const [space, setSpace] = useState(initial?.space_id ?? '');

  return (
    <div className="grid grid-cols-2 gap-2 border-b border-stone-100 bg-amber-50/40 p-4 sm:grid-cols-7">
      <Input placeholder="Point de vente" value={label} onChange={(e) => setLabel(e.target.value)} className="sm:col-span-2" />
      <Select value={type} onChange={(e) => setType(e.target.value)} options={POS_TYPES.map((t) => ({ value: t.value, label: t.label }))} />
      <Input type="number" step="0.01" placeholder="CA TTC €" value={ttc} onChange={(e) => setTtc(e.target.value)} />
      <Input type="number" step="0.01" placeholder="CA HT (opt.)" value={ht} onChange={(e) => setHt(e.target.value)} />
      <Input type="number" placeholder="Ventes" value={ventes} onChange={(e) => setVentes(e.target.value)} />
      <div className="flex items-center gap-1">
        <Select value={space} onChange={(e) => setSpace(e.target.value)}
          options={[{ value: '', label: 'Espace…' }, ...spaces.map((s) => ({ value: s.space_id, label: s.space_name }))]} />
      </div>
      <div className="col-span-2 flex items-center gap-1 sm:col-span-7">
        <Button size="sm" disabled={busy || !label.trim() || (!ttc && !ht)} onClick={() => onSubmit({ label, type, ttc, ht, ventes, space })}>
          <Check size={14} /> Enregistrer
        </Button>
        <button onClick={onCancel} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100"><X size={16} /></button>
      </div>
    </div>
  );
}
