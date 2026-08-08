/**
 * HRPreplanPage (ROLE_STADE) — pré-planification RH d'un match.
 * Le responsable RH ajoute les agents par espace, puis verrouille la liste
 * (« validé ») → elle bascule dans le tableau de bord de chaque responsable
 * de zone (RPC zone_get_preplan_staff). Route : /admin/rh/preplan
 */

import { useEffect, useState } from 'react';
import { Lock, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { RhPlanningFamilyBoard } from '@/components/rh/RhPlanningFamilyBoard';

const ROLES = ['Serveur', 'Chef de rang', 'Barman', 'Agent de sécurité', 'Runner', 'Hôte / Hôtesse', 'Responsable espace', 'Autre'];
const ROLE_ICONS: Record<string, string> = {
  Serveur: '🍽️', 'Chef de rang': '⭐', Barman: '🍺', 'Agent de sécurité': '🔒',
  Runner: '🏃', 'Hôte / Hôtesse': '🤝', 'Responsable espace': '👑', Autre: '👤',
};

interface PreplanAgent {
  id: string; nom: string; prenom: string; role: string;
  planned_start: string | null; planned_end: string | null; planned_hours: number | null;
  hourly_rate: number | null; status: string; note: string | null;
}
interface PreplanSpace {
  space_id: string; space_name: string; service_type: string | null;
  agents: PreplanAgent[]; nb_planifies: number; nb_pointes: number;
}
interface Preplan { success: boolean; total: number; by_space: PreplanSpace[] }
interface EventOption { event_id: string; event_name: string; event_date: string; event_type: string; status: string }
interface NewAgent { nom: string; prenom: string; role: string; start: string; end: string | null; rate: number | null }

function AddAgentForm({ onAdd }: { onAdd: (a: NewAgent) => void }) {
  const [nom, setNom] = useState('');
  const [prenom, setPrenom] = useState('');
  const [role, setRole] = useState('Serveur');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [rate, setRate] = useState('');
  const [open, setOpen] = useState(false);

  function handleAdd() {
    if (!nom.trim() || !prenom.trim() || !start) return;
    onAdd({ nom, prenom, role, start, end: end || null, rate: rate ? parseFloat(rate) : null });
    setNom(''); setPrenom(''); setStart(''); setEnd(''); setRate(''); setOpen(false);
  }

  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-stone-200 py-3 text-sm font-medium text-stone-400 transition-all hover:border-amber-400 hover:bg-amber-50 hover:text-amber-600">
        <Plus size={15} /> Ajouter un agent
      </button>
    );

  return (
    <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="text-sm font-bold text-amber-800">Nouvel agent</p>
      <div className="grid grid-cols-2 gap-2">
        <input value={prenom} onChange={(e) => setPrenom(e.target.value)} placeholder="Prénom *" autoFocus className="rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
        <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="NOM *" className="rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-amber-400" />
      </div>
      <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
        {ROLES.map((r) => <option key={r} value={r}>{ROLE_ICONS[r]} {r}</option>)}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs text-stone-500">Arrivée prévue *</label>
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="min-h-[44px] w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-400" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-stone-500">Fin prévue</label>
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="min-h-[44px] w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-400" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input type="number" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Taux €/h" min={0} step={0.5} className="flex-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
        <span className="text-xs text-stone-400">€/h (optionnel)</span>
      </div>
      <div className="flex gap-2">
        <button onClick={() => setOpen(false)} className="flex-1 rounded-xl border border-stone-200 py-2.5 text-sm text-stone-600">Annuler</button>
        <button onClick={handleAdd} disabled={!nom.trim() || !prenom.trim() || !start} className="flex-1 rounded-xl bg-amber-500 py-2.5 text-sm font-bold text-white disabled:opacity-40">Ajouter</button>
      </div>
    </div>
  );
}

const STATUS_META: Record<string, { badge: string; card: string }> = {
  pointé: { badge: 'bg-green-200 text-green-800', card: 'bg-green-50 border-green-200' },
  absent: { badge: 'bg-red-200 text-red-800', card: 'bg-red-50 border-red-200' },
  validé: { badge: 'bg-blue-200 text-blue-800', card: 'bg-blue-50 border-blue-200' },
  présent: { badge: 'bg-amber-200 text-amber-800', card: 'bg-amber-50 border-amber-200' },
  planifié: { badge: 'bg-stone-200 text-stone-600', card: 'bg-stone-50 border-stone-200' },
};
const STATUS_LABEL: Record<string, string> = {
  pointé: '✅ Pointé', absent: '❌ Absent', validé: '🔒 Validé', présent: '🟡 Présent', planifié: '📋 Planifié',
};

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

  async function addAgent(spaceId: string, agent: NewAgent) {
    const { data } = await supabase.rpc('hr_upsert_agent', {
      p_event_id: selectedEvent, p_space_id: spaceId, p_agent_id: null,
      p_nom: agent.nom, p_prenom: agent.prenom, p_role: agent.role,
      p_start: agent.start, p_end: agent.end, p_rate: agent.rate, p_created_by: hrName || 'RH',
    });
    if ((data as { success?: boolean } | null)?.success) {
      await reload();
      bump();
    }
  }

  async function deleteAgent(agentId: string) {
    if (isLocked) return;
    await supabase.from('event_staff_preplan').delete().eq('id', agentId);
    await reload();
    bump();
  }

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
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="h-8 w-1.5 rounded-full bg-amber-500" />
            <h1 className="text-2xl font-black text-stone-900">Planification RH Match</h1>
          </div>
          <p className="ml-3.5 mt-1 text-sm text-stone-400">Préparez le personnel par espace avant le jour J</p>
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
          renderSpaceDetail={({ id, nom }) => {
            const space = preplan?.by_space?.find((s) => s.space_id === id);
            if (!space) return <p className="text-sm text-stone-400">Aucun agent pour {nom}.</p>;
            return (
              <div className="space-y-2">
                {(space.agents ?? []).map((agent) => {
                  const meta = STATUS_META[agent.status] ?? STATUS_META.planifié;
                  return (
                    <div key={agent.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${meta.card}`}>
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-stone-800 text-xs font-black text-white">{agent.prenom?.[0]}{agent.nom?.[0]}</div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-stone-800">{agent.prenom} {agent.nom}</p>
                        <p className="text-xs text-stone-400">{ROLE_ICONS[agent.role]} {agent.role} · {agent.planned_start?.slice(0, 5)}{agent.planned_end ? ` → ${agent.planned_end.slice(0, 5)}` : ''}{agent.planned_hours ? ` (${agent.planned_hours}h)` : ''}</p>
                      </div>
                      <span className={`shrink-0 rounded-lg px-2 py-0.5 text-xs font-bold ${meta.badge}`}>{STATUS_LABEL[agent.status] ?? agent.status}</span>
                      {!isLocked && (
                        <button onClick={() => void deleteAgent(agent.id)} className="p-1 text-stone-300 transition-colors hover:text-red-400"><Trash2 size={13} /></button>
                      )}
                    </div>
                  );
                })}
                {!isLocked && <AddAgentForm onAdd={(a) => void addAgent(id, a)} />}
              </div>
            );
          }}
        />
      ) : null}
    </div>
  );
}
