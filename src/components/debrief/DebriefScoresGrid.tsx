/**
 * DebriefScoresGrid — grille comparative des scores de débrief par espace.
 *
 * Vue admin (ROLE_STADE) affichée dans l'onglet « Débriefs » d'un événement.
 * Compare, espace par espace, les notes de service / ménage / technique, l'état
 * des stocks, les urgences signalées et le statut de soumission.
 */

import { useQuery } from '@tanstack/react-query';
import {
  ClipboardList,
  AlertTriangle,
  Star,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import {
  Badge,
  Alert,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
  EmptyState,
  Spinner,
} from '@/components/ui';
import { supabase } from '@/lib/supabase';
import type { EventSpaceWithSpace } from '@/hooks/useEvents';

/** Ligne de débrief telle que sélectionnée pour la grille. */
interface DebriefScoreRow {
  space_id: string;
  submitted_at: string | null;
  overall_rating: number | null;
  service_score: number | null;
  cleaning_score: number | null;
  technical_score: number | null;
  stocks_suffisants: string | boolean | null;
  has_urgent_issue: boolean | null;
  urgent_issue_detail: string | null;
  cleaning_issues: string[] | null;
  tech_issues: string[] | null;
  cleaning_comment: string | null;
  technical_comment: string | null;
}

const SELECT_COLUMNS =
  'space_id, submitted_at, overall_rating, service_score, cleaning_score, technical_score, stocks_suffisants, has_urgent_issue, urgent_issue_detail, cleaning_issues, tech_issues, cleaning_comment, technical_comment';

/** Cellule de notation en étoiles (0–5) ou « — » si absente. */
function StarCell({ score }: { score: number | null }) {
  if (score === null || score === undefined) {
    return <span className="text-slate-400">—</span>;
  }
  const n = Math.max(0, Math.min(5, Math.round(score)));
  return (
    <span className="whitespace-nowrap text-amber-500" aria-label={`${n} sur 5`}>
      {'★'.repeat(n) + '☆'.repeat(5 - n)}
    </span>
  );
}

/** Vrai si le champ stocks_suffisants indique « suffisant ». */
function isStocksOk(value: string | boolean | null): boolean {
  if (typeof value === 'boolean') return value;
  return value !== null && value.trim().toLowerCase() === 'oui';
}

export function DebriefScoresGrid({
  eventId,
  spaces,
}: {
  eventId: string;
  spaces: EventSpaceWithSpace[];
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['debriefScores', eventId],
    queryFn: async (): Promise<DebriefScoreRow[]> => {
      const { data: rows, error } = await supabase
        .from('debriefs')
        .select(SELECT_COLUMNS)
        .eq('event_id', eventId);
      if (error) throw error;
      return (rows ?? []) as DebriefScoreRow[];
    },
  });

  const title = (
    <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
      <Star className="h-4 w-4 text-amber-500" aria-hidden />
      Scores des débriefs par espace
    </h2>
  );

  if (isLoading) {
    return (
      <section className="space-y-3">
        {title}
        <Spinner label="Chargement des scores…" />
      </section>
    );
  }

  const debriefs = data ?? [];

  if (debriefs.length === 0) {
    return (
      <section className="space-y-3">
        {title}
        <EmptyState
          icon={ClipboardList}
          title="Aucun débrief soumis"
          message="Les scores apparaîtront dès qu'un responsable soumet son débrief."
        />
      </section>
    );
  }

  const bySpace = new Map<string, DebriefScoreRow>();
  for (const row of debriefs) {
    bySpace.set(row.space_id, row);
  }

  const spaceLabel = (s: EventSpaceWithSpace): string =>
    s.spaces?.space_name ?? s.space_id;

  const dash = <span className="text-slate-400">—</span>;

  /** Alertes agrégées (urgences + anomalies ménage/technique). */
  const alerts = spaces.reduce<
    { spaceName: string; urgent: string | null; amber: string[] }[]
  >((acc, s) => {
    const row = bySpace.get(s.space_id);
    if (!row) return acc;
    const amber: string[] = [];
    if (row.cleaning_issues && row.cleaning_issues.length > 0) {
      amber.push(`Ménage : ${row.cleaning_issues.join(', ')}`);
    }
    if (row.tech_issues && row.tech_issues.length > 0) {
      amber.push(`Technique : ${row.tech_issues.join(', ')}`);
    }
    const urgent = row.has_urgent_issue
      ? row.urgent_issue_detail ?? 'Problème urgent signalé (sans détail).'
      : null;
    if (urgent || amber.length > 0) {
      acc.push({ spaceName: spaceLabel(s), urgent, amber });
    }
    return acc;
  }, []);

  return (
    <section className="space-y-4">
      {title}

      <div className="overflow-x-auto">
        <Table>
          <THead>
            <TR>
              <TH className="sticky left-0 z-10 bg-slate-50">Critère</TH>
              {spaces.map((s) => (
                <TH key={s.space_id} className="whitespace-nowrap text-center">
                  {spaceLabel(s)}
                </TH>
              ))}
            </TR>
          </THead>
          <TBody>
            <TR>
              <TD className="sticky left-0 z-10 bg-white font-medium text-slate-900">
                Global
              </TD>
              {spaces.map((s) => {
                const row = bySpace.get(s.space_id);
                return (
                  <TD key={s.space_id} className="text-center">
                    {row ? (
                      <span
                        title={
                          row.overall_rating != null
                            ? `Note globale : ${row.overall_rating}/5`
                            : undefined
                        }
                      >
                        <StarCell score={row.service_score} />
                      </span>
                    ) : (
                      dash
                    )}
                  </TD>
                );
              })}
            </TR>

            <TR>
              <TD className="sticky left-0 z-10 bg-white font-medium text-slate-900">
                Ménage
              </TD>
              {spaces.map((s) => {
                const row = bySpace.get(s.space_id);
                return (
                  <TD key={s.space_id} className="text-center">
                    {row ? <StarCell score={row.cleaning_score} /> : dash}
                  </TD>
                );
              })}
            </TR>

            <TR>
              <TD className="sticky left-0 z-10 bg-white font-medium text-slate-900">
                Technique
              </TD>
              {spaces.map((s) => {
                const row = bySpace.get(s.space_id);
                return (
                  <TD key={s.space_id} className="text-center">
                    {row ? <StarCell score={row.technical_score} /> : dash}
                  </TD>
                );
              })}
            </TR>

            <TR>
              <TD className="sticky left-0 z-10 bg-white font-medium text-slate-900">
                Stocks
              </TD>
              {spaces.map((s) => {
                const row = bySpace.get(s.space_id);
                if (!row || row.stocks_suffisants === null) {
                  return (
                    <TD key={s.space_id} className="text-center">
                      {dash}
                    </TD>
                  );
                }
                return (
                  <TD key={s.space_id} className="text-center">
                    {isStocksOk(row.stocks_suffisants) ? (
                      <Badge tone="success">✅ Oui</Badge>
                    ) : (
                      <Badge tone="danger">⚠️ Non</Badge>
                    )}
                  </TD>
                );
              })}
            </TR>

            <TR>
              <TD className="sticky left-0 z-10 bg-white font-medium text-slate-900">
                Urgent
              </TD>
              {spaces.map((s) => {
                const row = bySpace.get(s.space_id);
                if (!row) {
                  return (
                    <TD key={s.space_id} className="text-center">
                      {dash}
                    </TD>
                  );
                }
                return (
                  <TD key={s.space_id} className="text-center">
                    {row.has_urgent_issue ? (
                      <span title={row.urgent_issue_detail ?? undefined}>
                        <Badge tone="danger">⚠️ Oui</Badge>
                      </span>
                    ) : (
                      <Badge tone="success">✅ Aucun</Badge>
                    )}
                  </TD>
                );
              })}
            </TR>

            <TR>
              <TD className="sticky left-0 z-10 bg-white font-medium text-slate-900">
                Soumis
              </TD>
              {spaces.map((s) => {
                const row = bySpace.get(s.space_id);
                if (!row) {
                  return (
                    <TD key={s.space_id} className="text-center">
                      {dash}
                    </TD>
                  );
                }
                return (
                  <TD key={s.space_id} className="text-center">
                    {row.submitted_at ? (
                      <Badge tone="success">
                        <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden />
                        Soumis
                      </Badge>
                    ) : (
                      <Badge tone="neutral">
                        <Clock className="mr-1 h-3 w-3" aria-hidden />
                        En attente
                      </Badge>
                    )}
                  </TD>
                );
              })}
            </TR>
          </TBody>
        </Table>
      </div>

      {alerts.length > 0 && (
        <div className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            Alertes débrief
          </h3>
          {alerts.map((alert) => (
            <div key={alert.spaceName} className="space-y-2">
              {alert.urgent && (
                <Alert variant="error" title={`Urgence — ${alert.spaceName}`}>
                  {alert.urgent}
                </Alert>
              )}
              {alert.amber.length > 0 && (
                <Alert variant="warning" title={`Anomalies — ${alert.spaceName}`}>
                  {alert.amber.join(' · ')}
                </Alert>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
