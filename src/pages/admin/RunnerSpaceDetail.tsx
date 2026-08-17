/**
 * RunnerSpaceDetail (ROLE_STADE) — validation des dotations runner d'un espace.
 * Route : /admin/events/:id/runner/:spaceId
 */

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Send, ArrowLeftRight } from 'lucide-react';
import { clsx } from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useRunnerPlanning } from '@/hooks/useRunnerPlanning';
import { useLiveBalanceMap } from '@/hooks/useDepots';
import {
  getRunnerRowColor,
  RUNNER_ROW_CLASSES,
  RUNNER_STATUS_LABELS,
} from '@/lib/runnerCalculations';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  Alert,
  Badge,
  Button,
  Input,
  Spinner,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui';
import { getRecommendation } from '@/lib/runnerFallbackRatios';

export default function RunnerSpaceDetail() {
  const { id, spaceId } = useParams<{ id: string; spaceId: string }>();
  const { plans, validateLine, validateSpace, transmitToRunners, submitting } =
    useRunnerPlanning(id);
  const { map: liveBalance } = useLiveBalanceMap();
  const [edits, setEdits] = useState<Record<string, { qty: string; comment: string }>>({});

  // CDC V5 #4 — état du TRANSFERT (dépôt → espace) déjà enregistré pour cet espace.
  const transfersQuery = useQuery({
    queryKey: ['runnerTransfers', id, spaceId],
    enabled: !!id && !!spaceId,
    queryFn: async (): Promise<{ product_id: string; qty: number }[]> => {
      const { data } = await supabase
        .from('stock_movements')
        .select('product_id, qty')
        .eq('event_id', id)
        .eq('space_id', spaceId)
        .eq('movement_type', 'transfert_espace');
      return (data as { product_id: string; qty: number }[] | null) ?? [];
    },
  });

  if (plans.isLoading) return <Spinner fullPage label="Chargement…" />;

  const rows = (plans.data ?? []).filter((p) => p.space_id === spaceId);
  const spaceName = rows[0]?.space?.space_name ?? 'Espace';
  const status = rows[0]?.validation_status ?? 'brouillon';

  /** Quantité qui sera dispatchée (validée sinon reco / à-monter). */
  const dispatchQty = (p: {
    validated_quantity: number | null;
    recommended_quantity: number | null;
    quantity_to_move: number | null;
  }): number => p.validated_quantity ?? p.quantity_to_move ?? p.recommended_quantity ?? 0;

  // CDC V5 #2 — BODEGA_WINE_REQUIRED : la Bodega doit contenir une gamme vin
  // (rouge/blanc/rosé ; le champagne Mumm ne compte pas). Bloque la validation.
  const space0 = rows[0]?.space;
  const isBodega =
    space0?.space_name === 'Bodega' || (space0?.service_type as string | undefined) === 'bodega';
  const isStillWine = (p: (typeof rows)[number]): boolean =>
    p.product?.category === 'Vins' && !/^Mumm/i.test(p.product?.product_name ?? '');
  const bodegaWineMissing =
    isBodega && rows.length > 0 && !rows.some((p) => isStillWine(p) && dispatchQty(p) > 0);

  // Pré-dispatch : produits dont la quantité dépasse le stock dépôt disponible.
  const warnings = rows.filter((p) => {
    const depot = liveBalance.get(p.product_id)?.qty_total_depot ?? 0;
    return dispatchQty(p) > depot;
  });

  function editVal(p: { id: string; recommended_quantity: number | null; validated_quantity: number | null }) {
    return (
      edits[p.id]?.qty ??
      String(p.validated_quantity ?? p.recommended_quantity ?? 0)
    );
  }

  return (
    <div>
      <Link
        to={`/admin/events/${id}`}
        className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" /> Retour à l'événement
      </Link>

      <PageHeader
        title={`Runner — ${spaceName}`}
        description={`${rows.length} produit(s)`}
        action={<Badge tone="info">{RUNNER_STATUS_LABELS[status]}</Badge>}
      />

      {/* CDC V5 #4 — modèle TRANSFERT (L5/L6) : la fiche n'est pas une conso */}
      {(() => {
        const transfers = transfersQuery.data ?? [];
        const qty = transfers.reduce((s, t) => s + (Number(t.qty) || 0), 0);
        return (
          <Alert variant="info" className="mb-4">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <ArrowLeftRight className="h-4 w-4" /> Fiche = transfert
            </span>{' '}
            — « Transmettre » déduit le stock du <b>dépôt central</b> et l'affecte à l'espace (mouvement
            <em> transfert</em>), <b>sans consommation</b>. La consommation réelle se calcule à la clôture :
            initial + réassort − final.
            {transfers.length > 0 && (
              <> {' '}· <b>{transfers.length} produit(s) déjà transféré(s)</b> ({qty} u.).</>
            )}
          </Alert>
        );
      })()}

      {/* Barre de synthèse opérationnelle */}
      {rows.length > 0 &&
        (() => {
          const expectedPax = rows[0]?.space?.max_pax ?? null;
          const effReco = (p: (typeof rows)[number]): number => {
            if ((p.recommended_quantity ?? 0) > 0) return p.recommended_quantity as number;
            const c =
              p.attendance_coefficient * p.weather_coefficient * p.event_type_coefficient * p.trend_coefficient;
            return getRecommendation(p.product?.product_name ?? '', p.historical_avg_consumption ?? null, c, 1).qty;
          };
          const nbWithReco = rows.filter((p) => effReco(p) > 0).length;
          const totalToMove = rows.reduce(
            (s, p) => s + Math.max(0, effReco(p) - (p.initial_area_stock ?? 0)),
            0,
          );
          const depotIssue = warnings.length > 0;
          return (
            <div
              className={clsx(
                'mb-4 grid grid-cols-2 gap-4 rounded-xl border p-4 text-center sm:grid-cols-4',
                depotIssue ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50',
              )}
            >
              <div>
                <p className="font-display text-2xl font-black text-slate-800">{expectedPax ?? '—'}</p>
                <p className="text-xs text-slate-500">Pax attendus</p>
              </div>
              <div>
                <p className="font-display text-2xl font-black text-slate-800">{nbWithReco}</p>
                <p className="text-xs text-slate-500">Produits recommandés</p>
              </div>
              <div>
                <p className="font-display text-2xl font-black text-slate-900">{totalToMove}</p>
                <p className="text-xs text-slate-500">Unités à monter</p>
              </div>
              <div className="flex flex-col justify-center">
                <p className={clsx('text-sm font-medium', depotIssue ? 'text-red-600' : 'text-emerald-700')}>
                  {depotIssue ? '⚠️ Stocks dépôt insuffisants' : '✅ Stock dépôt suffisant'}
                </p>
                <p className="text-xs text-slate-400">La transmission déduira les dépôts automatiquement</p>
              </div>
            </div>
          );
        })()}

      {/* Contexte nouvelle saison : espaces à 0 → À monter = Recommandé */}
      {rows.length > 0 && rows.every((p) => (p.initial_area_stock ?? 0) === 0) && (
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
          📋 Base : saison précédente · Espaces à 0 — « À monter » = Recommandé
        </div>
      )}

      {/* Encadré pré-dispatch : contrôle stock dépôt avant transmission */}
      {rows.length > 0 && (
        <div
          className={clsx(
            'mb-4 rounded-xl border p-4',
            warnings.length > 0 ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50',
          )}
        >
          <h4 className="mb-1 text-sm font-medium text-slate-800">
            {warnings.length > 0
              ? `⚠️ ${warnings.length} produit(s) avec stock dépôt insuffisant`
              : '✅ Stock dépôt suffisant pour toutes les lignes'}
          </h4>
          {warnings.length > 0 ? (
            <ul className="space-y-0.5">
              {warnings.map((w) => (
                <li key={w.id} className="text-xs text-amber-700">
                  • {w.product?.product_name} : {dispatchQty(w)} requis,{' '}
                  {liveBalance.get(w.product_id)?.qty_total_depot ?? 0} disponible en dépôt
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-emerald-700">
              La transmission déduira automatiquement les quantités des dépôts AUC / Stock EST / Stockage Fûts.
            </p>
          )}
        </div>
      )}

      {/* BODEGA_WINE_REQUIRED — blocage validation si gamme vin absente */}
      {bodegaWineMissing && (
        <Alert variant="error" title="🍷 Bodega incomplète : gamme vin absente" className="mb-4">
          Ajoutez au moins un vin (Rouge NAIS / Blanc Montaurone / Rosé NAIS) à la fiche runner de la Bodega
          avant de valider ou transmettre. Régénérez les dotations ou saisissez une quantité sur un vin.
        </Alert>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          loading={submitting}
          disabled={bodegaWineMissing}
          onClick={() => spaceId && !bodegaWineMissing && void validateSpace(spaceId)}
        >
          <Check className="h-4 w-4" /> Tout valider cet espace
        </Button>
        <Button
          size="sm"
          variant="secondary"
          loading={submitting}
          disabled={bodegaWineMissing}
          onClick={() => spaceId && !bodegaWineMissing && void transmitToRunners(spaceId)}
        >
          <Send className="h-4 w-4" /> Transmettre aux runners
        </Button>
      </div>

      {rows.length === 0 ? (
        <Alert variant="info">Aucune dotation runner pour cet espace.</Alert>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Produit</TH>
              <TH>Cat.</TH>
              <TH className="text-right">Stock espace</TH>
              <TH className="text-right">Moy. hist.</TH>
              <TH className="text-right">Dern. simil.</TH>
              <TH className="text-right">Réf.</TH>
              <TH className="text-right">Coeff.</TH>
              <TH className="text-right">Reco.</TH>
              <TH className="text-right">À monter</TH>
              <TH className="text-right">Stock dépôt</TH>
              <TH>Validée</TH>
              <TH>Alerte</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {rows.map((p) => {
              const color = getRunnerRowColor(p);
              const coeff =
                p.attendance_coefficient *
                p.weather_coefficient *
                p.event_type_coefficient *
                p.trend_coefficient;
              // Repli fallback si la reco moteur est nulle (analytics vide).
              const fallback = getRecommendation(
                p.product?.product_name ?? '',
                p.historical_avg_consumption ?? null,
                coeff,
                1,
              );
              const reco =
                (p.recommended_quantity ?? 0) > 0 ? (p.recommended_quantity as number) : fallback.qty;
              const toMove = Math.max(0, reco - (p.initial_area_stock ?? 0));
              return (
                <TR key={p.id} className={RUNNER_ROW_CLASSES[color]}>
                  <TD className="font-medium text-slate-900">{p.product?.product_name}</TD>
                  <TD>{p.product?.category}</TD>
                  <TD className="text-right">{p.initial_area_stock}</TD>
                  <TD className="text-right">
                    {p.historical_avg_consumption?.toFixed(1) ?? '—'}
                  </TD>
                  <TD className="text-right">
                    {p.last_similar_event_consumption?.toFixed(0) ?? '—'}
                  </TD>
                  <TD className="text-right">{p.consumption_reference?.toFixed(1) ?? '—'}</TD>
                  <TD className="text-right">×{coeff.toFixed(2)}</TD>
                  <TD className="text-right">
                    {reco > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="rounded bg-pr-olive/15 px-2 py-0.5 font-semibold text-pr-olive-dark">
                          {reco}
                        </span>
                        {fallback.source === 'fallback' && (p.recommended_quantity ?? 0) === 0 && (
                          <span className="rounded-full bg-amber-100 px-1.5 text-[10px] text-amber-700" title="Estimé depuis les ratios S-1 (analytics vide)">
                            est.
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-slate-300">0</span>
                    )}
                  </TD>
                  <TD className="text-right">
                    {toMove > 0 ? (
                      <span className="rounded bg-pr-black px-2 py-0.5 font-semibold text-white">{toMove}</span>
                    ) : reco > 0 ? (
                      <span className="text-xs text-emerald-600">✓ Suffisant</span>
                    ) : (
                      <span className="text-slate-200">—</span>
                    )}
                  </TD>
                  <TD className="text-right">
                    {(() => {
                      const lb = liveBalance.get(p.product_id);
                      const depotQty = lb?.qty_total_depot ?? 0;
                      const need = dispatchQty(p);
                      return (
                        <div>
                          <div
                            className={clsx(
                              'font-medium',
                              depotQty === 0
                                ? 'text-red-600'
                                : depotQty < need
                                  ? 'text-amber-600'
                                  : 'text-emerald-700',
                            )}
                          >
                            {depotQty} en dépôt
                          </div>
                          <div className="text-[11px] text-slate-400">{lb?.source_depot ?? '—'}</div>
                        </div>
                      );
                    })()}
                  </TD>
                  <TD>
                    <Input
                      type="number"
                      min={0}
                      className="w-20"
                      value={editVal(p)}
                      onChange={(e) =>
                        setEdits((prev) => ({
                          ...prev,
                          [p.id]: { qty: e.target.value, comment: prev[p.id]?.comment ?? '' },
                        }))
                      }
                    />
                  </TD>
                  <TD>
                    {p.alert_type ? (
                      <Badge
                        tone={
                          p.alert_type === 'suffisant'
                            ? 'success'
                            : p.alert_type === 'surdotation'
                              ? 'warning'
                              : 'danger'
                        }
                      >
                        {p.alert_type}
                      </Badge>
                    ) : (
                      '—'
                    )}
                  </TD>
                  <TD>
                    <button
                      title="Valider la ligne"
                      disabled={submitting}
                      onClick={() =>
                        void validateLine(
                          p.id,
                          Number(editVal(p)) || 0,
                          edits[p.id]?.comment,
                        )
                      }
                      className={clsx(
                        'rounded-md bg-emerald-600 px-2 py-1 text-xs font-semibold text-white',
                        'hover:bg-emerald-700 disabled:opacity-50',
                      )}
                    >
                      ✓
                    </button>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </div>
  );
}
