/**
 * useRhData — charge les données RH filtrées par période (et type d'événement).
 *
 * « Séminaire » = tout événement non-match (event_type réel = 'séminaire'
 * accentué, 'cocktail', etc.) → filtre .neq('event_type','match').
 * PostgREST sérialise numeric en chaînes → coercition Number().
 */

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Period } from '@/components/rh/PeriodSelector';

export interface EventKpi {
  event_id: string; event_name: string; event_type: string; event_date: string; pax_count: number;
  nb_agents: number; nb_espaces: number; moy_heures_agent: number; total_heures: number;
  total_cout_rh: number; taux_confirmation_pct: number; total_heures_sup: number; ratio_agents_100pax: number | null;
}
export interface EspaceRatio {
  event_id: string; event_type: string; event_date: string; space_id: string; space_name: string;
  service_type: string; nb_agents: number; moy_heures: number; cout_rh: number;
  ratio_actuel: number | null; cible_ratio: number; ecart_pct: number | null; statut_staffing: string;
}
export interface AgentCumul {
  agent_nom: string; agent_role: string; nb_evenements: number; nb_espaces_differents: number;
  total_heures_cumul: number; moy_heures_par_evt: number; total_cout_cumul: number;
  taux_confirmation_pct: number; total_heures_sup: number;
}
export interface UnifiedRow {
  event_id: string; event_type: string; agent_nom: string; agent_role: string;
  heures_travaillees: number | null; confirme_agent: boolean;
}
export interface MonthAgg { key: string; label: string; agents: number; heures: number; cout: number; evts: number }
export interface GlobalKpis {
  totalEvts: number; avgAgents: number; avgHeures: number; totalCout: number;
  totalHSup: number; totalHeures: number; tauxConfirm: number;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const fmtDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function useRhData(eventTab: 'match' | 'seminaire', period: Period) {
  const [kpis, setKpis] = useState<EventKpi[]>([]);
  const [espaces, setEspaces] = useState<EspaceRatio[]>([]);
  const [agents, setAgents] = useState<AgentCumul[]>([]);
  const [unified, setUnified] = useState<UnifiedRow[]>([]);
  const [matchCount, setMatchCount] = useState(0);
  const [semiCount, setSemiCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const start = fmtDate(period.startDate);
  const end = fmtDate(period.endDate);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      // Filtre type : match = égalité ; séminaire = tout sauf match (gère l'accent).
      const typeFilter = <T,>(q: T): T => {
        const qq = q as { eq: (c: string, v: string) => T; neq: (c: string, v: string) => T };
        return eventTab === 'match' ? qq.eq('event_type', 'match') : qq.neq('event_type', 'match');
      };
      const [{ data: k }, { data: e }, { data: a }, { data: u }, { data: counts }] = await Promise.all([
        typeFilter(supabase.from('rh_event_kpis').select('*').gte('event_date', start).lte('event_date', end)).order('event_date'),
        typeFilter(supabase.from('rh_espace_ratios').select('*').gte('event_date', start).lte('event_date', end)),
        supabase.from('rh_agents_cumul').select('*').order('total_heures_cumul', { ascending: false }),
        typeFilter(supabase.from('rh_unified').select('event_id, event_type, agent_nom, agent_role, heures_travaillees, confirme_agent').gte('event_date', start).lte('event_date', end)).order('event_date'),
        supabase.from('rh_event_kpis').select('event_type').gte('event_date', start).lte('event_date', end),
      ]);
      if (!active) return;

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
      const ct = (counts ?? []) as { event_type: string }[];
      setMatchCount(ct.filter((c) => c.event_type === 'match').length);
      setSemiCount(ct.filter((c) => c.event_type !== 'match').length);
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [eventTab, start, end]);

  const byMonth = useMemo<MonthAgg[]>(() => {
    const map: Record<string, MonthAgg> = {};
    kpis.forEach((k) => {
      const d = new Date(k.event_date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
      if (!map[key]) map[key] = { key, label, agents: 0, heures: 0, cout: 0, evts: 0 };
      map[key].agents += k.nb_agents;
      map[key].heures += k.total_heures;
      map[key].cout += k.total_cout_rh;
      map[key].evts += 1;
    });
    return Object.values(map).sort((a, b) => a.key.localeCompare(b.key));
  }, [kpis]);

  const globalKpis = useMemo<GlobalKpis | null>(() => {
    if (kpis.length === 0) return null;
    const n = kpis.length;
    const totalHeures = kpis.reduce((s, k) => s + k.total_heures, 0);
    return {
      totalEvts: n,
      avgAgents: kpis.reduce((s, k) => s + k.nb_agents, 0) / n,
      avgHeures: kpis.reduce((s, k) => s + k.moy_heures_agent, 0) / n,
      totalCout: kpis.reduce((s, k) => s + k.total_cout_rh, 0),
      totalHSup: kpis.reduce((s, k) => s + k.total_heures_sup, 0),
      totalHeures,
      tauxConfirm: kpis.reduce((s, k) => s + k.taux_confirmation_pct, 0) / n,
    };
  }, [kpis]);

  return { kpis, espaces, agents, unified, byMonth, globalKpis, matchCount, semiCount, loading };
}
