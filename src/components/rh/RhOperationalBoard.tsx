/**
 * RhOperationalBoard — écran RH opérationnel d'un match (ROLE_STADE).
 *
 * Source unique : rh_board(event) → { rh, hors_resto[], resto[], poles[],
 * espaces[], mouvements[] }. Permet de saisir / renommer / déplacer / retirer /
 * restaurer un agent (pôles hors resto ET espaces restauration), avec journal
 * intégral des mouvements et clôture définitive. Toutes les écritures passent par
 * des RPC is_stade()-gardées qui journalisent et refusent toute modif après
 * clôture. Après chaque action réussie, on recharge rh_board.
 *
 * RG-003 : rh_board n'expose les coûts qu'à ROLE_STADE (garde serveur).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Lock, Plus, Pencil, ArrowRightLeft, UserMinus, RotateCcw, History,
  ChevronDown, ChevronRight, Check, X, ShieldCheck, Receipt,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Alert, Button, Input, Select, Spinner } from '@/components/ui';
import { RhBillingGrid } from '@/components/rh/RhBillingGrid';
import { BillingChip } from '@/components/rh/BillingChip';

const ROLE_OPTIONS = [
  'Serveur', 'Chef de rang', 'Barman', 'Agent de sécurité',
  'Runner', 'Hôte / Hôtesse', 'Responsable espace', 'Autre',
] as const;

interface Kpis {
  nb_agents: number; total_heures: number; cout_rh_ht: number;
  cout_resto: number; cout_hors_resto: number; cout_par_pax: number;
  cout_previsionnel: number; cout_reel: number; nb_forfait: number; nb_horaire: number;
}
interface RhSummary {
  closed: boolean; closed_at: string | null; closed_by: string | null;
  kpis: Kpis | null;
}
interface Agent {
  id: string; nom: string; prenom: string; role: string;
  heures: number; taux: number; status: string;
  billing_mode?: string; forfait?: number | null; cout?: number;
  pole?: string; space_id?: string; space_name?: string;
}
interface Espace { id: string; nom: string; }
interface Mouvement {
  at: string; action: string; agent: string;
  from: string | null; to: string | null; detail: string | null; by: string | null;
}
interface Board {
  error?: string;
  rh: RhSummary;
  hors_resto: Agent[];
  resto: Agent[];
  poles: string[];
  espaces: Espace[];
  mouvements: Mouvement[];
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const eur = (v: number): string =>
  v.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';

export function RhOperationalBoard({ eventId }: { eventId: string }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const by = user?.name ?? user?.email ?? 'RH';

  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showJournal, setShowJournal] = useState(false);
  const [showBilling, setShowBilling] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('rh_board', { p_event: eventId });
    setBoard((data as Board | null) ?? null);
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Exécute une RPC de mutation, gère succès/erreur, recharge le board. */
  const run = useCallback(
    async (fn: string, params: Record<string, unknown>, okMsg: string): Promise<boolean> => {
      setBusy(true);
      const { data, error } = await supabase.rpc(fn, params);
      setBusy(false);
      const res = data as { success?: boolean; error?: string } | null;
      if (error || !res?.success) {
        showToast(`Échec : ${res?.error ?? error?.message ?? 'erreur inconnue'}`, 'warning');
        return false;
      }
      showToast(okMsg, 'success');
      await load();
      return true;
    },
    [load, showToast],
  );

  const closed = board?.rh.closed ?? false;

  const moveOptions = useMemo(() => {
    if (!board) return [];
    return [
      { value: '', label: '↪ Déplacer vers…' },
      ...board.poles.map((p) => ({ value: `pole:${p}`, label: `Pôle · ${p}` })),
      ...board.espaces.map((e) => ({ value: `space:${e.id}`, label: `Espace · ${e.nom}` })),
    ];
  }, [board]);

  if (loading) return <Spinner />;
  if (!board) return <Alert variant="error">Impossible de charger le tableau RH.</Alert>;
  if (board.error) return <Alert variant="warning">{board.error}</Alert>;

  const k = board.rh.kpis;

  // Groupement
  const parPole = new Map<string, Agent[]>();
  for (const p of board.poles) parPole.set(p, []);
  for (const a of board.hors_resto) {
    const key = a.pole ?? 'Autres';
    if (!parPole.has(key)) parPole.set(key, []);
    parPole.get(key)!.push(a);
  }
  const parEspace = new Map<string, { nom: string; agents: Agent[] }>();
  for (const a of board.resto) {
    const key = a.space_id ?? a.space_name ?? '?';
    if (!parEspace.has(key)) parEspace.set(key, { nom: a.space_name ?? '—', agents: [] });
    parEspace.get(key)!.agents.push(a);
  }

  return (
    <div className="space-y-6">
      {/* Bandeau clôture */}
      {closed && (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-emerald-800">
          <ShieldCheck size={20} />
          <div>
            <p className="text-sm font-bold">RH clôturé définitivement</p>
            <p className="text-xs">
              {board.rh.closed_at
                ? `le ${new Date(board.rh.closed_at).toLocaleString('fr-FR')}`
                : ''}{' '}
              {board.rh.closed_by ? `par ${board.rh.closed_by}` : ''} — écran en lecture seule.
            </p>
          </div>
        </div>
      )}

      {/* KPIs — prévisionnel vs réel (forfait-aware) */}
      {k && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Agents" value={String(k.nb_agents)} />
            <Kpi label="Heures" value={num(k.total_heures).toFixed(0)} />
            <Kpi label="Budget RH prévisionnel" value={eur(num(k.cout_previsionnel))} />
            <EcartKpi prev={num(k.cout_previsionnel)} reel={num(k.cout_reel)} />
          </div>
          <p className="text-xs text-stone-400">
            {num(k.nb_horaire)} à l'heure · {num(k.nb_forfait)} au forfait · coût / spectateur {num(k.cout_par_pax).toFixed(2)} €
          </p>
        </div>
      )}

      {/* Grille de facturation (vue quantité + édition en masse) */}
      <div>
        <button
          onClick={() => setShowBilling((v) => !v)}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-600 hover:text-stone-900"
        >
          <Receipt size={15} /> Grille de facturation ({board.hors_resto.length + board.resto.length})
          {showBilling ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        {showBilling && (
          <div className="mt-3">
            <RhBillingGrid
              eventId={eventId}
              agents={[...board.resto, ...board.hors_resto]}
              closed={closed}
              by={by}
              onChanged={load}
            />
          </div>
        )}
      </div>

      {/* Pôles hors restauration */}
      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-stone-500">
          Pôles hors restauration
        </h2>
        <div className="space-y-4">
          {[...parPole.entries()].map(([pole, agents]) => (
            <GroupCard
              key={`pole:${pole}`}
              title={pole}
              agents={agents}
              closed={closed}
              busy={busy}
              moveOptions={moveOptions}
              onEdit={(a, p) => run('rh_edit_agent', { p_agent: a.id, ...p, p_by: by }, 'Agent mis à jour.')}
              onMove={(a, toPole, toSpace) =>
                run('rh_move_agent', { p_agent: a.id, p_to_pole: toPole, p_to_space: toSpace, p_by: by }, 'Agent déplacé.')}
              onRemove={(a, reason) => run('rh_remove_agent', { p_agent: a.id, p_reason: reason, p_by: by }, 'Agent retiré.')}
              onRestore={(a) => run('rh_restore_agent', { p_agent: a.id, p_by: by }, 'Agent restauré.')}
              onAdd={(p) =>
                run('rh_add_agent', { p_event: eventId, p_pole: pole, p_space: null, ...p, p_by: by }, 'Agent ajouté.')}
            />
          ))}
        </div>
      </section>

      {/* Espaces restauration */}
      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-stone-500">
          Espaces restauration
        </h2>
        {parEspace.size === 0 ? (
          <Alert variant="info">Aucun agent restauration pour ce match.</Alert>
        ) : (
          <div className="space-y-4">
            {[...parEspace.entries()].map(([spaceId, { nom, agents }]) => (
              <GroupCard
                key={`space:${spaceId}`}
                title={nom}
                agents={agents}
                closed={closed}
                busy={busy}
                moveOptions={moveOptions}
                onEdit={(a, p) => run('rh_edit_agent', { p_agent: a.id, ...p, p_by: by }, 'Agent mis à jour.')}
                onMove={(a, toPole, toSpace) =>
                  run('rh_move_agent', { p_agent: a.id, p_to_pole: toPole, p_to_space: toSpace, p_by: by }, 'Agent déplacé.')}
                onRemove={(a, reason) => run('rh_remove_agent', { p_agent: a.id, p_reason: reason, p_by: by }, 'Agent retiré.')}
                onRestore={(a) => run('rh_restore_agent', { p_agent: a.id, p_by: by }, 'Agent restauré.')}
                onAdd={(p) =>
                  run('rh_add_agent', { p_event: eventId, p_pole: null, p_space: spaceId, ...p, p_by: by }, 'Agent ajouté.')}
              />
            ))}
          </div>
        )}
      </section>

      {/* Journal des mouvements */}
      <section>
        <button
          onClick={() => setShowJournal((v) => !v)}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-600 hover:text-stone-900"
        >
          <History size={15} /> Historique des mouvements ({board.mouvements.length})
          {showJournal ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        {showJournal && (
          <div className="mt-2 max-h-80 overflow-y-auto rounded-2xl border border-stone-100">
            {board.mouvements.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-stone-400">Aucun mouvement enregistré.</p>
            ) : (
              <ul className="divide-y divide-stone-50 text-sm">
                {board.mouvements.map((m, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-x-2 px-4 py-2">
                    <span className="text-xs tabular-nums text-stone-400">
                      {new Date(m.at).toLocaleString('fr-FR')}
                    </span>
                    <ActionBadge action={m.action} />
                    <span className="font-medium text-stone-800">{m.agent}</span>
                    {(m.from || m.to) && (
                      <span className="text-stone-500">
                        {m.from ?? '—'} → {m.to ?? '—'}
                      </span>
                    )}
                    {m.detail && <span className="text-xs text-stone-400">· {m.detail}</span>}
                    {m.by && <span className="ml-auto text-xs text-stone-400">par {m.by}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* Clôture définitive */}
      {!closed && (
        <div className="flex justify-end border-t border-stone-100 pt-4">
          <button
            disabled={busy}
            onClick={async () => {
              if (!window.confirm('Clôturer définitivement le RH de ce match ?\n\nLe coût RH sera figé et l\'écran passera en lecture seule.')) return;
              if (!window.confirm('Cette action est IRRÉVERSIBLE. Confirmer la clôture définitive ?')) return;
              await run('rh_close_event', { p_event: eventId, p_by: by }, 'RH clôturé définitivement.');
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
          >
            <Lock size={16} /> Clôturer définitivement le RH
          </button>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${accent ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-100 bg-white'}`}>
      <p className={`text-[11px] uppercase tracking-wide ${accent ? 'text-white/60' : 'text-stone-400'}`}>{label}</p>
      <p className="mt-1 text-xl font-black tabular-nums">{value}</p>
    </div>
  );
}

/** Coût réel + écart réel−prévisionnel (vert = sous budget, rouge = dépassement). */
function EcartKpi({ prev, reel }: { prev: number; reel: number }) {
  const ecart = Math.round(reel - prev);
  const over = ecart > 0;
  const eur0 = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
  return (
    <div className="rounded-2xl border border-stone-900 bg-stone-900 p-4 text-white">
      <p className="text-[11px] uppercase tracking-wide text-white/60">Coût RH réel</p>
      <p className="mt-1 text-xl font-black tabular-nums">{eur0(reel)}</p>
      {ecart !== 0 && (
        <p className={`mt-0.5 text-[11px] font-bold ${over ? 'text-rose-400' : 'text-emerald-400'}`}>
          {over ? '▲' : '▼'} {over ? '+' : ''}{eur0(ecart)} vs prév.
        </p>
      )}
    </div>
  );
}

const ACTION_STYLES: Record<string, string> = {
  ajout: 'bg-emerald-100 text-emerald-700',
  renommage: 'bg-blue-100 text-blue-700',
  deplacement: 'bg-amber-100 text-amber-700',
  retrait: 'bg-rose-100 text-rose-700',
  restauration: 'bg-teal-100 text-teal-700',
  cloture: 'bg-stone-800 text-white',
};
function ActionBadge({ action }: { action: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${ACTION_STYLES[action] ?? 'bg-stone-100 text-stone-600'}`}>
      {action}
    </span>
  );
}

interface EditParams { p_nom: string; p_prenom: string; p_role: string; p_hours: number; p_rate: number | null; p_billing_mode: string; p_forfait: number | null; }
interface AddParams { p_nom: string; p_prenom: string; p_role: string; p_start: string; p_hours: number; p_rate: number | null; p_billing_mode: string; p_forfait: number | null; }

function GroupCard({
  title, agents, closed, busy, moveOptions,
  onEdit, onMove, onRemove, onRestore, onAdd,
}: {
  title: string;
  agents: Agent[];
  closed: boolean;
  busy: boolean;
  moveOptions: { value: string; label: string }[];
  onEdit: (a: Agent, p: EditParams) => Promise<boolean>;
  onMove: (a: Agent, toPole: string | null, toSpace: string | null) => Promise<boolean>;
  onRemove: (a: Agent, reason: string | null) => Promise<boolean>;
  onRestore: (a: Agent) => Promise<boolean>;
  onAdd: (p: AddParams) => Promise<boolean>;
}) {
  const [adding, setAdding] = useState(false);
  const active = agents.filter((a) => a.status !== 'retiré' && a.status !== 'absent');
  const totalH = active.reduce((s, a) => s + num(a.heures), 0);

  return (
    <div className="overflow-hidden rounded-2xl border border-stone-100 bg-white">
      <div className="flex items-center justify-between border-b border-stone-100 bg-stone-50 px-4 py-2.5">
        <p className="text-sm font-bold text-stone-800">
          {title}
          <span className="ml-2 text-xs font-normal text-stone-400">
            {active.length} agent{active.length > 1 ? 's' : ''} · {totalH.toFixed(1)} h
          </span>
        </p>
        {!closed && (
          <button
            onClick={() => setAdding((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg bg-stone-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-stone-700"
          >
            <Plus size={13} /> Ajouter
          </button>
        )}
      </div>

      {adding && !closed && (
        <AddForm
          busy={busy}
          onCancel={() => setAdding(false)}
          onSubmit={async (p) => {
            const ok = await onAdd(p);
            if (ok) setAdding(false);
          }}
        />
      )}

      {agents.length === 0 ? (
        <p className="px-4 py-3 text-sm text-stone-400">Aucun agent.</p>
      ) : (
        <ul className="divide-y divide-stone-50">
          {agents.map((a) => (
            <AgentLine
              key={a.id}
              agent={a}
              closed={closed}
              busy={busy}
              moveOptions={moveOptions}
              onEdit={onEdit}
              onMove={onMove}
              onRemove={onRemove}
              onRestore={onRestore}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function AddForm({
  busy, onCancel, onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (p: AddParams) => Promise<void>;
}) {
  const [nom, setNom] = useState('');
  const [prenom, setPrenom] = useState('');
  const [role, setRole] = useState<string>('Autre');
  const [start, setStart] = useState('17:00');
  const [hours, setHours] = useState('6');
  const [billing, setBilling] = useState('horaire');
  const [price, setPrice] = useState('');

  return (
    <div className="grid grid-cols-2 gap-2 border-b border-stone-100 bg-stone-50/60 px-4 py-3 sm:grid-cols-8">
      <Input placeholder="Nom" value={nom} onChange={(e) => setNom(e.target.value)} />
      <Input placeholder="Prénom" value={prenom} onChange={(e) => setPrenom(e.target.value)} />
      <Select value={role} onChange={(e) => setRole(e.target.value)} options={ROLE_OPTIONS.map((r) => ({ value: r, label: r }))} />
      <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
      <Input type="number" step="0.25" placeholder="Heures" value={hours} onChange={(e) => setHours(e.target.value)} />
      <Select value={billing} onChange={(e) => setBilling(e.target.value)} options={[{ value: 'horaire', label: 'Horaire' }, { value: 'forfait', label: 'Forfait' }]} />
      <Input type="number" step="0.5" placeholder={billing === 'forfait' ? 'Forfait €' : '€/h'} value={price} onChange={(e) => setPrice(e.target.value)} />
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          disabled={busy || nom.trim().length < 1}
          onClick={() =>
            void onSubmit({
              p_nom: nom.trim(),
              p_prenom: prenom.trim(),
              p_role: role,
              p_start: start || '17:00',
              p_hours: num(hours),
              p_rate: billing === 'horaire' && price ? num(price) : null,
              p_billing_mode: billing,
              p_forfait: billing === 'forfait' && price ? num(price) : null,
            })
          }
        >
          <Check size={14} />
        </Button>
        <button onClick={onCancel} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

function AgentLine({
  agent, closed, busy, moveOptions, onEdit, onMove, onRemove, onRestore,
}: {
  agent: Agent;
  closed: boolean;
  busy: boolean;
  moveOptions: { value: string; label: string }[];
  onEdit: (a: Agent, p: EditParams) => Promise<boolean>;
  onMove: (a: Agent, toPole: string | null, toSpace: string | null) => Promise<boolean>;
  onRemove: (a: Agent, reason: string | null) => Promise<boolean>;
  onRestore: (a: Agent) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [nom, setNom] = useState(agent.nom);
  const [prenom, setPrenom] = useState(agent.prenom);
  const [role, setRole] = useState(agent.role);
  const [hours, setHours] = useState(String(num(agent.heures)));
  const [rate, setRate] = useState(String(num(agent.taux)));
  const [billing, setBilling] = useState(agent.billing_mode ?? 'horaire');
  const [forfait, setForfait] = useState(String(num(agent.forfait ?? 0)));

  const removed = agent.status === 'retiré' || agent.status === 'absent';

  if (editing) {
    return (
      <li className="grid grid-cols-2 gap-2 bg-blue-50/40 px-4 py-3 sm:grid-cols-8">
        <Input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Nom" />
        <Input value={prenom} onChange={(e) => setPrenom(e.target.value)} placeholder="Prénom" />
        <Select value={role} onChange={(e) => setRole(e.target.value)} options={ROLE_OPTIONS.map((r) => ({ value: r, label: r }))} />
        <Input type="number" step="0.25" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="Heures" />
        <Select value={billing} onChange={(e) => setBilling(e.target.value)} options={[{ value: 'horaire', label: 'Horaire' }, { value: 'forfait', label: 'Forfait' }]} />
        {billing === 'forfait' ? (
          <Input type="number" step="0.5" value={forfait} onChange={(e) => setForfait(e.target.value)} placeholder="Forfait €" />
        ) : (
          <Input type="number" step="0.5" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="€/h" />
        )}
        <div className="col-span-2 flex items-center gap-1">
          <Button
            size="sm"
            disabled={busy || nom.trim().length < 1}
            onClick={async () => {
              const ok = await onEdit(agent, {
                p_nom: nom.trim(), p_prenom: prenom.trim(), p_role: role,
                p_hours: num(hours), p_rate: num(rate),
                p_billing_mode: billing, p_forfait: billing === 'forfait' ? num(forfait) : null,
              });
              if (ok) setEditing(false);
            }}
          >
            <Check size={14} />
          </Button>
          <button onClick={() => setEditing(false)} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100">
            <X size={16} />
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 ${removed ? 'bg-stone-50/60' : ''}`}>
      <span className={`min-w-0 flex-1 text-sm ${removed ? 'text-stone-400 line-through' : 'text-stone-800'}`}>
        <span className="font-medium">{`${agent.prenom} ${agent.nom}`.trim()}</span>
        <span className="ml-2 text-xs text-stone-400">{agent.role}</span>
        <span className="ml-2"><BillingChip mode={agent.billing_mode} taux={num(agent.taux)} forfait={agent.forfait} /></span>
      </span>
      <span className="text-xs tabular-nums text-stone-500">{num(agent.heures).toFixed(1)} h</span>

      {closed ? null : removed ? (
        <button
          disabled={busy}
          onClick={() => void onRestore(agent)}
          className="inline-flex items-center gap-1 rounded-lg border border-teal-200 px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50"
        >
          <RotateCcw size={13} /> Restaurer
        </button>
      ) : (
        <div className="flex items-center gap-1">
          <button
            title="Éditer"
            disabled={busy}
            onClick={() => setEditing(true)}
            className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-50"
          >
            <Pencil size={14} />
          </button>
          <div className="relative">
            <select
              disabled={busy}
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                if (v.startsWith('pole:')) void onMove(agent, v.slice(5), null);
                else if (v.startsWith('space:')) void onMove(agent, null, v.slice(6));
                e.target.value = '';
              }}
              className="appearance-none rounded-lg border border-stone-200 bg-white py-1 pl-6 pr-2 text-xs text-stone-600 hover:bg-stone-50 disabled:opacity-50"
              title="Déplacer"
            >
              {moveOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <ArrowRightLeft size={12} className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-stone-400" />
          </div>
          <button
            title="Retirer"
            disabled={busy}
            onClick={() => {
              const reason = window.prompt('Motif du retrait (optionnel) :') ?? null;
              void onRemove(agent, reason);
            }}
            className="rounded-lg p-1.5 text-stone-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
          >
            <UserMinus size={14} />
          </button>
        </div>
      )}
    </li>
  );
}
