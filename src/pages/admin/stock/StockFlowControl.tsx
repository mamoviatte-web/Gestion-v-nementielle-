/**
 * StockFlowControl — garde-fou « Contrôle des départs / retours » dépôt.
 * Pour un événement, réconcilie départ / réassort / consommation / retour
 * (get_event_stock_flow) et signale les anomalies (départ manquant, retour
 * compté 2×, dépôt gonflé). Permet de piloter la fiabilité du dépôt match par match.
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ArrowRightLeft } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface FlowAnomaly {
  produit: string;
  depart: number;
  reassort: number;
  conso: number;
  retour: number;
  probleme: string;
}
interface FlowResult {
  event_id: string;
  resume: { depart_total: number; reassort_total: number; conso_total: number; retour_total: number; anomalies: number };
  anomalies: FlowAnomaly[];
}
interface EventRow {
  event_id: string;
  event_name: string;
  event_date: string;
  status: string;
}

export default function StockFlowControl() {
  const [eventId, setEventId] = useState('');

  const events = useQuery({
    queryKey: ['flowEvents'],
    queryFn: async (): Promise<EventRow[]> => {
      const { data } = await supabase
        .from('events')
        .select('event_id, event_name, event_date, status')
        .eq('event_type', 'match')
        .order('event_date', { ascending: false })
        .limit(20);
      return (data as EventRow[] | null) ?? [];
    },
  });

  useEffect(() => {
    if (!eventId && events.data && events.data.length > 0) setEventId(events.data[0].event_id);
  }, [events.data, eventId]);

  const flow = useQuery({
    queryKey: ['stockFlow', eventId],
    enabled: !!eventId,
    queryFn: async (): Promise<FlowResult | null> => {
      const { data } = await supabase.rpc('get_event_stock_flow', { p_event: eventId });
      return (data as FlowResult | null) ?? null;
    },
  });

  const r = flow.data?.resume;
  const ok = useMemo(() => (r ? r.anomalies === 0 : false), [r]);

  const tiles = r
    ? [
        { label: 'Départ dépôt', value: r.depart_total, hint: 'sorti à l\'ouverture / transmission' },
        { label: 'Réassort', value: r.reassort_total, hint: 'complété en cours' },
        { label: 'Consommé', value: r.conso_total, hint: 'réellement vendu' },
        { label: 'Retour dépôt', value: r.retour_total, hint: 'remis en réserve' },
      ]
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-pr-black-soft/60">Événement (match)</label>
          <select
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            className="min-w-64 rounded-lg border border-pr-stone bg-white px-3 py-2 text-sm"
          >
            {(events.data ?? []).map((e) => (
              <option key={e.event_id} value={e.event_id}>
                {e.event_name} · {new Date(e.event_date).toLocaleDateString('fr-FR')} · {e.status}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 text-xs text-pr-black-soft/50">
          <ArrowRightLeft className="h-4 w-4" /> Départ + Réassort − Consommé = Retour (dépôt cohérent)
        </div>
      </div>

      {flow.isLoading && <p className="py-8 text-center text-sm text-pr-black-soft/50">Analyse du flux…</p>}

      {r && (
        <>
          {/* Verdict */}
          <div
            className={`flex items-center gap-3 rounded-xl border p-4 ${
              ok ? 'border-emerald-200 bg-emerald-50' : 'border-amber-300 bg-amber-50'
            }`}
          >
            {ok ? (
              <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" />
            ) : (
              <AlertTriangle className="h-6 w-6 shrink-0 text-amber-600" />
            )}
            <div>
              <p className={`text-sm font-bold ${ok ? 'text-emerald-800' : 'text-amber-900'}`}>
                {ok ? 'Dépôt cohérent — départs et retours réconciliés.' : `${r.anomalies} anomalie(s) de départ/retour à contrôler.`}
              </p>
              <p className={`text-xs ${ok ? 'text-emerald-700' : 'text-amber-700'}`}>
                {ok
                  ? 'Chaque sortie de réserve est tracée et les retours ne sont comptés qu\'une fois.'
                  : 'Un départ non enregistré ou un retour compté plusieurs fois fausse l\'inventaire de la réserve.'}
              </p>
            </div>
          </div>

          {/* Tuiles */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {tiles.map((t) => (
              <div key={t.label} className="rounded-xl border border-pr-stone bg-white p-4">
                <p className="text-xs text-pr-black-soft/60">{t.label}</p>
                <p className="mt-1 font-display text-2xl font-black tabular-nums text-pr-black">{t.value}</p>
                <p className="mt-0.5 text-[11px] text-pr-black-soft/40">{t.hint}</p>
              </div>
            ))}
          </div>

          {/* Anomalies */}
          {(flow.data?.anomalies?.length ?? 0) > 0 && (
            <div className="overflow-x-auto rounded-xl border border-pr-stone">
              <table className="w-full text-sm">
                <thead className="bg-pr-cream/60 text-left text-xs uppercase tracking-wide text-pr-black-soft/60">
                  <tr>
                    <th className="px-3 py-2">Produit</th>
                    <th className="px-3 py-2 text-right">Départ</th>
                    <th className="px-3 py-2 text-right">Réassort</th>
                    <th className="px-3 py-2 text-right">Conso</th>
                    <th className="px-3 py-2 text-right">Retour</th>
                    <th className="px-3 py-2">Problème</th>
                  </tr>
                </thead>
                <tbody>
                  {flow.data!.anomalies.map((a) => (
                    <tr key={a.produit} className="border-t border-pr-stone/60">
                      <td className="px-3 py-2 font-medium text-pr-black">{a.produit}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{a.depart}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{a.reassort}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{a.conso}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{a.retour}</td>
                      <td className="px-3 py-2">
                        <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                          {a.probleme}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
