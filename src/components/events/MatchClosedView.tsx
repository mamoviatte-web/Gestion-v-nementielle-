/**
 * MatchClosedView — bilan post-match par espace. Affiché à la place du
 * « Suivi live » quand un MATCH est clôturé (jamais pour les séminaires).
 * Source : vue match_closed_summary (supabase/match_closed_summary.sql).
 */

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ChevronDown, ChevronRight, TrendingUp, Users, Package,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { SuiviRhBlock } from './SuiviRhBlock';

type StatutEspace = 'complet' | 'cloture_partielle' | 'ouverture_seule' | 'aucun_stock';

const STATUT_STYLE: Record<StatutEspace, { bg: string; border: string; dot: string; label: string }> = {
  complet:           { bg: 'bg-green-50',  border: 'border-green-200',  dot: 'bg-green-500',  label: '✅ Complet' },
  cloture_partielle: { bg: 'bg-amber-50',  border: 'border-amber-200',  dot: 'bg-amber-500',  label: '⚠️ Partiel' },
  ouverture_seule:   { bg: 'bg-orange-50', border: 'border-orange-200', dot: 'bg-orange-500', label: '📥 Ouverture seule' },
  aucun_stock:       { bg: 'bg-red-50',    border: 'border-red-200',    dot: 'bg-red-500',    label: '❌ Aucun stock' },
};

const PROFILE_ICON: Record<string, string> = {
  salon: '⭐', loge: '🏆', bar_pub: '🍺', wine_bar: '🍷', club: '🎵',
  pmr: '♿', bodega: '🎭', terrasse: '🌿', buvette: '🍺',
};

interface SummaryRow {
  space_id: string;
  space_name: string;
  service_type: string;
  space_profile: string;
  produits_saisis: number;
  produits_clotures: number;
  cout_fb_espace: number;
  nb_agents_declares: number;
  heures_travaillees: number;
  cout_rh_espace: number;
  agents_confirmes: number;
  debrief_note: number | null;
  debrief_soumis_le: string | null;
  statut_espace: StatutEspace;
  responsable: string | null;
}

function n(v: unknown): number {
  const x = typeof v === 'string' ? parseFloat(v) : (v as number);
  return Number.isFinite(x) ? x : 0;
}
const eur = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

interface Alert {
  level: 'critical' | 'warning' | 'info';
  msg: string;
  sub: string;
}

export function MatchClosedView({ eventId, paxCount }: { eventId: string; eventName: string; paxCount: number }) {
  const [spaces, setSpaces] = useState<SummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    void supabase.from('match_closed_summary').select('*').eq('event_id', eventId).then(({ data }) => {
      if (!alive) return;
      const rows = (data as Record<string, unknown>[] | null) ?? [];
      setSpaces(rows.map((r) => ({
        space_id: r.space_id as string,
        space_name: r.space_name as string,
        service_type: r.service_type as string,
        space_profile: r.space_profile as string,
        produits_saisis: n(r.produits_saisis),
        produits_clotures: n(r.produits_clotures),
        cout_fb_espace: n(r.cout_fb_espace),
        nb_agents_declares: n(r.nb_agents_declares),
        heures_travaillees: n(r.heures_travaillees),
        cout_rh_espace: n(r.cout_rh_espace),
        agents_confirmes: n(r.agents_confirmes),
        debrief_note: r.debrief_note != null ? n(r.debrief_note) : null,
        debrief_soumis_le: (r.debrief_soumis_le as string | null) ?? null,
        statut_espace: (r.statut_espace as StatutEspace) ?? 'aucun_stock',
        responsable: (r.responsable as string | null) ?? null,
      })));
      setLoading(false);
    });
    return () => { alive = false; };
  }, [eventId]);

  const totals = useMemo(() => spaces.reduce(
    (acc, s) => ({
      fb: acc.fb + s.cout_fb_espace,
      rh: acc.rh + s.cout_rh_espace,
      agents: acc.agents + s.nb_agents_declares,
      heures: acc.heures + s.heures_travaillees,
      complets: acc.complets + (s.statut_espace === 'complet' ? 1 : 0),
      partiels: acc.partiels + (s.statut_espace !== 'complet' ? 1 : 0),
    }),
    { fb: 0, rh: 0, agents: 0, heures: 0, complets: 0, partiels: 0 },
  ), [spaces]);

  const alerts = useMemo<Alert[]>(() => [
    ...spaces.filter((s) => s.statut_espace === 'aucun_stock').map((s) => ({
      level: 'critical' as const,
      msg: `${s.space_name} — aucun stock saisi`,
      sub: s.responsable ? `Responsable : ${s.responsable}` : 'Aucun responsable connecté',
    })),
    ...spaces.filter((s) => s.statut_espace === 'ouverture_seule').map((s) => ({
      level: 'warning' as const,
      msg: `${s.space_name} — clôture manquante`,
      sub: 'Stock initial saisi mais pas de stock final',
    })),
    ...spaces.filter((s) => s.nb_agents_declares > 0 && s.agents_confirmes < s.nb_agents_declares).map((s) => ({
      level: 'warning' as const,
      msg: `${s.space_name} — ${s.nb_agents_declares - s.agents_confirmes} agent(s) non confirmé(s)`,
      sub: 'Horaires RH incomplets',
    })),
    ...spaces.filter((s) => !s.debrief_soumis_le && s.statut_espace === 'complet').map((s) => ({
      level: 'info' as const,
      msg: `${s.space_name} — débrief non soumis`,
      sub: s.responsable ? `Relancer ${s.responsable}` : '',
    })),
  ], [spaces]);

  const criticalCount = alerts.filter((a) => a.level === 'critical').length;

  const vipSpaces = spaces.filter((s) => s.space_profile !== 'buvette' && s.space_profile !== 'terrasse');
  const buvetteSpaces = spaces.filter((s) => s.space_profile === 'buvette' || s.space_profile === 'terrasse');
  const visibleVIP = showAll ? vipSpaces : vipSpaces.slice(0, 8);
  const buvetteFb = buvetteSpaces.reduce((sum, b) => sum + b.cout_fb_espace, 0);

  if (loading)
    return (
      <div className="mt-4 space-y-3">
        {[...Array(4)].map((_, i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-stone-100" />)}
      </div>
    );

  const kpis = [
    {
      icon: '💰', accent: '#C9A646', label: 'Coût F&B HT',
      value: totals.fb > 0 ? `${eur(totals.fb)} €` : '—',
      sub: paxCount > 0 && totals.fb > 0 ? `${(totals.fb / paxCount).toFixed(2)} €/pax` : undefined,
    },
    {
      icon: '⏱', accent: '#2563EB', label: 'Coût RH HT',
      value: totals.rh > 0 ? `${eur(totals.rh)} €` : '—',
      sub: totals.heures > 0 ? `${totals.heures.toFixed(0)} h · ${totals.agents} agents` : undefined,
    },
    {
      icon: '✅', accent: totals.partiels > 0 ? '#F97316' : '#059669', label: 'Espaces complets',
      value: `${totals.complets}/${spaces.length}`,
      sub: totals.partiels > 0 ? `${totals.partiels} incomplet(s)` : 'Tout complet',
    },
    {
      icon: '⚡',
      accent: criticalCount > 0 ? '#DC2626' : alerts.length > 0 ? '#F97316' : '#9CA3AF',
      value: criticalCount > 0 ? criticalCount : alerts.length > 0 ? alerts.length : '—',
      label: criticalCount > 0 ? 'Alerte(s) critique(s)' : alerts.length > 0 ? 'Point(s) attention' : 'Aucune alerte',
      sub: undefined,
    },
  ];

  return (
    <div className="mt-4 space-y-5">
      {/* ── BILAN GLOBAL ── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpis.map((k, i) => (
          <div key={i} className="relative overflow-hidden rounded-2xl border border-stone-100 bg-white p-4 shadow-sm">
            <div className="absolute left-0 right-0 top-0 h-1 rounded-t-2xl" style={{ background: k.accent }} />
            <span className="text-xl">{k.icon}</span>
            <p className="mt-2 text-2xl font-black text-stone-900">{k.value}</p>
            <p className="mt-0.5 text-xs text-stone-500">{k.label}</p>
            {k.sub && <p className="mt-0.5 text-[11px] text-stone-400">{k.sub}</p>}
          </div>
        ))}
      </div>

      {/* ── SUIVI RH (espaces + pôles hors resto + agents) ── */}
      <SuiviRhBlock eventId={eventId} fbCost={totals.fb} />

      {/* ── ALERTES ── */}
      {alerts.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-stone-100 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-stone-50 px-5 py-3">
            <AlertTriangle size={15} className="text-amber-500" />
            <p className="text-sm font-bold text-stone-800">{alerts.length} point{alerts.length > 1 ? 's' : ''} à traiter</p>
          </div>
          <div className="divide-y divide-stone-50">
            {alerts.map((a, i) => (
              <div key={i} className={`flex items-start gap-3 px-5 py-3 ${a.level === 'critical' ? 'bg-red-50' : a.level === 'warning' ? 'bg-amber-50' : 'bg-stone-50'}`}>
                <span className="mt-0.5 shrink-0 text-base">{a.level === 'critical' ? '🔴' : a.level === 'warning' ? '🟡' : 'ℹ️'}</span>
                <div>
                  <p className={`text-sm font-semibold ${a.level === 'critical' ? 'text-red-800' : a.level === 'warning' ? 'text-amber-800' : 'text-stone-700'}`}>{a.msg}</p>
                  {a.sub && <p className="mt-0.5 text-xs text-stone-400">{a.sub}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── ESPACES VIP & BARS ── */}
      {vipSpaces.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-stone-100 bg-white shadow-sm">
          <div className="border-b border-stone-50 px-5 py-3">
            <p className="text-sm font-bold text-stone-800">Espaces VIP &amp; Bars</p>
          </div>
          <div className="divide-y divide-stone-50">
            {visibleVIP.map((space) => {
              const style = STATUT_STYLE[space.statut_espace] ?? STATUT_STYLE.aucun_stock;
              const isOpen = expanded.has(space.space_id);
              const hasData = space.produits_saisis > 0 || space.nb_agents_declares > 0;
              return (
                <div key={space.space_id}>
                  <button
                    onClick={() => {
                      if (!hasData) return;
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(space.space_id)) next.delete(space.space_id);
                        else next.add(space.space_id);
                        return next;
                      });
                    }}
                    className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-stone-50"
                  >
                    <div className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
                    <span className="shrink-0 text-base">{PROFILE_ICON[space.space_profile] ?? '📋'}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-stone-800">{space.space_name}</p>
                        {space.responsable && <span className="hidden text-xs text-stone-400 sm:inline">{space.responsable}</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-4">
                      {space.cout_fb_espace > 0 && <span className="text-sm font-bold text-stone-700">{space.cout_fb_espace.toFixed(0)} €</span>}
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${style.bg} ${style.border}`}>{style.label}</span>
                      {hasData && (isOpen ? <ChevronDown size={14} className="text-stone-400" /> : <ChevronRight size={14} className="text-stone-400" />)}
                    </div>
                  </button>

                  {isOpen && (
                    <div className={`border-t border-stone-100 px-5 pb-4 pt-0 ${style.bg}`}>
                      <div className="mt-3 grid grid-cols-3 gap-3">
                        <div className="rounded-xl bg-white p-3 text-center">
                          <Package size={13} className="mx-auto mb-1 text-stone-300" />
                          <p className="text-lg font-black text-stone-900">{space.produits_clotures}/{space.produits_saisis}</p>
                          <p className="text-[10px] text-stone-400">produits clôturés</p>
                        </div>
                        <div className="rounded-xl bg-white p-3 text-center">
                          <Users size={13} className="mx-auto mb-1 text-stone-300" />
                          <p className="text-lg font-black text-stone-900">{space.agents_confirmes}/{space.nb_agents_declares}</p>
                          <p className="text-[10px] text-stone-400">agents confirmés</p>
                          {space.heures_travaillees > 0 && <p className="text-[10px] text-stone-300">{space.heures_travaillees.toFixed(1)} h total</p>}
                        </div>
                        <div className="rounded-xl bg-white p-3 text-center">
                          <TrendingUp size={13} className="mx-auto mb-1 text-stone-300" />
                          {space.debrief_soumis_le ? (
                            <>
                              <p className="text-lg font-black text-green-600">✓</p>
                              <p className="text-[10px] text-stone-400">Débrief soumis</p>
                            </>
                          ) : (
                            <>
                              <p className="text-lg font-black text-stone-300">—</p>
                              <p className="text-[10px] text-stone-400">Pas de débrief</p>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {!showAll && vipSpaces.length > 8 && (
            <button
              onClick={() => setShowAll(true)}
              className="w-full border-t border-stone-50 py-3 text-sm text-stone-400 transition-colors hover:bg-stone-50 hover:text-stone-600"
            >
              Voir {vipSpaces.length - 8} espaces de plus ↓
            </button>
          )}
        </div>
      )}

      {/* ── BUVETTES & TERRASSES — résumé agrégé ── */}
      {buvetteSpaces.length > 0 && (
        <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-bold text-stone-800">🍺 Buvettes &amp; Terrasses</p>
            <span className="text-xs text-stone-400">
              {buvetteSpaces.filter((s) => s.statut_espace === 'complet').length}/{buvetteSpaces.length} complètes
            </span>
          </div>
          <div className="mb-3 h-2.5 overflow-hidden rounded-full bg-stone-100">
            <div
              className="h-full rounded-full bg-green-500 transition-all"
              style={{ width: `${buvetteSpaces.length > 0 ? (buvetteSpaces.filter((s) => s.statut_espace === 'complet').length / buvetteSpaces.length) * 100 : 0}%` }}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {buvetteSpaces.map((b) => {
              const st = STATUT_STYLE[b.statut_espace] ?? STATUT_STYLE.aucun_stock;
              return (
                <span key={b.space_id} className={`rounded-lg border px-2.5 py-1 text-xs font-bold ${st.bg} ${st.border}`}>
                  {b.space_name.replace('Buvette ', 'B')}
                </span>
              );
            })}
          </div>
          {buvetteFb > 0 && (
            <p className="mt-3 text-xs text-stone-400">
              F&amp;B buvettes : <strong className="text-stone-700">{eur(buvetteFb)} € HT</strong>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
