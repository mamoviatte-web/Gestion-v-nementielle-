/**
 * WeeklyPlanner — planning hebdomadaire dynamique (remplace le tableau Excel).
 * Auto-alimenté par la vue weekly_planning : chaque événement non archivé
 * apparaît dans le bon jour, avec ses phases opérationnelles et son RH.
 */

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { isMatch } from '@/lib/eventUtils';

const DAYS_FR = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MONTH_FR = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
const OR_PR = '#C9A646';

const PHASE_COLORS: Record<string, string> = {
  mise_en_place: '#FEF3C7', evenement: '', demontage: '#FCE7F3', ilot: '#E0F2FE', autre: '#F3F4F6',
};
const PHASE_LABELS: Record<string, string> = {
  mise_en_place: '⚙️ MEP', evenement: '🎯', demontage: '📦 DMG', ilot: '🏗️ Îlot', autre: '📋',
};

interface Phase {
  phase_type: string;
  label: string | null;
  phase_date: string;
  start_time: string | null;
  regisseur: string | null;
  color: string | null;
}
interface PlanningEvent {
  event_id: string;
  event_name: string;
  event_type: string | null;
  status: string;
  pax_count: number | null;
  event_day: string | null;
  start_time: string | null;
  all_spaces: string | null;
  regisseurs: string | null;
  nb_agents_total: number | null;
  phases: Phase[] | null;
}

function eventColors(type: string | null) {
  return isMatch(type)
    ? { bg: '#1A1A2E', text: '#FFFFFF', border: '#1A1A2E' }
    : { bg: '#EFF6FF', text: '#1D4ED8', border: '#93C5FD' };
}

// Clé de jour en heure locale (évite le décalage UTC de toISOString).
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function getWeekDays(date: Date): Date[] {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // lundi
  const mon = new Date(d.setDate(diff));
  mon.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(mon);
    dt.setDate(mon.getDate() + i);
    return dt;
  });
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function formatWeekLabel(days: Date[]) {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };
  return `${days[0].toLocaleDateString('fr-FR', opts)} – ${days[6].toLocaleDateString('fr-FR', { ...opts, year: 'numeric' })}`;
}

/* ── Heatmap annuelle ── */
function YearHeatmap({ events, onWeekClick, currentWeekStart }: {
  events: PlanningEvent[];
  onWeekClick: (date: Date) => void;
  currentWeekStart: Date;
}) {
  const now = new Date();
  const year = now.getFullYear();

  const months = useMemo(() => {
    const cur = getWeekDays(new Date(year, 0, 1))[0];
    const arr: { month: number; weeks: Date[][] }[] = [];
    let currentMonth = -1;
    let monthData: { month: number; weeks: Date[][] } | null = null;
    for (let w = 0; w < 53; w++) {
      const week = getWeekDays(cur);
      const m = week[0].getMonth();
      if (m !== currentMonth) {
        if (monthData) arr.push(monthData);
        monthData = { month: m, weeks: [] };
        currentMonth = m;
      }
      monthData!.weeks.push(week);
      cur.setDate(cur.getDate() + 7);
    }
    if (monthData) arr.push(monthData);
    return arr;
  }, [year]);

  const eventsByDate = useMemo(() => {
    const map: Record<string, number> = {};
    events.forEach((e) => {
      const key = e.event_day?.slice(0, 10);
      if (key) map[key] = (map[key] ?? 0) + 1;
    });
    return map;
  }, [events]);

  return (
    <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
      <p className="mb-4 text-xs font-bold uppercase tracking-widest text-stone-400">Vue annuelle {year}</p>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {months.map(({ month, weeks }) => (
          <div key={month} className="shrink-0">
            <p className="mb-1.5 text-[10px] font-bold uppercase text-stone-400">{MONTH_FR[month]}</p>
            <div className="flex gap-0.5">
              {weeks.map((week, wi) => {
                const maxEvents = Math.max(...week.map((d) => eventsByDate[dayKey(d)] ?? 0));
                const isCurrent = isSameDay(week[0], currentWeekStart);
                const isPast = week[6] < now;
                return (
                  <button
                    key={wi}
                    onClick={() => onWeekClick(week[0])}
                    title={`Semaine du ${week[0].toLocaleDateString('fr-FR')}`}
                    className={`h-16 w-3.5 rounded-sm transition-all hover:scale-110 ${isCurrent ? 'ring-2 ring-amber-400 ring-offset-1' : ''}`}
                    style={{
                      background: isCurrent ? OR_PR
                        : maxEvents >= 3 ? '#1A1A2E'
                        : maxEvents === 2 ? '#4A7AB5'
                        : maxEvents === 1 ? '#93C5FD'
                        : isPast ? '#F1F5F9' : '#F8FAFC',
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {[
          { color: '#F1F5F9', label: 'Aucun' },
          { color: '#93C5FD', label: '1 événement' },
          { color: '#4A7AB5', label: '2 événements' },
          { color: '#1A1A2E', label: '3+' },
        ].map((l) => (
          <div key={l.label} className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-sm" style={{ background: l.color }} />
            <span className="text-[10px] text-stone-400">{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Carte événement ── */
function EventCard({ event }: { event: PlanningEvent }) {
  const [open, setOpen] = useState(false);
  const colors = eventColors(event.event_type);
  const phases = (event.phases ?? []).filter((p) => p.phase_type !== 'evenement');

  return (
    <div
      className="w-full cursor-pointer overflow-hidden rounded-xl text-left transition-all hover:shadow-md"
      style={{ border: `1.5px solid ${colors.border}` }}
      onClick={() => setOpen((o) => !o)}
    >
      <div className="px-2.5 py-2" style={{ background: colors.bg }}>
        <div className="flex items-center justify-between gap-1">
          <p className="truncate text-xs font-bold leading-tight" style={{ color: colors.text }}>
            {isMatch(event.event_type) ? '🏉' : '📋'} {event.event_name}
          </p>
          {!!event.pax_count && (
            <span className="shrink-0 text-[10px]" style={{ color: colors.text, opacity: 0.7 }}>{event.pax_count}</span>
          )}
        </div>
        {event.start_time && (
          <p className="mt-0.5 text-[10px]" style={{ color: colors.text, opacity: 0.6 }}>⏰ {event.start_time.slice(0, 5)}</p>
        )}
      </div>

      {phases.length > 0 && (
        <div className="divide-y divide-stone-50 bg-white">
          {phases.slice(0, open ? 99 : 2).map((phase, i) => (
            <div key={i} className="flex items-center gap-1.5 px-2.5 py-1.5">
              <span className="text-[10px]">{PHASE_LABELS[phase.phase_type] ?? '📋'}</span>
              <span className="truncate text-[10px] text-stone-600">{phase.label ?? phase.phase_type}</span>
              {phase.regisseur && <span className="ml-auto shrink-0 text-[9px] text-stone-400">{phase.regisseur.split(' ')[0]}</span>}
            </div>
          ))}
        </div>
      )}

      {!!event.nb_agents_total && event.nb_agents_total > 0 && (
        <div className="flex items-center gap-1.5 border-t border-stone-100 bg-stone-50 px-2.5 py-1.5">
          <Users size={10} className="text-stone-400" />
          <span className="text-[10px] text-stone-500">{event.nb_agents_total} agent{event.nb_agents_total > 1 ? 's' : ''}</span>
          {event.regisseurs && <span className="ml-1 truncate text-[10px] text-stone-400">· {event.regisseurs}</span>}
        </div>
      )}
    </div>
  );
}

export function WeeklyPlanner() {
  const [weekStart, setWeekStart] = useState(() => getWeekDays(new Date())[0]);
  const [allEvents, setAllEvents] = useState<PlanningEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void supabase.from('weekly_planning').select('*').then(({ data }) => {
      if (!alive) return;
      setAllEvents((data as PlanningEvent[] | null) ?? []);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart]);
  const weekEvents = useMemo(() => {
    const keys = new Set(weekDays.map(dayKey));
    return allEvents.filter((e) => e.event_day && keys.has(e.event_day.slice(0, 10)));
  }, [allEvents, weekDays]);

  const eventsByDay = useMemo(() => {
    const map: Record<string, PlanningEvent[]> = {};
    weekDays.forEach((d) => { map[dayKey(d)] = []; });
    weekEvents.forEach((e) => {
      const key = e.event_day?.slice(0, 10);
      if (key && map[key]) map[key].push(e);
    });
    return map;
  }, [weekEvents, weekDays]);

  const today = new Date();
  const shiftWeek = (delta: number) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + delta * 7);
    setWeekStart(d);
  };
  const seminaireCount = weekEvents.filter((e) => !isMatch(e.event_type)).length;

  return (
    <div className="space-y-4">
      <YearHeatmap events={allEvents} onWeekClick={setWeekStart} currentWeekStart={weekStart} />

      <div className="overflow-hidden rounded-2xl border border-stone-100 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-stone-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <button onClick={() => shiftWeek(-1)} className="flex h-8 w-8 items-center justify-center rounded-xl border border-stone-200 transition-colors hover:bg-stone-50">
              <ChevronLeft size={16} className="text-stone-600" />
            </button>
            <div>
              <p className="text-base font-black text-stone-900">{formatWeekLabel(weekDays)}</p>
              <p className="text-xs text-stone-400">{weekEvents.length} événement{weekEvents.length > 1 ? 's' : ''} cette semaine</p>
            </div>
            <button onClick={() => shiftWeek(1)} className="flex h-8 w-8 items-center justify-center rounded-xl border border-stone-200 transition-colors hover:bg-stone-50">
              <ChevronRight size={16} className="text-stone-600" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            {!isSameDay(weekStart, getWeekDays(today)[0]) && (
              <button onClick={() => setWeekStart(getWeekDays(new Date())[0])} className="rounded-xl border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50">
                Aujourd'hui
              </button>
            )}
            <div className="hidden items-center gap-2 sm:flex">
              <div className="flex items-center gap-1.5"><div className="h-3 w-3 rounded-sm bg-stone-900" /><span className="text-[10px] text-stone-400">Match</span></div>
              <div className="flex items-center gap-1.5"><div className="h-3 w-3 rounded-sm border border-blue-300 bg-blue-100" /><span className="text-[10px] text-stone-400">Séminaire</span></div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-7 divide-x divide-stone-100">
          {weekDays.map((day, i) => {
            const isToday = isSameDay(day, today);
            const dayEvts = eventsByDay[dayKey(day)] ?? [];
            return (
              <div key={i} className="min-w-0">
                <div className={`border-b border-stone-100 px-2 py-2 text-center ${isToday ? 'bg-stone-900' : 'bg-stone-50'}`}>
                  <p className={`text-[10px] font-bold uppercase tracking-wide ${isToday ? 'text-white/60' : 'text-stone-400'}`}>{DAYS_FR[i]}</p>
                  <p className={`mt-0.5 text-base font-black ${isToday ? 'text-white' : 'text-stone-800'}`}>{day.getDate()}</p>
                  {dayEvts.length > 0 && (
                    <div className="mt-1 flex justify-center gap-0.5">
                      {dayEvts.slice(0, 3).map((_, j) => <div key={j} className={`h-1 w-1 rounded-full ${isToday ? 'bg-white/60' : 'bg-amber-400'}`} />)}
                    </div>
                  )}
                </div>
                <div className="min-h-[120px] space-y-1.5 p-1.5">
                  {loading ? (
                    <div className="h-12 animate-pulse rounded-lg bg-stone-100" />
                  ) : dayEvts.length === 0 ? (
                    <div className="flex h-full items-center justify-center"><p className="text-[10px] text-stone-200">·</p></div>
                  ) : (
                    dayEvts.map((evt) => <EventCard key={evt.event_id} event={evt} />)
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {weekEvents.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-50 px-5 py-3">
            <div className="flex items-center gap-4 text-xs text-stone-500">
              <span>🏉 {weekEvents.filter((e) => isMatch(e.event_type)).length} match(s)</span>
              <span>📋 {seminaireCount} séminaire(s)</span>
              <span>👥 {weekEvents.reduce((s, e) => s + (e.nb_agents_total ?? 0), 0)} agents mobilisés</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-stone-400">
              <div className="h-3 w-3 rounded-sm" style={{ background: PHASE_COLORS.mise_en_place }} /><span>Mise en place</span>
              <div className="ml-2 h-3 w-3 rounded-sm" style={{ background: PHASE_COLORS.demontage }} /><span>Démontage</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
