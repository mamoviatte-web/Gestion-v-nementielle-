/**
 * StaffRHPage — Staff & RH, refonte « Stadium Manager » + filtres temporels.
 * Sélecteur de période (mois/année/tout/personnalisé), graphique adaptatif,
 * 7 onglets analytiques, alertes staffing.
 *
 * Données : hook useRhData (vues rh_* réservées ROLE_STADE — RG-003).
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bar, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { AlertTriangle, Calendar, CheckCircle, Download, Users } from 'lucide-react';
import { PeriodSelector, buildPeriod, type Period } from '@/components/rh/PeriodSelector';
import { HorsEventSection } from '@/components/rh/HorsEventSection';
import { useRhData, type EventKpi } from '@/hooks/useRhData';
import { supabase } from '@/lib/supabase';

const OR_PR = '#C9A646';
const BLEU_NUIT = '#1A1A2E';
const VERT_OK = '#059669';
const ORANGE_W = '#F97316';
const ROUGE_KO = '#DC2626';

const ROLE_COLORS: Record<string, string> = {
  Serveur: '#2563EB', 'Chef de rang': OR_PR, Barman: '#7C3AED', 'Agent de sécurité': ROUGE_KO,
  Runner: VERT_OK, 'Responsable espace': BLEU_NUIT, 'Hôte / Hôtesse': '#DB2777', Agent: '#0891B2', Autre: '#9CA3AF',
};

type EventTab = 'match' | 'seminaire';
type MainTab = EventTab | 'hors_event';
type ActiveTab = 'synthese' | 'par_agent' | 'par_espace' | 'par_evenement' | 'cumul' | 'alertes' | 'export';

const initials = (nom: string) => nom.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

function Kpi({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: string; icon?: string; accent?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-l">{label}</div>
      <div className="kpi-v num">{value}{unit && <span className="ml-1 text-base font-semibold" style={{ color: 'var(--muted)' }}>{unit}</span>}</div>
      {sub && <div className="kpi-s">{sub}</div>}
    </div>
  );
}

export default function StaffRHPage() {
  const navigate = useNavigate();
  const [mainTab, setMainTab] = useState<MainTab>('match');
  const eventTab: EventTab = mainTab === 'hors_event' ? 'match' : mainTab;
  const isHorsEvent = mainTab === 'hors_event';
  const [tab, setTab] = useState<ActiveTab>('synthese');
  const [period, setPeriod] = useState<Period>(() => buildPeriod('annee'));
  const [horsCount, setHorsCount] = useState(0);

  const { kpis, espaces, agents, unified, byMonth, globalKpis, matchCount, semiCount, loading } = useRhData(eventTab, period);

  // Compteur d'interventions hors-événement sur la période (badge du toggle).
  // Dégrade à 0 si la table n'est pas encore provisionnée (migration 042).
  useEffect(() => {
    let active = true;
    const s = period.startDate.toISOString().slice(0, 10);
    const e = period.endDate.toISOString().slice(0, 10);
    void supabase
      .from('staff_hors_event')
      .select('id', { count: 'exact', head: true })
      .gte('work_date', s)
      .lte('work_date', e)
      .then(({ count }) => { if (active) setHorsCount(count ?? 0); });
    return () => { active = false; };
  }, [period]);

  const uniqEspacesList = useMemo(() => [...new Map(espaces.map((e) => [e.space_id, e])).values()], [espaces]);

  // Alertes RH pertinentes uniquement. Le ratio agents/100 pax (et donc les
  // statuts « sous-staffé »/« critique ») a été retiré : chaque événement est
  // différent, la métrique n'est pas fiable.
  const alertes = useMemo(() => {
    const list: { level: 'critique' | 'warning'; msg: string; detail: string }[] = [];
    const sansC = unified.filter((u) => !u.confirme_agent && u.heures_travaillees !== null);
    if (sansC.length) list.push({ level: 'warning', msg: `${sansC.length} déclaration(s) sans confirmation agent`, detail: [...new Set(sansC.map((u) => u.agent_nom))].slice(0, 5).join(', ') });
    return list;
  }, [unified]);

  const aggregated = period.mode === 'annee' || period.mode === 'tout';
  const chartData = useMemo(() => {
    if (aggregated) return byMonth.map((m) => ({ name: m.label, agents: m.evts > 0 ? m.agents / m.evts : 0, cout: m.cout }));
    return kpis.map((k) => ({ name: new Date(k.event_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), agents: k.nb_agents, cout: k.total_cout_rh }));
  }, [aggregated, byMonth, kpis]);

  const chartRoles = useMemo(() => {
    const map: Record<string, number> = {};
    unified.forEach((u) => { map[u.agent_role] = (map[u.agent_role] ?? 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [unified]);

  const TABS: { key: ActiveTab; label: string }[] = [
    { key: 'synthese', label: 'Synthèse' },
    { key: 'par_agent', label: 'Par agent' },
    { key: 'par_espace', label: 'Par espace' },
    { key: 'par_evenement', label: 'Par événement' },
    { key: 'cumul', label: 'Cumul agents' },
    { key: 'alertes', label: `Alertes${alertes.length > 0 ? ` (${alertes.length})` : ''}` },
    { key: 'export', label: 'Export' },
  ];

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
          <button onClick={() => navigate('/admin/analytics/staff/monthly')} className="flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50">
            <Calendar size={15} /> Rapports mensuels
          </button>
        </div>

        {/* Toggle Matchs / Séminaires / Hors événement */}
        <div className="flex flex-wrap items-center gap-3">
          {([
            { key: 'match', label: '🏉 Matchs', count: matchCount },
            { key: 'seminaire', label: '📋 Séminaires', count: semiCount },
            { key: 'hors_event', label: '🔧 Hors événement', count: horsCount },
          ] as const).map((et) => (
            <button key={et.key} onClick={() => setMainTab(et.key)} className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all ${mainTab === et.key ? 'text-white shadow' : 'border border-stone-200 bg-white text-stone-600 hover:bg-stone-50'}`} style={mainTab === et.key ? { background: BLEU_NUIT } : {}}>
              {et.label}
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${mainTab === et.key ? 'bg-white/20 text-white' : 'bg-stone-100 text-stone-500'}`}>{et.count}</span>
            </button>
          ))}
        </div>

        {/* Sélecteur de période */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PeriodSelector value={period} onChange={setPeriod} />
          <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-400">
            {isHorsEvent
              ? <>{horsCount} intervention{horsCount > 1 ? 's' : ''} · <span className="capitalize">{period.label}</span></>
              : <>{kpis.length} événement{kpis.length > 1 ? 's' : ''} · <span className="capitalize">{period.label}</span></>}
          </div>
        </div>

        {isHorsEvent ? (
          <HorsEventSection period={period} />
        ) : loading ? (
          <div className="space-y-4">{[...Array(3)].map((_, i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-stone-100" />)}</div>
        ) : !globalKpis ? (
          <div className="rounded-2xl border border-stone-100 bg-white p-12 text-center">
            <Users size={36} className="mx-auto mb-3 text-stone-300" />
            <p className="font-semibold text-stone-600">Aucune donnée RH sur cette période</p>
            <p className="mt-1 text-sm text-stone-400">Changez de période ou de type d'événement, ou attendez la saisie des horaires.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Kpi label="Agents / événement" value={globalKpis.avgAgents.toFixed(1)} unit="moy." sub={`${globalKpis.totalEvts} événement(s)`} icon="👥" accent={BLEU_NUIT} />
              <Kpi label="Heures / agent" value={globalKpis.avgHeures.toFixed(1)} unit="h moy." sub="par prestation" icon="⏱" accent={OR_PR} />
              <Kpi label="Taux heures sup" value={(globalKpis.totalHeures > 0 ? (globalKpis.totalHSup / globalKpis.totalHeures) * 100 : 0).toFixed(1)} unit="%" sub={globalKpis.totalHSup > 0 ? 'À surveiller' : 'Correct'} icon="📈" accent={globalKpis.totalHSup > 0 ? ORANGE_W : VERT_OK} />
              <Kpi label="Coût RH total" value={globalKpis.totalCout.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} unit="€ HT" sub={`${(globalKpis.totalCout / Math.max(globalKpis.totalEvts, 1)).toFixed(0)} €/evt`} icon="💰" accent={VERT_OK} />
            </div>

            <div className="flex flex-wrap gap-1 border-b border-stone-200">
              {TABS.map((t) => (
                <button key={t.key} onClick={() => setTab(t.key)} className={`rounded-t-lg border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${tab === t.key ? 'border-stone-900 text-stone-900' : 'border-transparent text-stone-400 hover:text-stone-700'}`}>{t.label}</button>
              ))}
            </div>

            {tab === 'synthese' && (
              <div className="space-y-6">
                <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="font-bold text-stone-800">📈 {aggregated ? 'Vue mensuelle' : 'Événements'} — <span className="capitalize">{period.label}</span></h3>
                    <span className="rounded-lg bg-stone-50 px-2 py-1 text-xs text-stone-400">{aggregated ? 'Agrégé par mois' : 'Par événement'}</span>
                  </div>
                  {chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={240}>
                      <ComposedChart data={chartData}>
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis yAxisId="agents" tick={{ fontSize: 11 }} />
                        <YAxis yAxisId="cout" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}€`} />
                        <Tooltip formatter={(value, name) => (name === 'Coût RH' ? [`${Number(value).toFixed(0)} €`, name] : [Number(value).toFixed(1), name])} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                        <Legend />
                        <Bar yAxisId="cout" dataKey="cout" name="Coût RH" fill={OR_PR + '80'} radius={[4, 4, 0, 0]} />
                        <Line yAxisId="agents" type="monotone" dataKey="agents" name="Agents moy." stroke={BLEU_NUIT} strokeWidth={2.5} dot={{ fill: BLEU_NUIT, r: 4 }} animationDuration={600} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : <p className="py-12 text-center text-sm text-stone-400">Pas de données sur la période.</p>}
                  <div className="mt-3 flex justify-center gap-6 border-t border-stone-100 pt-3">
                    <div className="text-center"><p className="text-lg font-black text-stone-900">{globalKpis.totalEvts}</p><p className="text-xs text-stone-400">événements</p></div>
                    <div className="text-center"><p className="text-lg font-black text-stone-900">{globalKpis.totalHeures.toFixed(0)} h</p><p className="text-xs text-stone-400">heures totales</p></div>
                    <div className="text-center"><p className="text-lg font-black" style={{ color: OR_PR }}>{globalKpis.totalCout.toFixed(0)} €</p><p className="text-xs text-stone-400">coût RH période</p></div>
                  </div>
                </div>

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
              </div>
            )}

            {tab === 'par_agent' && (
              <div className="overflow-hidden rounded-2xl border border-stone-100 bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-stone-200 bg-stone-50">
                        {['Agent', 'Rôle', 'Événements', 'Moy. h/evt', 'Heures sup', 'Confirmé', 'Coût total'].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-stone-500">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-50">
                      {agents.map((agent) => (
                        <tr key={agent.agent_nom} className="transition-colors hover:bg-stone-50">
                          <td className="px-4 py-3"><div className="flex items-center gap-2"><div className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-black text-white" style={{ background: BLEU_NUIT }}>{initials(agent.agent_nom)}</div><span className="font-semibold text-stone-800">{agent.agent_nom}</span></div></td>
                          <td className="px-4 py-3"><span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: (ROLE_COLORS[agent.agent_role] ?? '#9CA3AF') + '20', color: ROLE_COLORS[agent.agent_role] ?? '#9CA3AF' }}>{agent.agent_role}</span></td>
                          <td className="px-4 py-3 font-semibold text-stone-700">{agent.nb_evenements}</td>
                          <td className="px-4 py-3"><span className={`font-bold ${agent.moy_heures_par_evt > 10 ? 'text-orange-600' : 'text-stone-800'}`}>{agent.moy_heures_par_evt.toFixed(1)} h</span></td>
                          <td className="px-4 py-3">{agent.total_heures_sup > 0 ? <span className="font-semibold text-orange-600">+{agent.total_heures_sup.toFixed(1)} h</span> : <span className="text-stone-300">—</span>}</td>
                          <td className="px-4 py-3"><div className="flex items-center gap-1.5"><div className="h-1.5 w-16 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-green-500" style={{ width: `${agent.taux_confirmation_pct}%` }} /></div><span className="text-xs text-stone-500">{agent.taux_confirmation_pct}%</span></div></td>
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
                  {uniqEspacesList.map((espace) => (
                    <div key={espace.space_id} className="rounded-2xl border border-stone-100 bg-white p-5">
                      <div className="mb-3 flex items-center justify-between"><p className="font-bold text-stone-900">{espace.space_name}</p></div>
                      <div className="grid grid-cols-2 gap-2 text-center">
                        <div className="rounded-xl bg-stone-50 py-2"><p className="text-xl font-black text-stone-900">{espace.nb_agents}</p><p className="text-[10px] text-stone-400">agents</p></div>
                        <div className="rounded-xl bg-stone-50 py-2"><p className="text-xl font-black text-stone-900">{espace.moy_heures.toFixed(1)}h</p><p className="text-[10px] text-stone-400">moy/agent</p></div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <div className="rounded-2xl border border-stone-100 bg-white p-10 text-center text-sm text-stone-400">Aucun espace avec données de staffing.</div>
            )}

            {tab === 'par_evenement' && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3.5">
                  <div className="kpi"><div className="kpi-v num">{globalKpis.totalEvts}</div><div className="kpi-s">événements sur la période</div></div>
                  <div className="kpi accent"><div className="kpi-v num">{globalKpis.totalCout.toFixed(0)} €</div><div className="kpi-s">coût RH total période</div></div>
                  <div className="kpi"><div className="kpi-v num">{globalKpis.totalHeures.toFixed(0)} h</div><div className="kpi-s">heures travaillées</div></div>
                </div>
                {kpis.length === 0 ? <div className="rounded-2xl border border-stone-100 bg-white p-10 text-center text-stone-400">Aucun événement sur cette période.</div> : kpis.map((k) => (
                  <EventRow key={k.event_id} k={k} totalCout={globalKpis.totalCout} />
                ))}
              </div>
            )}

            {tab === 'cumul' && (
              <div className="space-y-4">
                {agents.length >= 3 && (
                  <div className="mb-2 grid grid-cols-3 gap-3">
                    {[1, 0, 2].map((rank, col) => {
                      const agent = agents[rank];
                      if (!agent) return null;
                      return (
                        <div key={rank} className={`flex flex-col justify-end rounded-2xl border border-stone-100 bg-white p-4 text-center ${col === 0 ? 'order-2' : col === 1 ? 'order-1' : 'order-3'}`}>
                          <p className="mb-1 text-3xl">{['🥇', '🥈', '🥉'][rank]}</p>
                          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full text-sm font-black text-white" style={{ background: BLEU_NUIT }}>{initials(agent.agent_nom)}</div>
                          <p className="truncate text-sm font-bold text-stone-800">{agent.agent_nom}</p>
                          <p className="text-xs text-stone-400">{agent.agent_role}</p>
                          <p className="mt-1 text-lg font-black" style={{ color: OR_PR }}>{agent.total_heures_cumul.toFixed(0)} h</p>
                          <p className="text-[10px] text-stone-400">{agent.nb_evenements} événement{agent.nb_evenements > 1 ? 's' : ''}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="overflow-hidden rounded-2xl border border-stone-100 bg-white shadow-sm">
                  <div className="flex items-center gap-2 border-b border-stone-200 bg-stone-50 px-5 py-3">
                    <span className="text-sm font-bold text-stone-700">Classement agents — tous événements</span>
                    <span className="ml-auto text-xs text-stone-400">{agents.length} agent(s)</span>
                  </div>
                  <div className="divide-y divide-stone-50">
                    {agents.map((agent, i) => {
                      const maxH = agents[0]?.total_heures_cumul || 1;
                      const pct = (agent.total_heures_cumul / maxH) * 100;
                      return (
                        <div key={agent.agent_nom} className="flex items-center gap-4 px-5 py-3 hover:bg-stone-50">
                          <span className={`w-6 shrink-0 text-sm font-black ${i < 3 ? 'text-amber-600' : 'text-stone-300'}`}>{i < 3 ? ['🥇', '🥈', '🥉'][i] : `#${i + 1}`}</span>
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-black text-white" style={{ background: BLEU_NUIT }}>{initials(agent.agent_nom)}</div>
                          <div className="min-w-0 flex-1">
                            <div className="mb-1 flex items-center justify-between">
                              <div><span className="text-sm font-semibold text-stone-800">{agent.agent_nom}</span><span className="ml-2 text-xs text-stone-400">{agent.agent_role}</span></div>
                              <div className="ml-3 flex shrink-0 items-center gap-3">
                                <span className="text-sm font-black text-stone-900">{agent.total_heures_cumul.toFixed(0)} h</span>
                                <span className="text-xs text-stone-400">{agent.nb_evenements} evt</span>
                                {agent.total_cout_cumul > 0 && <span className="text-xs font-semibold" style={{ color: OR_PR }}>{agent.total_cout_cumul.toFixed(0)} €</span>}
                              </div>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: i < 3 ? OR_PR : BLEU_NUIT + '60' }} /></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {tab === 'alertes' && (
              <div className="space-y-3">
                {alertes.length === 0 ? (
                  <div className="rounded-2xl border border-green-200 bg-green-50 p-8 text-center"><CheckCircle size={32} className="mx-auto mb-2 text-green-500" /><p className="font-bold text-green-700">Aucune alerte RH</p><p className="text-sm text-green-500">Aucune anomalie à signaler.</p></div>
                ) : alertes.map((a, i) => (
                  <div key={i} className={`rounded-2xl border p-4 ${a.level === 'critique' ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'}`}>
                    <div className="mb-1 flex items-center gap-2"><AlertTriangle size={16} className={a.level === 'critique' ? 'text-red-600' : 'text-amber-600'} /><p className={`text-sm font-bold ${a.level === 'critique' ? 'text-red-800' : 'text-amber-800'}`}>{a.msg}</p></div>
                    <p className="ml-6 text-xs text-stone-500">{a.detail}</p>
                  </div>
                ))}
              </div>
            )}

            {tab === 'export' && (
              <div className="space-y-4 rounded-2xl border border-stone-100 bg-white p-6">
                <h3 className="font-bold text-stone-800">📥 Export des données RH — <span className="capitalize">{period.label}</span></h3>
                {[
                  { label: 'Synthèse par événement (CSV)', rows: () => kpis.map((k) => ({ evenement: k.event_name, date: k.event_date, agents: k.nb_agents, moy_heures: k.moy_heures_agent, cout_rh: k.total_cout_rh, confirmation_pct: k.taux_confirmation_pct })), file: 'rh_evenements' },
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

function EventRow({ k, totalCout }: { k: EventKpi; totalCout: number }) {
  const share = totalCout > 0 ? (k.total_cout_rh / totalCout) * 100 : 0;
  return (
    <div className="rounded-2xl border border-stone-100 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-bold text-stone-900">{k.event_name}</p>
          <p className="text-xs text-stone-400">{new Date(k.event_date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg bg-stone-100 px-2 py-1 text-xs font-semibold text-stone-600">👥 {k.nb_agents} agents</span>
          <span className="rounded-lg bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">⏱ {k.moy_heures_agent.toFixed(1)} h/agent</span>
          {k.total_cout_rh > 0 && <span className="rounded-lg px-2 py-1 text-xs font-semibold" style={{ background: OR_PR + '20', color: OR_PR }}>💰 {k.total_cout_rh.toFixed(0)} € RH</span>}
          <span className={`rounded-lg px-2 py-1 text-xs font-semibold ${k.taux_confirmation_pct >= 80 ? 'bg-green-100 text-green-700' : k.taux_confirmation_pct >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>✓ {k.taux_confirmation_pct}% conf.</span>
        </div>
      </div>
      {share > 0 && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full" style={{ width: `${share.toFixed(1)}%`, background: OR_PR }} /></div>
          <p className="mt-0.5 text-right text-[10px] text-stone-400">{share.toFixed(1)}% du coût période</p>
        </div>
      )}
    </div>
  );
}

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
