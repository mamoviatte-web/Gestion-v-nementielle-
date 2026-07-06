/**
 * MatchConsumptionReport — rapport de consommation d'un match séparé
 * Grand Public (buvettes B1-B9) vs VIP & Bars. Deux KPIs + deux tableaux
 * (le Grand Public est regroupé par produit toutes buvettes confondues).
 */

import { useMemo } from 'react';
import { Alert, Badge, EmptyState, Spinner, Table, TBody, TD, TH, THead, TR } from '@/components/ui';
import { formatEuro } from '@/lib/calculations';
import { useMatchConsumptionReport, type MatchConsumptionLine } from '@/hooks/useMatchConsumptionReport';
import { Beer, Star, TrendingUp } from 'lucide-react';

function num(v: number | null, digits = 1): string {
  return v == null ? '—' : v.toFixed(digits);
}

export function MatchConsumptionReport({ eventId }: { eventId: string }) {
  const { data, isLoading } = useMatchConsumptionReport(eventId);

  const vip = useMemo(() => (data?.lines ?? []).filter((l) => l.consumption_category !== 'Grand Public'), [data]);
  const gp = useMemo(() => (data?.lines ?? []).filter((l) => l.consumption_category === 'Grand Public'), [data]);

  // Grand Public : regroupé par produit (toutes buvettes).
  const gpByProduct = useMemo(() => {
    const map = new Map<string, { name: string; category: string; unit: string; consumed: number; cost: number; hasCost: boolean }>();
    for (const l of gp) {
      const e = map.get(l.product_id) ?? { name: l.product_name, category: l.category, unit: l.unit, consumed: 0, cost: 0, hasCost: false };
      e.consumed += l.consumed_qty;
      if (l.cost_ht != null) {
        e.cost += l.cost_ht;
        e.hasCost = true;
      }
      map.set(l.product_id, e);
    }
    return [...map.values()].sort((a, b) => a.category.localeCompare(b.category, 'fr') || a.name.localeCompare(b.name, 'fr'));
  }, [gp]);

  const totalVipCost = vip.reduce((s, l) => s + (l.cost_ht ?? 0), 0);
  const totalGpCost = gp.reduce((s, l) => s + (l.cost_ht ?? 0), 0);
  const vipClosed = vip.filter((l) => l.final_qty !== null).length;

  if (isLoading) return <Spinner label="Chargement du rapport…" />;

  if (data && !data.provisioned) {
    return (
      <Alert variant="warning" title="Vue non provisionnée">
        Applique <code>supabase/buvettes_capacites.sql</code> pour activer le rapport
        (vue <code>match_consumption_report</code> + colonnes capacités).
      </Alert>
    );
  }

  if (vip.length === 0 && gp.length === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="Aucune ligne de consommation"
        message="Les données apparaîtront après saisie des stocks initiaux/finaux par espace."
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* KPIs séparés */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-l-4 border-pr-stone border-l-pr-gold bg-white p-4">
          <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-pr-black-soft/50">
            <Star className="h-3.5 w-3.5" /> VIP &amp; Bars
          </p>
          <p className="mt-1 font-display text-2xl font-black text-pr-black">{formatEuro(totalVipCost)}</p>
          <p className="mt-1 text-xs text-pr-black-soft/50">{vipClosed} ligne(s) clôturée(s)</p>
        </div>
        <div className="rounded-xl border border-l-4 border-pr-stone border-l-amber-500 bg-white p-4">
          <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-pr-black-soft/50">
            <Beer className="h-3.5 w-3.5" /> Grand Public
          </p>
          <p className="mt-1 font-display text-2xl font-black text-pr-black">{formatEuro(totalGpCost)}</p>
          <p className="mt-1 text-xs text-pr-black-soft/50">Buvettes B1–B9</p>
        </div>
      </div>

      {/* Tableau VIP & Bars */}
      <section className="space-y-2">
        <h3 className="flex items-center gap-2 font-display text-base font-semibold text-pr-black">
          <Star className="h-4 w-4 text-pr-gold" /> VIP &amp; Bars
        </h3>
        {vip.length === 0 ? (
          <p className="text-sm text-pr-black-soft">Aucun espace VIP/Bar activé sur ce match.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg ring-1 ring-pr-stone/40">
            <Table>
              <THead>
                <TR>
                  <TH>Espace</TH>
                  <TH>Produit</TH>
                  <TH>Famille</TH>
                  <TH className="text-right">Pax</TH>
                  <TH className="text-right">Conso</TH>
                  <TH className="text-right">Ratio/100</TH>
                  <TH className="text-right">Coût HT</TH>
                </TR>
              </THead>
              <TBody>
                {vip.map((l) => (
                  <TR key={`${l.space_id}:${l.product_id}`}>
                    <TD className="font-medium text-pr-black">
                      {l.space_name}
                      <Badge tone={l.service_type === 'vip' ? 'warning' : 'neutral'} className="ml-2">
                        {l.service_type === 'vip' ? 'VIP' : 'Bar'}
                      </Badge>
                    </TD>
                    <TD>{l.product_name}</TD>
                    <TD className="text-pr-black-soft">{l.category}</TD>
                    <TD className="text-right tabular-nums">{l.expected_pax ?? l.max_pax ?? '—'}</TD>
                    <TD className="text-right tabular-nums font-medium">{l.final_qty === null ? '—' : l.consumed_qty}</TD>
                    <TD className="text-right tabular-nums text-pr-black-soft">{num(l.qty_per_100pax, 2)}</TD>
                    <TD className="text-right tabular-nums">{l.cost_ht == null ? '—' : formatEuro(l.cost_ht)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </section>

      {/* Tableau Grand Public — groupé par produit */}
      <section className="space-y-2">
        <h3 className="flex items-center gap-2 font-display text-base font-semibold text-pr-black">
          <Beer className="h-4 w-4 text-amber-500" /> Grand Public — Buvettes
        </h3>
        {gpByProduct.length === 0 ? (
          <p className="text-sm text-pr-black-soft">Aucune consommation buvette saisie.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg ring-1 ring-pr-stone/40">
            <Table>
              <THead>
                <TR>
                  <TH>Produit</TH>
                  <TH>Famille</TH>
                  <TH className="text-right">Conso totale</TH>
                  <TH className="text-right">Coût HT</TH>
                </TR>
              </THead>
              <TBody>
                {gpByProduct.map((p) => (
                  <TR key={p.name}>
                    <TD className="font-medium text-pr-black">{p.name}</TD>
                    <TD className="text-pr-black-soft">{p.category}</TD>
                    <TD className="text-right tabular-nums font-medium">
                      {p.consumed} {p.unit}
                    </TD>
                    <TD className="text-right tabular-nums">{p.hasCost ? formatEuro(p.cost) : '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}

/** Ré-export pour signature homogène avec les autres onglets. */
export type { MatchConsumptionLine };
