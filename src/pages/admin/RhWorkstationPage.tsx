/**
 * RhWorkstationPage (ROLE_STADE) — « RH · Poste de travail » de la coordinatrice.
 *
 * B2 du dispositif RH. Une page = un événement = un dispositif RH piloté :
 *   1. Bandeau des règles imbougeables (verrou par rôle — RG-001 / RG-003).
 *   2. Machine à états : Import → Validé J-1 → En cours → Verrou H-30 → Live
 *      (rh_validate_baseline fige la baseline, rh_validate_final gèle le réel).
 *   3. Reporting live (get_event_rh) : personnes, heures, coût prévu / réel,
 *      ventilation par statut d'emploi (bénévole = 0 €, légende).
 *   4. « Espaces servis » + « Prestataires & missions » éditables : chaque ligne
 *      agent passe par staff_update (les heures de début restent verrouillées 🔒
 *      côté responsable ; ici, coordinatrice = accès complet).
 *
 * Source de vérité : event_staff_preplan (lignes) + get_event_rh (agrégats) +
 * event_service_providers (sous-parties prestataires). Route /admin/rh/poste.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Lock, ShieldCheck, CheckCircle2, Circle, Plus, Trash2, Users, Save, X,
  AlertTriangle, HeartHandshake, Building2, Wrench,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

/* ───────────────────────── Types ───────────────────────── */

type RhState = 'importe' | 'valide_j1' | 'en_cours' | 'verrou_h30' | 'live';
type StaffStatus = 'salarie' | 'autoentrepreneur' | 'benevole' | 'franchise';

/** Option du sélecteur — alimentée par la vue `events_for_rh` (matchs uniquement). */
interface EventOption {
  event_id: string; event_name: string; event_date: string;
}

interface PreplanRow {
  id: string;
  space_id: string | null;
  agent_nom: string | null;
  agent_prenom: string | null;
  agent_role: string | null;
  pole: string | null;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  planned_hours: number | null;
  actual_hours: number | null;
  hourly_rate: number | null;
  billing_mode: string | null;
  forfait_amount: number | null;
  staff_status: StaffStatus | null;
  status: string | null;
  note: string | null;
}

interface SpaceRef { space_id: string; space_name: string }
interface ProviderRow { id: string; name: string; sort: number }

interface StatutLine { statut: string; agents: number; heures: number; cout: number }
interface RhReport {
  nb_agents: number;
  total_heures: number;
  cout_previsionnel: number;
  cout_reel: number;
  par_statut: StatutLine[];
}

/* ───────────────────────── Helpers ───────────────────────── */

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const eur = (v: number): string =>
  v.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €';

const STATUT_LABEL: Record<string, string> = {
  salarie: 'Salarié', autoentrepreneur: 'Auto-entrepreneur', benevole: 'Bénévole',
  franchise: 'Franchise', non_precise: 'Non précisé',
};
const STATUT_STYLE: Record<string, string> = {
  salarie: 'bg-sky-100 text-sky-700', autoentrepreneur: 'bg-violet-100 text-violet-700',
  benevole: 'bg-emerald-100 text-emerald-700', franchise: 'bg-amber-100 text-amber-700',
  non_precise: 'bg-stone-100 text-stone-500',
};

const STEPS: { key: RhState; label: string; help: string }[] = [
  { key: 'importe', label: 'Import', help: 'Émargement importé' },
  { key: 'valide_j1', label: 'Validé J-1', help: 'Baseline figée' },
  { key: 'en_cours', label: 'En cours', help: 'Jour J' },
  { key: 'verrou_h30', label: 'Verrou H-30', help: 'Ajustements bloqués' },
  { key: 'live', label: 'Live', help: 'Réel gelé' },
];
const stepIndex = (s: RhState | null): number =>
  Math.max(0, STEPS.findIndex((x) => x.key === (s ?? 'importe')));

/* ───────────────────────── Machine à états ───────────────────────── */

function StateTimeline({ state }: { state: RhState | null }) {
  const cur = stepIndex(state);
  return (
    <div className="flex items-center">
      {STEPS.map((s, i) => {
        const done = i < cur;
        const active = i === cur;
        return (
          <div key={s.key} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1">
              {done ? (
                <CheckCircle2 size={22} className="text-emerald-500" />
              ) : active ? (
                <div className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-stone-900 text-[11px] font-black text-white">
                  {i + 1}
                </div>
              ) : (
                <Circle size={22} className="text-stone-300" />
              )}
              <div className="text-center">
                <p className={`text-xs font-bold ${active ? 'text-stone-900' : done ? 'text-emerald-600' : 'text-stone-400'}`}>{s.label}</p>
                <p className="hidden text-[10px] text-stone-400 sm:block">{s.help}</p>
              </div>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`mx-1 h-0.5 flex-1 rounded-full ${i < cur ? 'bg-emerald-400' : 'bg-stone-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ───────────────────────── Tuile reporting ───────────────────────── */

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-stone-100 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">{label}</p>
      <p className={`mt-1 text-2xl font-black tabular-nums ${accent ?? 'text-stone-900'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-stone-400">{sub}</p>}
    </div>
  );
}

/* ───────────────────────── Ligne agent éditable ───────────────────────── */

function AgentRow({ row, onSaved }: { row: PreplanRow; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<PreplanRow>(row);
  useEffect(() => setDraft(row), [row]);

  const name = `${row.agent_prenom ?? ''} ${row.agent_nom ?? ''}`.trim() || '—';
  const isForfait = (draft.billing_mode ?? 'horaire') === 'forfait';

  async function save() {
    setBusy(true);
    setErr(null);
    const changes: Record<string, string | null> = {
      planned_start: draft.planned_start, planned_end: draft.planned_end,
      actual_start: draft.actual_start, actual_end: draft.actual_end,
      status: draft.status, note: draft.note,
      billing_mode: draft.billing_mode, staff_status: draft.staff_status,
      hourly_rate: draft.hourly_rate == null ? '' : String(draft.hourly_rate),
      forfait_amount: draft.forfait_amount == null ? '' : String(draft.forfait_amount),
    };
    const { data, error } = await supabase.rpc('staff_update', {
      p_id: row.id, p_changes: changes, p_by: 'Coordination RH', p_role: 'stade',
    });
    setBusy(false);
    const r = data as { success?: boolean; error?: string } | null;
    if (error || !r?.success) {
      setErr(r?.error ?? error?.message ?? 'Échec de l’enregistrement.');
      return;
    }
    setEditing(false);
    onSaved();
  }

  if (!editing) {
    return (
      <tr className="text-stone-800">
        <td className="px-4 py-2 font-medium">{name}
          <span className="ml-2 text-xs text-stone-400">{row.agent_role ?? ''}</span>
        </td>
        <td className="px-3 py-2">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUT_STYLE[row.staff_status ?? 'non_precise']}`}>
            {STATUT_LABEL[row.staff_status ?? 'non_precise']}
          </span>
        </td>
        <td className="px-3 py-2 text-center tabular-nums text-stone-500" title="Heure de début — verrouillée pour les responsables">
          <span className="inline-flex items-center gap-1">
            <Lock size={11} className="text-stone-300" />{row.planned_start?.slice(0, 5) ?? '—'}
          </span>
        </td>
        <td className="px-3 py-2 text-center tabular-nums">{row.actual_end?.slice(0, 5) ?? '—'}</td>
        <td className="px-3 py-2 text-right tabular-nums">{num(row.actual_hours ?? row.planned_hours).toFixed(1)}</td>
        <td className="px-3 py-2 text-stone-500">{row.status ?? 'planifié'}</td>
        <td className="px-3 py-2 text-right">
          <button onClick={() => setEditing(true)} className="text-xs font-semibold text-stone-500 hover:text-stone-900">Éditer</button>
        </td>
      </tr>
    );
  }

  return (
    <tr className="bg-stone-50 align-top">
      <td className="px-4 py-2 font-medium">{name}
        {err && <p className="mt-1 flex items-center gap-1 text-[11px] text-rose-600"><AlertTriangle size={11} />{err}</p>}
      </td>
      <td className="px-3 py-2">
        <select value={draft.staff_status ?? ''} onChange={(e) => setDraft({ ...draft, staff_status: (e.target.value || null) as StaffStatus | null })}
          className="w-full rounded-lg border border-stone-200 px-2 py-1 text-xs">
          <option value="">—</option>
          <option value="salarie">Salarié</option>
          <option value="autoentrepreneur">Auto-entrepreneur</option>
          <option value="benevole">Bénévole</option>
          <option value="franchise">Franchise</option>
        </select>
      </td>
      <td className="px-3 py-2" title="Réservé à la coordinatrice — verrouillé pour les responsables">
        <input type="time" value={draft.planned_start?.slice(0, 5) ?? ''} onChange={(e) => setDraft({ ...draft, planned_start: e.target.value || null })}
          className="w-full rounded-lg border border-amber-200 bg-amber-50/50 px-2 py-1 text-xs" />
      </td>
      <td className="px-3 py-2">
        <input type="time" value={draft.actual_end?.slice(0, 5) ?? ''} onChange={(e) => setDraft({ ...draft, actual_end: e.target.value || null })}
          className="w-full rounded-lg border border-stone-200 px-2 py-1 text-xs" />
      </td>
      <td className="px-3 py-2">
        <select value={draft.billing_mode ?? 'horaire'} onChange={(e) => setDraft({ ...draft, billing_mode: e.target.value })}
          className="mb-1 w-full rounded-lg border border-stone-200 px-2 py-1 text-xs">
          <option value="horaire">Horaire</option>
          <option value="forfait">Forfait</option>
        </select>
        {isForfait ? (
          <input type="number" step="0.01" placeholder="Forfait €" value={draft.forfait_amount ?? ''} onChange={(e) => setDraft({ ...draft, forfait_amount: e.target.value === '' ? null : Number(e.target.value) })}
            className="w-full rounded-lg border border-stone-200 px-2 py-1 text-xs" />
        ) : (
          <input type="number" step="0.01" placeholder="Taux €/h" value={draft.hourly_rate ?? ''} onChange={(e) => setDraft({ ...draft, hourly_rate: e.target.value === '' ? null : Number(e.target.value) })}
            className="w-full rounded-lg border border-stone-200 px-2 py-1 text-xs" />
        )}
      </td>
      <td className="px-3 py-2">
        <select value={draft.status ?? 'planifié'} onChange={(e) => setDraft({ ...draft, status: e.target.value })}
          className="w-full rounded-lg border border-stone-200 px-2 py-1 text-xs">
          <option value="planifié">Planifié</option>
          <option value="présent">Présent</option>
          <option value="absent">Absent</option>
          <option value="retiré">Retiré</option>
        </select>
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex justify-end gap-1">
          <button onClick={() => void save()} disabled={busy} className="rounded-lg bg-stone-900 p-1.5 text-white hover:bg-stone-700 disabled:opacity-40" title="Enregistrer">
            <Save size={14} />
          </button>
          <button onClick={() => { setEditing(false); setDraft(row); setErr(null); }} className="rounded-lg border border-stone-200 p-1.5 text-stone-500 hover:bg-white" title="Annuler">
            <X size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function AgentTable({ title, icon, rows, onSaved }: { title: string; icon: React.ReactNode; rows: PreplanRow[]; onSaved: () => void }) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-2xl border border-stone-100">
      <div className="flex items-center gap-2 border-b border-stone-100 bg-stone-50 px-4 py-2 text-sm font-bold text-stone-700">
        {icon}{title}<span className="ml-1 text-xs font-normal text-stone-400">({rows.length})</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 text-left text-xs uppercase tracking-wide text-stone-400">
              <th className="px-4 py-2">Agent</th>
              <th className="px-3 py-2">Statut</th>
              <th className="px-3 py-2 text-center">Début 🔒</th>
              <th className="px-3 py-2 text-center">Départ réel</th>
              <th className="px-3 py-2 text-right">Heures</th>
              <th className="px-3 py-2">Présence</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-50">
            {rows.map((r) => <AgentRow key={r.id} row={r} onSaved={onSaved} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ───────────────────────── Prestataires & missions ───────────────────────── */

function ProvidersPanel({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('event_service_providers')
      .select('id, name, sort').eq('event_id', eventId).order('sort').order('name');
    setRows((data ?? []) as ProviderRow[]);
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  async function add() {
    const n = name.trim();
    if (n.length < 2) return;
    setBusy(true);
    await supabase.from('event_service_providers').insert({ event_id: eventId, name: n, sort: rows.length });
    setBusy(false);
    setName('');
    void load();
  }
  async function remove(id: string) {
    await supabase.from('event_service_providers').delete().eq('id', id);
    void load();
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-stone-100">
      <div className="flex items-center gap-2 border-b border-stone-100 bg-stone-50 px-4 py-2 text-sm font-bold text-stone-700">
        <Wrench size={15} />Prestataires & missions
        <span className="ml-1 text-xs font-normal text-stone-400">({rows.length})</span>
      </div>
      <div className="space-y-2 p-3">
        {rows.length === 0 && <p className="px-1 py-2 text-xs text-stone-400">Aucun prestataire externe déclaré (sécurité, technique, animation…).</p>}
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-xl border border-stone-100 bg-white px-3 py-2">
            <span className="text-sm font-medium text-stone-800">{r.name}</span>
            <button onClick={() => void remove(r.id)} className="rounded-lg p-1 text-stone-300 hover:bg-rose-50 hover:text-rose-500" title="Retirer">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <div className="flex gap-2 pt-1">
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()}
            placeholder="Ajouter une mission / un prestataire…"
            className="flex-1 rounded-xl border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          <button onClick={() => void add()} disabled={busy || name.trim().length < 2}
            className="flex items-center gap-1 rounded-xl bg-stone-900 px-3 py-2 text-sm font-semibold text-white hover:bg-stone-700 disabled:opacity-40">
            <Plus size={15} />Ajouter
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Page ───────────────────────── */

export default function RhWorkstationPage({ basePath = '/admin/rh/poste' }: { basePath?: string } = {}) {
  const { responsableName } = useAuth();
  const navigate = useNavigate();
  const { eventId: routeEventId } = useParams<{ eventId?: string }>();
  const [events, setEvents] = useState<EventOption[]>([]);
  const [selected, setSelected] = useState(routeEventId ?? '');
  const [rows, setRows] = useState<PreplanRow[]>([]);
  const [spaces, setSpaces] = useState<Record<string, string>>({});
  const [report, setReport] = useState<RhReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [rhState, setRhState] = useState<RhState>('importe');
  const [isMatch, setIsMatch] = useState(true);
  const [checkingMatch, setCheckingMatch] = useState(false);

  useEffect(() => {
    // Sélecteur : matchs uniquement (vue events_for_rh — aucun séminaire ne peut apparaître).
    void supabase.from('events_for_rh').select('event_id, event_name, event_date')
      .order('event_date', { ascending: false })
      .then(({ data }) => {
        const evs = (data ?? []) as EventOption[];
        setEvents(evs);
        // Défaut canonique : si aucun événement dans l'URL, pointer le premier match.
        if (evs.length && !routeEventId) navigate(`${basePath}/${evs[0].event_id}`, { replace: true });
      });
    void supabase.from('spaces').select('space_id, space_name').then(({ data }) => {
      const map: Record<string, string> = {};
      for (const s of (data ?? []) as SpaceRef[]) map[s.space_id] = s.space_name;
      setSpaces(map);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // L'URL (`/admin/rh/poste/:eventId`) est la source de vérité de la sélection.
  useEffect(() => {
    if (routeEventId && routeEventId !== selected) setSelected(routeEventId);
  }, [routeEventId, selected]);

  const loadEvent = useCallback(async () => {
    if (!selected) return;
    setLoading(true);
    const [{ data: pre }, { data: rh }] = await Promise.all([
      supabase.from('event_staff_preplan')
        .select('id, space_id, agent_nom, agent_prenom, agent_role, pole, planned_start, planned_end, actual_start, actual_end, planned_hours, actual_hours, hourly_rate, billing_mode, forfait_amount, staff_status, status, note')
        .eq('event_id', selected).order('agent_nom'),
      supabase.rpc('get_event_rh', { p_event_id: selected }),
    ]);
    setRows((pre ?? []) as PreplanRow[]);
    const d = rh as {
      kpis?: { nb_agents?: unknown; total_heures?: unknown; cout_previsionnel?: unknown; cout_reel?: unknown };
      par_statut?: { statut?: string; agents?: unknown; heures?: unknown; cout?: unknown }[];
    } | null;
    setReport({
      nb_agents: num(d?.kpis?.nb_agents),
      total_heures: num(d?.kpis?.total_heures),
      cout_previsionnel: num(d?.kpis?.cout_previsionnel),
      cout_reel: num(d?.kpis?.cout_reel),
      par_statut: (d?.par_statut ?? []).map((s) => ({
        statut: String(s.statut ?? 'non_precise'), agents: num(s.agents), heures: num(s.heures), cout: num(s.cout),
      })),
    });
    setLoading(false);
  }, [selected]);

  // Garde d'accès + état RH pour l'événement sélectionné (deep link éventuel).
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    setCheckingMatch(true);
    void (async () => {
      const [{ data: ok }, { data: ev }] = await Promise.all([
        supabase.rpc('is_match_event', { p_event: selected }),
        supabase.from('events').select('rh_state').eq('event_id', selected).single(),
      ]);
      if (!alive) return;
      setIsMatch(ok === true);
      setRhState(((ev as { rh_state?: RhState } | null)?.rh_state ?? 'importe'));
      setCheckingMatch(false);
    })();
    return () => { alive = false; };
  }, [selected]);

  useEffect(() => { if (isMatch) void loadEvent(); }, [loadEvent, isMatch]);

  async function refreshState() {
    const { data } = await supabase.from('events').select('rh_state').eq('event_id', selected).single();
    setRhState(((data as { rh_state?: RhState } | null)?.rh_state ?? 'importe'));
  }

  async function validateBaseline() {
    if (!window.confirm('Figer la baseline J-1 ?\n\nChaque ligne RH sera photographiée (référence de comparaison). L’état passe à « Validé J-1 ».')) return;
    setActing(true);
    const { data } = await supabase.rpc('rh_validate_baseline', { p_event: selected, p_by: responsableName || 'Coordination RH' });
    setActing(false);
    const r = data as { success?: boolean; error?: string; lignes?: number } | null;
    if (r?.success) { alert(`✅ Baseline figée — ${r.lignes ?? 0} ligne(s).`); await refreshState(); }
    else alert(r?.error ?? 'Échec.');
  }

  async function validateFinal() {
    if (!window.confirm('Geler le réel (Live) ?\n\nLe dispositif passe à « Live » : les valeurs finales deviennent visibles côté responsables.')) return;
    setActing(true);
    const { data } = await supabase.rpc('rh_validate_final', { p_event: selected, p_by: responsableName || 'Coordination RH' });
    setActing(false);
    const r = data as { success?: boolean; error?: string } | null;
    if (r?.success) { alert('✅ Dispositif gelé (Live).'); await refreshState(); }
    else alert(r?.error ?? 'Échec.');
  }

  const bySpace = useMemo(() => {
    const groups = new Map<string, PreplanRow[]>();
    for (const r of rows.filter((x) => x.space_id)) {
      const key = spaces[r.space_id as string] ?? 'Espace';
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows, spaces]);

  const horsResto = useMemo(() => rows.filter((x) => !x.space_id), [rows]);
  const curStep = stepIndex(rhState);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      {/* En-tête */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="h-8 w-1.5 rounded-full bg-emerald-500" />
            <h1 className="text-2xl font-black text-stone-900">RH · Poste de travail</h1>
          </div>
          <p className="ml-3.5 mt-1 text-sm text-stone-400">Pilotage RH d’un match — de l’import au gel du réel.</p>
        </div>
        {events.length > 0 && (
          <select value={events.some((e) => e.event_id === selected) ? selected : ''}
            onChange={(e) => navigate(`${basePath}/${e.target.value}`)}
            className="min-w-[280px] rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400">
            {!events.some((e) => e.event_id === selected) && <option value="" disabled>— Sélectionner un match —</option>}
            {events.map((e) => (
              <option key={e.event_id} value={e.event_id}>
                🏉 {e.event_name} — {new Date(e.event_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Bandeau règles imbougeables */}
      <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
        <ShieldCheck size={18} className="mt-0.5 shrink-0 text-amber-600" />
        <div className="text-xs leading-relaxed text-amber-900">
          <p className="font-bold">Règles imbougeables</p>
          <p>Les <b>heures de début</b>, le <b>planning</b> et la <b>facturation</b> sont pilotés par la coordination RH uniquement 🔒. Un responsable de zone ne peut saisir que le <b>départ réel</b>, la <b>présence</b> et une <b>note</b>. Les <b>coûts</b> ne sont jamais exposés aux responsables (RG-003). Un <b>bénévole</b> compte 0 €.</p>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="rounded-2xl border border-stone-200 bg-white p-10 text-center text-sm text-stone-400">
          Aucun match à piloter.
        </div>
      ) : !isMatch && !checkingMatch ? (
        <div className="rounded-2xl border border-amber-200 bg-white p-10 text-center">
          <AlertTriangle size={28} className="mx-auto mb-2 text-amber-500" />
          <p className="text-base font-bold text-stone-800">Poste RH réservé aux matchs</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-stone-400">
            La gestion RH par émargement ne concerne que les matchs. Les séminaires gardent leur propre gestion RH.
            Sélectionnez un match pour piloter le poste.
          </p>
        </div>
      ) : (
        <>
          {/* Machine à états */}
          <div className="space-y-4 rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
            <StateTimeline state={rhState} />
            <div className="flex flex-wrap justify-end gap-2 border-t border-stone-50 pt-3">
              <button onClick={() => void validateBaseline()} disabled={acting || curStep >= 1}
                className="flex items-center gap-2 rounded-xl bg-stone-900 px-4 py-2 text-sm font-bold text-white hover:bg-stone-700 disabled:opacity-40">
                <Lock size={14} />Valider la baseline (J-1)
              </button>
              <button onClick={() => void validateFinal()} disabled={acting || curStep >= 4}
                className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40">
                <CheckCircle2 size={14} />Geler le réel (Live)
              </button>
            </div>
          </div>

          {/* Reporting */}
          {report && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Tile label="Personnes" value={String(report.nb_agents)} sub="planifiées / présentes" />
                <Tile label="Heures" value={report.total_heures.toFixed(0)} sub="cumulées" />
                <Tile label="Coût prévisionnel" value={eur(report.cout_previsionnel)} accent="text-stone-500" />
                <Tile label="Coût réel" value={eur(report.cout_reel)} accent="text-emerald-600" sub="bénévoles = 0 €" />
              </div>

              {/* Ventilation par statut d'emploi */}
              <div className="overflow-hidden rounded-2xl border border-stone-100 bg-white">
                <div className="flex items-center gap-2 border-b border-stone-100 bg-stone-50 px-4 py-2 text-sm font-bold text-stone-700">
                  <HeartHandshake size={15} />Par statut d’emploi
                </div>
                {report.par_statut.length === 0 ? (
                  <p className="px-4 py-4 text-xs text-stone-400">Renseignez le statut d’emploi des agents pour la ventilation.</p>
                ) : (
                  <div className="flex flex-wrap gap-2 p-3">
                    {report.par_statut.map((s) => (
                      <div key={s.statut} className="flex items-center gap-2 rounded-xl border border-stone-100 px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUT_STYLE[s.statut] ?? STATUT_STYLE.non_precise}`}>
                          {STATUT_LABEL[s.statut] ?? s.statut}
                        </span>
                        <span className="text-sm font-bold text-stone-800 tabular-nums">{s.agents}</span>
                        <span className="text-xs text-stone-400">· {s.heures.toFixed(0)} h ·</span>
                        <span className="text-sm font-semibold tabular-nums text-emerald-600">
                          {s.statut === 'benevole' ? '0 €' : eur(s.cout)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Espaces servis + prestataires */}
          {loading ? (
            <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-stone-100" />)}</div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-stone-700">
                <Building2 size={16} />Espaces servis
              </div>
              {bySpace.length === 0 ? (
                <p className="rounded-2xl border border-stone-100 bg-white px-4 py-6 text-center text-sm text-stone-400">
                  <Users size={18} className="mx-auto mb-1 text-stone-300" />
                  Aucun agent affecté à un espace. Importez l’émargement (Excel RH) pour alimenter le poste.
                </p>
              ) : (
                bySpace.map(([space, list]) => (
                  <AgentTable key={space} title={space} icon={<Building2 size={15} />} rows={list} onSaved={() => void loadEvent()} />
                ))
              )}

              <AgentTable title="Hors restauration (pôles)" icon={<Wrench size={15} />} rows={horsResto} onSaved={() => void loadEvent()} />
              <ProvidersPanel eventId={selected} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
