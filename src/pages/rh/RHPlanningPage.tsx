/**
 * RHPlanningPage — interface EXCLUSIVE du Responsable RH (accès par code match).
 * Aucune sidebar admin, aucun accès stocks/analyses/prix. Uniquement la
 * planification du personnel par espace. Route : /rh/planning (garde RHRoute).
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, ChevronDown, ChevronRight, Lock, LogOut, Plus, Sparkles, Trash2, RefreshCw, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { ExcelRHImporter } from '@/components/rh/ExcelRHImporter';
import { AgentSwapModal, type SwapTarget } from '@/components/rh/AgentSwapModal';

const ROLES = ['Serveur', 'Chef de rang', 'Barman', 'Agent de sécurité', 'Runner', 'Hôte / Hôtesse', 'Responsable espace', 'Autre'];
const ROLE_ICONS: Record<string, string> = {
  Serveur: '🍽️', 'Chef de rang': '⭐', Barman: '🍺', 'Agent de sécurité': '🔒',
  Runner: '🏃', 'Hôte / Hôtesse': '🤝', 'Responsable espace': '👑', Autre: '👤',
};

interface RHSession { success: boolean; event_id: string; event_name: string; event_date: string; rh_nom: string }
interface Agent { id: string; nom: string; prenom: string; role: string; planned_start: string | null; planned_end: string | null; status: string }
interface Space { space_id: string; space_name: string; agents: Agent[]; nb_planifies: number; nb_pointes: number }
interface Preplan { success: boolean; total: number; by_space: Space[] }
interface NewAgent { nom: string; prenom: string; role: string; start: string; end: string | null }

export default function RHPlanningPage() {
  const navigate = useNavigate();
  const token = localStorage.getItem('rh_session_token') ?? '';
  const rhNom = localStorage.getItem('rh_nom') ?? 'RH';

  const [session, setSession] = useState<RHSession | null>(null);
  const [preplan, setPreplan] = useState<Preplan | null>(null);
  const [loading, setLoading] = useState(true);
  const [locking, setLocking] = useState(false);
  const [openSpaces, setOpenSpaces] = useState<Set<string>>(new Set());
  const [showImporter, setShowImporter] = useState(false);
  const [importBanner, setImportBanner] = useState<string | null>(null);
  const [swapAgent, setSwapAgent] = useState<SwapTarget | null>(null);

  const loadPreplan = useCallback(async () => {
    const { data } = await supabase.rpc('rh_get_preplan_by_token', { p_token: token });
    const r = data as Preplan | null;
    if (r?.success) setPreplan(r);
  }, [token]);

  useEffect(() => {
    void supabase.rpc('get_rh_session', { p_token: token }).then(async ({ data }) => {
      const r = data as RHSession | null;
      if (!r?.success) {
        localStorage.removeItem('rh_session_token');
        navigate('/login');
        return;
      }
      setSession(r);
      await loadPreplan();
      setLoading(false);
    });
  }, [token, navigate, loadPreplan]);

  const totalPlanifies = preplan?.by_space?.reduce((s, sp) => s + (sp.nb_planifies ?? 0), 0) ?? 0;
  const isLocked = preplan?.by_space?.some((sp) => sp.agents?.some((a) => a.status !== 'planifié')) ?? false;

  async function addAgent(spaceId: string, agent: NewAgent) {
    const { data } = await supabase.rpc('rh_upsert_agent_by_token', {
      p_token: token, p_space_id: spaceId, p_agent_id: null,
      p_nom: agent.nom, p_prenom: agent.prenom, p_role: agent.role,
      p_start: agent.start, p_end: agent.end, p_rate: null,
    });
    if ((data as { success?: boolean } | null)?.success) await loadPreplan();
  }

  async function deleteAgent(agentId: string) {
    await supabase.rpc('rh_delete_agent_by_token', { p_token: token, p_agent_id: agentId });
    await loadPreplan();
  }

  async function lockPreplan() {
    if (!window.confirm(`Transmettre la liste définitive aux responsables de zone ?\n\n${totalPlanifies} agents seront envoyés sur le match « ${session?.event_name} ».\n\n⚠️ Cette action est irréversible.`)) return;
    setLocking(true);
    const { data } = await supabase.rpc('rh_lock_preplan_by_token', { p_token: token });
    setLocking(false);
    const r = data as { success?: boolean; agents_locked?: number } | null;
    if (r?.success) {
      alert(`✅ ${r.agents_locked} agent(s) transmis aux responsables de zone.`);
      await loadPreplan();
    }
  }

  function handleLogout() {
    localStorage.removeItem('rh_session_token');
    localStorage.removeItem('rh_event_name');
    localStorage.removeItem('rh_nom');
    navigate('/login');
  }

  const rhSpaces = (preplan?.by_space ?? []).map((s) => ({ space_id: s.space_id, space_name: s.space_name }));

  function handleImportDone(inserted: number) {
    setShowImporter(false);
    setImportBanner(`✅ ${inserted} agent(s) importé(s)`);
    void loadPreplan();
  }

  if (loading)
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50">
        <div className="w-full max-w-sm space-y-3 px-4">{[...Array(4)].map((_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-stone-200" />)}</div>
      </div>
    );

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="sticky top-0 z-20 bg-stone-900 px-4 py-4 text-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-sm font-black text-stone-900">PR</div>
            <div>
              <p className="text-sm font-bold leading-tight">Planning RH Match</p>
              <p className="text-xs leading-tight text-white/50">{session?.event_name} · {session?.event_date ? new Date(session.event_date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-white/50 sm:inline">{rhNom}</span>
            <button onClick={handleLogout} className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/60 transition-colors hover:border-white/40 hover:text-white">
              <LogOut size={13} /> Quitter
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-2xl border border-stone-200 bg-white p-4 text-center">
            <p className="text-2xl font-black text-stone-900">{totalPlanifies}</p>
            <p className="mt-0.5 text-xs text-stone-400">agents planifiés</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-4 text-center">
            <p className="text-2xl font-black text-stone-900">{preplan?.by_space?.length ?? 0}</p>
            <p className="mt-0.5 text-xs text-stone-400">espaces</p>
          </div>
          <div className={`rounded-2xl border p-4 text-center ${isLocked ? 'border-green-300 bg-green-50' : totalPlanifies > 0 ? 'border-amber-300 bg-amber-50' : 'border-stone-200 bg-white'}`}>
            <p className={`text-2xl font-black ${isLocked ? 'text-green-700' : 'text-stone-900'}`}>{isLocked ? '🔒' : totalPlanifies > 0 ? '📋' : '—'}</p>
            <p className={`mt-0.5 text-xs ${isLocked ? 'text-green-600' : 'text-stone-400'}`}>{isLocked ? 'Transmis aux zones' : 'En préparation'}</p>
          </div>
        </div>

        {importBanner && (
          <div className="flex items-center justify-between rounded-xl border border-green-200 bg-green-50 px-4 py-3">
            <p className="text-sm font-semibold text-green-800">{importBanner}</p>
            <button onClick={() => setImportBanner(null)} className="text-green-500 hover:text-green-700"><X size={16} /></button>
          </div>
        )}

        {!isLocked && (
          <button
            onClick={() => setShowImporter(true)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-400 to-amber-500 py-3.5 text-sm font-bold text-stone-900 shadow-sm transition-all hover:from-amber-500 hover:to-amber-600"
          >
            <Sparkles size={16} /> 📊 Importer le planning Excel prestataire
          </button>
        )}

        {!isLocked && totalPlanifies > 0 && (
          <button onClick={() => void lockPreplan()} disabled={locking} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-stone-900 py-4 text-base font-bold text-white transition-colors hover:bg-stone-700 disabled:opacity-40">
            <Lock size={17} /> {locking ? 'Transmission en cours…' : `✅ Valider et transmettre (${totalPlanifies} agents)`}
          </button>
        )}

        {isLocked && (
          <div className="flex items-center gap-3 rounded-2xl border border-green-200 bg-green-50 px-4 py-3">
            <CheckCircle size={20} className="shrink-0 text-green-600" />
            <div>
              <p className="text-sm font-bold text-green-800">Planning transmis aux responsables de zone</p>
              <p className="mt-0.5 text-xs text-green-600">Les {totalPlanifies} agents ont été basculés dans les interfaces des responsables.</p>
            </div>
          </div>
        )}

        {preplan?.by_space?.length === 0 && (
          <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center text-sm text-stone-400">Aucun espace activé sur ce match. Contactez l'équipe stade.</div>
        )}

        {preplan?.by_space?.map((space) => {
          const isOpen = openSpaces.has(space.space_id);
          return (
            <div key={space.space_id} className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
              <button onClick={() => setOpenSpaces((prev) => { const n = new Set(prev); n.has(space.space_id) ? n.delete(space.space_id) : n.add(space.space_id); return n; })} className="flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-stone-50">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold text-stone-900">{space.space_name}</p>
                    <span className="rounded-lg bg-stone-100 px-2 py-0.5 text-xs text-stone-500">{space.nb_planifies} agent{space.nb_planifies !== 1 ? 's' : ''}</span>
                  </div>
                  {space.agents?.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {[...new Set(space.agents.map((a) => a.role))].map((role) => (
                        <span key={role} className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500">{ROLE_ICONS[role]} {role}</span>
                      ))}
                    </div>
                  )}
                </div>
                {isOpen ? <ChevronDown size={16} className="shrink-0 text-stone-400" /> : <ChevronRight size={16} className="shrink-0 text-stone-400" />}
              </button>
              {isOpen && (
                <div className="space-y-2 border-t border-stone-100 p-4">
                  {space.agents.length === 0 && <p className="py-2 text-center text-xs text-stone-400">Aucun agent ajouté pour cet espace</p>}
                  {space.agents.map((agent) => (
                    <div key={agent.id} className="flex items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-stone-800 text-xs font-black text-white">{agent.prenom?.[0]}{agent.nom?.[0]}</div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-stone-800">{agent.prenom} {agent.nom}</p>
                        <p className="truncate text-xs text-stone-400">{ROLE_ICONS[agent.role]} {agent.role} · {agent.planned_start?.slice(0, 5)}{agent.planned_end ? ` → ${agent.planned_end.slice(0, 5)}` : ''}</p>
                      </div>
                      {!isLocked && (
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            onClick={() => setSwapAgent({ id: agent.id, prenom: agent.prenom, nom: agent.nom, role: agent.role, space_id: space.space_id, space_name: space.space_name })}
                            title="Remplacer / retirer (no-show)"
                            className="p-1 text-stone-300 transition-colors hover:text-amber-500"
                          >
                            <RefreshCw size={14} />
                          </button>
                          <button onClick={() => void deleteAgent(agent.id)} className="p-1 text-stone-300 transition-colors hover:text-red-400"><Trash2 size={14} /></button>
                        </div>
                      )}
                    </div>
                  ))}
                  {!isLocked && <AddAgentInline onAdd={(a) => void addAgent(space.space_id, a)} />}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showImporter && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 md:items-center">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
            <ExcelRHImporter token={token} spaces={rhSpaces} onDone={handleImportDone} onClose={() => setShowImporter(false)} />
          </div>
        </div>
      )}

      {swapAgent && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 md:items-center">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
            <h3 className="mb-4 font-bold text-stone-900">Gestion absence / remplacement</h3>
            <AgentSwapModal
              absentAgent={swapAgent}
              token={token}
              onDone={() => { setSwapAgent(null); void loadPreplan(); }}
              onClose={() => setSwapAgent(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function AddAgentInline({ onAdd }: { onAdd: (a: NewAgent) => void }) {
  const [open, setOpen] = useState(false);
  const [nom, setNom] = useState('');
  const [prenom, setPrenom] = useState('');
  const [role, setRole] = useState('Serveur');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  function submit() {
    if (!nom.trim() || !prenom.trim() || !start) return;
    onAdd({ nom, prenom, role, start, end: end || null });
    setNom(''); setPrenom(''); setStart(''); setEnd(''); setOpen(false);
  }

  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-stone-200 py-3 text-sm font-medium text-stone-400 transition-all hover:border-amber-400 hover:bg-amber-50 hover:text-amber-600">
        <Plus size={15} /> Ajouter un agent
      </button>
    );

  return (
    <div className="space-y-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3">
      <div className="grid grid-cols-2 gap-2">
        <input value={prenom} onChange={(e) => setPrenom(e.target.value)} placeholder="Prénom *" autoFocus className="min-h-[40px] rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
        <input value={nom} onChange={(e) => setNom(e.target.value.toUpperCase())} placeholder="NOM *" className="min-h-[40px] rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-amber-400" />
      </div>
      <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
        {ROLES.map((r) => <option key={r} value={r}>{ROLE_ICONS[r]} {r}</option>)}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="min-h-[40px] rounded-lg border border-stone-200 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" />
        <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="min-h-[40px] rounded-lg border border-stone-200 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" />
      </div>
      <div className="flex gap-2">
        <button onClick={() => setOpen(false)} className="flex-1 rounded-lg border border-stone-200 py-2 text-sm text-stone-500">Annuler</button>
        <button onClick={submit} disabled={!nom.trim() || !prenom.trim() || !start} className="flex-1 rounded-lg bg-amber-500 py-2 text-sm font-bold text-white disabled:opacity-40">Ajouter</button>
      </div>
    </div>
  );
}
