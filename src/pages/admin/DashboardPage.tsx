/**
 * DashboardPage — Tableau de bord « Stadium Manager » (système visuel homogène).
 * Présentation restylée (jetons de design, tuiles KPI, carte graphe, inbox) —
 * AUCUNE donnée ni liaison changée : mêmes sources qu'avant.
 *
 * Sources (lecture seule) :
 *  - dashboard_kpis (F&B annuel, clôtures, matchs)
 *  - audit_latest_run (santé des données) — tuile accent
 *  - consumption_general_by_space (conso par famille) — carte graphe
 *  - events + dashboard_vip_spaces_status (hero, espaces VIP, activité récente)
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight, Activity, Calendar, Users, Trophy, Presentation,
  BarChart3, CheckCircle2, Loader2, Circle, Star, Beer, Wine, Music,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { isMatch } from '@/lib/eventUtils';
import { WeeklyPlanner } from '@/components/dashboard/WeeklyPlanner';
import { InboxPanel } from '@/components/dashboard/InboxPanel';

type StockStatus = 'en_attente' | 'en_cours' | 'cloture';

interface Kpis { total_evenements: number; en_cours: number; matchs_ce_mois: number; fb_annuel_ht: number; clotures_annee: number }
interface Health { global_score: number; critical_count: number; warning_count: number }
interface FamilyBar { family: 'VIP' | 'Bars' | 'Buvettes'; valeur: number }
interface EventRow { event_id: string; event_name: string; event_type: string | null; status: string; event_date: string; start_time: string | null; expected_attendees: number | null }
interface HistoryRow { event_id: string; event_name: string; event_type: string | null; status: string; event_date: string; total_fb_cost_ht: number | null; expected_attendees: number | null }
interface VipSpaceRow { event_id: string; space_id: string; space_name: string; space_profile: string; stock_status: StockStatus; responsable: string | null }

const SPACE_ICON: Record<string, LucideIcon> = { salon: Star, loge: Trophy, bar_pub: Beer, wine_bar: Wine, club: Music };
const FAM_META: { family: FamilyBar['family']; cls: string }[] = [
  { family: 'VIP', cls: 'vip' }, { family: 'Bars', cls: 'bars' }, { family: 'Buvettes', cls: 'buv' },
];

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}
const eur0 = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 0 });

function SpaceStatusPill({ status }: { status: StockStatus }) {
  if (status === 'cloture') return <span className="pill good"><CheckCircle2 size={12} /> Clôturé</span>;
  if (status === 'en_cours') return <span className="pill warn"><Loader2 size={12} /> En cours</span>;
  return <span className="pill mute"><Circle size={12} /> En attente</span>;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [families, setFamilies] = useState<FamilyBar[]>([]);
  const [active, setActive] = useState<EventRow | null>(null);
  const [next, setNext] = useState<EventRow | null>(null);
  const [spaces, setSpaces] = useState<VipSpaceRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    async function load() {
      const [k, hlt, cons, evts, sp, hist] = await Promise.all([
        supabase.from('dashboard_kpis').select('*').maybeSingle(),
        supabase.from('audit_latest_run').select('global_score, critical_count, warning_count').maybeSingle(),
        supabase.from('consumption_general_by_space').select('family, valeur_ht'),
        supabase.from('events').select('event_id, event_name, event_type, status, event_date, start_time, expected_attendees').in('status', ['en_cours', 'préparé']).order('event_date').limit(5),
        supabase.from('dashboard_vip_spaces_status').select('*'),
        supabase.from('events').select('event_id, event_name, event_type, status, event_date, total_fb_cost_ht, expected_attendees').in('status', ['clôturé', 'archivé']).order('event_date', { ascending: false }).limit(5),
      ]);
      if (!alive) return;

      const kData = (k.data as Record<string, unknown> | null) ?? null;
      setKpis(kData ? {
        total_evenements: num(kData.total_evenements), en_cours: num(kData.en_cours),
        matchs_ce_mois: num(kData.matchs_ce_mois), fb_annuel_ht: num(kData.fb_annuel_ht), clotures_annee: num(kData.clotures_annee),
      } : null);

      const hData = (hlt.data as Record<string, unknown> | null) ?? null;
      setHealth(hData ? { global_score: num(hData.global_score), critical_count: num(hData.critical_count), warning_count: num(hData.warning_count) } : null);

      const consRows = (cons.data as { family: string; valeur_ht: number }[] | null) ?? [];
      const byFam = new Map<string, number>();
      for (const r of consRows) byFam.set(r.family, (byFam.get(r.family) ?? 0) + num(r.valeur_ht));
      setFamilies(FAM_META.map((f) => ({ family: f.family, valeur: byFam.get(f.family) ?? 0 })).filter((f) => f.valeur > 0));

      const events = (evts.data as EventRow[] | null) ?? [];
      const enCours = events.find((e) => e.status === 'en_cours') ?? null;
      const today = new Date().toISOString().slice(0, 10);
      const prochain = events.filter((e) => e.status === 'préparé' && String(e.event_date).slice(0, 10) >= today)
        .sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)))[0] ?? null;
      setActive(enCours);
      setNext(enCours ? null : prochain);
      setSpaces((sp.data as VipSpaceRow[] | null) ?? []);
      setHistory((hist.data as HistoryRow[] | null) ?? []);
      setLoading(false);
    }
    void load();
    return () => { alive = false; };
  }, []);

  const heroEvent = active ?? next;
  const activeSpaces = useMemo(() => (active ? spaces.filter((s) => s.event_id === active.event_id) : []), [active, spaces]);
  const famMax = useMemo(() => Math.max(1, ...families.map((f) => f.valeur)), [families]);

  if (loading)
    return (
      <div className="dash space-y-4 p-6" style={{ background: 'var(--bg)' }}>
        <div className="h-32 animate-pulse rounded-3xl bg-stone-200" />
        <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-stone-100" />)}
        </div>
      </div>
    );

  return (
    <div className="dash mx-auto min-h-screen max-w-6xl space-y-5 p-6" style={{ background: 'var(--bg)' }}>
      {/* ── À TRAITER (inbox unifiée) ── */}
      <InboxPanel />

      {/* ── HERO événement ── */}
      {heroEvent ? (
        <button
          onClick={() => navigate(`/admin/events/${heroEvent.event_id}`)}
          className="relative w-full overflow-hidden rounded-3xl text-left transition-transform hover:scale-[1.004]"
          style={{ background: '#1b1a17' }}
        >
          <div className="absolute inset-0 opacity-[0.12]" style={{ background: 'radial-gradient(circle at 82% 50%, var(--accent), transparent 60%)' }} />
          <div className="relative flex items-center justify-between p-6">
            <div>
              <div className="mb-3 flex items-center gap-2">
                {active ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold text-white" style={{ background: 'var(--crit)' }}>
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> EN COURS
                  </span>
                ) : (
                  <span className="text-[11px] font-bold uppercase tracking-widest text-white/45">Prochain événement</span>
                )}
                <span className="inline-flex items-center gap-1 text-xs font-medium text-white/45">
                  {isMatch(heroEvent.event_type) ? <><Trophy size={13} /> Match</> : <><Presentation size={13} /> Séminaire</>}
                </span>
              </div>
              <p className="text-3xl font-black leading-tight text-white">{heroEvent.event_name}</p>
              <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-white/55">
                <span className="inline-flex items-center gap-1.5">
                  <Calendar size={14} />{new Date(heroEvent.event_date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                  {heroEvent.start_time && ` · ${heroEvent.start_time.slice(0, 5)}`}
                </span>
                {!!heroEvent.expected_attendees && (
                  <span className="num inline-flex items-center gap-1.5"><Users size={14} />{heroEvent.expected_attendees.toLocaleString('fr-FR')} pax</span>
                )}
              </div>
            </div>
            <ChevronRight size={24} className="shrink-0 text-white/30" />
          </div>
          <div className="h-0.5 w-full" style={{ background: 'var(--accent)' }} />
        </button>
      ) : (
        <div className="rounded-3xl border border-dashed p-6 text-center" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
          <p className="font-medium" style={{ color: 'var(--muted)' }}>Aucun événement en cours ou à venir</p>
          <button onClick={() => navigate('/admin/events')} className="mt-3 rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ background: 'var(--ink)' }}>
            + Créer un événement
          </button>
        </div>
      )}

      {/* ── TUILES KPI ── */}
      <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
        <div className="kpi">
          <div className="kpi-l">Coût F&amp;B HT (année)</div>
          <div className="kpi-v num">{kpis?.fb_annuel_ht ? `${eur0(kpis.fb_annuel_ht)} €` : '—'}</div>
          <div className="kpi-s">prix figés à la clôture</div>
        </div>
        <div className="kpi">
          <div className="kpi-l">Événements clôturés</div>
          <div className="kpi-v num">{kpis?.clotures_annee ?? 0}</div>
          <div className="kpi-s">sur l'année</div>
        </div>
        <div className="kpi">
          <div className="kpi-l">Matchs ce mois</div>
          <div className="kpi-v num">{kpis?.matchs_ce_mois ?? 0}</div>
          <div className="kpi-s">à venir &amp; en cours</div>
        </div>
        <div className="kpi accent">
          <div className="kpi-l">Santé des données</div>
          <div className="kpi-v num">{health ? `${health.global_score}/100` : '—'}</div>
          <div className={`kpi-s ${health && (health.critical_count > 0 || health.warning_count > 0) ? 'down' : health ? 'up' : ''}`}>
            {health ? (health.critical_count + health.warning_count === 0 ? 'aucune anomalie' : `${health.critical_count} critique(s) · ${health.warning_count} alerte(s)`) : 'audit non lancé'}
          </div>
        </div>
      </div>

      {/* ── GRAPHE : consommation par famille ── */}
      {families.length > 0 && (
        <div className="card p-5">
          <div className="mb-1 flex items-center gap-2">
            <BarChart3 size={16} style={{ color: 'var(--ink-2)' }} />
            <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>Consommation par famille</p>
            <span className="ml-auto text-xs" style={{ color: 'var(--muted)' }}>valeur HT cumulée</span>
          </div>
          {FAM_META.filter((m) => families.some((f) => f.family === m.family)).map((m) => {
            const val = families.find((f) => f.family === m.family)?.valeur ?? 0;
            return (
              <div key={m.family} className="bar-row">
                <span className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>{m.family}</span>
                <span className="track"><span className={`fill ${m.cls}`} style={{ width: `${Math.max(4, (val / famMax) * 100)}%` }} /></span>
                <span className="bar-val num" style={{ color: 'var(--ink)' }}>{eur0(val)} €</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── ESPACES VIP EN DIRECT ── */}
      {active && activeSpaces.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between px-5 pb-3 pt-4" style={{ borderBottom: '1px solid var(--line-soft)' }}>
            <div className="flex items-center gap-2">
              <Activity size={15} style={{ color: 'var(--muted)' }} />
              <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>Espaces VIP — suivi en direct</p>
            </div>
            <span className="num text-xs" style={{ color: 'var(--muted)' }}>
              {activeSpaces.filter((s) => s.stock_status !== 'en_attente').length}/{activeSpaces.length} actifs
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2.5 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {activeSpaces.map((space) => {
              const Icon = SPACE_ICON[space.space_profile] ?? Circle;
              return (
                <button
                  key={space.space_id}
                  onClick={() => navigate(`/admin/events/${space.event_id}`)}
                  className="flex items-center gap-3 rounded-xl px-3 py-3 text-left transition-all hover:shadow-sm"
                  style={{ border: '1px solid var(--line)', background: 'var(--surface-2)' }}
                >
                  <Icon size={16} className="shrink-0" style={{ color: 'var(--accent)' }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold" style={{ color: 'var(--ink)' }}>{space.space_name}</p>
                    <p className="truncate text-xs" style={{ color: space.responsable ? 'var(--muted)' : 'var(--line)' }}>{space.responsable ?? 'Non connecté'}</p>
                  </div>
                  <SpaceStatusPill status={space.stock_status} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── ACTIVITÉ RÉCENTE ── */}
      {history.length > 0 && (
        <div className="card">
          <div className="px-5 pb-3 pt-4" style={{ borderBottom: '1px solid var(--line-soft)' }}>
            <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>Activité récente</p>
          </div>
          <div>
            {history.map((evt, i) => (
              <button
                key={evt.event_id}
                onClick={() => navigate(`/admin/events/${evt.event_id}`)}
                className="group flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-[var(--surface-2)]"
                style={{ borderTop: i === 0 ? 'none' : '1px solid var(--line-soft)' }}
              >
                {isMatch(evt.event_type) ? <Trophy size={16} className="shrink-0" style={{ color: 'var(--accent)' }} /> : <Presentation size={16} className="shrink-0" style={{ color: 'var(--ink-2)' }} />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold" style={{ color: 'var(--ink)' }}>{evt.event_name}</p>
                  <p className="num text-xs" style={{ color: 'var(--muted)' }}>
                    {new Date(evt.event_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {!!evt.expected_attendees && ` · ${evt.expected_attendees} pax`}
                  </p>
                </div>
                {num(evt.total_fb_cost_ht) > 0 && (
                  <span className="num shrink-0 text-sm font-bold" style={{ color: 'var(--ink-2)' }}>{eur0(num(evt.total_fb_cost_ht))} €</span>
                )}
                <ChevronRight size={14} className="shrink-0" style={{ color: 'var(--line)' }} />
              </button>
            ))}
          </div>
          <div className="px-5 py-3" style={{ borderTop: '1px solid var(--line-soft)' }}>
            <button onClick={() => navigate('/admin/events')} className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>
              Voir tous les événements →
            </button>
          </div>
        </div>
      )}

      {/* ── PLANNING HEBDOMADAIRE ── */}
      <div>
        <div className="mb-4 flex items-center gap-2">
          <div className="h-6 w-1.5 rounded-full" style={{ background: 'var(--accent)' }} />
          <h2 className="text-lg font-black" style={{ color: 'var(--ink)' }}>Planning hebdomadaire</h2>
        </div>
        <WeeklyPlanner />
      </div>
    </div>
  );
}
