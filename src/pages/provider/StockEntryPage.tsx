/**
 * StockEntryPage (Responsable) — cycle de saisie de stock (Phase 2).
 *
 * Flux dérivé des données (pas d'état de phase local) :
 *   OUVERTURE → EN COURS (réassort) → CLÔTURE → TERMINÉ
 *
 * Règles : RG-001 (nom obligatoire), RG-003 (aucun prix affiché),
 * RG-004 (anomalie obligatoire si consommation < 0).
 */

import { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Boxes, PackageCheck, PlusCircle, ClipboardCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useOpenEventForSpace } from '@/hooks/useEvents';
import {
  useStock,
  type ClosingLineInput,
  type OpeningLineInput,
  type ReassortLineInput,
} from '@/hooks/useStock';
import { computeConsumed } from '@/lib/calculations';
import { PRODUCT_STATE_OPTIONS, PRODUCT_STATE_META } from '@/lib/labels';
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
  TFoot,
  TH,
  THead,
  TR,
  Textarea,
} from '@/components/ui';
import type { Product, ProductState } from '@/lib/types';

/** Récupère le libellé produit depuis la map (fallback sur l'id). */
function productName(map: Map<string, Product>, id: string): string {
  return map.get(id)?.product_name ?? id;
}
function productUnit(map: Map<string, Product>, id: string): string {
  return map.get(id)?.unit ?? '';
}

export default function StockEntryPage() {
  const { user, responsableName } = useAuth();
  const spaceId = user?.spaceId;

  // Étape 0 — RG-001 : nom obligatoire.
  if (!responsableName) return <Navigate to="/provider/home" replace />;

  if (!spaceId) {
    return (
      <Alert variant="warning" title="Espace non rattaché">
        Votre compte n'est rattaché à aucun espace. Contactez l'équipe Stade.
      </Alert>
    );
  }

  return <StockEntryContent spaceId={spaceId} responsableNom={responsableName} />;
}

function StockEntryContent({
  spaceId,
  responsableNom,
}: {
  spaceId: string;
  responsableNom: string;
}) {
  const eventQuery = useOpenEventForSpace(spaceId);
  const event = eventQuery.data;
  const stock = useStock(event?.event_id, spaceId, { withPrices: false });

  // Sous-mode local de la vue « en cours ».
  const [mode, setMode] = useState<'view' | 'reassort' | 'closing'>('view');

  if (eventQuery.isLoading) return <Spinner fullPage label="Chargement…" />;
  if (!event) {
    return (
      <EmptyState
        icon={Boxes}
        title="Aucun événement ouvert"
        message="Aucun événement n'est actuellement ouvert pour votre espace."
      />
    );
  }

  const header = (
    <PageHeader
      title="Saisie des stocks"
      description={`${event.event_name} — ${new Date(event.event_date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}`}
    />
  );

  if (stock.loading) {
    return (
      <div>
        {header}
        <Spinner fullPage label="Chargement des stocks…" />
      </div>
    );
  }

  return (
    <div>
      {header}
      {stock.phase === 'ouverture' && (
        <OpeningForm
          stock={stock}
          responsableNom={responsableNom}
        />
      )}
      {stock.phase === 'reassort' && mode === 'view' && (
        <EnCoursView stock={stock} onReassort={() => setMode('reassort')} onClose={() => setMode('closing')} />
      )}
      {stock.phase === 'reassort' && mode === 'reassort' && (
        <ReassortForm stock={stock} responsableNom={responsableNom} onDone={() => setMode('view')} />
      )}
      {stock.phase === 'reassort' && mode === 'closing' && (
        <ClosingForm stock={stock} responsableNom={responsableNom} onCancel={() => setMode('view')} />
      )}
      {stock.phase === 'cloture' && <RecapView stock={stock} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ouverture                                                           */
/* ------------------------------------------------------------------ */

function OpeningForm({
  stock,
  responsableNom,
}: {
  stock: ReturnType<typeof useStock>;
  responsableNom: string;
}) {
  const dotations = stock.dotations.data ?? [];
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(dotations.map((d) => [d.product_id, String(d.planned_qty)])),
  );
  const [error, setError] = useState<string | null>(null);

  if (dotations.length === 0) {
    return (
      <EmptyState
        icon={Boxes}
        title="Aucune dotation"
        message="Aucune dotation runner n'a été préparée pour votre espace sur cet événement."
      />
    );
  }

  async function handleSubmit() {
    setError(null);
    const lines: OpeningLineInput[] = dotations.map((d) => ({
      product_id: d.product_id,
      initial_qty: Math.max(0, Number(qty[d.product_id] ?? 0) || 0),
    }));
    try {
      await stock.submitOpening(lines, responsableNom);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la validation.');
    }
  }

  return (
    <div className="space-y-4">
      <Alert variant="info" title="Inventaire d'ouverture">
        Saisissez la quantité réellement reçue pour chaque produit doté.
      </Alert>
      {error && <Alert variant="error">{error}</Alert>}

      <div className="space-y-3">
        {dotations.map((d) => (
          <div
            key={d.dotation_id}
            className="flex items-center justify-between gap-3 rounded-lg bg-white p-3 ring-1 ring-slate-200"
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-900">
                {productName(stock.productMap, d.product_id)}
              </p>
              <p className="text-xs text-slate-500">
                Dotation prévue : {d.planned_qty} {productUnit(stock.productMap, d.product_id)}
              </p>
            </div>
            <div className="w-28 shrink-0">
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                aria-label={`Quantité réelle ${productName(stock.productMap, d.product_id)}`}
                value={qty[d.product_id] ?? ''}
                onChange={(e) =>
                  setQty((prev) => ({ ...prev, [d.product_id]: e.target.value }))
                }
              />
            </div>
          </div>
        ))}
      </div>

      <Button fullWidth size="lg" loading={stock.submitting} onClick={handleSubmit}>
        <PackageCheck className="h-5 w-5" /> Valider l'inventaire d'ouverture
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* En cours                                                            */
/* ------------------------------------------------------------------ */

function EnCoursView({
  stock,
  onReassort,
  onClose,
}: {
  stock: ReturnType<typeof useStock>;
  onReassort: () => void;
  onClose: () => void;
}) {
  const lines = stock.stockLines.data ?? [];
  return (
    <div className="space-y-4">
      <Alert variant="success" title="Inventaire d'ouverture validé">
        Vous pouvez saisir des réassorts puis procéder à la clôture.
      </Alert>

      <Table>
        <THead>
          <TR>
            <TH>Produit</TH>
            <TH className="text-right">Initial</TH>
            <TH className="text-right">Réassort</TH>
            <TH className="text-right">Disponible</TH>
          </TR>
        </THead>
        <TBody>
          {lines.map((l) => (
            <TR key={l.line_id}>
              <TD>{productName(stock.productMap, l.product_id)}</TD>
              <TD className="text-right">{l.initial_qty}</TD>
              <TD className="text-right">{l.reassort_qty}</TD>
              <TD className="text-right font-medium">
                {l.initial_qty + l.reassort_qty}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button variant="secondary" size="lg" onClick={onReassort}>
          <PlusCircle className="h-5 w-5" /> Saisir un réassort
        </Button>
        <Button size="lg" onClick={onClose}>
          <ClipboardCheck className="h-5 w-5" /> Saisir l'inventaire de clôture
        </Button>
      </div>
    </div>
  );
}

function ReassortForm({
  stock,
  responsableNom,
  onDone,
}: {
  stock: ReturnType<typeof useStock>;
  responsableNom: string;
  onDone: () => void;
}) {
  const lines = stock.stockLines.data ?? [];
  const [delta, setDelta] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    const inputs: ReassortLineInput[] = lines
      .map((l) => ({
        product_id: l.product_id,
        delta: Math.max(0, Number(delta[l.product_id] ?? 0) || 0),
      }))
      .filter((l) => l.delta > 0);
    if (inputs.length === 0) {
      setError('Saisissez au moins une quantité de réassort.');
      return;
    }
    try {
      await stock.submitReassort(inputs, responsableNom);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors du réassort.');
    }
  }

  return (
    <div className="space-y-4">
      <Alert variant="info" title="Réassort">
        Indiquez uniquement les quantités <strong>ajoutées</strong> (delta).
      </Alert>
      {error && <Alert variant="error">{error}</Alert>}

      <div className="space-y-3">
        {lines.map((l) => (
          <div
            key={l.line_id}
            className="flex items-center justify-between gap-3 rounded-lg bg-white p-3 ring-1 ring-slate-200"
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-900">
                {productName(stock.productMap, l.product_id)}
              </p>
              <p className="text-xs text-slate-500">
                Disponible actuel : {l.initial_qty + l.reassort_qty}
              </p>
            </div>
            <div className="w-28 shrink-0">
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                placeholder="+0"
                aria-label={`Réassort ${productName(stock.productMap, l.product_id)}`}
                value={delta[l.product_id] ?? ''}
                onChange={(e) =>
                  setDelta((prev) => ({ ...prev, [l.product_id]: e.target.value }))
                }
              />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button variant="ghost" size="lg" onClick={onDone}>
          Annuler
        </Button>
        <Button size="lg" loading={stock.submitting} onClick={handleSubmit}>
          Valider le réassort
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Clôture                                                             */
/* ------------------------------------------------------------------ */

interface ClosingState {
  final: string;
  state: ProductState;
  anomaly: string;
}

function ClosingForm({
  stock,
  responsableNom,
  onCancel,
}: {
  stock: ReturnType<typeof useStock>;
  responsableNom: string;
  onCancel: () => void;
}) {
  const lines = stock.stockLines.data ?? [];
  const [form, setForm] = useState<Record<string, ClosingState>>(() =>
    Object.fromEntries(
      lines.map((l) => [l.product_id, { final: '', state: 'fermé' as ProductState, anomaly: '' }]),
    ),
  );
  const [error, setError] = useState<string | null>(null);

  function update(productId: string, patch: Partial<ClosingState>) {
    setForm((prev) => ({ ...prev, [productId]: { ...prev[productId], ...patch } }));
  }

  async function handleSubmit() {
    setError(null);
    const inputs: ClosingLineInput[] = lines.map((l) => {
      const f = form[l.product_id];
      return {
        product_id: l.product_id,
        final_qty: Math.max(0, Number(f.final ?? 0) || 0),
        product_state: f.state,
        anomaly_comment: f.anomaly,
      };
    });
    try {
      await stock.submitClosing(inputs, responsableNom);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la clôture.');
    }
  }

  return (
    <div className="space-y-4">
      <Alert variant="warning" title="Inventaire de clôture">
        Saisissez le restant, l'état du produit, et un commentaire si la
        consommation est négative (RG-004).
      </Alert>
      {error && <Alert variant="error">{error}</Alert>}

      <div className="space-y-3">
        {lines.map((l) => {
          const f = form[l.product_id];
          const available = l.initial_qty + l.reassort_qty;
          const consumed = computeConsumed(l.initial_qty, l.reassort_qty, Number(f.final ?? 0) || 0);
          const negative = f.final !== '' && consumed < 0;
          return (
            <div
              key={l.line_id}
              className="space-y-2 rounded-lg bg-white p-3 ring-1 ring-slate-200"
            >
              <div className="flex items-center justify-between">
                <p className="font-medium text-slate-900">
                  {productName(stock.productMap, l.product_id)}
                </p>
                <span className="text-xs text-slate-500">Disponible : {available}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  label="Restant"
                  value={f.final}
                  error={negative ? 'Consommation négative' : null}
                  onChange={(e) => update(l.product_id, { final: e.target.value })}
                />
                <Select
                  label="État"
                  options={PRODUCT_STATE_OPTIONS}
                  value={f.state}
                  onChange={(e) =>
                    update(l.product_id, { state: e.target.value as ProductState })
                  }
                />
              </div>
              {negative && (
                <Textarea
                  label="Commentaire d'anomalie (obligatoire)"
                  rows={2}
                  value={f.anomaly}
                  onChange={(e) => update(l.product_id, { anomaly: e.target.value })}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button variant="ghost" size="lg" onClick={onCancel}>
          Annuler
        </Button>
        <Button size="lg" loading={stock.submitting} onClick={handleSubmit}>
          <ClipboardCheck className="h-5 w-5" /> Valider la clôture
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Récapitulatif (terminé) — sans prix (RG-003)                        */
/* ------------------------------------------------------------------ */

function RecapView({ stock }: { stock: ReturnType<typeof useStock> }) {
  const lines = stock.stockLines.data ?? [];
  const rows = useMemo(
    () =>
      lines.map((l) => ({
        ...l,
        consumed: computeConsumed(l.initial_qty, l.reassort_qty, l.final_qty ?? 0),
      })),
    [lines],
  );

  return (
    <div className="space-y-4">
      <Alert variant="success" title="Clôture validée">
        L'inventaire de clôture a été enregistré. Récapitulatif ci-dessous.
      </Alert>

      <Table>
        <THead>
          <TR>
            <TH>Produit</TH>
            <TH className="text-right">Initial</TH>
            <TH className="text-right">Réassort</TH>
            <TH className="text-right">Final</TH>
            <TH>État</TH>
            <TH className="text-right">Conso.</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.line_id}>
              <TD>{productName(stock.productMap, r.product_id)}</TD>
              <TD className="text-right">{r.initial_qty}</TD>
              <TD className="text-right">{r.reassort_qty}</TD>
              <TD className="text-right">{r.final_qty ?? '—'}</TD>
              <TD>
                {r.product_state && (
                  <Badge tone={PRODUCT_STATE_META[r.product_state].tone}>
                    {PRODUCT_STATE_META[r.product_state].label}
                  </Badge>
                )}
              </TD>
              <TD className="text-right">
                {r.consumed < 0 ? (
                  <Badge tone="danger">{r.consumed}</Badge>
                ) : (
                  r.consumed
                )}
              </TD>
            </TR>
          ))}
        </TBody>
        <TFoot>
          <TR>
            <TD>Total</TD>
            <TD className="text-right">
              {rows.reduce((s, r) => s + r.initial_qty, 0)}
            </TD>
            <TD className="text-right">
              {rows.reduce((s, r) => s + r.reassort_qty, 0)}
            </TD>
            <TD className="text-right">
              {rows.reduce((s, r) => s + (r.final_qty ?? 0), 0)}
            </TD>
            <TD />
            <TD className="text-right">
              {rows.reduce((s, r) => s + r.consumed, 0)}
            </TD>
          </TR>
        </TFoot>
      </Table>
    </div>
  );
}
