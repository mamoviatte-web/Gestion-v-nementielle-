/**
 * HRPreplanPage (ROLE_STADE) — planning RH d'un match, rendu vivant par famille.
 *
 * Sélecteur d'événement + compteur (agents planifiés / pointés) + verrouillage
 * (« validé » → transmis aux responsables de zone via zone_get_preplan_staff).
 * Le détail par espace et par pôle hors-restauration (saisie, édition des heures
 * et de la facturation forfait/horaire, déplacement, retrait) est géré par
 * RhPlanningFamilyBoard (source unique rh_board / rh_planning_board).
 * Route : /admin/rh/preplan
 */

import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { RhPlanningFamilyBoard } from '@/components/rh/RhPlanningFamilyBoard';

interface PreplanAgent { status: string }
interface PreplanSpace { space_id: string; agents: PreplanAgent[]; nb_planifies: number; nb_pointes: number }
interface Preplan { success: boolean; total: number; by_space: PreplanSpace[] }
interface EventOption { event_id: string; event_name: string; event_date: string; event_type: string; status: string }

export default function HRPreplanPage() {
  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedEvent, setSelectedEvent] = useState('');
  const [preplan, setPreplan] = useState<Preplan | null>(null);
  const [loading, setLoading] = useState(false);
  const [locking, setLocking] = useState(false);
  const [hrName, setHrName] = useState('');
  const [refreshSignal, setRefreshSignal] = useState(0);
  const bump = () => setRefreshSignal((n) => n + 1);

  useEffect(() => {
    void supabase.from('events').select('event_id, event_name, event_date, event_type, status')
      .in('status', ['brouillon', 'préparé', 'en_cours']).order('event_date')
      .then(({ data }) => {
        const evs = (data ?? []) as EventOption[];
        setEvents(evs);
        if (evs.length > 0) setSelectedEvent(evs[0].event_id);
      });
  }, []);

  async function reload() {
    if (!selectedEvent) return;
    const { data } = await supabase.rpc('hr_get_preplan', { p_event_id: selectedEvent });
    const r = data as Preplan | null;
    if (r?.success) setPreplan(r);
  }

  useEffect(() => {
    if (!selectedEvent) return;
    setLoading(true);
    void supabase.rpc('hr_get_preplan', { p_event_id: selectedEvent }).then(({ data }) => {
      const r = data as Preplan | null;
      if (r?.success) setPreplan(r);
      setLoading(false);
    });
  }, [selectedEvent]);

  const totalPlanifies = preplan?.by_space?.reduce((s, sp) => s + (sp.nb_planifies ?? 0), 0) ?? 0;
  const totalPointes = preplan?.by_space?.reduce((s, sp) => s + (sp.nb_pointes ?? 0), 0) ?? 0;
  const isLocked = preplan?.by_space?.some((sp) => sp.agents?.some((a) => a.status !== 'planifié')) ?? false;

  async function lockPreplan() {
    const evName = events.find((e) => e.event_id === selectedEvent)?.event_name ?? '';
    if (!window.confirm(`Verrouiller la liste RH pour « ${evName} » ?\n\n${totalPlanifies} agents seront transmis aux responsables de zone.\nVous ne pourrez plus modifier la liste après cette action.`)) return;
    setLocking(true);
    const { data } = await supabase.rpc('hr_lock_preplan', { p_event_id: selectedEvent, p_hr_name: hrName || 'RH' });
    setLocking(false);
    const r = data as { success?: boolean; agents_locked?: number } | null;
    if (r?.success) {
      alert(`✅ ${r.agents_locked} agent(s) verrouillés et transmis aux responsables de zone.`);
      await reload();
      bump();
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="h-8 w-1.5 rounded-full bg-amber-500" />
            <h1 className="text-2xl font-black text-stone-900">Planification RH Match</h1>
          </div>
          <p className="ml-3.5 mt-1 text-sm text-stone-400">Préparez le personnel par espace et par pôle avant le jour J</p>
        </div>
        <input value={hrName} onChange={(e) => setHrName(e.target.value)} placeholder="Votre nom (Responsable RH)" className="min-w-[220px] rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
      </div>

      {events.length === 0 ? (
        <div className="rounded-2xl border border-stone-200 bg-white p-10 text-center text-sm text-stone-400">Aucun événement ouvert à planifier (brouillon / préparé / en cours).</div>
      ) : (
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <label className="mb-2 block text-sm font-bold text-stone-700">Événement à planifier</label>
          <select value={selectedEvent} onChange={(e) => setSelectedEvent(e.target.value)} className="w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-amber-400">
            {events.map((e) => (
              <option key={e.event_id} value={e.event_id}>
                {e.event_type === 'match' ? '🏉' : '📋'} {e.event_name} — {new Date(e.event_date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}{e.status === 'en_cours' ? ' 🔴 EN COURS' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {preplan && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-3">
            <div className="rounded-xl border border-stone-200 bg-white px-5 py-3 text-center">
              <p className="text-2xl font-black text-stone-900">{totalPlanifies}</p>
              <p className="text-xs text-stone-400">agents planifiés</p>
            </div>
            <div className={`rounded-xl border px-5 py-3 text-center ${totalPointes === totalPlanifies && totalPlanifies > 0 ? 'border-green-300 bg-green-50' : 'border-stone-200 bg-white'}`}>
              <p className="text-2xl font-black text-stone-900">{totalPointes}</p>
              <p className="text-xs text-stone-400">pointés</p>
            </div>
            {isLocked && (
              <div className="flex items-center gap-2 rounded-xl border border-green-300 bg-green-50 px-4 py-3">
                <Lock size={16} className="text-green-600" />
                <span className="text-sm font-bold text-green-700">Liste verrouillée · transmise aux zones</span>
              </div>
            )}
          </div>
          {!isLocked && totalPlanifies > 0 && (
            <button onClick={() => void lockPreplan()} disabled={locking || !hrName.trim()} className="flex items-center gap-2 rounded-xl bg-stone-900 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-stone-700 disabled:opacity-40">
              <Lock size={15} /> {locking ? 'Verrouillage…' : `Verrouiller et transmettre (${totalPlanifies})`}
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-stone-100" />)}</div>
      ) : selectedEvent ? (
        <RhPlanningFamilyBoard
          eventId={selectedEvent}
          refreshSignal={refreshSignal}
          onExternalChange={() => void reload()}
        />
      ) : null}
    </div>
  );
}
