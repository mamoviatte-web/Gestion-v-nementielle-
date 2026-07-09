/**
 * StaffRHPage — Staff & RH, refonte « Stadium Manager ».
 * KPIs, comparatif Match / Séminaire, 6 onglets analytiques, alertes staffing.
 *
 * Source : vues rh_event_kpis / rh_espace_ratios / rh_agents_cumul / rh_unified
 * (réservées ROLE_STADE — RG-003). « Séminaire » = tout événement non-match.
 * PostgREST sérialise numeric en chaînes → coercition Number() au chargement.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import {
  Bar, BarChart, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { AlertTriangle, Calendar, CheckCircle, Download, Users } from 'lucide-react';

const OR_PR = '#C9A646';
const BLEU_NUIT = '#1A1A2E';
const VERT_OK = '#059669';
const ORANGE_W = '#F97316';
const ROUGE_KO = '#DC2626';

const STATUT_STYLE: Record<string, { color: string; bg: string; border: string; label: string }> = {
  ok: { color: VERT_OK, bg: 'bg-green-50', border: 'border-green-300', label: '✅ Staffé' },
  'sous-staffé': { color: ORANGE_W, bg: 'bg-amber-50', border: 'border-amber-300', label: '⚠️ Sous-staffé' },
  critique: { color: ROUGE_KO, bg: 'bg-red-50', border: 'border-red-300', label: '🔴 Critique' },
  inconnu: { color: '#9CA3AF', bg: 'bg-stone-50', border: 'border-stone-200', label: '— Inconnu' },
};

const ROLE_COLORS: Record<string, string> = {
  Serveur: '#2563EB', 'Chef de rang': OR_PR, Barman: '#7C3AED', 'Agent de sécurité': ROUGE_KO,
  Runner: VERT_OK, 'Responsable espace': BLEU_NUIT, 'Hôte / Hôtesse': '#DB2777', Agent: '#0891B2', Autre: '#9CA3AF',
};

type EventTab = 'match' | 'seminaire';
type ActiveTab = 'synthese' | 'par_agent' | 'par_espace' | 'par_evenement' | 'alertes' | 'export';

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const isMatch = (t: string) => t === 'match';

interface EventKpi {
  event_id: string; event_name: string; event_type: string; event_date: string; pax_count: number;
  nb_agents: number; nb_espaces: number; moy_heures_agent: number; total_heures: number;
  total_cout_rh: number; taux_confirmation_pct: number; total_heures_sup: number; ratio_agents_100pax: number | null;
}
interface EspaceRatio {
  event_id: string; event_type: string; event_date: string; space_id: string; space_name: string;
  service_type: string; nb_agents: number; moy_heures: number; cout_rh: number;
  ratio_actuel: number | null; cible_ratio: number; ecart_pct: number | null; statut_staffing: string;
}
interface AgentCumul {
  agent_nom: string; agent_role: string; nb_evenements: number; nb_espaces_differents: number;
  total_heures_cumul: number; moy_heures_par_evt: number; total_cout_cumul: number;
  taux_confirmation_pct: number; total_heures_sup: number;
}
interface UnifiedRow {
  event_id: string; event_type: string; agent_nom: string; agent_role: string;
  heures_travaillees: number | null; confirme_agent: boolean;
}

function Kpi({ label, value, unit, sub, icon, accent }: {
  label: string; value: string; unit?: string; sub?: string; icon: string; accent: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
      <div className="absolute inset-x-0 top-0 h-1 rounded-t-2xl" style={{ background: accent }} />
      <div className="mb-2 flex items-start justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">{label}</p>
        <span className="text-xl">{icon}</span>
      </div>
      <div className="flex items-end gap-1">
        <p className="text-3xl font-black text-stone-900">{value}</p>
        {unit && <p className="mb-0.5 text-sm text-stone-400">{unit}</p>}
      </div>
      {sub && <p className="mt-1.5 text-xs text-stone-400">{sub}</p>}
    </div>
  );
}

export default function StaffRHPage() {
  const navigate = useNavigate();
  const [eventTab, setEventTab] = useState<EventTab>('match');
  const [tab, setTab] = useState<ActiveTab>('synthese');
  const [kpis, setKpis] = useState<EventKpi[]>([]);
  const [espaces, setEspaces] = useState<EspaceRatio[]>([]);
  const [agents, setAgents] = useState<AgentCumul[]>([]);
  const [unified, setUnified] = useState<UnifiedRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [{ data: k }, { data: e }, { data: a }, { data: u }] = await Promise.all([
        supabase.from('rh_event_kpis').select('*').order('event_date', { ascending: false }),
        supabase.from('rh_espace_ratios').select('*').order('event_date', { ascending: false }),
        supabase.from('rh_agents_cumul').select('*'),
        supabase.from('rh_unified').select('event_id, event_type, agent_nom, agent_role, heures_travaillees, confirme_agent').order('event_date', { ascending: false }),
      ]);
      setKpis((k ?? []).map((r): EventKpi => ({
        event_id: String(r.event_id), event_name: String(r.event_name), event_type: String(r.event_type),
        event_date: String(r.event_date), pax_count: num(r.pax_count), nb_agents: num(r.nb_agents),
        nb_espaces: num(r.nb_espaces), moy_heures_agent: num(r.moy_heures_agent), total_heures: num(r.total_heures),
        total_cout_rh: num(r.total_cout_rh), taux_confirmation_pct: num(r.taux_confirmation_pct),
        total_heures_sup: num(r.total_heures_sup), ratio_agents_100pax: r.ratio_agents_100pax == null ? null : num(r.ratio_agents_100pax),
      })));
      setEspaces((e ?? []).map((r): EspaceRatio => ({
        event_id: String(r.event_id), event_type: String(r.event_type), event_date: String(r.event_date),
        space_id: String(r.space_id), space_name: String(r.space_name), service_type: String(r.service_type),
        nb_agents: num(r.nb_agents), moy_heures: num(r.moy_heures), cout_rh: num(r.cout_rh),
        ratio_actuel: r.ratio_actuel == null ? null : num(r.ratio_actuel), cible_ratio: num(r.cible_ratio),
        ecart_pct: r.ecart_pct == null ? null : num(r.ecart_pct), statut_staffing: String(r.statut_staffing),
      })));
      setAgents((a ?? []).map((r): AgentCumul => ({
        agent_nom: String(r.agent_nom ?? '—'), agent_role: String(r.agent_role ?? 'Autre'),
        nb_evenements: num(r.nb_evenements), nb_espaces_differents: num(r.nb_espaces_differents),
        total_heures_cumul: num(r.total_heures_cumul), moy_heures_par_evt: num(r.moy_heures_par_evt),
        total_cout_cumul: num(r.total_cout_cumul), taux_confirmation_pct: num(r.taux_confirmation_pct),
        total_heures_sup: num(r.total_heures_sup),
      })));
      setUnified((u ?? []).map((r): UnifiedRow => ({
        event_id: String(r.event_id), event_type: String(r.event_type), agent_nom: String(r.agent_nom ?? '—'),
        agent_role: String(r.agent_role ?? 'Autre'), heures_travaillees: r.heures_travaillees == null ? null : num(r.heures_travaillees),
        confirme_agent: Boolean(r.confirme_agent),
      })));
      setLoading(false);
    }
    void load();
  }, []);

  const matchCount = useMemo(() => kpis.filter((k) => isMatch(k.event_type)).length, [kpis]);
  const semiCount = useMemo(() => kpis.filter((k) => !isMatch(k.event_type)).length, [kpis]);
  const keep = (t: string) => (eventTab === 'match' ? isMatch(t) : !isMatch(t));

  const filteredKpis = useMemo(() => kpis.filter((k) => keep(k.event_type)), [kpis, eventTab]);
  const filteredEspaces = useMemo(() => espaces.filter((e) => keep(e.event_type)), [espaces, eventTab]);
  const filteredUnified = useMemo(() => unified.filter((u) => keep(u.event_type)), [unified, eventTab]);

  const globalKpis = useMemo(() => {
    if (filteredKpis.length === 0) return null;
    const n = filteredKpis.length;
    const totalHeures = filteredKpis.reduce((s, k) => s + k.total_heures, 0);
    const totalHSup = filteredKpis.reduce((s, k) => s + k.total_heures_sup, 0);
    return {
      totalEvts: n,
      avgAgents: filteredKpis.reduce((s, k) => s + k.nb_agents, 0) / n,
      avgHeures: filteredKpis.reduce((s, k) => s + k.moy_heures_agent, 0) / n,
      totalCout: filteredKpis.reduce((s, k) => s + k.total_cout_rh, 0),
      tauxHSup: totalHeures > 0 ? (totalHSup / totalHeures) * 100 : 0,
      tauxConfirm: filteredKpis.reduce((s, k) => s + k.taux_confirmation_pct, 0) / n,
    };
  }, [filteredKpis]);

  const alertes = useMemo(() => {
    const list: { level: 'critique' | 'warning'; msg: string; detail: string }[] = [];
    const uniqEspaces = [...new Map(filteredEspaces.map((e) => [e.space_id + e.event_id, e])).values()];
    const critiques = uniqEspaces.filter((e) => e.statut_staffing === 'critique');
    if (critiques.length > 0)
      list.push({ level: 'critique', msg: `${critiques.length} espace(s) en sous-staffing critique`, detail: critiques.slice(0, 3).map((e) => `${e.space_name} (${e.ecart_pct ?? '?'}%)`).join(', ') });
    const sous = uniqEspaces.filter((e) => e.statut_staffing === 'sous-staffé');
    if (sous.length > 0)
      list.push({ level: 'warning', msg: `${sous.length} espace(s) légèrement sous-staffé(s)`, detail: sous.slice(0, 3).map((e) => `${e.space_name} (${e.ecart_pct ?? '?'}%)`).join(', ') });
    const sansConfirm = filteredUnified.filter((u) => !u.confirme_agent && u.heures_travaillees !== null);
    if (sansConfirm.length > 0)
      list.push({ level: 'warning', msg: `${sansConfirm.length} déclaration(s) sans confirmation agent`, detail: [...new Set(sansConfirm.map((u) => u.agent_nom))].slice(0, 5).join(', ') });
    return list;
  }, [filteredEspaces, filteredUnified]);

  const chartEvents = useMemo(
    () => filteredKpis.slice().reverse().map((k) => ({
      name: new Date(k.event_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
      agents: k.nb_agents, heures: k.moy_heures_agent, cout: k.total_cout_rh,
    })),
    [filteredKpis],
  );

  const chartRoles = useMemo(() => {
    const map: Record<string, number> = {};
    filteredUnified.forEach((u) => { map[u.agent_role] = (map[u.agent_role] ?? 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [filteredUnified]);

  const uniqEspacesList = useMemo(() => [...new Map(filteredEspaces.map((e) => [e.space_id, e])).values()], [filteredEspaces]);

  const TABS: { key: ActiveTab; label: string }[] = [
    { key: 'synthese', label: 'Synthèse' },
    { key: 'par_agent', label: 'Par agent' },
    { key: 'par_espace', label: 'Par espace' },
    { key: 'par_evenement', label: 'Par événement' },
    { key: 'alertes', label: `Alertes${alertes.length > 0 ? ` (${alertes.length})` : ''}` },
    { key: 'export', label: 'Export' },
  ];

  if (loading)
    return (
      <div className="space-y-4 p-8">
        {[...Array(3)].map((_, i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-stone-100" />)}
      </div>
    );

  return (
    <div className="min-h-screen" style={{ background: '#FAFAF8' }}>
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="h-8 w-1.5 rounded-full" style={{ background: OR_PR }} />
              <h1 className="text-3xl font-black text-stone-900">Staff &amp; RH</h1>
            </div>
            <p className="ml-3.5 mt-1 text-sm text-stone-400">Dimensionnement · heures supplémentaires · efficacité</p>
          </div>
          <button
            onClick={() => navigate('/admin/analytics/staff/monthly')}
            className="flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50"
          >
            <Calendar size={15} /> Rapports mensuels
          </button>
        </div>

        {/* Toggle Match / Séminaire */}
        <div className="flex flex-wrap items-center gap-3">
          {([{ key: 'match', label: '🏉 Matchs', count: matchCount }, { key: 'seminaire', label: '📋 Séminaires', count: semiCount }] as const).map((et) => (
            <button
              key={et.key}
              onClick={() => setEventTab(et.key)}
              className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all ${eventTab === et.key ? 'text-white shadow' : 'border border-stone-200 bg-white text-stone-600 hover:bg-stone-50'}`}
              style={eventTab === et.key ? { background: BLEU_NUIT } : {}}
            >
              {et.label}
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${eventTab === et.key ? 'bg-white/20 text-white' : 'bg-stone-100 text-stone-500'}`}>{et.count}</span>
            </button>
          ))}
          {alertes.some((a) => a.level === 'critique') && (
            <span className="ml-2 flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
              <AlertTriangle size={13} /> {alertes.filter((a) => a.level === 'critique').length} alerte(s) critique(s)
            </span>
          )}
        </div>

        {globalKpis ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Kpi label="Agents / événement" value={globalKpis.avgAgents.toFixed(1)} unit="moy." sub={`${globalKpis.totalEvts} événement(s)`} icon="👥" accent={BLEU_NUIT} />
            <Kpi label="Heures / agent" value={globalKpis.avgHeures.toFixed(1)} unit="h moy." sub="par prestation" icon="⏱" accent={OR_PR} />
            <Kpi label="Taux heures sup" value={globalKpis.tauxHSup.toFixed(1)} unit="%" sub={globalKpis.tauxHSup > 10 ? '⚠️ Élevé' : '✅ Correct'} icon="📈" accent={globalKpis.tauxHSup > 10 ? ORANGE_W : VERT_OK} />
            <Kpi label="Coût RH total" value={globalKpis.totalCout.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} unit="€ HT" sub={`${(globalKpis.totalCout / Math.max(globalKpis.totalEvts, 1)).toFixed(0)} €/evt`} icon="💰" accent={VERT_OK} />
          </div>
        ) : (
          <div className="rounded-2xl border border-stone-100 bg-white p-12 text-center">
            <Users size={36} className="mx-auto mb-3 text-stone-300" />
            <p className="font-semibold text-stone-600">Aucune donnée RH</p>
            <p className="mt-1 text-sm text-stone-400">Les données apparaîtront après la saisie des horaires par les responsables de zone.</p>
          </div>
        )}

        {globalKpis && (
          <>
            <div className="flex flex-wrap gap-1 border-b border-stone-200">
              {TABS.map((t) => (
                <button key={t.key} onClick={() => setTab(t.key)} className={`rounded-t-lg border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${tab === t.key ? 'border-stone-900 text-stone-900' : 'border-transparent text-stone-400 hover:text-stone-700'}`}>{t.label}</button>
              ))}
            </div>

            {tab === 'synthese' && (
              <div className="space-y-6">
                {chartEvents.length > 1 && (
                  <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
                    <h3 className="mb-4 font-bold text-stone-800">📈 Évolution agents &amp; heures par événement</h3>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={chartEvents}>
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis yAxisId="agents" tick={{ fontSize: 11 }} />
                        <YAxis yAxisId="heures" orientation="right" tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Legend />
                        <Line yAxisId="agents" type="monotone" dataKey="agents" name="Agents" stroke={BLEU_NUIT} strokeWidth={2.5} dot={{ fill: BLEU_NUIT, r: 4 }} />
                        <Line yAxisId="heures" type="monotone" dataKey="heures" name="H/agent" stroke={OR_PR} strokeWidth={2.5} dot={{ fill: OR_PR, r: 4 }} strokeDasharray="5 3" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
                    <h3 className="mb-4 font-bold text-stone-800">👥 Répartition par rôle</h3>
                    {chartRoles.length > 0 ? (
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie data={chartRoles} cx="40%" cy="50%" outerRadius={80} innerRadius={50} dataKey="value" animationBegin={0}>
                            {chartRoles.map((entry, i) => <Cell key={i} fill={ROLE_COLORS[entry.name] ?? '#9CA3AF'} />)}
                          </Pie>
                          <Tooltip formatter={(value) => [`${Number(value)} personnes`, '']} />
                          <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: 11 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : <p className="py-12 text-center text-sm text-stone-400">Pas de données.</p>}
                  </div>

                  <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
                    <h3 className="mb-4 font-bold text-stone-800">💰 Coût RH par événement (€)</h3>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={chartEvents}>
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(value) => [`${Number(value).toFixed(0)} €`, 'Coût RH']} />
                        <Bar dataKey="cout" name="Coût RH" fill={OR_PR} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
                  <h3 className="mb-4 font-bold text-stone-800">🗺 Ratio agents / 100 pax par espace</h3>
                  {uniqEspacesList.length > 0 ? (
                    <div className="space-y-3">
                      {uniqEspacesList.sort((a, b) => (a.ecart_pct ?? 0) - (b.ecart_pct ?? 0)).map((espace) => {
                        const s = STATUT_STYLE[espace.statut_staffing] ?? STATUT_STYLE.inconnu;
                        const pct = espace.cible_ratio > 0 && espace.ratio_actuel != null ? Math.min((espace.ratio_actuel / espace.cible_ratio) * 100, 120) : 0;
                        return (
                          <div key={espace.space_id}>
                            <div className="mb-1.5 flex items-center justify-between text-sm">
                              <span className="font-semibold text-stone-700">{espace.space_name}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-stone-500">Cible {espace.cible_ratio} · Actuel {espace.ratio_actuel ?? '—'}</span>
                                <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${s.bg} ${s.border}`} style={{ color: s.color }}>{s.label}</span>
                              </div>
                            </div>
                            <div className="h-2.5 overflow-hidden rounded-full bg-stone-100">
                              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: s.color }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : <p className="py-6 text-center text-sm text-stone-400">Aucun espace avec données de staffing.</p>}
                </div>
              </div>
            )}

            {tab === 'par_agent' && (
              <div className="overflow-hidden rounded-2xl border border-stone-100 bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-stone-200 bg-stone-50">
                        {['Agent', 'Rôle', 'Événements', 'Moy. h/evt', 'Heures sup', 'Confirmé', 'Coût total'].map((h) => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-stone-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-50">
                      {agents.map((agent) => (
                        <tr key={agent.agent_nom} className="transition-colors hover:bg-stone-50">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-black text-white" style={{ background: BLEU_NUIT }}>
                                {agent.agent_nom.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                              </div>
                              <span className="font-semibold text-stone-800">{agent.agent_nom}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: (ROLE_COLORS[agent.agent_role] ?? '#9CA3AF') + '20', color: ROLE_COLORS[agent.agent_role] ?? '#9CA3AF' }}>{agent.agent_role}</span>
                          </td>
                          <td className="px-4 py-3 font-semibold text-stone-700">{agent.nb_evenements}</td>
                          <td className="px-4 py-3"><span className={`font-bold ${agent.moy_heures_par_evt > 10 ? 'text-orange-600' : 'text-stone-800'}`}>{agent.moy_heures_par_evt.toFixed(1)} h</span></td>
                          <td className="px-4 py-3">{agent.total_heures_sup > 0 ? <span className="font-semibold text-orange-600">+{agent.total_heures_sup.toFixed(1)} h</span> : <span className="text-stone-300">—</span>}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-green-500" style={{ width: `${agent.taux_confirmation_pct}%` }} /></div>
                              <span className="text-xs text-stone-500">{agent.taux_confirmation_pct}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 font-bold text-stone-800">{agent.total_cout_cumul > 0 ? `${agent.total_cout_cumul.toFixed(0)} €` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === 'par_espace' && (
              uniqEspacesList.length > 0 ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {uniqEspacesList.map((espace) => {
                    const s = STATUT_STYLE[espace.statut_staffing] ?? STATUT_STYLE.inconnu;
                    return (
                      <div key={espace.space_id} className={`rounded-2xl border-2 bg-white p-5 ${s.border}`}>
                        <div className="mb-3 flex items-center justify-between">
                          <p className="font-bold text-stone-900">{espace.space_name}</p>
                          <span className="rounded-lg px-2 py-1 text-xs font-bold" style={{ background: s.color + '20', color: s.color }}>{s.label}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div className="rounded-xl bg-stone-50 py-2"><p className="text-xl font-black text-stone-900">{espace.nb_agents}</p><p className="text-[10px] text-stone-400">agents</p></div>
                          <div className="rounded-xl bg-stone-50 py-2"><p className="text-xl font-black text-stone-900">{espace.moy_heures.toFixed(1)}h</p><p className="text-[10px] text-stone-400">moy/agent</p></div>
                          <div className={`rounded-xl py-2 ${s.bg}`}><p className="text-xl font-black" style={{ color: s.color }}>{espace.ratio_actuel ?? '—'}</p><p className="text-[10px] text-stone-400">/ 100pax</p></div>
                        </div>
                        {espace.ecart_pct !== null && <p className="mt-2 text-center text-xs" style={{ color: s.color }}>Cible {espace.cible_ratio} · écart {espace.ecart_pct > 0 ? '+' : ''}{espace.ecart_pct}%</p>}
                      </div>
                    );
                  })}
                </div>
              ) : <div className="rounded-2xl border border-stone-100 bg-white p-10 text-center text-sm text-stone-400">Aucun espace avec données de staffing (renseignez la fréquentation attendue de l'événement).</div>
            )}

            {tab === 'par_evenement' && (
              <div className="space-y-3">
                {filteredKpis.map((k) => (
                  <div key={k.event_id} className="rounded-2xl border border-stone-100 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-bold text-stone-900">{k.event_name}</p>
                        <p className="text-xs text-stone-400">{new Date(k.event_date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-lg bg-green-100 px-2 py-1 text-xs font-semibold text-green-700">{k.nb_agents} agents</span>
                        <span className="rounded-lg bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">{k.moy_heures_agent.toFixed(1)} h/agent</span>
                        <span className="rounded-lg bg-stone-100 px-2 py-1 text-xs font-semibold text-stone-600">{k.total_cout_rh.toFixed(0)} € RH</span>
                        <span className={`rounded-lg px-2 py-1 text-xs font-semibold ${k.taux_confirmation_pct >= 80 ? 'bg-green-100 text-green-700' : k.taux_confirmation_pct >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{k.taux_confirmation_pct}% confirmé</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'alertes' && (
              <div className="space-y-3">
                {alertes.length === 0 ? (
                  <div className="rounded-2xl border border-green-200 bg-green-50 p-8 text-center">
                    <CheckCircle size={32} className="mx-auto mb-2 text-green-500" />
                    <p className="font-bold text-green-700">Aucune alerte RH</p>
                    <p className="text-sm text-green-500">Tous les espaces sont correctement staffés.</p>
                  </div>
                ) : alertes.map((a, i) => (
                  <div key={i} className={`rounded-2xl border p-4 ${a.level === 'critique' ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'}`}>
                    <div className="mb-1 flex items-center gap-2">
                      <AlertTriangle size={16} className={a.level === 'critique' ? 'text-red-600' : 'text-amber-600'} />
                      <p className={`text-sm font-bold ${a.level === 'critique' ? 'text-red-800' : 'text-amber-800'}`}>{a.msg}</p>
                    </div>
                    <p className="ml-6 text-xs text-stone-500">{a.detail}</p>
                  </div>
                ))}
              </div>
            )}

            {tab === 'export' && (
              <div className="space-y-4 rounded-2xl border border-stone-100 bg-white p-6">
                <h3 className="font-bold text-stone-800">📥 Export des données RH</h3>
                {[
                  { label: 'Synthèse par événement (CSV)', rows: () => filteredKpis.map((k) => ({ evenement: k.event_name, date: k.event_date, agents: k.nb_agents, moy_heures: k.moy_heures_agent, cout_rh: k.total_cout_rh, confirmation_pct: k.taux_confirmation_pct })), file: 'rh_evenements' },
                  { label: 'Cumul par agent (CSV)', rows: () => agents.map((a) => ({ agent: a.agent_nom, role: a.agent_role, evenements: a.nb_evenements, heures_cumul: a.total_heures_cumul, heures_sup: a.total_heures_sup, cout_cumul: a.total_cout_cumul, confirmation_pct: a.taux_confirmation_pct })), file: 'rh_agents' },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between rounded-xl border border-stone-200 p-4 hover:bg-stone-50">
                    <p className="text-sm font-semibold text-stone-800">{item.label}</p>
                    <button onClick={() => exportCsv(item.rows(), item.file)} className="flex items-center gap-2 rounded-lg bg-stone-900 px-3 py-2 text-xs font-semibold text-white"><Download size={12} /> Exporter</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Export CSV simple (téléchargement client). */
function exportCsv(rows: Record<string, unknown>[], filename: string) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
