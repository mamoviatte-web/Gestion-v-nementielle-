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
import { AlertTriangle, Calendar, CheckCircle, ChevronDown, ChevronRight, Download, FileSpreadsheet, Users } from 'lucide-react';
import { PeriodSelector, buildPeriod, type Period } from '@/components/rh/PeriodSelector';
import { HorsEventSection } from '@/components/rh/HorsEventSection';
import { useRhData, type EventKpi } from '@/hooks/useRhData';
import { supabase } from '@/lib/supabase';
import { downloadAoaWorkbook, sumFormula, type AoaCell, type AoaSheetOut } from '@/lib/xlsxAoa';
import { EUR0, HOURS, INT, type ColumnStyle } from '@/lib/excelTheme';

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
  const [showAgents, setShowAgents] = useState(false);
  const [excelLoading, setExcelLoading] = useState(false);

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

  // ── Export Excel complet et habillé (downloadAoaWorkbook) ──────────────
  const typeLabel = eventTab === 'match' ? 'Matchs' : 'Séminaires';
  const PCT_INT = '0"%"'; // taux stockés en entier 0-100 (≠ fraction PCT)
  const round1 = (n: number) => Number(n.toFixed(1));
  const frDate = (d: string) => (d ? new Date(d).toLocaleDateString('fr-FR') : '');
  const slug = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  const excelFilename = `RH-Staff_${typeLabel}_${slug(period.label)}.xlsx`;

  function buildExcelSheets(): AoaSheetOut[] {
    const g = globalKpis;
    if (!g) return [];
    const L: (s: ColumnStyle) => ColumnStyle = (s) => s;
    const tauxSup = g.totalHeures > 0 ? (g.totalHSup / g.totalHeures) * 100 : 0;

    // Cellule TOTAL auto-vérifiante pour les feuilles au format standard
    // [titre],[],[entêtes],…lignes,total (données en lignes Excel 4..3+n) :
    // =SUM sur la colonne additive `ci`. Repli sur la valeur statique si aucune
    // ligne (une plage inversée =SUM(X4:X3) serait invalide). Réservé aux
    // colonnes ADDITIVES (montants, heures, compteurs) — jamais aux moyennes/%.
    const totalCell = (ci: number, n: number, fallback: AoaCell): AoaCell =>
      n > 0 ? sumFormula(ci, 4, 3 + n) : fallback;

    // Ventilation par rôle (tri décroissant).
    const roleSorted = [...chartRoles].sort((a, b) => b.value - a.value);
    // Ventilation par espace (agrégée sur la période, tri décroissant par coût).
    const espaceMap = new Map<string, { agents: number; cout: number }>();
    espaces.forEach((e) => {
      const cur = espaceMap.get(e.space_name) ?? { agents: 0, cout: 0 };
      cur.agents += e.nb_agents;
      cur.cout += e.cout_rh;
      espaceMap.set(e.space_name, cur);
    });
    const espaceSorted = [...espaceMap.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.cout - a.cout);

    // ── Feuille 1 : SYNTHÈSE (KPIs + ventilations) ──
    const synth: AoaCell[][] = [
      [`Staff & RH — Synthèse — ${period.label} · ${typeLabel}`],
      [],
      ['Indicateur', 'Valeur', 'Coût RH (€ HT)'],
      ['Événements', g.totalEvts, null],
      ['Agents / événement (moy.)', round1(g.avgAgents), null],
      ['Heures / agent (moy.)', round1(g.avgHeures), null],
      ['Heures totales', round1(g.totalHeures), null],
      ['Heures supplémentaires', round1(g.totalHSup), null],
      ['Taux heures sup (%)', round1(tauxSup), null],
      ['Coût RH total', null, Math.round(g.totalCout)],
      [],
      ['Répartition par rôle', 'Interventions', 'Coût RH (€ HT)'],
      ...roleSorted.map((r): AoaCell[] => [r.name, r.value, null]),
      [],
      ['Répartition par espace', 'Agents', 'Coût RH (€ HT)'],
      ...espaceSorted.map((e): AoaCell[] => [e.name, e.agents, Math.round(e.cout)]),
      ['TOTAL', espaceSorted.reduce((s, e) => s + e.agents, 0), Math.round(espaceSorted.reduce((s, e) => s + e.cout, 0))],
    ];
    // TOTAL du bloc « Répartition par espace » (dernier bloc) rendu auto-vérifiant.
    // La plage est calculée depuis la matrice elle-même (robuste si les blocs du
    // haut changent) : les E lignes espace précèdent la ligne TOTAL finale.
    if (espaceSorted.length > 0) {
      const total = synth[synth.length - 1];
      const firstRow = synth.length - espaceSorted.length; // 1re ligne espace (Excel)
      const lastRow = synth.length - 1;                    // dernière ligne espace (Excel)
      total[1] = sumFormula(1, firstRow, lastRow); // Agents (additif)
      total[2] = sumFormula(2, firstRow, lastRow); // Coût RH (additif)
    }

    // ── Feuille 2 : PAR AGENT (détail nominatif) ──
    const agentHeader = ['Agent', 'Rôle', 'Événements', 'Moy. h/evt', 'Heures sup', 'Confirmation', 'Coût total'];
    const parAgent: AoaCell[][] = [
      [`Staff & RH — Par agent — ${period.label} · ${typeLabel}`],
      [],
      agentHeader,
      ...agents.map((a): AoaCell[] => [
        a.agent_nom, a.agent_role, a.nb_evenements, round1(a.moy_heures_par_evt),
        round1(a.total_heures_sup), a.taux_confirmation_pct, Math.round(a.total_cout_cumul),
      ]),
      ['TOTAL', '',
        totalCell(2, agents.length, agents.reduce((s, a) => s + a.nb_evenements, 0)), null,
        totalCell(4, agents.length, round1(agents.reduce((s, a) => s + a.total_heures_sup, 0))), null,
        totalCell(6, agents.length, Math.round(agents.reduce((s, a) => s + a.total_cout_cumul, 0)))],
    ];

    // ── Feuille 3 : CUMUL AGENTS (classement) ──
    const cumul: AoaCell[][] = [
      [`Staff & RH — Cumul agents — ${period.label} · ${typeLabel}`],
      [],
      ['Rang', 'Agent', 'Rôle', 'Événements', 'Heures cumulées', 'Heures sup', 'Coût cumulé', 'Confirmation'],
      ...agents.map((a, i): AoaCell[] => [
        i + 1, a.agent_nom, a.agent_role, a.nb_evenements, round1(a.total_heures_cumul),
        round1(a.total_heures_sup), Math.round(a.total_cout_cumul), a.taux_confirmation_pct,
      ]),
      ['TOTAL', '', '',
        totalCell(3, agents.length, agents.reduce((s, a) => s + a.nb_evenements, 0)),
        totalCell(4, agents.length, round1(agents.reduce((s, a) => s + a.total_heures_cumul, 0))),
        totalCell(5, agents.length, round1(agents.reduce((s, a) => s + a.total_heures_sup, 0))),
        totalCell(6, agents.length, Math.round(agents.reduce((s, a) => s + a.total_cout_cumul, 0))), null],
    ];

    // ── Feuille 4 : PAR ÉVÉNEMENT ──
    const parEvt: AoaCell[][] = [
      [`Staff & RH — Par événement — ${period.label} · ${typeLabel}`],
      [],
      ['Événement', 'Date', 'Type', 'Pax', 'Agents', 'Espaces', 'Moy. h/agent', 'Heures totales', 'Heures sup', 'Coût RH', 'Confirmation'],
      ...kpis.map((k): AoaCell[] => [
        k.event_name, frDate(k.event_date), k.event_type, k.pax_count, k.nb_agents, k.nb_espaces,
        round1(k.moy_heures_agent), round1(k.total_heures), round1(k.total_heures_sup),
        Math.round(k.total_cout_rh), k.taux_confirmation_pct,
      ]),
      ['TOTAL', '', '',
        totalCell(3, kpis.length, kpis.reduce((s, k) => s + k.pax_count, 0)),
        totalCell(4, kpis.length, kpis.reduce((s, k) => s + k.nb_agents, 0)),
        null, null,
        totalCell(7, kpis.length, round1(kpis.reduce((s, k) => s + k.total_heures, 0))),
        totalCell(8, kpis.length, round1(kpis.reduce((s, k) => s + k.total_heures_sup, 0))),
        totalCell(9, kpis.length, Math.round(kpis.reduce((s, k) => s + k.total_cout_rh, 0))), null],
    ];

    // ── Feuille 5 : PAR ESPACE (détail par ligne événement × espace) ──
    const espacesSorted = [...espaces].sort((a, b) => a.event_date.localeCompare(b.event_date));
    const parEspace: AoaCell[][] = [
      [`Staff & RH — Par espace — ${period.label} · ${typeLabel}`],
      [],
      ['Date', 'Espace', 'Service', 'Agents', 'Moy. h/agent', 'Coût RH'],
      ...espacesSorted.map((e): AoaCell[] => [
        frDate(e.event_date), e.space_name, e.service_type, e.nb_agents, round1(e.moy_heures), Math.round(e.cout_rh),
      ]),
      ['TOTAL', '', '',
        totalCell(3, espacesSorted.length, espacesSorted.reduce((s, e) => s + e.nb_agents, 0)), null,
        totalCell(5, espacesSorted.length, Math.round(espacesSorted.reduce((s, e) => s + e.cout_rh, 0)))],
    ];

    // ── Feuille 6 : INTERVENTIONS (ligne-à-ligne agent × événement) ──
    const evName = new Map(kpis.map((k) => [k.event_id, k.event_name]));
    const interventions: AoaCell[][] = [
      [`Staff & RH — Interventions — ${period.label} · ${typeLabel}`],
      [],
      ['Agent', 'Rôle', 'Événement', 'Heures', 'Confirmé'],
      ...unified.map((u): AoaCell[] => [
        u.agent_nom, u.agent_role, evName.get(u.event_id) ?? u.event_id,
        u.heures_travaillees == null ? null : round1(u.heures_travaillees), u.confirme_agent ? 'Oui' : 'Non',
      ]),
      ['TOTAL', '', '',
        totalCell(3, unified.length, round1(unified.reduce((s, u) => s + (u.heures_travaillees ?? 0), 0))), ''],
    ];

    return [
      { name: 'Synthèse', aoa: synth, widths: [34, 16, 18], columns: [L({ align: 'left' }), L({ align: 'right' }), L({ numFmt: EUR0, align: 'right' })] },
      { name: 'Par agent', aoa: parAgent, widths: [26, 18, 12, 12, 12, 14, 14], columns: [L({ align: 'left' }), L({ align: 'left' }), L({ numFmt: INT, align: 'right' }), L({ numFmt: HOURS, align: 'right' }), L({ numFmt: HOURS, align: 'right' }), L({ numFmt: PCT_INT, align: 'right' }), L({ numFmt: EUR0, align: 'right' })] },
      { name: 'Cumul agents', aoa: cumul, widths: [8, 26, 18, 12, 15, 12, 14, 13], columns: [L({ numFmt: INT, align: 'center' }), L({ align: 'left' }), L({ align: 'left' }), L({ numFmt: INT, align: 'right' }), L({ numFmt: HOURS, align: 'right' }), L({ numFmt: HOURS, align: 'right' }), L({ numFmt: EUR0, align: 'right' }), L({ numFmt: PCT_INT, align: 'right' })] },
      { name: 'Par événement', aoa: parEvt, widths: [28, 12, 13, 8, 9, 9, 13, 14, 11, 13, 13], columns: [L({ align: 'left' }), L({ align: 'center' }), L({ align: 'center' }), L({ numFmt: INT, align: 'right' }), L({ numFmt: INT, align: 'right' }), L({ numFmt: INT, align: 'right' }), L({ numFmt: HOURS, align: 'right' }), L({ numFmt: HOURS, align: 'right' }), L({ numFmt: HOURS, align: 'right' }), L({ numFmt: EUR0, align: 'right' }), L({ numFmt: PCT_INT, align: 'right' })] },
      { name: 'Par espace', aoa: parEspace, widths: [12, 24, 16, 10, 13, 13], columns: [L({ align: 'center' }), L({ align: 'left' }), L({ align: 'left' }), L({ numFmt: INT, align: 'right' }), L({ numFmt: HOURS, align: 'right' }), L({ numFmt: EUR0, align: 'right' })] },
      { name: 'Interventions', aoa: interventions, widths: [24, 18, 28, 11, 11], columns: [L({ align: 'left' }), L({ align: 'left' }), L({ align: 'left' }), L({ numFmt: HOURS, align: 'right' }), L({ align: 'center' })] },
    ];
  }

  async function handleExportExcel() {
    if (!globalKpis) return;
    setExcelLoading(true);
    try {
      await downloadAoaWorkbook(buildExcelSheets(), excelFilename);
    } finally {
      setExcelLoading(false);
    }
  }

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
          <div className="flex flex-wrap items-center gap-2">
            {!isHorsEvent && (
              <button
                onClick={() => void handleExportExcel()}
                disabled={!globalKpis || loading || excelLoading}
                className="flex items-center gap-2 rounded-xl bg-stone-900 px-4 py-2 text-sm font-bold text-white hover:bg-stone-700 disabled:opacity-40"
              >
                <Download size={15} /> {excelLoading ? 'Génération…' : 'Exporter Excel'}
              </button>
            )}
            <button onClick={() => navigate('/admin/analytics/staff/monthly')} className="flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50">
              <Calendar size={15} /> Rapports mensuels
            </button>
          </div>
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
                <button
                  type="button"
                  onClick={() => setShowAgents((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 border-b border-stone-200 bg-stone-50 px-5 py-3 text-left transition-colors hover:bg-stone-100"
                >
                  <span className="flex items-center gap-2 text-sm font-bold text-stone-700">
                    {showAgents ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    Détail nominatif par agent
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-stone-500">
                      {agents.length} agent{agents.length > 1 ? 's' : ''}
                    </span>
                  </span>
                  <span className="hidden text-xs font-medium text-stone-400 sm:inline">
                    {showAgents ? 'Masquer' : 'Afficher'} · détail complet dans l'export Excel ↑
                  </span>
                </button>
                {showAgents && (
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
                )}
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
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-900 bg-stone-900 p-4">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-bold text-white">
                      <FileSpreadsheet size={16} className="text-emerald-400" /> Classeur Excel complet et habillé
                    </p>
                    <p className="mt-0.5 text-xs text-stone-300">
                      6 feuilles : Synthèse (KPIs + ventilations), Par agent, Cumul agents, Par événement, Par espace, Interventions (détail ligne-à-ligne).
                    </p>
                  </div>
                  <button
                    onClick={() => void handleExportExcel()}
                    disabled={!globalKpis || excelLoading}
                    className="flex shrink-0 items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-bold text-stone-900 hover:bg-stone-100 disabled:opacity-40"
                  >
                    <Download size={14} /> {excelLoading ? 'Génération…' : 'Exporter Excel'}
                  </button>
                </div>
                <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-stone-400">Exports rapides (CSV)</p>
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
