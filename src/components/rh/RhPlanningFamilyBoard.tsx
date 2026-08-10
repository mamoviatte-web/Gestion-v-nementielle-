/**
 * RhPlanningFamilyBoard — rendu « vivant » du Planning RH Match, groupé par
 * FAMILLE d'espace (VIP & Salons · Buvettes · Bars & Clubs · Terrasses &
 * Extérieur · Hors restauration). La classification vient de la base
 * (rh_planning_board → familles[].key) : jamais déduite du nom côté front.
 *
 * Barre de synthèse collante (compteurs animés + jauge de pointage), chips de
 * filtre par famille, sections repliables, cartes d'espace avec état + barre
 * « % pointé » animée, section hors-resto par pôle (Cashless/Sécurité/Accueil/
 * Autres — cliquables). Clic sur une carte d'espace OU de pôle → gestion RH
 * opérationnelle (GroupCard de rh_board : édition heures/facturation, ajout,
 * déplacement, retrait). Realtime sur event_staff_preplan → refresh (debounce).
 * RG-003 : rh_planning_board / rh_board réservés ROLE_STADE (garde base).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Crown, CupSoda, Martini, Sun, ScanLine, CreditCard, Shield, Users,
  ChevronDown, ChevronRight, ShieldCheck, type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Alert, Spinner } from '@/components/ui';
import { GroupCard, type Agent } from '@/components/rh/RhOperationalBoard';

/** Slice « agents » de rh_board (détails éditables : heures, facturation, statut). */
interface OpsBoard {
  hors_resto: Agent[];
  resto: Agent[];
  poles: string[];
  espaces: { id: string; nom: string }[];
}

interface Espace {
  id: string; nom: string; agents: number; heures: number; cout: number;
  pct_pointe: number; etat: 'vide' | 'planifie' | 'en_cours' | 'complet';
}
interface Famille {
  key: string; label: string; ordre: number;
  totaux: { espaces: number; agents: number; heures: number; cout: number; pct_pointe: number };
  espaces: Espace[];
}
interface Pole { pole: string; agents: number; heures: number; cout: number; }
interface HorsResto {
  key: string; label: string; ordre: number;
  totaux: { agents: number; heures: number; cout: number };
  poles: Pole[];
}
interface PlanningBoard {
  error?: string;
  event: { id: string; nom: string; date: string; closed: boolean } | null;
  familles: Famille[];
  hors_resto: HorsResto | null;
}

interface FamilyStyle { label: string; accent: string; soft: string; ring: string; Icon: LucideIcon; }
const FAMILY: Record<string, FamilyStyle> = {
  vip: { label: 'VIP & Salons', accent: '#B8860B', soft: '#FBF3DD', ring: '#E7C765', Icon: Crown },
  buvette: { label: 'Buvettes', accent: '#1D7A46', soft: '#E4F4EA', ring: '#79C79B', Icon: CupSoda },
  bar: { label: 'Bars & Clubs', accent: '#5B4B8A', soft: '#ECE8F7', ring: '#B3A4E0', Icon: Martini },
  terrasse: { label: 'Terrasses & Extérieur', accent: '#0E7C7B', soft: '#DDF3F2', ring: '#6FC9C7', Icon: Sun },
  horsresto: { label: 'Hors restauration', accent: '#2F6FED', soft: '#E4ECFD', ring: '#8FB2F5', Icon: ScanLine },
};
const famStyle = (key: string): FamilyStyle => FAMILY[key] ?? FAMILY.horsresto;

const ETAT: Record<string, { label: string; dot: string }> = {
  vide: { label: 'Vide', dot: '#9AA3AF' },
  planifie: { label: 'Planifié', dot: '#2F6FED' },
  en_cours: { label: 'En cours', dot: '#C9A227' },
  complet: { label: 'Complet', dot: '#1D7A46' },
};
const POLE_ICON: Record<string, LucideIcon> = {
  Cashless: CreditCard, 'Sécurité/Mascotte': Shield, 'Accueil/Scanettes': ScanLine, Autres: Users,
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const eur = (v: number): string => Math.round(v).toLocaleString('fr-FR') + ' €';

/** Compteur animé (count-up) piloté par requestAnimationFrame. */
function useCountUp(target: number, ms = 600): number {
  const [val, setVal] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - (1 - t) * (1 - t);
      setVal(from + (target - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return val;
}

export function RhPlanningFamilyBoard({
  eventId,
  onExternalChange,
  refreshSignal = 0,
}: {
  eventId: string;
  onExternalChange?: () => void;
  refreshSignal?: number;
}) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const by = user?.name ?? user?.email ?? 'RH';

  const [board, setBoard] = useState<PlanningBoard | null>(null);
  const [ops, setOps] = useState<OpsBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [activeFamily, setActiveFamily] = useState<string | null>(null);
  const [closedFamilies, setClosedFamilies] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null); // space_id
  const [expandedPole, setExpandedPole] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [pb, ob] = await Promise.all([
      supabase.rpc('rh_planning_board', { p_event: eventId }),
      supabase.rpc('rh_board', { p_event: eventId }),
    ]);
    setBoard((pb.data as PlanningBoard | null) ?? null);
    const b = ob.data as { hors_resto?: Agent[]; resto?: Agent[]; poles?: string[]; espaces?: { id: string; nom: string }[] } | null;
    setOps({
      hors_resto: b?.hors_resto ?? [], resto: b?.resto ?? [],
      poles: b?.poles ?? [], espaces: b?.espaces ?? [],
    });
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load, refreshSignal]);

  // Realtime : toute écriture sur event_staff_preplan de cet événement → refresh
  // (debounce 300ms) + notification au parent (compteur pré-plan).
  useEffect(() => {
    const timer = { id: 0 as ReturnType<typeof setTimeout> | 0 };
    const schedule = () => {
      if (timer.id) clearTimeout(timer.id);
      timer.id = setTimeout(() => {
        void load();
        onExternalChange?.();
      }, 300);
    };
    const ch = supabase
      .channel(`rh-planning-${eventId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'event_staff_preplan', filter: `event_id=eq.${eventId}` },
        schedule,
      )
      .subscribe();
    return () => {
      if (timer.id) clearTimeout(timer.id);
      void supabase.removeChannel(ch);
    };
  }, [eventId, load, onExternalChange]);

  /** Exécute une RPC opérationnelle (édition/ajout/déplacement…) puis recharge. */
  const run = useCallback(
    async (fn: string, params: Record<string, unknown>, okMsg: string): Promise<boolean> => {
      setBusy(true);
      const { data, error } = await supabase.rpc(fn, params);
      setBusy(false);
      const res = data as { success?: boolean; error?: string } | null;
      if (error || !res?.success) {
        showToast(`Échec : ${res?.error ?? error?.message ?? 'erreur'}`, 'warning');
        return false;
      }
      showToast(okMsg, 'success');
      await load();
      onExternalChange?.();
      return true;
    },
    [load, showToast, onExternalChange],
  );

  const moveOptions = useMemo(() => {
    if (!ops) return [];
    return [
      { value: '', label: '↪ Déplacer vers…' },
      ...ops.poles.map((p) => ({ value: `pole:${p}`, label: `Pôle · ${p}` })),
      ...ops.espaces.map((e) => ({ value: `space:${e.id}`, label: `Espace · ${e.nom}` })),
    ];
  }, [ops]);

  const closed = board?.event?.closed ?? false;

  /** Rend un GroupCard opérationnel (édition heures/facturation, ajout, déplacement, retrait). */
  const renderGroup = (title: string, agents: Agent[], onAddCtx: { pole: string | null; space: string | null }) => (
    <GroupCard
      title={title}
      agents={agents}
      closed={closed}
      busy={busy}
      moveOptions={moveOptions}
      onEdit={(a, p) => run('rh_edit_agent', { p_agent: a.id, ...p, p_by: by }, 'Agent mis à jour.')}
      onMove={(a, toPole, toSpace) => run('rh_move_agent', { p_agent: a.id, p_to_pole: toPole, p_to_space: toSpace, p_by: by }, 'Agent déplacé.')}
      onRemove={(a, reason) => run('rh_remove_agent', { p_agent: a.id, p_reason: reason, p_by: by }, 'Agent retiré.')}
      onRestore={(a) => run('rh_restore_agent', { p_agent: a.id, p_by: by }, 'Agent restauré.')}
      onAdd={(p) => run('rh_add_agent', { p_event: eventId, p_pole: onAddCtx.pole, p_space: onAddCtx.space, ...p, p_by: by }, 'Agent ajouté.')}
    />
  );
  const familles = useMemo(() => board?.familles ?? [], [board]);
  const hr = board?.hors_resto ?? null;

  // Totaux globaux (familles + hors resto).
  const totals = useMemo(() => {
    let agents = 0, heures = 0, cout = 0, pointeW = 0;
    for (const f of familles) {
      agents += num(f.totaux.agents);
      heures += num(f.totaux.heures);
      cout += num(f.totaux.cout);
      pointeW += num(f.totaux.agents) * num(f.totaux.pct_pointe);
    }
    if (hr) {
      agents += num(hr.totaux.agents);
      heures += num(hr.totaux.heures);
      cout += num(hr.totaux.cout);
    }
    const restoAgents = familles.reduce((s, f) => s + num(f.totaux.agents), 0);
    const pct = restoAgents > 0 ? Math.round(pointeW / restoAgents) : 0;
    return { agents, heures, cout, pct };
  }, [familles, hr]);

  const aAgents = useCountUp(totals.agents);
  const aHeures = useCountUp(totals.heures);
  const aCout = useCountUp(totals.cout);

  if (loading) return <Spinner />;
  if (!board) return <Alert variant="error">Impossible de charger le planning.</Alert>;
  if (board.error) return <Alert variant="warning">{board.error}</Alert>;

  // Cartes de pôles hors resto : union des pôles peuplés (stats) et des pôles
  // standard (Cashless/Sécurité/Accueil/Autres) même vides → toujours accessibles.
  const poleStats = new Map((hr?.poles ?? []).map((p) => [p.pole, p]));
  const poleNames = Array.from(new Set([...(hr?.poles ?? []).map((p) => p.pole), ...(ops?.poles ?? [])]));
  const poleCards: Pole[] = poleNames.map((n) => poleStats.get(n) ?? { pole: n, agents: 0, heures: 0, cout: 0 });

  const showFamily = (key: string) => activeFamily === null || activeFamily === key;
  const toggleClosed = (key: string) =>
    setClosedFamilies((prev) => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });

  return (
    <div className="space-y-5">
      {closed && (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-emerald-800">
          <ShieldCheck size={20} />
          <p className="text-sm font-bold">RH clôturé définitivement — écran en lecture seule.</p>
        </div>
      )}

      {/* Barre de synthèse collante */}
      <div className="sticky top-0 z-20 -mx-1 rounded-2xl border border-stone-200 bg-white/90 px-4 py-3 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <Stat label="Agents" value={Math.round(aAgents).toString()} />
          <Stat label="Heures" value={aHeures.toFixed(0)} />
          <Stat label="Coût RH HT" value={eur(aCout)} />
          <div className="min-w-[180px] flex-1">
            <div className="mb-1 flex items-center justify-between text-xs text-stone-500">
              <span>Pointage global</span>
              <span className="font-bold tabular-nums">{totals.pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-stone-100">
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width] duration-500"
                style={{ width: `${totals.pct}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Chips de filtre par famille */}
      <div className="flex flex-wrap gap-2">
        {familles.map((f) => {
          const st = famStyle(f.key);
          const on = activeFamily === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setActiveFamily(on ? null : f.key)}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors"
              style={{
                borderColor: st.ring,
                background: on ? st.accent : st.soft,
                color: on ? '#fff' : st.accent,
              }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: on ? '#fff' : st.accent }} />
              {st.label}
              <span className="rounded-full bg-white/40 px-1.5 text-[10px] tabular-nums">{f.totaux.espaces}</span>
            </button>
          );
        })}
        {hr && hr.totaux.agents > 0 && (
          <button
            onClick={() => setActiveFamily(activeFamily === 'horsresto' ? null : 'horsresto')}
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors"
            style={{
              borderColor: FAMILY.horsresto.ring,
              background: activeFamily === 'horsresto' ? FAMILY.horsresto.accent : FAMILY.horsresto.soft,
              color: activeFamily === 'horsresto' ? '#fff' : FAMILY.horsresto.accent,
            }}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: activeFamily === 'horsresto' ? '#fff' : FAMILY.horsresto.accent }} />
            {FAMILY.horsresto.label}
            <span className="rounded-full bg-white/40 px-1.5 text-[10px] tabular-nums">{hr.poles.length}</span>
          </button>
        )}
      </div>

      {/* Sections par famille */}
      {familles.map((f, idx) => {
        if (!showFamily(f.key)) return null;
        const st = famStyle(f.key);
        const open = !closedFamilies.has(f.key);
        return (
          <section
            key={f.key}
            className="overflow-hidden rounded-2xl border animate-fadeUp"
            style={{ borderColor: st.ring, animationDelay: `${idx * 40}ms` }}
          >
            <button
              onClick={() => toggleClosed(f.key)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left"
              style={{ background: st.soft }}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl text-white" style={{ background: st.accent }}>
                <st.Icon size={18} />
              </span>
              <span className="font-bold" style={{ color: st.accent }}>{st.label}</span>
              <span className="ml-auto flex items-center gap-3 text-xs" style={{ color: st.accent }}>
                <span>{f.totaux.espaces} esp.</span>
                <span>{num(f.totaux.agents)} ag.</span>
                <span>{num(f.totaux.heures).toFixed(0)} h</span>
                <span className="font-bold">{eur(num(f.totaux.cout))}</span>
                <span className="rounded-full bg-white/60 px-2 py-0.5 font-bold tabular-nums">{num(f.totaux.pct_pointe)}%</span>
                {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </span>
            </button>
            {open && (
              <div className="bg-white p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {f.espaces.map((e) => {
                    const et = ETAT[e.etat] ?? ETAT.planifie;
                    const isOpen = expanded === e.id;
                    return (
                      <button
                        key={e.id}
                        onClick={() => setExpanded(isOpen ? null : e.id)}
                        className="group relative overflow-hidden rounded-xl border border-stone-200 bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
                        style={isOpen ? { boxShadow: `0 0 0 2px ${st.ring}` } : undefined}
                      >
                        <span className="absolute inset-y-0 left-0 w-1" style={{ background: st.accent }} />
                        <div className="flex items-center justify-between">
                          <p className="font-bold text-stone-800">{e.nom}</p>
                          <span className="inline-flex items-center gap-1 text-[11px] text-stone-500">
                            <span className="h-2 w-2 rounded-full" style={{ background: et.dot }} />
                            {et.label}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-stone-500">
                          {num(e.agents)} agents · {num(e.heures).toFixed(1)} h · {eur(num(e.cout))}
                        </p>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-100">
                          <div
                            className="h-full rounded-full transition-[width] duration-500"
                            style={{ width: `${num(e.pct_pointe)}%`, background: st.accent }}
                          />
                        </div>
                        <p className="mt-1 text-[11px] text-stone-400">{num(e.pct_pointe)}% pointé</p>
                      </button>
                    );
                  })}
                </div>
                {/* Détail RH opérationnel de l'espace : édition heures/facturation, ajout, déplacement, retrait. */}
                {expanded && f.espaces.some((e) => e.id === expanded) && (
                  <div className="mt-4">
                    {renderGroup(
                      f.espaces.find((e) => e.id === expanded)?.nom ?? '',
                      (ops?.resto ?? []).filter((a) => a.space_id === expanded),
                      { pole: null, space: expanded },
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}

      {/* Section Hors restauration */}
      {poleCards.length > 0 && showFamily('horsresto') && (
        <section className="overflow-hidden rounded-2xl border" style={{ borderColor: FAMILY.horsresto.ring }}>
          <div className="flex items-center gap-3 px-4 py-3" style={{ background: FAMILY.horsresto.soft }}>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl text-white" style={{ background: FAMILY.horsresto.accent }}>
              <ScanLine size={18} />
            </span>
            <div>
              <p className="font-bold" style={{ color: FAMILY.horsresto.accent }}>{FAMILY.horsresto.label}</p>
              <p className="text-[11px]" style={{ color: FAMILY.horsresto.accent }}>agents sans espace physique — cliquez un pôle pour gérer</p>
            </div>
            <span className="ml-auto flex items-center gap-3 text-xs" style={{ color: FAMILY.horsresto.accent }}>
              <span>{num(hr?.totaux.agents)} ag.</span>
              <span>{num(hr?.totaux.heures).toFixed(0)} h</span>
              <span className="font-bold">{eur(num(hr?.totaux.cout))}</span>
            </span>
          </div>
          <div className="bg-white p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {poleCards.map((p) => {
                const Icon = POLE_ICON[p.pole] ?? Users;
                const isOpen = expandedPole === p.pole;
                return (
                  <button
                    key={p.pole}
                    onClick={() => setExpandedPole(isOpen ? null : p.pole)}
                    className="rounded-xl border border-stone-200 p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
                    style={{ background: FAMILY.horsresto.soft, boxShadow: isOpen ? `0 0 0 2px ${FAMILY.horsresto.ring}` : undefined }}
                  >
                    <div className="flex items-center gap-2">
                      <Icon size={16} style={{ color: FAMILY.horsresto.accent }} />
                      <p className="text-sm font-bold text-stone-800">{p.pole}</p>
                      <span className="ml-auto text-stone-400">{isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span>
                    </div>
                    <p className="mt-1 text-xs text-stone-500">
                      {num(p.agents)} agents · {num(p.heures).toFixed(1)} h · {eur(num(p.cout))}
                    </p>
                  </button>
                );
              })}
            </div>
            {/* Détail RH opérationnel du pôle sélectionné */}
            {expandedPole && (
              <div className="mt-4">
                {renderGroup(
                  expandedPole,
                  (ops?.hors_resto ?? []).filter((a) => (a.pole ?? 'Autres') === expandedPole),
                  { pole: expandedPole, space: null },
                )}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-lg font-black tabular-nums text-stone-900">{value}</p>
      <p className="text-[11px] uppercase tracking-wide text-stone-400">{label}</p>
    </div>
  );
}
