import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  PackageX,
  TrendingUp,
} from 'lucide-react';

import { Badge } from '@/components/ui';
import { Spinner } from '@/components/ui';
import { EmptyState } from '@/components/ui';
import { formatEuro } from '@/lib/calculations';
import { isStockCritical } from '@/lib/stockCalculations';
import { supabase } from '@/lib/supabase';
import {
  useStockBalances,
  useReserveLocation,
  useUnresolvedVarianceCount,
} from '@/hooks/useStockV2';
import { useStockAlerts } from '@/hooks/useStockAlerts';
import { useCatalog } from '@/hooks/useCatalog';
import type { StockAlert, StockBalanceView } from '@/lib/types';

/** Familles de produits affichées dans la répartition. */
const CATEGORIES = ['Vins', 'Bières', 'Soft', 'Sirops', 'Spiritueux', 'Matériel'] as const;

/** Carte KPI compacte du bandeau supérieur. */
function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-pr-stone border-t-[3px] border-t-pr-black bg-white p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-pr-olive-dark">
        {label}
      </p>
      <p className="mt-1 font-display text-3xl font-black text-pr-black">{value}</p>
    </div>
  );
}

/** Point coloré indiquant la sévérité d'une alerte. */
function SeverityDot({ severity }: { severity: StockAlert['severity'] }) {
  const color =
    severity === 'error'
      ? 'bg-pr-rust'
      : severity === 'warning'
        ? 'bg-amber-500'
        : 'bg-pr-gold';
  return <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${color}`} aria-hidden />;
}

/** Titre de section homogène. */
function SectionHeading({ children }: { children: string }) {
  return (
    <h2 className="text-sm font-semibold uppercase tracking-wide text-pr-black-soft/60">
      {children}
    </h2>
  );
}

/** Onglet « Vue générale » du module Stock. */
export default function StockDashboard() {
  const [alertsOpen, setAlertsOpen] = useState(true);

  const balances = useStockBalances();
  const reserve = useReserveLocation();
  const reserveBalances = useStockBalances(reserve?.id);
  const variance = useUnresolvedVarianceCount();
  const alerts = useStockAlerts();
  const { products } = useCatalog();

  const allBalances: StockBalanceView[] = useMemo(
    () => balances.data ?? [],
    [balances.data],
  );

  // KPI 1 — valorisation totale de tout le stock.
  const totalValue = useMemo(
    () =>
      allBalances.reduce(
        (sum, b) => sum + b.current_quantity * (b.unit_value_ht ?? 0),
        0,
      ),
    [allBalances],
  );

  // KPI 2 — produits actifs sous leur seuil en réserve centrale.
  const criticalStats = useMemo(() => {
    const activeProducts = (products.data ?? []).filter((p) => p.active);
    const reserveQty = new Map<string, number>();
    for (const b of reserveBalances.data ?? []) {
      reserveQty.set(b.product_id, (reserveQty.get(b.product_id) ?? 0) + b.current_quantity);
    }
    const critical = activeProducts.filter((p) => {
      const qty = reserveQty.get(p.product_id) ?? 0;
      const threshold = p.min_stock ?? p.stock_min;
      return isStockCritical(qty, threshold);
    }).length;
    return { critical, total: activeProducts.length };
  }, [products.data, reserveBalances.data]);

  // KPI 3 — nombre d'alertes de dormance.
  const dormantCount = useMemo(
    () => (alerts.data ?? []).filter((a) => a.type === 'dormant').length,
    [alerts.data],
  );

  const openVariance = variance.data ?? 0;

  // Répartition du stock par famille (quantités cumulées).
  const familyBreakdown = useMemo(() => {
    const totals = new Map<string, number>();
    for (const b of allBalances) {
      const cat = b.product?.category;
      if (!cat) continue;
      totals.set(cat, (totals.get(cat) ?? 0) + b.current_quantity);
    }
    const rows = CATEGORIES.map((c) => ({ category: c, total: totals.get(c) ?? 0 }));
    const max = Math.max(1, ...rows.map((r) => r.total));
    return { rows, max };
  }, [allBalances]);

  // Top 5 consommations sur 30 jours (requête directe Supabase).
  const top5 = useQuery({
    queryKey: ['stockTop5Consumption'],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data, error } = await supabase
        .from('stock_movements')
        .select('product_id, qty')
        .eq('movement_type', 'consommation')
        .gte('created_at', since);
      if (error) throw error;
      const byProduct = new Map<string, number>();
      for (const row of (data ?? []) as { product_id: string; qty: number }[]) {
        byProduct.set(row.product_id, (byProduct.get(row.product_id) ?? 0) + row.qty);
      }
      return [...byProduct.entries()]
        .map(([product_id, total]) => ({ product_id, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);
    },
  });

  const productNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of products.data ?? []) map.set(p.product_id, p.product_name);
    return map;
  }, [products.data]);

  if (balances.isLoading) {
    return <Spinner fullPage label="Chargement…" />;
  }

  return (
    <div className="space-y-8">
      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Stock total valorisé" value={formatEuro(totalValue)} />
        <KpiCard
          label="Produits critiques"
          value={`${criticalStats.critical}/${criticalStats.total}`}
        />
        <KpiCard label="Produits dormants" value={String(dormantCount)} />
        <KpiCard label="Écarts ouverts" value={String(openVariance)} />
      </div>

      {/* Alertes actives */}
      <section className="space-y-3">
        <button
          type="button"
          onClick={() => setAlertsOpen((o) => !o)}
          className="flex items-center gap-2"
        >
          {alertsOpen ? (
            <ChevronDown className="h-4 w-4 text-pr-black-soft/60" aria-hidden />
          ) : (
            <ChevronRight className="h-4 w-4 text-pr-black-soft/60" aria-hidden />
          )}
          <SectionHeading>Alertes actives</SectionHeading>
          {(alerts.data ?? []).length > 0 && (
            <Badge tone="warning">{(alerts.data ?? []).length}</Badge>
          )}
        </button>

        {alertsOpen &&
          (alerts.isLoading ? (
            <p className="text-sm text-pr-black-soft/60">Chargement des alertes…</p>
          ) : (alerts.data ?? []).length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="Aucune alerte"
              message="Tous les stocks sont dans les seuils attendus."
            />
          ) : (
            <ul className="space-y-2">
              {(alerts.data ?? []).map((alert, i) => (
                <li
                  key={`${alert.type}-${i}`}
                  className="flex items-start gap-3 rounded-lg border border-pr-stone bg-white p-3"
                >
                  <SeverityDot severity={alert.severity} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-pr-black">{alert.message}</p>
                    {alert.action && (
                      <p className="mt-1 text-xs text-pr-olive-dark">{alert.action}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ))}
      </section>

      {/* Top 5 consommations */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-pr-black-soft/60" aria-hidden />
          <SectionHeading>Top 5 consommations (30 derniers jours)</SectionHeading>
        </div>
        {top5.isLoading ? (
          <p className="text-sm text-pr-black-soft/60">Chargement…</p>
        ) : (top5.data ?? []).length === 0 ? (
          <p className="text-sm text-pr-black-soft/50">
            Aucune consommation enregistrée sur 30 jours.
          </p>
        ) : (
          <ul className="divide-y divide-pr-stone rounded-lg border border-pr-stone bg-white">
            {(top5.data ?? []).map((row) => (
              <li
                key={row.product_id}
                className="flex items-center justify-between px-4 py-2.5 text-sm"
              >
                <span className="text-pr-black">
                  {productNames.get(row.product_id) ?? row.product_id}
                </span>
                <span className="font-semibold text-pr-black-soft">
                  {row.total} unités
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Répartition par famille */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <PackageX className="h-4 w-4 text-pr-black-soft/60" aria-hidden />
          <SectionHeading>Répartition du stock par famille</SectionHeading>
        </div>
        {familyBreakdown.rows.every((r) => r.total === 0) ? (
          <EmptyState
            icon={AlertTriangle}
            title="Aucun stock"
            message="Aucune quantité en stock à répartir pour le moment."
          />
        ) : (
          <div className="space-y-3 rounded-lg border border-pr-stone bg-white p-4">
            {familyBreakdown.rows.map((row) => (
              <div key={row.category}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium text-pr-black">{row.category}</span>
                  <span className="text-pr-black-soft/70">{row.total}</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-pr-stone/50">
                  <div
                    className="h-full rounded-full bg-pr-olive"
                    style={{ width: `${(row.total / familyBreakdown.max) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
