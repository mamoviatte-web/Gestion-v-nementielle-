/**
 * DashboardPage — Tableau de bord « Stadium Manager ».
 * Lecture en 3 secondes : hero événement en cours/prochain, 4 KPIs, espaces VIP
 * en direct (premium intérieur uniquement, pas les buvettes), activité récente.
 *
 * Données : vues dashboard_kpis + dashboard_vip_spaces_status
 * (supabase/space_specificity_dashboard.sql). Les requêtes dégradent
 * proprement si les vues ne sont pas encore déployées.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Activity } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { isMatch } from '@/lib/eventUtils';
import { WeeklyPlanner } from '@/components/dashboard/WeeklyPlanner';

const OR_PR = '#C9A646';
const BLEU_NUIT = '#1A1A2E';

type StockStatus = 'en_attente' | 'en_cours' | 'cloture';

interface Kpis {
  total_evenements: number;
  en_cours: number;
  matchs_ce_mois: number;
  fb_annuel_ht: number;
  clotures_annee: number;
}
interface EventRow {
  event_id: string;
  event_name: string;
  event_type: string | null;
  status: string;
  event_date: string;
  start_time: string | null;
  expected_attendees: number | null;
}
interface HistoryRow {
  event_id: string;
  event_name: string;
  event_type: string | null;
  status: string;
  event_date: string;
  total_fb_cost_ht: number | null;
  expected_attendees: number | null;
}
interface VipSpaceRow {
  event_id: string;
  space_id: string;
  space_name: string;
  space_profile: string;
  stock_status: StockStatus;
  responsable: string | null;
}
interface Alert {
  msg: string;
  detail: string;
}

const SPACE_ICON: Record<string, string> = {
  salon: '⭐', loge: '🏆', bar_pub: '🍺', wine_bar: '🍷', club: '🎵',
};

function SpaceStatusPill({ status }: { status: StockStatus }) {
  if (status === 'cloture')
    return <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">✅ Clôturé</span>;
  if (status === 'en_cours')
    return <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">🔄 En cours</span>;
  return <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-bold text-stone-400">○ En attente</span>;
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [active, setActive] = useState<EventRow | null>(null);
  const [next, setNext] = useState<EventRow | null>(null);
  const [spaces, setSpaces] = useState<VipSpaceRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    async function load() {
      const [k, evts, sp, hist] = await Promise.all([
        supabase.from('dashboard_kpis').select('*').maybeSingle(),
        supabase
          .from('events')
          .select('event_id, event_name, event_type, status, event_date, start_time, expected_attendees')
          .in('status', ['en_cours', 'préparé'])
          .order('event_date')
          .limit(5),
        supabase.from('dashboard_vip_spaces_status').select('*'),
        supabase
          .from('events')
          .select('event_id, event_name, event_type, status, event_date, total_fb_cost_ht, expected_attendees')
          .in('status', ['clôturé', 'archivé'])
          .order('event_date', { ascending: false })
          .limit(5),
      ]);
      if (!alive) return;

      const kData = (k.data as Record<string, unknown> | null) ?? null;
      setKpis(kData ? {
        total_evenements: num(kData.total_evenements),
        en_cours: num(kData.en_cours),
        matchs_ce_mois: num(kData.matchs_ce_mois),
        fb_annuel_ht: num(kData.fb_annuel_ht),
        clotures_annee: num(kData.clotures_annee),
      } : null);

      const events = (evts.data as EventRow[] | null) ?? [];
      const enCours = events.find((e) => e.status === 'en_cours') ?? null;
      // Prochain = le plus proche événement préparé À VENIR (pas un préparé passé
      // resté ouvert). Comparaison sur la date calendaire (event_date = DATE).
      const today = new Date().toISOString().slice(0, 10);
      const prochain = events
        .filter((e) => e.status === 'préparé' && String(e.event_date).slice(0, 10) >= today)
        .sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)))[0] ?? null;
      setActive(enCours);
      setNext(enCours ? null : prochain);

      const vipRows = (sp.data as VipSpaceRow[] | null) ?? [];
      setSpaces(vipRows);

      setHistory((hist.data as HistoryRow[] | null) ?? []);

      const newAlerts: Alert[] = [];
      if (enCours) {
        const missing = vipRows.filter((s) => s.event_id === enCours.event_id && s.stock_status === 'en_attente');
        if (missing.length > 0) {
          newAlerts.push({
            msg: `${missing.length} espace(s) sans stock saisi`,
            detail: missing.slice(0, 3).map((s) => s.space_name).join(' · '),
          });
        }
      }
      setAlerts(newAlerts);
      setLoading(false);
    }
    void load();
    return () => { alive = false; };
  }, []);

  const heroEvent = active ?? next;
  const activeSpaces = useMemo(
    () => (active ? spaces.filter((s) => s.event_id === active.event_id) : []),
    [active, spaces],
  );

  if (loading)
    return (
      <div className="space-y-4 p-6">
        <div className="h-36 animate-pulse rounded-3xl bg-stone-200" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-stone-100" />)}
        </div>
      </div>
    );

  return (
    <div className="mx-auto min-h-screen max-w-6xl space-y-5 p-6" style={{ background: '#FAFAF8' }}>
      {/* ── HERO ── */}
      {heroEvent ? (
        <button
          onClick={() => navigate(`/admin/events/${heroEvent.event_id}`)}
          className="relative w-full overflow-hidden rounded-3xl text-left transition-transform hover:scale-[1.005]"
          style={{ background: BLEU_NUIT }}
        >
          <div
            className="absolute inset-0 opacity-10"
            style={{ background: `radial-gradient(circle at 80% 50%, ${OR_PR}, transparent 60%)` }}
          />
          <div className="relative flex items-center justify-between p-6">
            <div>
              <div className="mb-3 flex items-center gap-2">
                {active ? (
                  <span className="flex items-center gap-1.5 rounded-full bg-red-500 px-3 py-1 text-xs font-bold text-white">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> EN COURS
                  </span>
                ) : (
                  <span className="text-xs font-bold uppercase tracking-widest text-white/50">Prochain événement</span>
                )}
                <span className="text-xs font-medium text-white/40">
                  {isMatch(heroEvent.event_type) ? '🏉 Match' : '📋 Séminaire'}
                </span>
              </div>
              <p className="text-3xl font-black leading-tight text-white">{heroEvent.event_name}</p>
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <span className="text-sm text-white/60">
                  📅 {new Date(heroEvent.event_date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                  {heroEvent.start_time && ` · ${heroEvent.start_time.slice(0, 5)}`}
                </span>
                {!!heroEvent.expected_attendees && (
                  <span className="text-sm text-white/60">👥 {heroEvent.expected_attendees.toLocaleString('fr-FR')} pax</span>
                )}
              </div>
            </div>
            <ChevronRight size={24} className="shrink-0 text-white/30" />
          </div>
          <div className="h-0.5 w-full" style={{ background: OR_PR }} />
        </button>
      ) : (
        <div className="rounded-3xl border-2 border-dashed border-stone-200 bg-white p-6 text-center">
          <p className="font-medium text-stone-400">Aucun événement en cours ou à venir</p>
          <button
            onClick={() => navigate('/admin/events')}
            className="mt-3 rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white"
          >
            + Créer un événement
          </button>
        </div>
      )}

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { icon: '📅', value: kpis?.matchs_ce_mois ?? 0, label: 'Matchs ce mois', accent: BLEU_NUIT },
          { icon: '💰', value: kpis?.fb_annuel_ht ? `${(kpis.fb_annuel_ht / 1000).toFixed(1)}k€` : '—', label: 'F&B annuel HT', accent: OR_PR },
          { icon: '✅', value: kpis?.clotures_annee ?? 0, label: 'Événements clôturés', accent: '#059669' },
          { icon: '⚡', value: alerts.length > 0 ? alerts.length : '—', label: alerts.length > 0 ? 'Alerte(s)' : 'Aucune alerte', accent: alerts.length > 0 ? '#DC2626' : '#9CA3AF' },
        ].map((k, i) => (
          <div key={i} className="relative overflow-hidden rounded-2xl border border-stone-100 bg-white p-4 shadow-sm">
            <div className="absolute left-0 right-0 top-0 h-0.5 rounded-t-2xl" style={{ background: k.accent }} />
            <span className="text-xl">{k.icon}</span>
            <p className="mt-2 text-2xl font-black text-stone-900">{k.value}</p>
            <p className="mt-0.5 text-xs text-stone-400">{k.label}</p>
          </div>
        ))}
      </div>

      {/* ── ALERTES ── */}
      {alerts.map((a, i) => (
        <div key={i} className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle size={16} className="shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-800">{a.msg}</p>
            <p className="truncate text-xs text-amber-600">{a.detail}</p>
          </div>
        </div>
      ))}

      {/* ── ESPACES VIP EN DIRECT ── */}
      {active && activeSpaces.length > 0 && (
        <div className="rounded-2xl border border-stone-100 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-stone-50 px-5 pb-3 pt-4">
            <div className="flex items-center gap-2">
              <Activity size={15} className="text-stone-400" />
              <p className="text-sm font-bold text-stone-800">Espaces VIP — suivi en direct</p>
            </div>
            <span className="text-xs text-stone-400">
              {activeSpaces.filter((s) => s.stock_status !== 'en_attente').length}/{activeSpaces.length} actifs
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2.5 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {activeSpaces.map((space) => (
              <button
                key={space.space_id}
                onClick={() => navigate(`/admin/events/${space.event_id}`)}
                className={`flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all hover:shadow-sm ${
                  space.stock_status === 'cloture'
                    ? 'border-green-200 bg-green-50'
                    : space.stock_status === 'en_cours'
                      ? 'border-blue-200 bg-blue-50'
                      : 'border-stone-200 bg-stone-50'
                }`}
              >
                <span className="shrink-0 text-base">{SPACE_ICON[space.space_profile] ?? '📋'}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-stone-800">{space.space_name}</p>
                  {space.responsable ? (
                    <p className="truncate text-xs text-stone-400">{space.responsable}</p>
                  ) : (
                    <p className="text-xs text-stone-300">Non connecté</p>
                  )}
                </div>
                <SpaceStatusPill status={space.stock_status} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── ACTIVITÉ RÉCENTE ── */}
      {history.length > 0 && (
        <div className="rounded-2xl border border-stone-100 bg-white shadow-sm">
          <div className="border-b border-stone-50 px-5 pb-3 pt-4">
            <p className="text-sm font-bold text-stone-800">Activité récente</p>
          </div>
          <div className="divide-y divide-stone-50">
            {history.map((evt) => (
              <button
                key={evt.event_id}
                onClick={() => navigate(`/admin/events/${evt.event_id}`)}
                className="group flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-stone-50"
              >
                <span className="shrink-0 text-xl">{isMatch(evt.event_type) ? '🏉' : '📋'}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-stone-800">{evt.event_name}</p>
                  <p className="text-xs text-stone-400">
                    {new Date(evt.event_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {!!evt.expected_attendees && ` · ${evt.expected_attendees} pax`}
                  </p>
                </div>
                {num(evt.total_fb_cost_ht) > 0 && (
                  <span className="shrink-0 text-sm font-bold text-stone-600">
                    {num(evt.total_fb_cost_ht).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €
                  </span>
                )}
                <ChevronRight size={14} className="shrink-0 text-stone-300 group-hover:text-stone-500" />
              </button>
            ))}
          </div>
          <div className="border-t border-stone-50 px-5 py-3">
            <button onClick={() => navigate('/admin/events')} className="text-xs font-medium text-stone-400 hover:text-stone-700">
              Voir tous les événements →
            </button>
          </div>
        </div>
      )}

      {/* ── PLANNING HEBDOMADAIRE ── */}
      <div>
        <div className="mb-4 flex items-center gap-2">
          <div className="h-6 w-1.5 rounded-full" style={{ background: OR_PR }} />
          <h2 className="text-lg font-black text-stone-900">Planning hebdomadaire</h2>
        </div>
        <WeeklyPlanner />
      </div>
    </div>
  );
}
