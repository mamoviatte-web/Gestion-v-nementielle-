/**
 * WeeklyPlanner — planning hebdomadaire dynamique (remplace le tableau Excel).
 *
 * Les cellules quotidiennes sont alimentées par la RPC `planning_items` : chaque
 * activité (événement + phases opérationnelles J-3/J-2/J-1, montage, RH…) est
 * placée à SA propre date, plus d'empilement sous le jour du match. La vue
 * `weekly_planning` reste utilisée pour la heatmap annuelle.
 *
 * Clic sur un item → drawer de détail/édition (phase_upsert/delete/validate).
 * « + » par jour → création d'une tâche pré-datée. RG-003 : écritures réservées
 * ROLE_STADE (garde base sur les RPC phase_*).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Users, Plus, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { isMatch } from '@/lib/eventUtils';
import {
  PlanningItemDrawer, PHASE_LABEL,
  type PlanningItem, type EventOpt, type SpaceOpt,
} from '@/components/dashboard/PlanningItemDrawer';

const DAYS_FR = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MONTH_FR = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
const OR_PR = '#C9A646';

/** Vue heatmap : événement par jour (source weekly_planning). */
interface PlanningEvent {
  event_id: string;
  event_day: string | null;
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

/* ── Heatmap annuelle (source weekly_planning) ── */
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

/* ── Carte événement (item kind='event') ── */
function EventItemCard({ item, onClick }: { item: PlanningItem; onClick: () => void }) {
  const match = isMatch(item.event_type);
  const colors = match
    ? { bg: '#1A1A2E', text: '#FFFFFF', border: '#1A1A2E' }
    : { bg: '#EFF6FF', text: '#1D4ED8', border: '#93C5FD' };
  return (
    <button
      onClick={onClick}
      className="w-full overflow-hidden rounded-xl text-left transition-all hover:shadow-md"
      style={{ border: `1.5px solid ${colors.border}` }}
    >
      <div className="px-2.5 py-2" style={{ background: colors.bg }}>
        <p className="truncate text-xs font-bold leading-tight" style={{ color: colors.text }}>
          {match ? '🏉' : '📋'} {item.event_name}
        </p>
        {item.start_time && (
          <p className="mt-0.5 text-[10px]" style={{ color: colors.text, opacity: 0.65 }}>⏰ {item.start_time.slice(0, 5)}</p>
        )}
      </div>
    </button>
  );
}

/* ── Puce tâche (item kind='phase') ── */
function TaskChip({ item, onClick }: { item: PlanningItem; onClick: () => void }) {
  const color = item.color ?? '#6B7280';
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-lg border border-stone-100 bg-white px-2 py-1.5 text-left transition-all hover:shadow-sm ${item.is_validated ? 'opacity-70' : ''}`}
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <div className="flex items-center gap-1">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        <span className="truncate text-[11px] font-semibold text-stone-700">{item.label ?? PHASE_LABEL[item.phase_type]}</span>
        {item.is_validated && <Check size={11} className="ml-auto shrink-0 text-emerald-500" />}
      </div>
      <p className="mt-0.5 truncate text-[9px] text-stone-400">
        {PHASE_LABEL[item.phase_type] ?? item.phase_type}
        {item.start_time && ` · ${item.start_time.slice(0, 5)}${item.end_time ? `–${item.end_time.slice(0, 5)}` : ''}`}
        {item.regisseur && ` · ${item.regisseur}`}
        {!!item.nb_personnes && ` · 👥${item.nb_personnes}`}
      </p>
    </button>
  );
}

export function WeeklyPlanner() {
  const [weekStart, setWeekStart] = useState(() => getWeekDays(new Date())[0]);
  const [heatmapEvents, setHeatmapEvents] = useState<PlanningEvent[]>([]);
  const [items, setItems] = useState<PlanningItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<EventOpt[]>([]);
  const [spaces, setSpaces] = useState<SpaceOpt[]>([]);
  const [drawer, setDrawer] = useState<{ item: PlanningItem | null; date?: string; eventId?: string } | null>(null);

  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart]);

  // Heatmap annuelle (weekly_planning) + référentiels (événements, espaces) — une fois.
  useEffect(() => {
    let alive = true;
    void supabase.from('weekly_planning').select('event_id, event_day').then(({ data }) => {
      if (alive) setHeatmapEvents((data as PlanningEvent[] | null) ?? []);
    });
    // Menu « Événement de rattachement » : uniquement les événements à venir et
    // non clôturés (vue dérivée — se met à jour automatiquement). Le filtrage est
    // porté par la vue, pas par le front.
    void supabase.from('events_selectable_for_tasks').select('event_id, event_name, event_date, event_type')
      .order('event_date').then(({ data }) => {
        if (alive) setEvents((data as EventOpt[] | null) ?? []);
      });
    void supabase.from('spaces').select('space_id, space_name').eq('active', true).order('space_name').then(({ data }) => {
      if (alive) setSpaces((data as SpaceOpt[] | null) ?? []);
    });
    return () => { alive = false; };
  }, []);

  // Items datés de la semaine visible.
  const loadItems = useCallback(async () => {
    const from = dayKey(weekDays[0]);
    const to = dayKey(weekDays[6]);
    const { data } = await supabase.rpc('planning_items', { p_from: from, p_to: to });
    setItems((data as PlanningItem[] | null) ?? []);
    setLoading(false);
  }, [weekDays]);

  useEffect(() => {
    setLoading(true);
    void loadItems();
  }, [loadItems]);

  const byDay = useMemo(() => {
    const map: Record<string, PlanningItem[]> = {};
    weekDays.forEach((d) => { map[dayKey(d)] = []; });
    for (const it of items) (map[it.date] ??= []).push(it);
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'event' ? -1 : 1;
        return (a.start_time ?? '99').localeCompare(b.start_time ?? '99');
      });
    }
    return map;
  }, [items, weekDays]);

  const today = new Date();
  const shiftWeek = (delta: number) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + delta * 7);
    setWeekStart(d);
  };

  // Événement de rattachement par défaut pour une création dans cette semaine.
  const defaultEventId = items.find((i) => i.kind === 'event')?.event_id ?? items[0]?.event_id ?? events[0]?.event_id;

  const nbEvents = items.filter((i) => i.kind === 'event').length;
  const nbMatchs = items.filter((i) => i.kind === 'event' && isMatch(i.event_type)).length;
  const nbSemi = items.filter((i) => i.kind === 'event' && !isMatch(i.event_type)).length;
  const nbAgents = items.reduce((s, i) => s + (i.kind === 'phase' ? i.nb_personnes ?? 0 : 0), 0);

  return (
    <div className="space-y-4">
      <YearHeatmap events={heatmapEvents} onWeekClick={setWeekStart} currentWeekStart={weekStart} />

      <div className="overflow-hidden rounded-2xl border border-stone-100 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-stone-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <button onClick={() => shiftWeek(-1)} className="flex h-8 w-8 items-center justify-center rounded-xl border border-stone-200 transition-colors hover:bg-stone-50">
              <ChevronLeft size={16} className="text-stone-600" />
            </button>
            <div>
              <p className="text-base font-black text-stone-900">{formatWeekLabel(weekDays)}</p>
              <p className="text-xs text-stone-400">{nbEvents} événement{nbEvents > 1 ? 's' : ''} cette semaine</p>
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
          </div>
        </div>

        <div className="grid grid-cols-7 divide-x divide-stone-100">
          {weekDays.map((day, i) => {
            const isToday = isSameDay(day, today);
            const key = dayKey(day);
            const dayItems = byDay[key] ?? [];
            return (
              <div key={i} className="group/day min-w-0">
                <div className={`flex items-center justify-between border-b border-stone-100 px-2 py-2 ${isToday ? 'bg-stone-900' : 'bg-stone-50'}`}>
                  <div className="flex-1 text-center">
                    <p className={`text-[10px] font-bold uppercase tracking-wide ${isToday ? 'text-white/60' : 'text-stone-400'}`}>{DAYS_FR[i]}</p>
                    <p className={`mt-0.5 text-base font-black ${isToday ? 'text-white' : 'text-stone-800'}`}>{day.getDate()}</p>
                  </div>
                  <button
                    onClick={() => setDrawer({ item: null, date: key, eventId: defaultEventId })}
                    title="Ajouter une tâche"
                    className={`flex h-6 w-6 items-center justify-center rounded-lg opacity-0 transition-opacity group-hover/day:opacity-100 ${isToday ? 'text-white/70 hover:bg-white/10' : 'text-stone-400 hover:bg-stone-200'}`}
                  >
                    <Plus size={14} />
                  </button>
                </div>
                <div className="min-h-[120px] space-y-1.5 p-1.5">
                  {loading ? (
                    <div className="h-12 animate-pulse rounded-lg bg-stone-100" />
                  ) : dayItems.length === 0 ? (
                    <button
                      onClick={() => setDrawer({ item: null, date: key, eventId: defaultEventId })}
                      className="flex h-full min-h-[100px] w-full items-center justify-center rounded-lg text-stone-200 transition-colors hover:bg-stone-50 hover:text-stone-300"
                    >
                      <Plus size={16} />
                    </button>
                  ) : (
                    dayItems.map((it) =>
                      it.kind === 'event' ? (
                        <EventItemCard key={it.id} item={it} onClick={() => setDrawer({ item: it })} />
                      ) : (
                        <TaskChip key={it.id} item={it} onClick={() => setDrawer({ item: it })} />
                      ),
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-50 px-5 py-3">
          <div className="flex items-center gap-4 text-xs text-stone-500">
            <span>🏉 {nbMatchs} match(s)</span>
            <span>📋 {nbSemi} séminaire(s)</span>
            <span className="flex items-center gap-1"><Users size={12} /> {nbAgents} agents mobilisés</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-stone-400">
            {[
              { c: '#F59E0B', l: 'Mise en place' }, { c: '#EC4899', l: 'Démontage' },
              { c: '#10B981', l: 'Livraison' }, { c: '#2F6FED', l: 'RH' }, { c: '#0E7C7B', l: 'Nettoyage' },
            ].map((x) => (
              <span key={x.l} className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: x.c }} />{x.l}
              </span>
            ))}
          </div>
        </div>
      </div>

      {drawer && (
        <PlanningItemDrawer
          item={drawer.item}
          defaultDate={drawer.date}
          defaultEventId={drawer.eventId}
          events={events}
          spaces={spaces}
          onClose={() => setDrawer(null)}
          onSaved={() => void loadItems()}
        />
      )}
    </div>
  );
}
