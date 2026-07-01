/**
 * Onglet « 📈 Analyse conso » d'un événement (ROLE_STADE).
 * Restitue, par espace, l'historique de consommation appris par le moteur
 * et la recommandation projetée pour le prochain événement.
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Package, TrendingUp } from 'lucide-react';
import {
  Alert,
  Badge,
  EmptyState,
  Select,
  Spinner,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui';
import type { ConsumptionAnalytics, Event, StatusTone } from '@/lib/types';
import type { EventSpaceWithSpace } from '@/hooks/useEvents';
import {
  useSpaceAnalytics,
  useSpaceConfidence,
} from '@/hooks/useConsumptionAnalytics';
import {
  computeRecommendation,
  confidenceBars,
  TREND_META,
  type RecommendationResult,
} from '@/lib/analyticsEngine';

/* ─── Barème de tendance : garde-fou pour les valeurs nulles ─────────── */
type TrendKey = keyof typeof TREND_META;

function isTrendKey(value: string | null): value is TrendKey {
  return value !== null && value in TREND_META;
}

/* ─── Composant principal ────────────────────────────────────────────── */
export function ConsumptionAnalysisTab({
  event,
  spaces,
}: {
  event: Event;
  spaces: EventSpaceWithSpace[];
}) {
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>(
    () => spaces[0]?.space_id ?? '',
  );

  const eventType = event.event_type ?? '';

  const { data: analytics, isLoading } = useSpaceAnalytics(
    selectedSpaceId || undefined,
    eventType,
  );
  const { data: confidence } = useSpaceConfidence(
    selectedSpaceId || undefined,
    eventType,
  );

  const spaceOptions = useMemo(
    () =>
      spaces.map((s) => ({
        value: s.space_id,
        label: s.spaces?.space_name ?? s.space_id,
      })),
    [spaces],
  );

  const spaceName = useMemo(
    () =>
      spaces.find((s) => s.space_id === selectedSpaceId)?.spaces?.space_name ??
      'Espace',
    [spaces, selectedSpaceId],
  );

  /** Recommandation pré-calculée par ligne (mémoïsée). */
  const rows = useMemo(() => {
    const list = analytics ?? [];
    return list.map((row) => {
      const reco: RecommendationResult | null = row.product
        ? computeRecommendation({
            event,
            analytics: row,
            product: row.product,
            areaInitialStock: 0,
          })
        : null;
      return { row, reco };
    });
  }, [analytics, event]);

  /* ─── Titre + garde « type non défini » ───────────────────────────── */
  const header = (
    <div>
      <h2 className="font-display text-lg font-semibold text-pr-black">
        Analyse de consommation — {event.event_name}
      </h2>
      <p className="mt-0.5 text-sm text-pr-black-soft">
        Données intégrées dans l'historique · le calcul se met à jour à chaque
        clôture.
      </p>
    </div>
  );

  if (event.event_type === null) {
    return (
      <div className="space-y-4">
        {header}
        <Alert variant="info" title="Analyse indisponible">
          Type d'événement non défini — analyse indisponible.
        </Alert>
      </div>
    );
  }

  const bars = confidence ? confidenceBars(confidence.avgConfidence) : null;

  return (
    <div className="space-y-5">
      {header}

      {/* Sélecteur d'espace */}
      <div className="max-w-xs">
        <Select
          label="Espace"
          options={spaceOptions}
          value={selectedSpaceId}
          onChange={(e) => setSelectedSpaceId(e.target.value)}
        />
      </div>

      {/* Bandeau de confiance */}
      {confidence && bars && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-pr-cream px-4 py-3 ring-1 ring-inset ring-pr-stone">
          <span className="font-mono text-base tracking-widest text-pr-olive-dark">
            {'▓'.repeat(bars.filled)}
            {'░'.repeat(5 - bars.filled)}
          </span>
          <span className="text-sm font-semibold text-pr-black">
            {Math.round(confidence.avgConfidence * 100)}% · {bars.label}
          </span>
          <span className="text-sm text-pr-black-soft">
            {confidence.nbProductsWithHistory} produits avec historique ·{' '}
            {confidence.nbProductsWithoutHistory} sans
          </span>
        </div>
      )}

      {isLoading ? (
        <Spinner label="Analyse…" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title="Aucun historique pour cet espace"
          message="Clôturez des événements pour alimenter le moteur."
        />
      ) : (
        <>
          {/* Table principale */}
          <section className="space-y-2">
            <h3 className="font-display text-base font-semibold text-pr-black">
              Par espace — {spaceName}
            </h3>
            <Table>
              <THead>
                <TR>
                  <TH>Produit</TH>
                  <TH className="text-right">Conso moyenne</TH>
                  <TH className="text-right">Ratio/100 pax</TH>
                  <TH className="text-right">Retour %</TH>
                  <TH>Tendance</TH>
                  <TH>Recommandation prochaine</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map(({ row, reco }) => (
                  <TR key={row.product_id}>
                    <TD className="px-3 py-2 font-medium text-pr-black">
                      {row.product?.product_name ?? row.product_id}
                    </TD>
                    <TD className="px-3 py-2 text-right tabular-nums">
                      {formatNum(row.avg_qty_per_event)}
                    </TD>
                    <TD className="px-3 py-2 text-right tabular-nums">
                      {formatNum(row.avg_qty_per_100_pax)}
                    </TD>
                    <TD className="px-3 py-2 text-right tabular-nums">
                      {row.return_rate_avg !== null
                        ? `${Math.round(row.return_rate_avg * 100)}%`
                        : '—'}
                    </TD>
                    <TD className="px-3 py-2">
                      <TrendBadge direction={row.trend_direction} />
                    </TD>
                    <TD className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="tabular-nums font-medium text-pr-black">
                          {reco ? reco.recommendedQty : '—'}
                        </span>
                        <span className="text-xs text-pr-black-soft">
                          {row.product?.unit ?? ''}
                        </span>
                        {reco?.alertType && (
                          <span
                            className="inline-block h-2 w-2 rounded-full bg-pr-rust"
                            title={reco.alertMessage ?? reco.alertType}
                            aria-label="Alerte"
                          />
                        )}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </section>

          {/* Alertes de lucidité */}
          <LucidityAlerts analytics={analytics ?? []} />

          {/* Impact sur le prochain événement */}
          <NextEventImpact rows={rows} />
        </>
      )}
    </div>
  );
}

/* ─── Sous-composants ────────────────────────────────────────────────── */

function TrendBadge({ direction }: { direction: ConsumptionAnalytics['trend_direction'] }) {
  if (!isTrendKey(direction)) {
    return <span className="text-pr-black-soft">—</span>;
  }
  const meta = TREND_META[direction];
  return (
    <Badge tone={meta.tone as StatusTone}>
      {meta.arrow} {meta.label}
    </Badge>
  );
}

function LucidityAlerts({ analytics }: { analytics: ConsumptionAnalytics[] }) {
  const alerts = useMemo(() => {
    const out: { key: string; icon: string; tone: StatusTone; text: string }[] = [];
    for (const a of analytics) {
      const name = a.product?.product_name ?? a.product_id;
      if (a.rupture_count >= 2) {
        out.push({
          key: `${a.product_id}-rupture`,
          icon: '🔴',
          tone: 'danger',
          text: `${name} : Rupture ×${a.rupture_count} → dotation + marge`,
        });
      }
      if (a.surdotation_count >= 3 && (a.return_rate_avg ?? 0) > 0.45) {
        out.push({
          key: `${a.product_id}-surdotation`,
          icon: '📦',
          tone: 'warning',
          text: `${name} : Surdotation ×${a.surdotation_count} (retour ${Math.round(
            (a.return_rate_avg ?? 0) * 100,
          )}%)`,
        });
      }
      if (a.trend_direction === 'forte_hausse') {
        out.push({
          key: `${a.product_id}-hausse`,
          icon: '📈',
          tone: 'info',
          text: `${name} : Forte hausse de consommation`,
        });
      }
    }
    return out;
  }, [analytics]);

  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 font-display text-base font-semibold text-pr-black">
        <AlertTriangle className="h-4 w-4 text-pr-rust" aria-hidden />
        Alertes de lucidité
      </h3>
      {alerts.length === 0 ? (
        <p className="text-sm text-pr-black-soft">Aucune alerte sur cet espace.</p>
      ) : (
        <ul className="space-y-1.5">
          {alerts.map((al) => (
            <li key={al.key} className="flex items-center gap-2 text-sm">
              <span aria-hidden>{al.icon}</span>
              <Badge tone={al.tone}>{al.text}</Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface Row {
  row: ConsumptionAnalytics;
  reco: RecommendationResult | null;
}

function NextEventImpact({ rows }: { rows: Row[] }) {
  const impacts = useMemo(
    () =>
      rows
        .filter(({ row }) => row.nb_events_analyzed > 0)
        .slice(0, 5),
    [rows],
  );

  if (impacts.length === 0) return null;

  return (
    <section className="space-y-2 rounded-lg bg-pr-cream px-4 py-3 ring-1 ring-inset ring-pr-stone">
      <h3 className="flex items-center gap-2 font-display text-base font-semibold text-pr-black">
        <Package className="h-4 w-4 text-pr-olive" aria-hidden />
        Impact sur le prochain événement
      </h3>
      <ul className="space-y-1.5">
        {impacts.map(({ row, reco }) => (
          <li key={row.product_id} className="text-sm">
            <div className="flex items-center gap-1.5 text-pr-black">
              <ArrowRight className="h-3.5 w-3.5 text-pr-olive" aria-hidden />
              <span className="font-medium">
                {row.product?.product_name ?? row.product_id}
              </span>
              <span className="text-pr-black-soft">
                : recommandation {reco ? reco.recommendedQty : 0}{' '}
                {row.product?.unit ?? ''}
              </span>
            </div>
            {reco?.alertMessage && (
              <p className="ml-5 text-xs text-pr-black-soft">{reco.alertMessage}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ─── Aides de formatage ─────────────────────────────────────────────── */
function formatNum(value: number | null): string {
  if (value === null) return '—';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
