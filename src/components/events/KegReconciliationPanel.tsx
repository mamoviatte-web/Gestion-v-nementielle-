/**
 * KegReconciliationPanel — réconciliation des fûts à la clôture d'un match.
 * Source (vues figées) : event_keg_reconciliation (détail espace × fût) +
 * event_keg_reconciliation_summary (récap). Règle : les pleins restants
 * reviennent au dépôt « Stockage Fûts » SAUF pour les VIP/bars et les buvettes
 * containers Nord EST/EST NORD/EST SUD (ex-B2/B3/B4), qui les gardent sur place. « Valider la réconciliation »
 * écrit le registre fûts via apply_keg_reconciliation (idempotent, tag RECON:).
 * RG-003 : écran admin (ROLE_STADE). Vues sans coût.
 */

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Beer, PackageCheck, Home, ArrowRightLeft, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Button, Spinner } from '@/components/ui';

interface ReconLine {
  space_id: string; space_name: string; service_type: string | null; family: string;
  product_id: string; product_name: string; volume_l: number | null;
  dispatche: number; vides_a_rentrer: number; pleins_restants: number;
  destination_pleins: 'retour_stockage' | 'garde_sur_place';
}
interface ReconSummary {
  total_vides_a_rentrer: number; pleins_retour_stockage: number; pleins_gardes_sur_place: number; nb_espaces: number;
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function KegReconciliationPanel({ eventId, closed }: { eventId: string; closed: boolean }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const by = user?.name ?? user?.email ?? 'Stade';
  const [lines, setLines] = useState<ReconLine[]>([]);
  const [summary, setSummary] = useState<ReconSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [l, s] = await Promise.all([
      supabase.from('event_keg_reconciliation').select('*').eq('event_id', eventId).order('space_name'),
      supabase.from('event_keg_reconciliation_summary').select('*').eq('event_id', eventId).maybeSingle(),
    ]);
    setLines((l.data as ReconLine[] | null) ?? []);
    setSummary((s.data as ReconSummary | null) ?? null);
    setLoading(false);
  }, [eventId]);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="rounded-2xl border border-stone-100 bg-white p-5"><Spinner label="Réconciliation fûts…" /></div>;
  if (lines.length === 0) return null; // pas de fûts dispatchés sur ce match

  const retour = lines.filter((l) => l.destination_pleins === 'retour_stockage');
  const garde = lines.filter((l) => l.destination_pleins === 'garde_sur_place');

  async function validate() {
    setSaving(true);
    const { data, error } = await supabase.rpc('apply_keg_reconciliation', { p_event: eventId, p_by: by });
    setSaving(false);
    const r = data as { success?: boolean; lignes_vides?: number; lignes_retour_stockage?: number } | null;
    if (error || r?.success === false) { showToast(`Échec : ${error?.message ?? 'réconciliation refusée'}`, 'warning'); return; }
    showToast(`Réconciliation appliquée — ${num(r?.lignes_vides)} vide(s) à rentrer, ${num(r?.lignes_retour_stockage)} retour(s) stockage.`, 'success');
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['kegSummary'] }),
      queryClient.invalidateQueries({ queryKey: ['kegReturnHistory'] }),
      queryClient.invalidateQueries({ queryKey: ['depotsSummary'] }),
    ]);
    await load();
  }

  return (
    <section className="space-y-4 rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-bold text-stone-800"><Beer size={16} className="text-amber-600" /> Réconciliation des fûts</p>
          <p className="mt-0.5 text-xs text-stone-400">
            Vides consommés à rentrer · pleins restants renvoyés au stockage (sauf VIP et buvettes container Nord EST / EST NORD / EST SUD, gardés sur place).
          </p>
        </div>
        <Button size="sm" loading={saving} onClick={() => void validate()}>
          <Check size={14} /> Valider la réconciliation
        </Button>
      </div>

      {/* Bandeau récap */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard icon={PackageCheck} accent="#B45309" label="Vides à rentrer" value={num(summary?.total_vides_a_rentrer)} hint="retour brasseur / consigne" />
        <StatCard icon={ArrowRightLeft} accent="#047857" label="Pleins → stockage" value={num(summary?.pleins_retour_stockage)} hint="reviennent au dépôt Fûts" />
        <StatCard icon={Home} accent="#1D4ED8" label="Pleins gardés sur place" value={num(summary?.pleins_gardes_sur_place)} hint="VIP + Nord EST/EST NORD/EST SUD" />
      </div>

      {!closed && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          ⚠️ Match non clôturé — ces chiffres évolueront jusqu'à la saisie des stocks finaux. Validez après clôture.
        </p>
      )}

      <ReconGroup title="Retour stockage" tone="emerald" rows={retour} />
      <ReconGroup title="Gardé sur place (VIP + containers)" tone="sky" rows={garde} />
    </section>
  );
}

function StatCard({ icon: Icon, label, value, hint, accent }: { icon: typeof Home; label: string; value: number; hint?: string; accent: string }) {
  return (
    <div className="rounded-xl border border-stone-100 bg-stone-50/60 p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500"><Icon size={13} style={{ color: accent }} /> {label}</p>
      <p className="mt-1 text-2xl font-black" style={{ color: accent }}>{value}</p>
      {hint && <p className="text-[11px] text-stone-400">{hint}</p>}
    </div>
  );
}

function ReconGroup({ title, tone, rows }: { title: string; tone: 'emerald' | 'sky'; rows: ReconLine[] }) {
  if (rows.length === 0) return null;
  const badge = tone === 'emerald'
    ? { cls: 'bg-emerald-100 text-emerald-700', label: 'Retour stockage' }
    : { cls: 'bg-sky-100 text-sky-700', label: 'Gardé sur place' };
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-stone-500">
        {title} <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${badge.cls}`}>{badge.label}</span>
      </p>
      <div className="overflow-x-auto rounded-xl border border-stone-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 bg-stone-50 text-left text-[11px] uppercase tracking-wide text-stone-400">
              <th className="px-3 py-2">Espace</th>
              <th className="px-3 py-2">Fût</th>
              <th className="px-2 py-2 text-right">Dispatché</th>
              <th className="px-2 py-2 text-right">Vides à rentrer</th>
              <th className="px-3 py-2 text-right">Pleins restants</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-50">
            {rows.map((r) => (
              <tr key={`${r.space_id}-${r.product_id}`} className="text-stone-800">
                <td className="px-3 py-2 font-medium">{r.space_name}</td>
                <td className="px-3 py-2 text-stone-600">{r.product_name}{r.volume_l ? <span className="ml-1 text-[10px] text-stone-400">{num(r.volume_l)} L</span> : null}</td>
                <td className="px-2 py-2 text-right tabular-nums text-stone-500">{num(r.dispatche)}</td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums text-amber-700">{num(r.vides_a_rentrer)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{num(r.pleins_restants)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
