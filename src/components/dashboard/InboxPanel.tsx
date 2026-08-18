/**
 * InboxPanel — « À traiter » : file d'actions unifiée du Tableau de bord.
 *
 * Regroupe en une seule liste priorisée les points opérationnels à traiter,
 * depuis les SOURCES EXISTANTES (aucun recalcul divergent) :
 *   - Saisie stock manquante  → useDashboardLive().today_events (spaces_count vs stocks_submitted)
 *   - Débriefs en attente      → useDashboardLive().kpis.debriefs_pending
 *   - Prestataires en retard    → useDashboardLive().provider_alerts (delay_min)
 *   - Alertes stock (rupture)   → useDashboardLive().stock_alerts
 *   - Anomalies qualité ouvertes → audit_findings (dernier run, critique/moyenne)
 * Lecture seule : chaque item renvoie vers l'écran où le résoudre.
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Inbox, ChevronRight, PackageX, ClipboardCheck, Clock, AlertTriangle, ShieldAlert } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useDashboardLive } from '@/hooks/useDashboardLive';

type Sev = 'crit' | 'warn';
interface Item {
  key: string;
  sev: Sev;
  kind: string;
  icon: typeof Inbox;
  label: string;
  sub?: string;
  to: string;
}

const SEV_RANK: Record<Sev, number> = { crit: 0, warn: 1 };
const KIND_STYLE: Record<Sev, string> = {
  crit: 'bg-rose-100 text-rose-700',
  warn: 'bg-amber-100 text-amber-700',
};

export function InboxPanel() {
  const { data } = useDashboardLive();

  const findingsQ = useQuery({
    queryKey: ['inboxFindings'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data: run } = await supabase.from('audit_latest_run').select('id').maybeSingle();
      const runId = (run as { id: string } | null)?.id;
      if (!runId) return [] as { id: string; title: string; severity: string }[];
      const { data: f } = await supabase
        .from('audit_findings')
        .select('id, title, severity')
        .eq('audit_run_id', runId)
        .eq('status', 'ouverte')
        .in('severity', ['critique', 'moyenne']);
      return (f as { id: string; title: string; severity: string }[] | null) ?? [];
    },
  });

  const items: Item[] = useMemo(() => {
    const out: Item[] = [];
    const events = data?.today_events ?? [];
    const soleEvent = events.length === 1 ? events[0].event_id : null;
    const eventsLink = soleEvent ? `/admin/events/${soleEvent}` : '/admin/events';

    // 1) Saisie stock manquante (par événement du jour)
    for (const e of events) {
      const missing = e.spaces_count - e.stocks_submitted;
      if (missing > 0) {
        out.push({
          key: `stock-${e.event_id}`,
          sev: e.status === 'en_cours' ? 'crit' : 'warn',
          kind: 'Saisie stock',
          icon: PackageX,
          label: `${e.event_name} — ${e.stocks_submitted}/${e.spaces_count} espaces saisis`,
          sub: `${missing} espace${missing > 1 ? 's' : ''} sans stock saisi`,
          to: `/admin/events/${e.event_id}`,
        });
      }
    }

    // 2) Débriefs en attente (agrégat)
    const debriefs = data?.kpis.debriefs_pending ?? 0;
    if (debriefs > 0) {
      out.push({
        key: 'debriefs',
        sev: 'warn',
        kind: 'Débrief',
        icon: ClipboardCheck,
        label: `${debriefs} débrief${debriefs > 1 ? 's' : ''} en attente`,
        sub: 'Relancer les responsables d’espace',
        to: eventsLink,
      });
    }

    // 3) Prestataires en retard
    for (const p of data?.provider_alerts ?? []) {
      if (p.delay_min > 15) {
        out.push({
          key: `prov-${p.company}-${p.planned_time}`,
          sev: p.delay_min > 30 ? 'crit' : 'warn',
          kind: 'Prestataire',
          icon: Clock,
          label: `${p.company} en retard (${p.delay_min} min)`,
          sub: p.planned_time ? `Prévu ${p.planned_time.slice(0, 5)}` : undefined,
          to: eventsLink,
        });
      }
    }

    // 4) Alertes stock (rupture / critique)
    for (const a of data?.stock_alerts ?? []) {
      if (a.severity === 'avertissement') continue;
      out.push({
        key: `alert-${a.product_name}-${a.space_name ?? ''}`,
        sev: 'crit',
        kind: 'Stock',
        icon: AlertTriangle,
        label: `${a.product_name} bas (${a.current_qty}/${a.min_stock})`,
        sub: a.space_name ?? a.category,
        to: '/admin/stock',
      });
    }

    // 5) Anomalies qualité ouvertes
    for (const f of findingsQ.data ?? []) {
      out.push({
        key: `finding-${f.id}`,
        sev: f.severity === 'critique' ? 'crit' : 'warn',
        kind: 'Anomalie',
        icon: ShieldAlert,
        label: f.title,
        sub: `Qualité des données · ${f.severity}`,
        to: '/admin/audit',
      });
    }

    return out.sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev]);
  }, [data, findingsQ.data]);

  const critCount = items.filter((i) => i.sev === 'crit').length;

  if (items.length === 0) {
    return (
      <div className="mb-5 flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-white"><Inbox size={17} /></div>
        <div>
          <p className="text-sm font-bold text-emerald-800">Rien à traiter</p>
          <p className="text-xs text-emerald-600">Stocks, débriefs, prestataires et anomalies sont à jour.</p>
        </div>
      </div>
    );
  }

  return (
    <section className="mb-5 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-stone-100 px-4 py-3">
        <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-pr-black text-white">
          <Inbox size={17} />
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-pr-rust px-1 text-[10px] font-black text-white">
            {items.length > 9 ? '9+' : items.length}
          </span>
        </div>
        <div>
          <h2 className="text-sm font-black text-stone-900">À traiter</h2>
          <p className="text-[11px] text-stone-400">
            {items.length} action{items.length > 1 ? 's' : ''}{critCount > 0 ? ` · ${critCount} critique${critCount > 1 ? 's' : ''}` : ''}
          </p>
        </div>
      </div>
      <div className="divide-y divide-stone-100">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <Link key={it.key} to={it.to} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-stone-50">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${KIND_STYLE[it.sev]}`}><Icon size={15} /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-stone-800">{it.label}</span>
                {it.sub && <span className="block truncate text-[11px] text-stone-400">{it.sub}</span>}
              </span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${KIND_STYLE[it.sev]}`}>{it.kind}</span>
              <ChevronRight size={15} className="shrink-0 text-stone-300" />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
