/**
 * Tableau « Stocks & Dotations » (admin, ROLE_STADE).
 * Affiche prix et coûts (RG-003 ne s'applique qu'au Responsable).
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useStock } from '@/hooks/useStock';
import { computeConsumed, computeCost, formatEuro } from '@/lib/calculations';
import { PRODUCT_STATE_META } from '@/lib/labels';
import { RunnerStatusBadge } from '@/components/stock/RunnerStatusBadge';
import { MovementHistory } from '@/components/stock/MovementHistory';
import {
  Alert,
  Badge,
  Spinner,
  Table,
  TBody,
  TD,
  TFoot,
  TH,
  THead,
  TR,
} from '@/components/ui';
import type { RunnerStatus, StockContinuityRow } from '@/lib/types';

interface Row {
  product_id: string;
  product_name: string;
  category: string;
  unit: string;
  unit_price_ht: number | null;
  dotation_id: string | null;
  planned_qty: number | null;
  runner_status: RunnerStatus | null;
  initial_qty: number | null;
  reassort_qty: number | null;
  final_qty: number | null;
  product_state: keyof typeof PRODUCT_STATE_META | null;
  responsable_nom: string | null;
  consumed: number | null;
  cost: number | null;
}

export function StockDotationsTable({
  eventId,
  spaceId,
}: {
  eventId: string;
  spaceId: string;
}) {
  const stock = useStock(eventId, spaceId, { withPrices: true });

  // Continuité des stocks vs match précédent (résilient si la vue n'existe pas).
  const continuity = useQuery({
    queryKey: ['continuity', eventId, spaceId],
    queryFn: async (): Promise<StockContinuityRow[]> => {
      const { data, error } = await supabase
        .from('stock_continuity_check')
        .select('*')
        .eq('event_id', eventId)
        .eq('space_id', spaceId);
      if (error) return [];
      return (data ?? []) as StockContinuityRow[];
    },
  });
  const gaps = (continuity.data ?? []).filter(
    (r) =>
      r.continuity_status === 'ecart_positif_a_justifier' ||
      r.continuity_status === 'ecart_negatif_a_justifier',
  );

  const rows = useMemo<Row[]>(() => {
    const dotations = stock.dotations.data ?? [];
    const lines = stock.stockLines.data ?? [];
    const ids = new Set<string>([
      ...dotations.map((d) => d.product_id),
      ...lines.map((l) => l.product_id),
    ]);

    return Array.from(ids).map((pid) => {
      const product = stock.productMap.get(pid);
      const dotation = dotations.find((d) => d.product_id === pid) ?? null;
      const line = lines.find((l) => l.product_id === pid) ?? null;
      const consumed =
        line && line.final_qty !== null
          ? computeConsumed(line.initial_qty, line.reassort_qty, line.final_qty)
          : null;
      const cost =
        consumed !== null ? computeCost(consumed, product?.unit_price_ht ?? null) : null;
      return {
        product_id: pid,
        product_name: product?.product_name ?? pid,
        category: product?.category ?? '—',
        unit: product?.unit ?? '',
        unit_price_ht: product?.unit_price_ht ?? null,
        dotation_id: dotation?.dotation_id ?? null,
        planned_qty: dotation?.planned_qty ?? null,
        runner_status: dotation?.runner_status ?? null,
        initial_qty: line?.initial_qty ?? null,
        reassort_qty: line?.reassort_qty ?? null,
        final_qty: line?.final_qty ?? null,
        product_state: line?.product_state ?? null,
        responsable_nom: line?.responsable_nom ?? null,
        consumed,
        cost,
      };
    }).sort((a, b) => a.product_name.localeCompare(b.product_name, 'fr'));
  }, [stock.dotations.data, stock.stockLines.data, stock.productMap]);

  const negatives = rows.filter((r) => r.consumed !== null && r.consumed < 0);
  const missingPrice = rows.filter((r) => r.unit_price_ht === null);
  const totalCost = rows.reduce((s, r) => s + (r.cost ?? 0), 0);
  const hasMissingCost = rows.some((r) => r.consumed !== null && r.unit_price_ht === null);

  if (stock.loading) return <Spinner fullPage label="Chargement…" />;

  if (rows.length === 0) {
    return (
      <Alert variant="info">
        Aucune dotation ni saisie de stock pour cet espace.
      </Alert>
    );
  }

  function handleAdvance(dotationId: string, next: RunnerStatus) {
    void stock.advanceRunnerStatus(dotationId, next);
  }

  return (
    <div className="space-y-3">
      {/* Alertes groupées */}
      {negatives.length > 0 && (
        <Alert variant="error" title={`${negatives.length} consommation(s) négative(s) — RG-004`}>
          {negatives.map((r) => r.product_name).join(', ')}
        </Alert>
      )}
      {missingPrice.length > 0 && (
        <Alert variant="warning" title={`${missingPrice.length} produit(s) sans prix HT — RG-005`}>
          Les coûts associés sont affichés « — » et exclus du total.
        </Alert>
      )}
      {gaps.length > 0 && (
        <Alert variant="warning" title={`${gaps.length} écart(s) de continuité de stock`}>
          {gaps
            .map(
              (g) =>
                `${g.product_name} : initial déclaré ${g.current_initial_qty} ≠ final précédent ${g.previous_final_qty ?? 0} (écart ${g.stock_gap > 0 ? '+' : ''}${g.stock_gap})`,
            )
            .join(' · ')}{' '}
          — vérifier un réassort non documenté ou une erreur de saisie.
        </Alert>
      )}

      <Table>
        <THead>
          <TR>
            <TH>Produit</TH>
            <TH>Cat.</TH>
            <TH className="text-right">Dotation</TH>
            <TH>Runner</TH>
            <TH className="text-right">Initial</TH>
            <TH className="text-right">Réassort</TH>
            <TH className="text-right">Final</TH>
            <TH>État</TH>
            <TH className="text-right">Conso.</TH>
            <TH className="text-right">Prix U HT</TH>
            <TH className="text-right">Coût HT</TH>
            <TH>Responsable</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.product_id}>
              <TD className="font-medium text-slate-900">{r.product_name}</TD>
              <TD>{r.category}</TD>
              <TD className="text-right">{r.planned_qty ?? '—'}</TD>
              <TD>
                {r.runner_status && r.dotation_id ? (
                  <RunnerStatusBadge
                    status={r.runner_status}
                    disabled={stock.submitting}
                    onAdvance={(next) => handleAdvance(r.dotation_id!, next)}
                  />
                ) : (
                  '—'
                )}
              </TD>
              <TD className="text-right">{r.initial_qty ?? '—'}</TD>
              <TD className="text-right">{r.reassort_qty ?? '—'}</TD>
              <TD className="text-right">{r.final_qty ?? '—'}</TD>
              <TD>
                {r.product_state ? (
                  <Badge tone={PRODUCT_STATE_META[r.product_state].tone}>
                    {PRODUCT_STATE_META[r.product_state].label}
                  </Badge>
                ) : (
                  '—'
                )}
              </TD>
              <TD className="text-right">
                {r.consumed === null ? (
                  '—'
                ) : r.consumed < 0 ? (
                  <Badge tone="danger">{r.consumed}</Badge>
                ) : (
                  r.consumed
                )}
              </TD>
              <TD className="text-right">
                {r.unit_price_ht === null ? (
                  <Badge tone="warning">Prix manquant</Badge>
                ) : (
                  formatEuro(r.unit_price_ht)
                )}
              </TD>
              <TD className="text-right">{formatEuro(r.cost)}</TD>
              <TD>{r.responsable_nom ?? '—'}</TD>
            </TR>
          ))}
        </TBody>
        <TFoot>
          <TR>
            <TD className="font-semibold">Total coût HT</TD>
            <TD /><TD /><TD /><TD /><TD /><TD /><TD /><TD /><TD />
            <TD className="text-right font-semibold">
              {hasMissingCost ? `${formatEuro(totalCost)} *` : formatEuro(totalCost)}
            </TD>
            <TD />
          </TR>
        </TFoot>
      </Table>
      {hasMissingCost && (
        <p className="text-xs text-slate-500">
          * Total partiel : des produits consommés n'ont pas de prix HT (RG-005).
        </p>
      )}

      <div className="pt-4">
        <MovementHistory
          eventId={eventId}
          spaceId={spaceId}
          productMap={stock.productMap}
        />
      </div>
    </div>
  );
}
