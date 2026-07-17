/**
 * ZoneStaffHoursPage — recensement RH d'un espace (flux token match).
 * Le responsable ajoute toute son équipe (nom, rôle, arrivée/départ réels,
 * pause), les heures sont calculées (passage minuit géré) et alimentent les
 * charges RH de l'événement. Route : /zone/match/:sessionToken/rh
 */

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, Plus, Trash2, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useMatchSession } from '@/hooks/useMatchSession';
import { MatchZoneHeader } from '@/components/zone/MatchZoneHeader';

const ROLES = ['Serveur', 'Chef de rang', 'Barman', 'Agent de sécurité', 'Runner', 'Hôte / Hôtesse', 'Responsable espace', 'Autre'];

interface StaffMember {
  id: string;
  staff_name: string;
  role: string;
  arrival_time: string | null;
  departure_time: string | null;
  break_minutes: number;
  hours_worked: number | null;
  rh_cost: number | null;
  confirmed_by_staff: boolean;
  confirmed_by_manager: boolean;
  notes: string | null;
}

function calcHours(arrival?: string | null, departure?: string | null, breakMin = 0): number | null {
  if (!arrival || !departure) return null;
  const toMin = (t: string) => {
    const [h, m] = t.slice(0, 5).split(':').map(Number);
    return h * 60 + m;
  };
  let diff = toMin(departure) - toMin(arrival);
  if (diff < 0) diff += 24 * 60;
  return Math.round(((diff - breakMin) / 60) * 100) / 100;
}
function formatHours(h: number | null): string {
  if (h === null || h <= 0) return '—';
  const hrs = Math.floor(h);
  const min = Math.round((h - hrs) * 60);
  return min > 0 ? `${hrs}h${String(min).padStart(2, '0')}` : `${hrs}h`;
}

function AddStaffForm({ token, onSaved }: { token: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('Serveur');
  const [arrival, setArrival] = useState('');
  const [departure, setDeparture] = useState('');
  const [breakMin, setBreakMin] = useState(0);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim() || !arrival) return;
    setSaving(true);
    await supabase.rpc('upsert_zone_staff_member', {
      p_token: token,
      p_staff_id: null,
      p_staff_name: name.trim(),
      p_role: role,
      p_arrival_time: arrival,
      p_departure_time: departure || null,
      p_break_minutes: breakMin,
    });
    setName('');
    setArrival('');
    setDeparture('');
    setBreakMin(0);
    setSaving(false);
    setOpen(false);
    onSaved();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-stone-300 py-3.5 text-sm font-medium text-stone-500 transition-colors hover:border-amber-400 hover:bg-amber-50 hover:text-amber-600"
      >
        <Plus size={16} /> Ajouter un membre de l'équipe
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="text-sm font-semibold text-amber-800">Nouveau membre de l'équipe</p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom Prénom *" autoFocus className="w-full rounded-xl border border-stone-200 bg-white px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-amber-400" />
      <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
        {ROLES.map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs text-stone-500">Heure d'arrivée *</label>
          <input type="time" value={arrival} onChange={(e) => setArrival(e.target.value)} className="min-h-[48px] w-full rounded-xl border border-stone-200 bg-white px-3 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-stone-500">Heure de départ</label>
          <input type="time" value={departure} onChange={(e) => setDeparture(e.target.value)} className="min-h-[48px] w-full rounded-xl border border-stone-200 bg-white px-3 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <label className="shrink-0 text-xs text-stone-500">Pause (min)</label>
        <input type="number" min={0} max={120} step={15} value={breakMin || ''} onChange={(e) => setBreakMin(parseInt(e.target.value) || 0)} placeholder="0" className="w-24 rounded-xl border border-stone-200 bg-white px-3 py-2 text-center focus:outline-none focus:ring-2 focus:ring-amber-400" />
        <span className="text-xs text-stone-400">déduits des heures</span>
      </div>
      <div className="flex gap-2">
        <button onClick={() => setOpen(false)} className="flex-1 rounded-xl border border-stone-200 py-3 text-sm font-medium text-stone-600">Annuler</button>
        <button onClick={() => void handleSave()} disabled={!name.trim() || !arrival || saving} className="flex-1 rounded-xl bg-stone-900 py-3 text-sm font-bold text-white disabled:opacity-40">{saving ? 'Ajout…' : 'Ajouter'}</button>
      </div>
    </div>
  );
}

function StaffCard({ agent, token, onChange }: { agent: StaffMember; token: string; onChange: () => void }) {
  const [editDep, setEditDep] = useState(agent.departure_time?.slice(0, 5) ?? '');
  const hours = calcHours(agent.arrival_time, editDep || agent.departure_time, agent.break_minutes);
  const isComplete = !!agent.departure_time && agent.confirmed_by_staff && agent.confirmed_by_manager;

  async function saveDeparture() {
    if (!editDep || editDep === agent.departure_time?.slice(0, 5)) return;
    await supabase.rpc('upsert_zone_staff_member', {
      p_token: token,
      p_staff_id: agent.id,
      p_staff_name: agent.staff_name,
      p_role: agent.role,
      p_arrival_time: agent.arrival_time,
      p_departure_time: editDep,
      p_break_minutes: agent.break_minutes,
    });
    onChange();
  }
  async function toggle(type: 'staff' | 'manager') {
    await supabase.rpc('confirm_zone_staff_hour', { p_token: token, p_staff_id: agent.id, p_type: type });
    onChange();
  }
  async function remove() {
    if (!confirm(`Supprimer ${agent.staff_name} de la liste ?`)) return;
    await supabase.rpc('delete_zone_staff_member', { p_token: token, p_staff_id: agent.id });
    onChange();
  }

  const durBg = hours === null ? 'bg-stone-50' : hours < 2 ? 'bg-red-50' : hours < 4 ? 'bg-amber-50' : 'bg-green-50';
  const durText = hours === null ? 'text-stone-300' : hours < 2 ? 'text-red-600' : hours < 4 ? 'text-amber-600' : 'text-green-700';

  return (
    <div className={`space-y-3 rounded-2xl border-2 bg-white p-4 ${isComplete ? 'border-green-300' : 'border-stone-200'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${isComplete ? 'bg-green-100 text-green-700' : 'bg-stone-100 text-stone-700'}`}>
            {agent.staff_name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <div>
            <p className="font-bold text-stone-900">{agent.staff_name}</p>
            <p className="text-xs text-stone-400">{agent.role}</p>
          </div>
        </div>
        <button onClick={() => void remove()} className="p-1 text-stone-300 transition-colors hover:text-red-400">
          <Trash2 size={15} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-stone-50 py-2.5">
          <p className="text-xs text-stone-400">Arrivée</p>
          <p className="text-base font-bold text-stone-800">{agent.arrival_time?.slice(0, 5) ?? '—'}</p>
        </div>
        <div className={`rounded-xl px-1 py-1.5 ${editDep ? 'bg-blue-50' : 'bg-stone-50'}`}>
          <p className="text-xs text-stone-400">Départ réel</p>
          <input type="time" value={editDep} onChange={(e) => setEditDep(e.target.value)} onBlur={() => void saveDeparture()} className="min-h-[28px] w-full border-0 bg-transparent text-center text-sm font-bold text-stone-800 focus:outline-none" />
        </div>
        <div className={`rounded-xl py-2.5 ${durBg}`}>
          <p className="text-xs text-stone-400">Durée</p>
          <p className={`text-base font-bold ${durText}`}>{formatHours(hours)}</p>
        </div>
      </div>

      {agent.break_minutes > 0 && <p className="text-center text-xs text-stone-400">Pause déduite : {agent.break_minutes} min</p>}

      <div className="grid grid-cols-2 gap-2">
        {(['staff', 'manager'] as const).map((t) => {
          const on = t === 'staff' ? agent.confirmed_by_staff : agent.confirmed_by_manager;
          return (
            <button
              key={t}
              onClick={() => void toggle(t)}
              className={`flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-xs font-semibold transition-all ${on ? 'border-green-500 bg-green-500 text-white' : 'border-stone-200 bg-stone-50 text-stone-600 hover:border-green-300'}`}
            >
              <CheckCircle size={13} />
              {t === 'staff' ? (on ? '✓ Agent ok' : 'Agent ok ?') : on ? '✓ Responsable ok' : 'Responsable ok ?'}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface PreplanStaff {
  id: string; nom: string; prenom: string; full_name: string; role: string;
  planned_start: string | null; planned_end: string | null; status: string;
}

/** Carte d'un agent pré-planifié par la RH — pointage terrain (zone manager). */
function PreplanAgentCard({ agent, token, onUpdate }: { agent: PreplanStaff; token: string; onUpdate: () => void }) {
  const [actualStart, setActualStart] = useState(agent.planned_start?.slice(0, 5) ?? '');
  const [actualEnd, setActualEnd] = useState('');
  const [saving, setSaving] = useState(false);
  const isDone = agent.status === 'pointé' || agent.status === 'absent';

  async function pointage(status: 'présent' | 'absent' | 'pointé') {
    setSaving(true);
    await supabase.rpc('zone_pointage_agent', {
      p_token: token, p_agent_id: agent.id, p_status: status,
      p_start: status !== 'absent' ? actualStart : null,
      p_end: status === 'pointé' ? actualEnd : null,
    });
    setSaving(false);
    onUpdate();
  }

  return (
    <div className={`space-y-3 rounded-2xl border-2 bg-white p-4 ${agent.status === 'pointé' ? 'border-green-300' : agent.status === 'absent' ? 'border-red-200 opacity-60' : 'border-stone-200'}`}>
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-stone-900 text-sm font-black text-white">{agent.prenom?.[0]}{agent.nom?.[0]}</div>
        <div className="flex-1">
          <p className="font-bold text-stone-900">{agent.prenom} {agent.nom}</p>
          <p className="text-xs text-stone-400">{agent.role} · prévu {agent.planned_start?.slice(0, 5)}{agent.planned_end ? `→${agent.planned_end.slice(0, 5)}` : ''}</p>
        </div>
        {isDone && <span className={`rounded-lg px-2 py-1 text-xs font-bold ${agent.status === 'pointé' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>{agent.status === 'pointé' ? '✅ Pointé' : '❌ Absent'}</span>}
      </div>
      {!isDone && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-stone-400">Arrivée réelle</label>
              <input type="time" value={actualStart} onChange={(e) => setActualStart(e.target.value)} className="min-h-[44px] w-full rounded-xl border border-stone-200 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-green-400" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-400">Départ réel</label>
              <input type="time" value={actualEnd} onChange={(e) => setActualEnd(e.target.value)} className="min-h-[44px] w-full rounded-xl border border-stone-200 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-green-400" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => void pointage('absent')} disabled={saving} className="rounded-xl border-2 border-red-200 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40">❌ Absent</button>
            <button onClick={() => void pointage(actualEnd ? 'pointé' : 'présent')} disabled={saving || !actualStart} className="rounded-xl bg-stone-900 py-2.5 text-sm font-bold text-white disabled:opacity-40">{saving ? '…' : actualEnd ? '✅ Pointer' : '🟡 Arrivé'}</button>
          </div>
        </>
      )}
    </div>
  );
}

export default function ZoneStaffHoursPage() {
  const { token, session, loading } = useMatchSession();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [ready, setReady] = useState<boolean | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [preplanStaff, setPreplanStaff] = useState<PreplanStaff[]>([]);
  const [isPrelocked, setIsPrelocked] = useState(false);

  const fetchStaff = useCallback(async () => {
    if (!token) return;
    const { data, error } = await supabase.rpc('get_zone_staff_hours', { p_token: token });
    const r = data as { success?: boolean; staff?: StaffMember[] } | null;
    if (error || !r?.success) return setReady(false);
    setStaff(r.staff ?? []);
    setReady(true);
  }, [token]);

  const fetchPreplan = useCallback(async () => {
    if (!token) return;
    const { data } = await supabase.rpc('zone_get_preplan_staff', { p_token: token });
    const r = data as { success?: boolean; is_prelocked?: boolean; staff?: PreplanStaff[] } | null;
    if (r?.success) {
      setPreplanStaff(r.staff ?? []);
      setIsPrelocked(r.is_prelocked ?? false);
    }
  }, [token]);

  const refetchAll = useCallback(async () => {
    await Promise.all([fetchStaff(), fetchPreplan()]);
  }, [fetchStaff, fetchPreplan]);

  useEffect(() => {
    if (session?.success) void refetchAll();
  }, [session, refetchAll]);

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-stone-50 text-stone-500">Chargement…</div>;
  if (!session?.success) return <div className="p-8 text-center text-stone-500">Session expirée.</div>;

  const totalHours = staff.reduce((s, a) => s + (calcHours(a.arrival_time, a.departure_time, a.break_minutes) ?? 0), 0);
  const validated = staff.filter((a) => a.confirmed_by_staff && a.confirmed_by_manager).length;
  const allConfirmed = staff.length > 0 && staff.every((a) => a.departure_time && a.confirmed_by_staff && a.confirmed_by_manager);

  function handleSubmit() {
    const missing = staff.filter((a) => !a.departure_time || !a.confirmed_by_staff || !a.confirmed_by_manager);
    if (missing.length > 0) {
      alert(`${missing.length} agent(s) incomplets.\nRenseignez l'heure de départ et les 2 confirmations pour chacun.`);
      return;
    }
    setSubmitted(true);
  }

  return (
    <div className="min-h-screen bg-stone-50 pb-10">
      <MatchZoneHeader session={session} back />
      <div className="mx-auto max-w-lg space-y-3 p-4">
        <div className="flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-3">
          <Users size={18} className="text-stone-400" />
          <p className="text-sm font-semibold text-stone-700">Horaires de l'équipe</p>
        </div>

        {/* Liste pré-planifiée par la RH (verrouillée) → pointage terrain */}
        {isPrelocked && preplanStaff.length > 0 && (
          <div className="space-y-3">
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
              <p className="text-sm font-semibold text-blue-800">👥 {preplanStaff.length} agent(s) planifié(s) par la RH</p>
              <p className="mt-0.5 text-xs text-blue-600">Confirmez leur présence et renseignez les heures réelles.</p>
            </div>
            {preplanStaff.map((agent) => (
              <PreplanAgentCard key={agent.id} agent={agent} token={token} onUpdate={() => void refetchAll()} />
            ))}
            <p className="pt-1 text-center text-xs text-stone-400">— Ajouts hors planning ci-dessous —</p>
          </div>
        )}

        {staff.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-center">
              <p className="text-xl font-black text-stone-900">{staff.length}</p>
              <p className="text-xs text-stone-400">agent{staff.length > 1 ? 's' : ''}</p>
            </div>
            <div className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-center">
              <p className="text-xl font-black text-stone-900">{formatHours(totalHours)}</p>
              <p className="text-xs text-stone-400">heures</p>
            </div>
            <div className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-center">
              <p className="text-xl font-black text-stone-900">{validated}/{staff.length}</p>
              <p className="text-xs text-stone-400">validés</p>
            </div>
          </div>
        )}

        {ready === false && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Fonctionnalité en cours d'activation — applique <code>supabase/zone_staff_hours.sql</code>.
          </div>
        )}
        {staff.length === 0 && ready && !isPrelocked && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            <p className="mb-1 font-semibold">👥 Recensement de l'équipe</p>
            <p>Ajoutez chaque membre de votre équipe avec ses heures réelles d'arrivée et de départ.</p>
          </div>
        )}

        {staff.map((agent) => (
          <StaffCard key={agent.id} agent={agent} token={token} onChange={fetchStaff} />
        ))}

        {!submitted && <AddStaffForm token={token} onSaved={fetchStaff} />}

        {staff.length > 0 && !submitted && (
          <>
            <button
              onClick={handleSubmit}
              disabled={!allConfirmed}
              className="mt-2 min-h-[56px] w-full rounded-2xl bg-stone-900 py-4 text-base font-bold text-white disabled:opacity-40"
            >
              ✅ Soumettre la feuille RH ({staff.length} agent{staff.length > 1 ? 's' : ''})
            </button>
            {!allConfirmed && (
              <p className="text-center text-xs text-stone-400">Renseignez le départ et les 2 confirmations pour chaque agent avant de soumettre.</p>
            )}
          </>
        )}

        {submitted && (
          <div className="rounded-2xl border border-green-200 bg-green-50 p-5 text-center">
            <p className="text-lg font-black text-green-700">✅ Feuille RH soumise</p>
            <p className="mt-1 text-sm text-green-600">
              {staff.length} agent{staff.length > 1 ? 's' : ''} · {formatHours(totalHours)} au total
            </p>
            <p className="mt-2 text-xs text-green-500">Les données ont été transmises à l'équipe stade.</p>
          </div>
        )}
      </div>
    </div>
  );
}
