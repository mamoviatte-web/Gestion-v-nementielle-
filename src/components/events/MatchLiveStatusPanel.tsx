/**
 * MatchLiveStatusPanel — suivi live du match par espace (ROLE_STADE).
 * Sessions connectées, avancement stocks / horaires, consommation estimée,
 * rafraîchi en Realtime. Masqué tant que la vue match_live_status n'existe pas.
 */

import { useMatchLiveStatus, type SpaceLiveStatus } from '@/hooks/useMatchLiveStatus';

const STOCK_BADGE: Record<SpaceLiveStatus['stock_status'], { label: string; cls: string }> = {
  en_attente: { label: 'En attente', cls: 'bg-slate-100 text-slate-500' },
  en_cours: { label: 'En cours', cls: 'bg-amber-100 text-amber-700' },
  clôturé: { label: 'Clôturé', cls: 'bg-green-100 text-green-700' },
};

const SERVICE_DOT: Record<string, string> = {
  vip: 'bg-amber-500',
  bar: 'bg-slate-700',
  buvette: 'bg-sky-500',
};

function relTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function MatchLiveStatusPanel({ eventId }: { eventId: string }) {
  const { spaces, available, loading } = useMatchLiveStatus(eventId);

  if (!available) return null; // vue non appliquée → on n'affiche rien
  if (loading) return <div className="h-24 animate-pulse rounded-xl bg-slate-100" />;
  if (spaces.length === 0) return null;

  const connected = spaces.reduce((s, x) => s + (x.active_sessions ?? 0), 0);
  const closed = spaces.filter((s) => s.stock_status === 'clôturé').length;

  return (
    <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-semibold text-slate-800">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
          </span>
          Suivi live du match
        </h3>
        <p className="text-xs text-slate-500">
          {connected} connecté(s) · {closed}/{spaces.length} espace(s) clôturé(s)
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-400">
              <th className="pb-2 text-left font-medium">Espace</th>
              <th className="pb-2 text-center font-medium">Connectés</th>
              <th className="pb-2 text-center font-medium">Stock</th>
              <th className="pb-2 text-right font-medium">Conso. est.</th>
              <th className="pb-2 text-center font-medium">Horaires</th>
              <th className="pb-2 text-right font-medium">Activité</th>
            </tr>
          </thead>
          <tbody>
            {spaces.map((s) => {
              const badge = STOCK_BADGE[s.stock_status];
              return (
                <tr key={s.space_id} className="border-t border-slate-100">
                  <td className="py-2">
                    <span className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${SERVICE_DOT[s.service_type ?? ''] ?? 'bg-slate-300'}`} />
                      <span className="font-medium text-slate-800">{s.space_name}</span>
                    </span>
                    {s.last_staff_name && <span className="ml-4 text-xs text-slate-400">{s.last_staff_name}</span>}
                  </td>
                  <td className="py-2 text-center">
                    {s.active_sessions > 0 ? (
                      <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-green-100 px-1.5 text-xs font-bold text-green-700">
                        {s.active_sessions}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="py-2 text-center">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>{badge.label}</span>
                  </td>
                  <td className="py-2 text-right font-medium text-slate-700">{s.total_consumed_est ?? 0}</td>
                  <td className="py-2 text-center text-slate-600">
                    {s.schedules_done}/{s.schedules_total}
                  </td>
                  <td className="py-2 text-right text-xs text-slate-400">{relTime(s.last_activity)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
