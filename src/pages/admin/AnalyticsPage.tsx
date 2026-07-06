/**
 * Page « Analyses » (ROLE_STADE) — vue globale du moteur d'apprentissage.
 * Précision croissante à chaque événement clôturé : score de confiance,
 * tendances, alertes rupture / surdotation, et historique détaillé par produit.
 */

import { Fragment, useMemo, useState } from 'react';
import { RefreshCw, TrendingUp } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Input,
  Select,
  Spinner,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import {
  triggerAnalyticsRefresh,
  useAllAnalytics,
  useProductHistory,
} from '@/hooks/useConsumptionAnalytics';
import { confidenceBars, TREND_META } from '@/lib/analyticsEngine';
import { BuvetteAnalyticsSection } from '@/components/buvette/BuvetteAnalyticsSection';
import type { ConsumptionAnalytics } from '@/lib/types';

/* ─── Référentiels ──────────────────────────────────────────────────── */

const CATEGORIES = ['Vins', 'Bières', 'Soft', 'Sirops', 'Spiritueux', 'Matériel'] as const;

const ALL = '__all__';

function formatEventDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function confidenceGauge(score: number): string {
  const { filled } = confidenceBars(score);
  return '▓'.repeat(filled) + '░'.repeat(5 - filled);
}

/* ─── Détail historique d'un produit (composant enfant → hook non conditionnel) ── */

interface ProductHistoryDetailProps {
  spaceId: string;
  productId: string;
  eventType: string;
}

function ProductHistoryDetail({ spaceId, productId, eventType }: ProductHistoryDetailProps) {
  const { data } = useProductHistory(spaceId, productId, eventType);
  const rows = data ?? [];

  if (rows.length === 0) {
    return (
      <div className="px-3 py-3 text-sm text-pr-olive-dark">
        Aucun historique d'événement pour ce produit dans cet espace.
      </div>
    );
  }

  return (
    <div className="p-3">
      <Table>
        <THead>
          <TR>
            <TH>Événement</TH>
            <TH>Date</TH>
            <TH className="text-right">Affluence</TH>
            <TH>Météo</TH>
            <TH className="text-right">Consommé</TH>
            <TH className="text-right">Dotation</TH>
            <TH className="text-right">Taux retour</TH>
            <TH>Rupture</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row, idx) => (
            <TR key={`${row.eventName}-${row.eventDate}-${idx}`}>
              <TD className="font-medium text-pr-black">{row.eventName}</TD>
              <TD>{formatEventDate(row.eventDate)}</TD>
              <TD className="text-right tabular-nums">{row.attendance.toLocaleString('fr-FR')}</TD>
              <TD className="capitalize">{row.weather.replace(/_/g, ' ')}</TD>
              <TD className="text-right tabular-nums">{row.consumedQty}</TD>
              <TD className="text-right tabular-nums">{row.dotationQty}</TD>
              <TD className="text-right tabular-nums">{Math.round(row.returnRate * 100)} %</TD>
              <TD>
                {row.hadRupture ? (
                  <Badge tone="danger">🔴 Rupture</Badge>
                ) : (
                  <span className="text-pr-olive-dark">—</span>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

/* ─── Carte KPI ─────────────────────────────────────────────────────── */

interface ProductGroup {
  productId: string;
  productName: string;
  category: string;
  nbEspaces: number;
  nbEvenements: number;
  totalAvgConso: number;
  avgRatio100: number | null;
  avgConfidence: number;
  dominantTrend: string | null;
  totalRuptures: number;
  spaceRows: ConsumptionAnalytics[];
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-pr-stone border-t-[3px] border-t-pr-black bg-white p-4">
      <p className="text-[11px] uppercase tracking-wide text-pr-olive-dark">{label}</p>
      <p className="mt-1 font-display text-3xl font-black text-pr-black">{value}</p>
    </div>
  );
}

/* ─── Page ──────────────────────────────────────────────────────────── */

export default function AnalyticsPage() {
  const { showToast } = useToast();
  const { data, isLoading, refetch } = useAllAnalytics();
  const [refreshing, setRefreshing] = useState(false);

  const [spaceFilter, setSpaceFilter] = useState(ALL);
  const [categoryFilter, setCategoryFilter] = useState(ALL);
  const [eventTypeFilter, setEventTypeFilter] = useState(ALL);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<'product' | 'space'>('product');
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);

  const rows = useMemo<ConsumptionAnalytics[]>(() => data ?? [], [data]);

  /* Options de filtres dérivées des données. */
  const spaceOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      if (!map.has(r.space_id)) {
        map.set(r.space_id, r.space?.space_name ?? r.space_id);
      }
    }
    const opts = [...map.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
    return [{ value: ALL, label: 'Toutes' }, ...opts];
  }, [rows]);

  const categoryOptions = useMemo(
    () => [
      { value: ALL, label: 'Toutes' },
      ...CATEGORIES.map((c) => ({ value: c, label: c })),
    ],
    [],
  );

  const eventTypeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.event_type) set.add(r.event_type);
    }
    const opts = [...set]
      .sort((a, b) => a.localeCompare(b, 'fr'))
      .map((t) => ({ value: t, label: t.replace(/_/g, ' ') }));
    return [{ value: ALL, label: 'Tous' }, ...opts];
  }, [rows]);

  /* Filtrage client-side. */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (spaceFilter !== ALL && r.space_id !== spaceFilter) return false;
      if (categoryFilter !== ALL && r.product?.category !== categoryFilter) return false;
      if (eventTypeFilter !== ALL && r.event_type !== eventTypeFilter) return false;
      if (q && !(r.product?.product_name ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, spaceFilter, categoryFilter, eventTypeFilter, search]);

  /* Regroupement par produit (1 ligne / produit, détail espaces dépliable). */
  const byProduct = useMemo<ProductGroup[]>(() => {
    const map = new Map<string, ConsumptionAnalytics[]>();
    for (const r of filtered) {
      const arr = map.get(r.product_id) ?? [];
      arr.push(r);
      map.set(r.product_id, arr);
    }
    const groups: ProductGroup[] = [...map.entries()].map(([productId, spaceRows]) => {
      const first = spaceRows[0];
      const ratios = spaceRows.map((r) => r.avg_qty_per_100_pax).filter((v): v is number => v != null);
      const confs = spaceRows.map((r) => r.confidence_score).filter((v): v is number => v != null);
      // Tendance dominante (mode).
      const trendCount = new Map<string, number>();
      for (const r of spaceRows) if (r.trend_direction) trendCount.set(r.trend_direction, (trendCount.get(r.trend_direction) ?? 0) + 1);
      const dominantTrend = [...trendCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      return {
        productId,
        productName: first.product?.product_name ?? '—',
        category: first.product?.category ?? '—',
        nbEspaces: spaceRows.length,
        nbEvenements: Math.max(0, ...spaceRows.map((r) => r.nb_events_analyzed)),
        totalAvgConso: spaceRows.reduce((s, r) => s + (r.avg_qty_per_event ?? 0), 0),
        avgRatio100: ratios.length ? ratios.reduce((s, v) => s + v, 0) / ratios.length : null,
        avgConfidence: confs.length ? confs.reduce((s, v) => s + v, 0) / confs.length : 0,
        dominantTrend,
        totalRuptures: spaceRows.reduce((s, r) => s + r.rupture_count, 0),
        spaceRows,
      };
    });
    return groups.sort((a, b) => a.category.localeCompare(b.category, 'fr') || a.productName.localeCompare(b.productName, 'fr'));
  }, [filtered]);

  /* KPI globaux (calculés sur les lignes filtrées). */
  const kpis = useMemo(() => {
    const withHistory = filtered.filter((r) => r.nb_events_analyzed > 0);
    const avgConfidence =
      withHistory.length > 0
        ? withHistory.reduce((s, r) => s + (r.confidence_score ?? 0), 0) / withHistory.length
        : 0;
    return {
      avgConfidence,
      trackedCount: filtered.length,
      ruptureCount: filtered.filter((r) => r.rupture_count >= 2).length,
      surdotationCount: filtered.filter((r) => r.surdotation_count >= 3).length,
    };
  }, [filtered]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await triggerAnalyticsRefresh();
      await refetch();
      showToast('Analyses recalculées.', 'success');
    } catch {
      showToast('Le recalcul a échoué. Réessayez.', 'warning');
    } finally {
      setRefreshing(false);
    }
  }

  if (isLoading) {
    return <Spinner fullPage label="Chargement des analyses…" />;
  }

  const refreshButton = (
    <Button variant="secondary" onClick={handleRefresh} loading={refreshing}>
      <RefreshCw className="h-4 w-4" aria-hidden /> Recalculer
    </Button>
  );

  return (
    <div>
      <PageHeader
        title="Analyses"
        description="Moteur d'apprentissage — précision croissante à chaque événement clôturé."
        action={refreshButton}
      />

      <div className="mb-6">
        <BuvetteAnalyticsSection />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title="Aucune analyse disponible"
          message="Les analyses apparaîtront après la clôture d'événements."
        />
      ) : (
        <div className="space-y-6">
          {/* Barre de filtres */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select
              label="Espace"
              options={spaceOptions}
              value={spaceFilter}
              onChange={(e) => setSpaceFilter(e.target.value)}
            />
            <Select
              label="Famille produit"
              options={categoryOptions}
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            />
            <Select
              label="Type événement"
              options={eventTypeOptions}
              value={eventTypeFilter}
              onChange={(e) => setEventTypeFilter(e.target.value)}
            />
            <Input
              label="Recherche produit"
              placeholder="Nom du produit…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select
              label="Affichage"
              options={[
                { value: 'product', label: 'Par produit (groupé)' },
                { value: 'space', label: 'Par espace (détaillé)' },
              ]}
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as 'product' | 'space')}
            />
          </div>

          {/* KPI globaux */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Score de confiance moyen"
              value={`${Math.round(kpis.avgConfidence * 100)} %`}
            />
            <KpiCard label="Produits suivis" value={String(kpis.trackedCount)} />
            <KpiCard label="Alertes rupture" value={String(kpis.ruptureCount)} />
            <KpiCard label="Surdotations" value={String(kpis.surdotationCount)} />
          </div>

          {/* Table principale */}
          <div>
            <h2 className="mb-3 font-display text-lg font-bold text-pr-black">Vue par produit</h2>
            {filtered.length === 0 ? (
              <Alert variant="info" title="Aucun résultat">
                Aucun produit ne correspond aux filtres sélectionnés.
              </Alert>
            ) : groupBy === 'product' ? (
              <ProductGroupedTable
                groups={byProduct}
                expanded={expandedProduct}
                onToggle={(id) => setExpandedProduct(expandedProduct === id ? null : id)}
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Espace</TH>
                    <TH>Produit</TH>
                    <TH>Famille</TH>
                    <TH className="text-right">Historique</TH>
                    <TH className="text-right">Conso moy.</TH>
                    <TH className="text-right">Ratio/100 pax</TH>
                    <TH>Confiance</TH>
                    <TH>Tendance</TH>
                    <TH>Alerte</TH>
                  </TR>
                </THead>
                <TBody>
                  {filtered.map((r) => {
                    const key = `${r.space_id}:${r.product_id}`;
                    const isOpen = expanded === key;
                    const score = r.confidence_score ?? 0;
                    const { filled, label: confLabel } = confidenceBars(score);
                    const confTone =
                      filled >= 4 ? 'success' : filled >= 2 ? 'info' : 'neutral';
                    const trend = r.trend_direction ? TREND_META[r.trend_direction] : null;

                    return (
                      <Fragment key={key}>
                        <TR className="cursor-pointer hover:bg-pr-cream/60">
                          <TD className="font-medium text-pr-black">
                            <button
                              type="button"
                              className="text-left"
                              onClick={() => setExpanded(isOpen ? null : key)}
                            >
                              {r.space?.space_name ?? '—'}
                            </button>
                          </TD>
                          <TD className="font-medium text-pr-black">
                            <button
                              type="button"
                              className="text-left"
                              onClick={() => setExpanded(isOpen ? null : key)}
                            >
                              {r.product?.product_name ?? '—'}
                            </button>
                          </TD>
                          <TD>{r.product?.category ?? '—'}</TD>
                          <TD className="text-right tabular-nums">
                            {r.nb_events_analyzed} évén.
                          </TD>
                          <TD className="text-right tabular-nums">
                            {r.avg_qty_per_event != null ? r.avg_qty_per_event.toFixed(2) : '—'}
                          </TD>
                          <TD className="text-right tabular-nums">
                            {r.avg_qty_per_100_pax != null
                              ? r.avg_qty_per_100_pax.toFixed(4)
                              : '—'}
                          </TD>
                          <TD>
                            <span className="inline-flex items-center gap-2">
                              <span
                                className="font-mono tracking-tight text-pr-olive"
                                aria-hidden
                              >
                                {confidenceGauge(score)}
                              </span>
                              <Badge tone={confTone}>
                                {Math.round(score * 100)} % · {confLabel}
                              </Badge>
                            </span>
                          </TD>
                          <TD>
                            {trend ? (
                              <Badge tone={trend.tone}>
                                {trend.arrow} {trend.label}
                              </Badge>
                            ) : (
                              <span className="text-pr-olive-dark">—</span>
                            )}
                          </TD>
                          <TD>
                            {r.rupture_count >= 2 ? (
                              <Badge tone="danger">🔴 Rupture ×{r.rupture_count}</Badge>
                            ) : r.surdotation_count >= 3 ? (
                              <Badge tone="warning">📦 Surdotation</Badge>
                            ) : (
                              <span className="text-pr-olive-dark">—</span>
                            )}
                          </TD>
                        </TR>
                        {isOpen && (
                          <tr>
                            <td colSpan={9} className="bg-pr-cream/40 p-0">
                              <ProductHistoryDetail
                                spaceId={r.space_id}
                                productId={r.product_id}
                                eventType={r.event_type}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </TBody>
              </Table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Table groupée par produit (détail espaces dépliable) ──────────────── */

function ProductGroupedTable({
  groups,
  expanded,
  onToggle,
}: {
  groups: ProductGroup[];
  expanded: string | null;
  onToggle: (productId: string) => void;
}) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>Produit</TH>
          <TH>Famille</TH>
          <TH className="text-right">Espaces</TH>
          <TH className="text-right">Historique</TH>
          <TH className="text-right">Conso moy.</TH>
          <TH className="text-right">Ratio/100 pax</TH>
          <TH>Confiance</TH>
          <TH>Tendance</TH>
          <TH>Alerte</TH>
          <TH />
        </TR>
      </THead>
      <TBody>
        {groups.map((g) => {
          const isOpen = expanded === g.productId;
          const { filled, label: confLabel } = confidenceBars(g.avgConfidence);
          const confTone = filled >= 4 ? 'success' : filled >= 2 ? 'info' : 'neutral';
          const trend = g.dominantTrend && g.dominantTrend in TREND_META
            ? TREND_META[g.dominantTrend as keyof typeof TREND_META]
            : null;
          return (
            <Fragment key={g.productId}>
              <TR className="cursor-pointer hover:bg-pr-cream/60" onClick={() => onToggle(g.productId)}>
                <TD className="font-medium text-pr-black">{g.productName}</TD>
                <TD className="text-pr-black-soft">{g.category}</TD>
                <TD className="text-right tabular-nums">
                  {g.nbEspaces} espace{g.nbEspaces > 1 ? 's' : ''}
                </TD>
                <TD className="text-right tabular-nums">{g.nbEvenements} évén.</TD>
                <TD className="text-right tabular-nums font-medium">{g.totalAvgConso.toFixed(1)}</TD>
                <TD className="text-right tabular-nums text-pr-black-soft">
                  {g.avgRatio100 != null ? g.avgRatio100.toFixed(4) : '—'}
                </TD>
                <TD>
                  <span className="inline-flex items-center gap-2">
                    <span className="font-mono tracking-tight text-pr-olive" aria-hidden>
                      {confidenceGauge(g.avgConfidence)}
                    </span>
                    <Badge tone={confTone}>
                      {Math.round(g.avgConfidence * 100)} % · {confLabel}
                    </Badge>
                  </span>
                </TD>
                <TD>
                  {trend ? (
                    <Badge tone={trend.tone}>
                      {trend.arrow} {trend.label}
                    </Badge>
                  ) : (
                    <span className="text-pr-olive-dark">—</span>
                  )}
                </TD>
                <TD>
                  {g.totalRuptures > 0 ? (
                    <Badge tone="danger">🔴 Rupture ×{g.totalRuptures}</Badge>
                  ) : (
                    <span className="text-pr-olive-dark">—</span>
                  )}
                </TD>
                <TD className="text-right text-pr-black-soft/40">{isOpen ? '▲' : '▼'}</TD>
              </TR>
              {isOpen &&
                g.spaceRows.map((r) => {
                  const rTrend = r.trend_direction ? TREND_META[r.trend_direction] : null;
                  return (
                    <TR key={`${g.productId}:${r.space_id}`} className="bg-pr-cream/40 text-sm">
                      <TD className="pl-8 text-pr-black-soft">↳ {r.space?.space_name ?? '—'}</TD>
                      <TD className="text-pr-black-soft/70">{r.space?.space_type ?? ''}</TD>
                      <TD />
                      <TD className="text-right tabular-nums text-pr-black-soft">{r.nb_events_analyzed} évén.</TD>
                      <TD className="text-right tabular-nums text-pr-black-soft">
                        {r.avg_qty_per_event != null ? r.avg_qty_per_event.toFixed(1) : '—'}
                      </TD>
                      <TD className="text-right tabular-nums text-pr-black-soft">
                        {r.avg_qty_per_100_pax != null ? r.avg_qty_per_100_pax.toFixed(4) : '—'}
                      </TD>
                      <TD className="text-pr-black-soft">{Math.round((r.confidence_score ?? 0) * 100)} %</TD>
                      <TD>
                        {rTrend ? (
                          <span className="text-xs text-pr-black-soft">
                            {rTrend.arrow} {rTrend.label}
                          </span>
                        ) : (
                          <span className="text-pr-olive-dark">—</span>
                        )}
                      </TD>
                      <TD>
                        {r.rupture_count > 0 ? (
                          <span className="text-xs text-pr-rust">×{r.rupture_count}</span>
                        ) : (
                          <span className="text-pr-olive-dark">—</span>
                        )}
                      </TD>
                      <TD />
                    </TR>
                  );
                })}
            </Fragment>
          );
        })}
      </TBody>
    </Table>
  );
}
