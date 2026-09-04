/**
 * BilanRegisseur — section « Horaires régisseur » + « Charges régisseur » du
 * bilan d'un événement (ROLE_STADE). Corrige les heures (passage minuit),
 * affiche le vrai nom (jamais le code d'accès), le coût RH par régisseur et le
 * total consolidé F&B + RH. Le taux horaire est saisissable en ligne.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Users, X } from 'lucide-react';
import { Alert, Button, Input, Spinner } from '@/components/ui';
import { formatEuro } from '@/lib/calculations';
import { supabase } from '@/lib/supabase';
import {
  computeHours,
  computeRHCost,
  formatHours,
  formatDelta,
  getResponsableName,
} from '@/lib/scheduleCalculations';
import type { Event } from '@/lib/types';

interface ScheduleRow {
  schedule_id: string;
  space_id: string;
  staff_name: string | null;
  role: string | null;
  planned_arrival: string | null;
  planned_departure: string | null;
  actual_departure: string | null;
  hourly_rate: number | null;
  spaces: { space_name: string } | null;
}

/**
 * @param variant  'full' (Bilan) affiche le total consolidé F&B + RH ;
 *                 'rh' (onglet RH & Horaires) n'affiche que la charge régisseur.
 */
export function BilanRegisseur({ event, variant = 'full' }: { event: Event; variant?: 'full' | 'rh' }) {
  const queryClient = useQueryClient();
  const [rateTarget, setRateTarget] = useState<ScheduleRow | null>(null);

  const schedulesQuery = useQuery({
    queryKey: ['bilanRegisseur', event.event_id],
    queryFn: async (): Promise<ScheduleRow[]> => {
      const { data, error } = await supabase
        .from('schedules')
        .select(
          'schedule_id, space_id, staff_name, role, planned_arrival, planned_departure, actual_departure, hourly_rate, spaces(space_name)',
        )
        .eq('event_id', event.event_id);
      if (error) throw error;
      return (data ?? []) as unknown as ScheduleRow[];
    },
  });

  // Total F&B de l'événement (pour le total consolidé) — inutile en variante RH.
  const fbQuery = useQuery({
    queryKey: ['bilanRegisseurFB', event.event_id],
    enabled: variant === 'full',
    queryFn: async (): Promise<number> => {
      const { data } = await supabase
        .from('event_cost_summary')
        .select('total_fb_cost_ht')
        .eq('event_id', event.event_id)
        .maybeSingle();
      return data?.total_fb_cost_ht != null ? Number(data.total_fb_cost_ht) : 0;
    },
  });

  const saveRate = useMutation({
    mutationFn: async ({ scheduleId, rate }: { scheduleId: string; rate: number }) => {
      const { error } = await supabase.from('schedules').update({ hourly_rate: rate }).eq('schedule_id', scheduleId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bilanRegisseur', event.event_id] });
    },
  });

  const rows = schedulesQuery.data ?? [];
  const hasRates = rows.some((r) => r.hourly_rate != null);

  const enriched = useMemo(
    () =>
      rows.map((sc) => {
        const name = getResponsableName(sc.staff_name);
        const plannedH = computeHours(sc.planned_arrival, sc.planned_departure);
        const actualH = computeHours(sc.planned_arrival, sc.actual_departure);
        const delta = plannedH != null && actualH != null ? actualH - plannedH : null;
        const cost = computeRHCost(actualH, sc.hourly_rate);
        return { sc, name, plannedH, actualH, delta, cost };
      }),
    [rows],
  );

  const totalRH = useMemo(() => enriched.reduce((s, e) => s + (e.cost ?? 0), 0), [enriched]);
  const totalFB = fbQuery.data ?? 0;
  const pax = event.expected_attendees ?? 0;

  if (schedulesQuery.isLoading) return <Spinner label="Chargement des horaires…" />;

  if (rows.length === 0) {
    return (
      <section className="space-y-3">
        <SectionTitle icon={Clock}>Horaires régisseur</SectionTitle>
        <p className="text-sm text-slate-500">Aucun horaire régisseur saisi pour cet événement.</p>
      </section>
    );
  }

  return (
    <>
      {/* Horaires régisseur */}
      <section className="space-y-3">
        <SectionTitle icon={Clock}>Horaires régisseur</SectionTitle>
        <div className="overflow-x-auto rounded-xl border border-pr-stone bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-pr-stone text-left text-xs uppercase tracking-wide text-pr-black-soft/60">
                <th className="px-3 py-2.5 font-semibold">Espace</th>
                <th className="px-3 py-2.5 font-semibold">Régisseur</th>
                <th className="px-3 py-2.5 text-right font-semibold">Prévu</th>
                <th className="px-3 py-2.5 text-right font-semibold">Départ réel</th>
                <th className="px-3 py-2.5 text-right font-semibold">Heures</th>
                <th className="px-3 py-2.5 text-right font-semibold">Écart</th>
                {hasRates && <th className="px-3 py-2.5 text-right font-semibold">Coût RH</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-pr-stone">
              {enriched.map(({ sc, name, actualH, delta, cost }) => (
                <tr key={sc.schedule_id} className="hover:bg-pr-cream/40">
                  <td className="px-3 py-2.5 text-pr-black">{sc.spaces?.space_name ?? '—'}</td>
                  <td className="px-3 py-2.5 font-medium text-pr-black">{name}</td>
                  <td className="px-3 py-2.5 text-right text-pr-black-soft/70">
                    {sc.planned_arrival?.slice(0, 5) ?? '—'} → {sc.planned_departure?.slice(0, 5) ?? '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right text-pr-black-soft/70">
                    {sc.actual_departure?.slice(0, 5) ?? '⏳ En cours'}
                  </td>
                  <td className="px-3 py-2.5 text-right font-medium text-pr-black">{formatHours(actualH)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <span
                      className={
                        delta === null
                          ? 'text-pr-black-soft/30'
                          : delta > 1
                            ? 'text-amber-600'
                            : delta < -0.5
                              ? 'text-sky-600'
                              : 'text-pr-olive-dark'
                      }
                    >
                      {formatDelta(delta)}
                    </span>
                  </td>
                  {hasRates && (
                    <td className="px-3 py-2.5 text-right font-medium text-pr-black">
                      {cost != null ? formatEuro(cost) : <span className="text-xs text-amber-500">taux ?</span>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Charges régisseur + total consolidé */}
      <section className="space-y-3">
        <SectionTitle icon={Users}>Charges régisseur</SectionTitle>
        <div className="overflow-x-auto rounded-xl border border-pr-stone bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-pr-stone text-left text-xs uppercase tracking-wide text-pr-black-soft/60">
                <th className="px-3 py-2.5 font-semibold">Régisseur</th>
                <th className="px-3 py-2.5 text-right font-semibold">H prévues</th>
                <th className="px-3 py-2.5 text-right font-semibold">H réelles</th>
                <th className="px-3 py-2.5 text-right font-semibold">Taux/h</th>
                <th className="px-3 py-2.5 text-right font-semibold">Coût</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pr-stone">
              {enriched.map(({ sc, name, plannedH, actualH, cost }) => (
                <tr key={sc.schedule_id}>
                  <td className="px-3 py-2 font-medium text-pr-black">{name}</td>
                  <td className="px-3 py-2 text-right text-pr-black-soft/60">{formatHours(plannedH)}</td>
                  <td className="px-3 py-2 text-right text-pr-black">{formatHours(actualH)}</td>
                  <td className="px-3 py-2 text-right">
                    {sc.hourly_rate != null ? (
                      <button
                        className="text-pr-black-soft/70 underline decoration-dotted hover:text-pr-black"
                        onClick={() => setRateTarget(sc)}
                      >
                        {sc.hourly_rate.toFixed(2)} €/h
                      </button>
                    ) : (
                      <button className="text-xs text-pr-olive-dark underline" onClick={() => setRateTarget(sc)}>
                        Définir
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-pr-black">
                    {cost != null ? formatEuro(cost) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Total consolidé F&B + RH — Bilan uniquement (masqué dans l'onglet RH) */}
        {variant === 'full' && (
        <div className="rounded-xl border border-pr-stone bg-pr-cream/40 p-4">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-pr-black-soft/70">Total F&amp;B HT</span>
              <span className="font-medium text-pr-black">{formatEuro(totalFB)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-pr-black-soft/70">Charges régisseur</span>
              <span className="font-medium text-pr-black">{formatEuro(totalRH)}</span>
            </div>
            <div className="flex justify-between border-t border-pr-stone pt-2">
              <span className="font-medium text-pr-black">Coût total événement</span>
              <span className="font-display text-lg font-black text-pr-black">{formatEuro(totalFB + totalRH)} HT</span>
            </div>
            {pax > 0 && (
              <div className="flex justify-between text-xs text-pr-black-soft/50">
                <span>Coût / participant</span>
                <span>{((totalFB + totalRH) / pax).toFixed(2)} €/pax</span>
              </div>
            )}
          </div>
        </div>
        )}
      </section>

      {rateTarget && (
        <RateModal
          schedule={rateTarget}
          saving={saveRate.isPending}
          onClose={() => setRateTarget(null)}
          onSave={async (rate) => {
            await saveRate.mutateAsync({ scheduleId: rateTarget.schedule_id, rate });
            setRateTarget(null);
          }}
        />
      )}
    </>
  );
}

function RateModal({
  schedule,
  saving,
  onClose,
  onSave,
}: {
  schedule: ScheduleRow;
  saving: boolean;
  onClose: () => void;
  onSave: (rate: number) => void;
}) {
  const [rate, setRate] = useState(schedule.hourly_rate != null ? String(schedule.hourly_rate) : '');
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    const n = Number(rate);
    if (!Number.isFinite(n) || n < 0) return setError('Taux invalide.');
    onSave(n);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between">
          <h2 className="font-display text-lg font-black text-pr-black">Taux horaire régisseur</h2>
          <button onClick={onClose} aria-label="Fermer" className="text-pr-black-soft/40 hover:text-pr-black">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-4 text-sm text-pr-black-soft/60">
          {getResponsableName(schedule.staff_name)} — {schedule.spaces?.space_name ?? ''}. Ce taux sert au calcul du
          coût RH sur cet horaire.
        </p>
        {error && <Alert variant="error" className="mb-3">{error}</Alert>}
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min="0"
            step="0.50"
            placeholder="Ex : 15.00"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
          <span className="text-pr-black-soft/60">€/h</span>
        </div>
        <Button fullWidth className="mt-4" loading={saving} onClick={handleSave}>
          Enregistrer le taux
        </Button>
      </div>
    </div>
  );
}

function SectionTitle({ children, icon: Icon }: { children: string; icon: typeof Clock }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-600">
      <Icon className="h-4 w-4" aria-hidden />
      {children}
    </h3>
  );
}
