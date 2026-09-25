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
  Card,
  Spinner,
  StatTile,
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

  // ── L'essentiel (Jour J : chiffre / conso / coûts / stocks finaux) ──────
  const totalConsumed = rows.reduce((s, r) => s + Math.max(r.consumed ?? 0, 0), 0);
  const closedCount = rows.filter((r) => r.final_qty !== null).length;
  const allClosed = closedCount === rows.length;
  const toCheck = negatives.length + gaps.length;

  // Colonnes de préparation (dotation / runner) : masquées si vides — sur le
  // Jour J la clôture ne porte que sur initial → réassort → final → conso.
  const showDotation = rows.some((r) => r.planned_qty != null && r.planned_qty > 0);
  const showRunner = rows.some((r) => r.runner_status != null && r.dotation_id != null);

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

  // Placeholder discret pour les cellules vides (recule visuellement).
  const dash = <span className="text-pr-black-soft/25">—</span>;
  // Nb de colonnes rendues (pour l'alignement du pied « Total »).
  const midCols = 3 + (showDotation ? 1 : 0) + (showRunner ? 1 : 0); // Initial, Réassort, Final (+ prep)

  return (
    <div className="space-y-4">
      {/* ── L'ESSENTIEL — chiffre / conso / coûts / stocks finaux ───────── */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatTile
          label="Coût F&B HT"
          value={hasMissingCost ? `${formatEuro(totalCost)} *` : formatEuro(totalCost)}
          sub={hasMissingCost ? 'partiel — prix manquants' : 'consommation réelle'}
          tone={hasMissingCost ? 'warn' : 'default'}
        />
        <StatTile
          label="Conso totale"
          value={totalConsumed}
          sub="toutes unités confondues"
        />
        <StatTile
          label="Stock final"
          value={`${closedCount} / ${rows.length}`}
          sub={allClosed ? 'tous saisis ✓' : 'produits clôturés'}
          tone={allClosed ? 'good' : 'warn'}
        />
        <StatTile
          label="À vérifier"
          value={toCheck}
          sub={toCheck === 0 ? 'rien à signaler ✓' : 'conso < 0 · écarts'}
          tone={toCheck === 0 ? 'good' : 'crit'}
        />
      </div>

      {/* ── Points de contrôle (regroupés, scannables) ──────────────────── */}
      {negatives.length > 0 && (
        <Alert variant="error" title={`${negatives.length} consommation(s) négative(s) — RG-004`}>
          {negatives.map((r) => r.product_name).join(', ')} — final supérieur aux entrées :
          corriger la saisie ou justifier par un commentaire d'anomalie.
        </Alert>
      )}
      {gaps.length > 0 && (
        <Alert variant="warning" title={`${gaps.length} écart(s) de continuité avec l'événement précédent`}>
          <ul className="mt-1 space-y-1">
            {gaps.map((g) => (
              <li key={g.product_name} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-semibold text-pr-black">{g.product_name}</span>
                <span className="tabular-nums text-pr-black-soft/70">
                  final précédent {g.previous_final_qty ?? 0} → initial déclaré {g.current_initial_qty}
                </span>
                <Badge tone={g.stock_gap > 0 ? 'warning' : 'danger'}>
                  écart {g.stock_gap > 0 ? '+' : ''}{g.stock_gap}
                </Badge>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-pr-black-soft/60">
            Vérifier un réassort non documenté ou une erreur de saisie.
          </p>
        </Alert>
      )}
      {missingPrice.length > 0 && (
        <Alert variant="warning" title={`${missingPrice.length} produit(s) sans prix HT — RG-005`}>
          Les coûts associés sont affichés « — » et exclus du total (opérationnel non bloqué).
        </Alert>
      )}

      {/* ── Tableau de clôture : Initial → Réassort → Final → Conso → Coût ── */}
      <Card pad="none" className="overflow-hidden">
        <Table>
          <THead>
            <TR>
              <TH>Produit</TH>
              {showDotation && <TH className="text-right">Dotation</TH>}
              {showRunner && <TH>Runner</TH>}
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
                <TD>
                  <span className="font-medium text-pr-black">{r.product_name}</span>
                  <span className="ml-2 text-xs text-pr-black-soft/40">{r.category}</span>
                </TD>
                {showDotation && (
                  <TD className="text-right tabular-nums">{r.planned_qty ?? dash}</TD>
                )}
                {showRunner && (
                  <TD>
                    {r.runner_status && r.dotation_id ? (
                      <RunnerStatusBadge
                        status={r.runner_status}
                        disabled={stock.submitting}
                        onAdvance={(next) => handleAdvance(r.dotation_id!, next)}
                      />
                    ) : (
                      dash
                    )}
                  </TD>
                )}
                <TD className="text-right tabular-nums text-pr-black-soft/70">{r.initial_qty ?? dash}</TD>
                <TD className="text-right tabular-nums text-pr-black-soft/70">{r.reassort_qty ?? dash}</TD>
                <TD className="text-right font-semibold tabular-nums text-pr-black">{r.final_qty ?? dash}</TD>
                <TD>
                  {r.product_state ? (
                    <Badge tone={PRODUCT_STATE_META[r.product_state].tone}>
                      {PRODUCT_STATE_META[r.product_state].label}
                    </Badge>
                  ) : (
                    dash
                  )}
                </TD>
                <TD className="text-right tabular-nums">
                  {r.consumed === null ? (
                    dash
                  ) : r.consumed < 0 ? (
                    <Badge tone="danger">{r.consumed}</Badge>
                  ) : (
                    <span className="font-semibold text-pr-black">{r.consumed}</span>
                  )}
                </TD>
                <TD className="text-right tabular-nums text-pr-black-soft/70">
                  {r.unit_price_ht === null ? (
                    <Badge tone="warning">Prix manquant</Badge>
                  ) : (
                    formatEuro(r.unit_price_ht)
                  )}
                </TD>
                <TD className="text-right font-semibold tabular-nums text-pr-black">
                  {r.cost === null ? dash : formatEuro(r.cost)}
                </TD>
                <TD>
                  {r.responsable_nom ? (
                    <span className="text-xs font-medium uppercase tracking-wide text-pr-black-soft/60">{r.responsable_nom}</span>
                  ) : (
                    dash
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
          <TFoot>
            <TR>
              <TD className="font-semibold text-pr-black">Total coût HT</TD>
              {Array.from({ length: midCols + 3 }).map((_, i) => <TD key={i} />)}
              <TD className="text-right font-display text-base font-black tabular-nums text-pr-black">
                {hasMissingCost ? `${formatEuro(totalCost)} *` : formatEuro(totalCost)}
              </TD>
              <TD />
            </TR>
          </TFoot>
        </Table>
      </Card>
      {hasMissingCost && (
        <p className="text-xs text-pr-black-soft/50">
          * Total partiel : des produits consommés n'ont pas de prix HT (RG-005).
        </p>
      )}

      {/* ── Historique des mouvements — replié par défaut (secondaire) ───── */}
      <MovementHistory
        eventId={eventId}
        spaceId={spaceId}
        productMap={stock.productMap}
        collapsible
      />
    </div>
  );
}
