/**
 * MatchLiveStatusPanel — suivi live du match, REGROUPÉ PAR THÈME D'ESPACE
 * (Salons/VIP · Bars · Buvettes). Chaque thème est une sous-partie repliable
 * qui affiche en tête son bilan (connectés, clôturés, conso) et déplie le détail
 * par espace. Objectif : gagner de la place et rendre le contrôle plus rapide.
 * ROLE_STADE, rafraîchi en Realtime. Masqué tant que la vue n'existe pas.
 */

import { ChevronRight } from 'lucide-react';
import { useMatchLiveStatus, type SpaceLiveStatus } from '@/hooks/useMatchLiveStatus';

const STOCK_BADGE: Record<SpaceLiveStatus['stock_status'], { label: string; cls: string }> = {
  en_attente: { label: 'En attente', cls: 'bg-pr-stone/50 text-pr-black-soft/50' },
  en_cours: { label: 'En cours', cls: 'bg-amber-100 text-amber-700' },
  clôturé: { label: 'Clôturé', cls: 'bg-green-100 text-green-700' },
};

/** Thèmes d'espaces (ordre d'affichage) + pastille de couleur. */
const THEMES: { key: string; label: string; dot: string; match: (t: string) => boolean }[] = [
  { key: 'vip', label: 'Salons & VIP', dot: 'bg-amber-500', match: (t) => t === 'vip' },
  { key: 'bar', label: 'Bars', dot: 'bg-pr-black-soft', match: (t) => t === 'bar' },
  { key: 'buvette', label: 'Buvettes', dot: 'bg-sky-500', match: (t) => t === 'buvette' },
  { key: 'autre', label: 'Autres', dot: 'bg-pr-stone', match: () => true },
];

function relTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function themeOf(t: string | null): string {
  const st = t ?? '';
  return THEMES.find((g) => g.key !== 'autre' && g.match(st))?.key ?? 'autre';
}

export function MatchLiveStatusPanel({ eventId }: { eventId: string }) {
  const { spaces, available, loading } = useMatchLiveStatus(eventId);

  if (!available) return null;
  if (loading) return <div className="h-24 animate-pulse rounded-xl bg-pr-stone/50" />;
  if (spaces.length === 0) return null;

  const connected = spaces.reduce((s, x) => s + (x.active_sessions ?? 0), 0);
  const closed = spaces.filter((s) => s.stock_status === 'clôturé').length;

  const groups = THEMES.map((g) => ({
    ...g,
    items: spaces.filter((s) => themeOf(s.service_type) === g.key),
  })).filter((g) => g.items.length > 0);

  return (
    <details className="group/live mb-5 overflow-hidden rounded-xl border border-pr-stone bg-white">
      {/* Replié par défaut : on garde la vue concentrée. Le résumé (connectés /
          clôturés) reste visible d'un coup d'œil ; on déplie au besoin. */}
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 transition-colors hover:bg-pr-cream/40 [&::-webkit-details-marker]:hidden">
        <h3 className="flex items-center gap-2 font-semibold text-pr-black-soft/90">
          <ChevronRight size={15} className="shrink-0 text-pr-black-soft/40 transition-transform group-open/live:rotate-90" />
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
          </span>
          Suivi live du match
        </h3>
        <p className="text-xs text-pr-black-soft/50">
          {connected} connecté(s) · {closed}/{spaces.length} espace(s) clôturé(s)
        </p>
      </summary>

      <div className="space-y-2 border-t border-pr-stone/60 px-4 pb-4 pt-3">
        {groups.map((g) => {
          const gConnected = g.items.reduce((s, x) => s + (x.active_sessions ?? 0), 0);
          const gClosed = g.items.filter((s) => s.stock_status === 'clôturé').length;
          const gConso = g.items.reduce((s, x) => s + (x.total_consumed_est ?? 0), 0);
          const allClosed = gClosed === g.items.length;
          return (
            <details key={g.key} className="group overflow-hidden rounded-xl border border-pr-stone/70" open>
              <summary className="flex cursor-pointer list-none items-center gap-2.5 bg-pr-cream/50 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                <ChevronRight size={15} className="shrink-0 text-pr-black-soft/40 transition-transform group-open:rotate-90" />
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${g.dot}`} />
                <span className="font-display text-sm font-bold text-pr-black">{g.label}</span>
                <span className="text-xs font-medium text-pr-black-soft/40">{g.items.length} espace(s)</span>
                <span className="ml-auto flex items-center gap-2 text-xs">
                  {gConnected > 0 && (
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-green-100 px-1.5 font-bold text-green-700">
                      {gConnected}
                    </span>
                  )}
                  <span className={`rounded-full px-2 py-0.5 font-medium ${allClosed ? 'bg-green-100 text-green-700' : 'bg-pr-stone/50 text-pr-black-soft/55'}`}>
                    {gClosed}/{g.items.length} clôturés
                  </span>
                  <span className="hidden tabular-nums text-pr-black-soft/45 sm:inline">conso ~{gConso}</span>
                </span>
              </summary>

              <div className="divide-y divide-pr-stone/50 border-t border-pr-stone/60">
                {g.items.map((s) => {
                  const badge = STOCK_BADGE[s.stock_status];
                  return (
                    <div key={s.space_id} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.active_sessions > 0 ? 'bg-green-500' : 'bg-pr-stone'}`} />
                        <span className="truncate font-medium text-pr-black-soft/90">{s.space_name}</span>
                        {s.last_staff_name && <span className="truncate text-xs text-pr-black-soft/40">· {s.last_staff_name}</span>}
                      </span>
                      {s.active_sessions > 0 && (
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-green-100 px-1.5 text-xs font-bold text-green-700">
                          {s.active_sessions}
                        </span>
                      )}
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>{badge.label}</span>
                      <span className="hidden w-14 shrink-0 text-right tabular-nums text-xs text-pr-black-soft/70 sm:inline">{s.total_consumed_est ?? 0}</span>
                      <span className="hidden w-10 shrink-0 text-right text-xs text-pr-black-soft/60 sm:inline">{s.schedules_done}/{s.schedules_total}</span>
                      <span className="w-12 shrink-0 text-right text-xs text-pr-black-soft/45">{relTime(s.last_activity)}</span>
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    </details>
  );
}
