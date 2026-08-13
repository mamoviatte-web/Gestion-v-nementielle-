/**
 * VipPaxPanel — pax (population) par espace VIP/Bar d'un événement, modifiable à
 * tout moment. Source : get_event_spaces_pax (family='VIP') ; édition via
 * set_space_pax (écrit event_spaces.expected_pax + fill_ratio). Le moteur VIP
 * (get_vip_dotation = COALESCE(expected_pax, max_pax, 100)) suit automatiquement ;
 * régénérer les dotations runner met à jour les quantités. Événement clôturé →
 * set_space_pax refuse. RG-003 : réservé ROLE_STADE (garde base).
 */

import { useCallback, useEffect, useState } from 'react';
import { Users, Check, X, RotateCcw, Pencil } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Spinner } from '@/components/ui';

interface PaxRow {
  space_id: string; space_name: string; service_type: string | null; family: string;
  max_pax: number | null; expected_pax: number | null; effective_pax: number | null; pax_custom: boolean;
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function VipPaxPanel({ eventId, onChanged }: { eventId: string; onChanged?: () => void }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const by = user?.name ?? user?.email ?? 'Stade';
  const [rows, setRows] = useState<PaxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('get_event_spaces_pax', { p_event: eventId });
    const all = (data as PaxRow[] | null) ?? [];
    setRows(all.filter((r) => r.family === 'VIP'));
    setLoading(false);
  }, [eventId]);
  useEffect(() => { void load(); }, [load]);

  async function apply(spaceId: string, pax: number) {
    if (!Number.isFinite(pax) || pax <= 0) { showToast('Pax invalide.', 'warning'); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc('set_space_pax', { p_event: eventId, p_space: spaceId, p_pax: pax, p_by: by });
    setBusy(false);
    const res = data as { success?: boolean; error?: string } | null;
    if (error || !res?.success) { showToast(`Échec : ${res?.error ?? error?.message ?? 'erreur'}`, 'warning'); return; }
    showToast('Pax mis à jour.', 'success');
    setEditId(null);
    await load();
    onChanged?.();
  }

  if (loading) return <Spinner />;
  if (rows.length === 0) return null;

  const totalVip = rows.reduce((s, r) => s + num(r.effective_pax), 0);

  return (
    <section className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="flex items-center gap-2 text-sm font-bold text-stone-800"><Users size={15} className="text-amber-600" /> Pax des espaces VIP & Bars</p>
          <p className="mt-0.5 text-xs text-stone-400">Population par espace — pilote les dotations VIP. Total effectif : <b>{totalVip}</b> pax</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-stone-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-400">
              <th className="px-3 py-2">Espace</th>
              <th className="px-3 py-2 text-right">Capacité</th>
              <th className="px-3 py-2 text-right">Pax prévu</th>
              <th className="px-3 py-2 text-center">Statut</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-50">
            {rows.map((r) => {
              const editing = editId === r.space_id;
              return (
                <tr key={r.space_id} className="text-stone-800">
                  <td className="px-3 py-2 font-medium">{r.space_name}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-stone-400">{num(r.max_pax) || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    {editing ? (
                      <input type="number" min="1" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus
                        className="w-20 rounded border border-amber-300 px-2 py-1 text-right text-sm" />
                    ) : (
                      <span className={`tabular-nums ${r.pax_custom ? 'font-bold text-stone-900' : 'text-stone-400'}`}>{num(r.effective_pax)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {r.pax_custom
                      ? <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">Personnalisé</span>
                      : <span className="text-[10px] text-stone-400">Défaut (capacité)</span>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      {editing ? (
                        <>
                          <button disabled={busy} onClick={() => void apply(r.space_id, num(draft))} className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50"><Check size={15} /></button>
                          <button onClick={() => setEditId(null)} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100"><X size={15} /></button>
                        </>
                      ) : (
                        <>
                          <button disabled={busy} onClick={() => { setEditId(r.space_id); setDraft(String(num(r.effective_pax) || num(r.max_pax))); }} title="Modifier le pax" className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"><Pencil size={14} /></button>
                          {r.pax_custom && (
                            <button disabled={busy} onClick={() => void apply(r.space_id, num(r.max_pax))} title="Réinitialiser à la capacité" className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100"><RotateCcw size={14} /></button>
                          )}
                        </>
                      )}
                    </div>
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
