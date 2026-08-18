/**
 * useInbox — agrégation UNIQUE de la file d'actions à traiter (ROLE_STADE).
 *
 * Une seule source pour le badge « 9+ » ET la liste du Tableau de bord (pas
 * d'agrégation éparpillée). Trois familles, depuis les tables existantes :
 *   - Saisie stock manquante : event_spaces vs event_stock_lines soumis (event actif)
 *   - Débriefs manquants      : event_spaces vs debriefs soumis (event actif)
 *   - Anomalies qualité       : audit_findings ouvertes, sévérité ≠ faible
 * Lecture seule. React Query (clé partagée) → un seul fetch dédupliqué.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type InboxKind = 'Saisie stock' | 'Débrief' | 'Anomalie';
export interface InboxItem {
  key: string;
  kind: InboxKind;
  sev: 'crit' | 'warn';
  label: string;
  sub?: string;
  to: string;
}

const ACTIVE = ['préparé', 'en_cours', 'clôture_en_attente'];
const RANK = { crit: 0, warn: 1 } as const;

/** Ajoute space_id au set de la clé event_id (Map de sets). */
function add(map: Map<string, Set<string>>, ev: string, sp: string) {
  let s = map.get(ev);
  if (!s) { s = new Set(); map.set(ev, s); }
  s.add(sp);
}

export function useInbox() {
  return useQuery({
    queryKey: ['inbox'],
    staleTime: 60_000,
    refetchInterval: 90_000,
    queryFn: async (): Promise<InboxItem[]> => {
      const items: InboxItem[] = [];

      const { data: events } = await supabase.from('events').select('event_id, event_name, status').in('status', ACTIVE);
      const evs = (events as { event_id: string; event_name: string; status: string }[] | null) ?? [];
      const ids = evs.map((e) => e.event_id);

      if (ids.length) {
        const [{ data: spacesData }, { data: linesData }, { data: debriefData }] = await Promise.all([
          supabase.from('event_spaces').select('event_id, space_id').in('event_id', ids),
          supabase.from('event_stock_lines').select('event_id, space_id, submitted_at').in('event_id', ids),
          supabase.from('debriefs').select('event_id, space_id, submitted_at').in('event_id', ids),
        ]);

        const spacesByEvent = new Map<string, Set<string>>();
        for (const s of (spacesData as { event_id: string; space_id: string }[] | null) ?? []) add(spacesByEvent, s.event_id, s.space_id);
        const stockOk = new Map<string, Set<string>>();
        for (const l of (linesData as { event_id: string; space_id: string; submitted_at: string | null }[] | null) ?? []) if (l.submitted_at) add(stockOk, l.event_id, l.space_id);
        const debriefOk = new Map<string, Set<string>>();
        for (const d of (debriefData as { event_id: string; space_id: string; submitted_at: string | null }[] | null) ?? []) if (d.submitted_at) add(debriefOk, d.event_id, d.space_id);

        for (const e of evs) {
          const total = spacesByEvent.get(e.event_id)?.size ?? 0;
          if (!total) continue;
          const sOk = stockOk.get(e.event_id)?.size ?? 0;
          const dOk = debriefOk.get(e.event_id)?.size ?? 0;
          const sMiss = total - sOk;
          const dMiss = total - dOk;
          if (sMiss > 0) {
            items.push({
              key: `stock-${e.event_id}`,
              kind: 'Saisie stock',
              sev: e.status === 'en_cours' ? 'crit' : 'warn',
              label: `${e.event_name} — ${sOk}/${total} espaces saisis`,
              sub: `${sMiss} espace${sMiss > 1 ? 's' : ''} sans stock saisi`,
              to: `/admin/events/${e.event_id}`,
            });
          }
          if (dMiss > 0) {
            items.push({
              key: `debrief-${e.event_id}`,
              kind: 'Débrief',
              sev: 'warn',
              label: `${e.event_name} — ${dOk}/${total} débriefs`,
              sub: `${dMiss} débrief${dMiss > 1 ? 's' : ''} manquant${dMiss > 1 ? 's' : ''}`,
              to: `/admin/events/${e.event_id}`,
            });
          }
        }
      }

      const { data: run } = await supabase.from('audit_latest_run').select('id').maybeSingle();
      const runId = (run as { id: string } | null)?.id;
      if (runId) {
        const { data: f } = await supabase
          .from('audit_findings')
          .select('id, title, severity')
          .eq('audit_run_id', runId)
          .eq('status', 'ouverte')
          .neq('severity', 'faible');
        for (const x of (f as { id: string; title: string; severity: string }[] | null) ?? []) {
          items.push({
            key: `finding-${x.id}`,
            kind: 'Anomalie',
            sev: x.severity === 'critique' ? 'crit' : 'warn',
            label: x.title,
            sub: `Qualité des données · ${x.severity}`,
            to: '/admin/audit',
          });
        }
      }

      return items.sort((a, b) => RANK[a.sev] - RANK[b.sev]);
    },
  });
}
