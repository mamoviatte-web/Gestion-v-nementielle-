/**
 * RunnerSpaceDetail (ROLE_STADE) — validation des dotations runner d'un espace.
 * Route : /admin/events/:id/runner/:spaceId
 */

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Send } from 'lucide-react';
import { clsx } from 'clsx';
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

export default function RunnerSpaceDetail() {
  const { id, spaceId } = useParams<{ id: string; spaceId: string }>();
  const { plans, validateLine, validateSpace, transmitToRunners, submitting } =
    useRunnerPlanning(id);
  const { map: liveBalance } = useLiveBalanceMap();
  const [edits, setEdits] = useState<Record<string, { qty: string; comment: string }>>({});

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

      <div className="mb-4 flex flex-wrap gap-2">
        <Button size="sm" loading={submitting} onClick={() => spaceId && void validateSpace(spaceId)}>
          <Check className="h-4 w-4" /> Tout valider cet espace
        </Button>
        <Button
          size="sm"
          variant="secondary"
          loading={submitting}
          onClick={() => spaceId && void transmitToRunners(spaceId)}
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
                  <TD className="text-right font-semibold">{p.recommended_quantity ?? '—'}</TD>
                  <TD className="text-right">{p.quantity_to_move ?? '—'}</TD>
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
