/**
 * RunnerSpaceDetail (ROLE_STADE) — validation des dotations runner d'un espace.
 * Route : /admin/events/:id/runner/:spaceId
 */

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Send } from 'lucide-react';
import { clsx } from 'clsx';
import { useRunnerPlanning } from '@/hooks/useRunnerPlanning';
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
  const [edits, setEdits] = useState<Record<string, { qty: string; comment: string }>>({});

  if (plans.isLoading) return <Spinner fullPage label="Chargement…" />;

  const rows = (plans.data ?? []).filter((p) => p.space_id === spaceId);
  const spaceName = rows[0]?.space?.space_name ?? 'Espace';
  const status = rows[0]?.validation_status ?? 'brouillon';

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
