/**
 * DepotsTab — onglet « Dépôts » du module Stock (ROLE_STADE).
 * Deux dépôts centraux (AUC — réserve générale, Stock EST — cave vins &
 * spiritueux) × trois vues : Stock actuel · Livraisons · Dispatch espaces.
 * Bouton « Enregistrer une livraison » → DeliveryModal.
 */

import { useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  PackageCheck,
  Send,
  Truck,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { Badge, Button, EmptyState, Spinner } from '@/components/ui';
import { formatEuro } from '@/lib/calculations';
import { DeliveryModal } from '@/components/stock/DeliveryModal';
import KegStorageTab from './KegStorageTab';
import {
  useDepots,
  useDepotBalances,
  useDepotDeliveries,
  useDepotDispatch,
  useDepotProductScope,
  useLiveBalanceMap,
  type Delivery,
} from '@/hooks/useDepots';

type DepotView = 'stock' | 'livraisons' | 'dispatch';

const VIEWS: { key: DepotView; label: string; Icon: LucideIcon }[] = [
  { key: 'stock', label: 'Stock actuel', Icon: Boxes },
  { key: 'livraisons', label: 'Livraisons', Icon: Truck },
  { key: 'dispatch', label: 'Dispatch espaces', Icon: Send },
];

function frDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* ─────────────────────────── Onglet principal ─────────────────────────── */

export default function DepotsTab() {
  const depots = useDepots();
  const [depotId, setDepotId] = useState<string | null>(null);
  const [view, setView] = useState<DepotView>('stock');
  const [modalOpen, setModalOpen] = useState(false);

  // Sélectionne AUC (1er) par défaut dès que la liste arrive.
  useEffect(() => {
    if (!depotId && depots.data && depots.data.length > 0) setDepotId(depots.data[0].id);
  }, [depots.data, depotId]);

  const currentDepot = useMemo(
    () => (depots.data ?? []).find((d) => d.id === depotId) ?? null,
    [depots.data, depotId],
  );
  const scope = useDepotProductScope(currentDepot?.name);
  const isKeg = /f[uû]ts/i.test(currentDepot?.name ?? '');

  if (depots.isLoading) return <Spinner fullPage label="Chargement des dépôts…" />;
  if (!depots.data || depots.data.length === 0) {
    return (
      <EmptyState
        icon={Warehouse}
        title="Aucun dépôt configuré"
        message="Les dépôts centraux (AUC, Stock EST) ne sont pas encore initialisés."
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Sélecteur de dépôt + action */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {depots.data.map((d) => {
            const active = d.id === depotId;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => setDepotId(d.id)}
                className={clsx(
                  'flex items-center gap-2 rounded-xl border px-4 py-2.5 text-left transition-colors',
                  active
                    ? 'border-pr-black bg-pr-black text-pr-white'
                    : 'border-pr-stone bg-white text-pr-black hover:bg-pr-cream',
                )}
              >
                <Warehouse className="h-4 w-4 shrink-0" />
                <span className="text-sm font-semibold">{d.name}</span>
              </button>
            );
          })}
        </div>

        {!isKeg && (
          <Button onClick={() => setModalOpen(true)} disabled={!currentDepot}>
            <Truck className="h-4 w-4" /> Enregistrer une livraison
          </Button>
        )}
      </div>

      {currentDepot?.description && (
        <p className="text-sm text-pr-black-soft/60">{currentDepot.description}</p>
      )}

      {/* Dépôt Fûts : gestion pleins/vides dédiée. Autres dépôts : 3 vues génériques. */}
      {isKeg ? (
        <KegStorageTab />
      ) : (
        <>
          <div className="flex gap-1 overflow-x-auto border-b border-pr-stone">
            {VIEWS.map((v) => {
              const active = view === v.key;
              return (
                <button
                  key={v.key}
                  onClick={() => setView(v.key)}
                  className={clsx(
                    'flex shrink-0 items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                    active
                      ? 'border-pr-black text-pr-black'
                      : 'border-transparent text-pr-black-soft/50 hover:text-pr-black',
                  )}
                >
                  <v.Icon className="h-4 w-4" /> {v.label}
                </button>
              );
            })}
          </div>

          {view === 'stock' && <DepotStockView depotId={depotId} />}
          {view === 'livraisons' && <DepotDeliveriesView depotId={depotId} />}
          {view === 'dispatch' && <DepotDispatchView depotId={depotId} />}
        </>
      )}

      {modalOpen && currentDepot && !isKeg && (
        <DeliveryModal
          depotId={currentDepot.id}
          depotName={currentDepot.name}
          categoryScope={scope}
          onClose={() => setModalOpen(false)}
          onSaved={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}

/* ─────────────────────────── Vue Stock actuel ─────────────────────────── */

/** Sous-groupe « format » d'un produit (softs 50cl / grande bouteille / verre…). */
function formatGroup(name: string, unit: string, category: string): string {
  if (unit === 'verre') return 'Verre service';
  if (/50cl/i.test(name)) return 'Format 50cl (buvettes)';
  if (/grande|1L/i.test(name) || (category === 'Soft' && unit === 'btl')) return 'Grande bouteille (salons)';
  if (category === 'Sirops') return 'Sirops';
  if (category === 'Bières') return 'Bières';
  if (category === 'Vins') return 'Vins & champagnes';
  if (category === 'Spiritueux') return 'Spiritueux';
  if (category === 'Matériel') return 'Matériel';
  return category;
}

/** Espaces cibles indicatifs selon le format/catégorie. */
function espacesCibles(name: string, unit: string, category: string): string {
  if (/50cl/i.test(name)) return 'Buvettes · PMR · Bodega';
  if (unit === 'verre') return 'Comptoir · Salons · Bars';
  if (/grande|1L/i.test(name)) return 'Salons VIP · Loges · Bars';
  if (category === 'Spiritueux') return 'Salons VIP · Loges · Bars';
  if (category === 'Vins') return 'Salons VIP · Loges';
  return 'Tous espaces';
}

const GROUP_ORDER = [
  'Format 50cl (buvettes)',
  'Grande bouteille (salons)',
  'Verre service',
  'Vins & champagnes',
  'Spiritueux',
  'Sirops',
  'Bières',
  'Matériel',
];

function DepotStockView({ depotId }: { depotId: string | null }) {
  const balances = useDepotBalances(depotId ?? undefined);
  const { map: liveBalance } = useLiveBalanceMap();

  const { groups, totalQty, totalValue, refCount } = useMemo(() => {
    const data = balances.data ?? [];
    const byGroup = new Map<string, typeof data>();
    for (const b of data) {
      const g = formatGroup(b.product_name, b.unit, b.category);
      const arr = byGroup.get(g) ?? [];
      arr.push(b);
      byGroup.set(g, arr);
    }
    const ordered = [...byGroup.keys()].sort((a, b) => {
      const ia = GROUP_ORDER.indexOf(a);
      const ib = GROUP_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    return {
      groups: ordered.map((g) => ({ name: g, rows: byGroup.get(g)! })),
      totalValue: data.reduce((s, b) => s + b.current_quantity * (b.unit_value_ht ?? 0), 0),
      totalQty: data.reduce((s, b) => s + b.current_quantity, 0),
      refCount: data.length,
    };
  }, [balances.data]);

  if (balances.isLoading) return <Spinner label="Chargement du stock…" />;
  if (refCount === 0) {
    return (
      <EmptyState
        icon={Boxes}
        title="Dépôt vide"
        message="Aucun produit référencé dans ce dépôt. Enregistrez une livraison pour l'approvisionner."
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MiniKpi label="Références" value={String(refCount)} />
        <MiniKpi label="Quantité totale" value={totalQty.toLocaleString('fr-FR')} />
        <MiniKpi label="Valorisation HT" value={formatEuro(totalValue)} />
      </div>

      {groups.map((group) => {
        const gQty = group.rows.reduce((s, b) => s + b.current_quantity, 0);
        const gVal = group.rows.reduce((s, b) => s + b.current_quantity * (b.unit_value_ht ?? 0), 0);
        return (
          <div key={group.name}>
            <div className="mb-2 flex items-center justify-between border-b-2 border-pr-black py-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-pr-black-soft/60">{group.name}</span>
              <span className="text-xs text-pr-black-soft/50">
                {gQty.toLocaleString('fr-FR')} u · {formatEuro(gVal)}
              </span>
            </div>
            <div className="overflow-x-auto rounded-xl border border-pr-stone bg-white">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-pr-stone">
                  {group.rows.map((b) => {
                    const inEvent = liveBalance.get(b.product_id)?.qty_in_event ?? 0;
                    return (
                      <tr key={b.product_id} className="hover:bg-pr-cream/40">
                        <td className="px-4 py-2 font-medium text-pr-black">{b.product_name}</td>
                        <td className="px-4 py-2 text-[11px] text-pr-black-soft/50">
                          {espacesCibles(b.product_name, b.unit, b.category)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          <span className={b.current_quantity === 0 ? 'text-pr-rust' : 'text-pr-black'}>
                            {b.current_quantity.toLocaleString('fr-FR')} {b.unit}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-sky-600">
                          {inEvent > 0 ? `${inEvent.toLocaleString('fr-FR')}` : '—'}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-pr-black-soft/60">
                          {b.unit_value_ht == null ? '—' : formatEuro(b.unit_value_ht)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums font-medium text-pr-black">
                          {b.unit_value_ht == null ? '—' : formatEuro(b.current_quantity * b.unit_value_ht)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────── Vue Livraisons ─────────────────────────── */

function DepotDeliveriesView({ depotId }: { depotId: string | null }) {
  const deliveries = useDepotDeliveries(depotId ?? undefined);

  if (deliveries.isLoading) return <Spinner label="Chargement des livraisons…" />;
  if (!deliveries.data || deliveries.data.length === 0) {
    return (
      <EmptyState
        icon={Truck}
        title="Aucune livraison"
        message="Aucune livraison fournisseur enregistrée sur ce dépôt."
      />
    );
  }

  return (
    <ul className="space-y-2">
      {deliveries.data.map((d) => (
        <DeliveryCard key={d.id} delivery={d} />
      ))}
    </ul>
  );
}

function DeliveryCard({ delivery }: { delivery: Delivery }) {
  const [open, setOpen] = useState(false);
  const total = useMemo(
    () => delivery.lines.reduce((s, l) => s + l.qty_received * (l.unit_price_ht ?? 0), 0),
    [delivery.lines],
  );
  const qtyTotal = useMemo(
    () => delivery.lines.reduce((s, l) => s + l.qty_received, 0),
    [delivery.lines],
  );

  return (
    <li className="overflow-hidden rounded-xl border border-pr-stone bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-pr-cream/40"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-pr-black-soft/50" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-pr-black-soft/50" />
        )}
        <PackageCheck className="h-5 w-5 shrink-0 text-pr-olive-dark" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-pr-black">{delivery.supplier_name}</span>
            <Badge tone="neutral">{frDate(delivery.delivery_date)}</Badge>
            {delivery.invoice_ref && <Badge tone="info">{delivery.invoice_ref}</Badge>}
          </div>
          <p className="mt-0.5 truncate text-xs text-pr-black-soft/60">
            {delivery.lines.length} référence(s) · {qtyTotal.toLocaleString('fr-FR')} unités
            {delivery.received_by ? ` · reçu par ${delivery.received_by}` : ''}
          </p>
        </div>
        <span className="shrink-0 font-display font-black text-pr-black">{formatEuro(total)}</span>
      </button>

      {open && (
        <div className="border-t border-pr-stone bg-pr-cream/20 px-4 py-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-pr-black-soft/60">
                <th className="py-1.5 font-semibold">Produit</th>
                <th className="py-1.5 text-right font-semibold">Reçu</th>
                <th className="py-1.5 text-right font-semibold">PU HT</th>
                <th className="py-1.5 text-right font-semibold">Total HT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pr-stone/60">
              {delivery.lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-1.5 text-pr-black">{l.product?.product_name ?? '—'}</td>
                  <td className="py-1.5 text-right tabular-nums text-pr-black">
                    {l.qty_received} {l.product?.unit ?? ''}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-pr-black-soft/70">
                    {l.unit_price_ht == null ? '—' : formatEuro(l.unit_price_ht)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums font-medium text-pr-black">
                    {l.unit_price_ht == null ? '—' : formatEuro(l.qty_received * l.unit_price_ht)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {delivery.notes && (
            <p className="mt-2 text-xs italic text-pr-black-soft/60">{delivery.notes}</p>
          )}
        </div>
      )}
    </li>
  );
}

/* ─────────────────────────── Vue Dispatch ─────────────────────────── */

function DepotDispatchView({ depotId }: { depotId: string | null }) {
  const dispatch = useDepotDispatch(depotId ?? undefined);

  const rows = useMemo(
    () => (dispatch.data ?? []).filter((r) => r.qty_in_depot !== 0 || r.total_dispatched > 0),
    [dispatch.data],
  );

  if (dispatch.isLoading) return <Spinner label="Chargement du dispatch…" />;
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Send}
        title="Aucun dispatch"
        message="Aucun mouvement de dispatch depuis ce dépôt vers les espaces pour l'instant."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-pr-stone bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-pr-stone text-left text-xs uppercase tracking-wide text-pr-black-soft/60">
            <th className="px-4 py-2.5 font-semibold">Produit</th>
            <th className="px-4 py-2.5 text-right font-semibold">En dépôt</th>
            <th className="px-4 py-2.5 text-right font-semibold">Dispatché</th>
            <th className="px-4 py-2.5 font-semibold">Vers les espaces</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-pr-stone">
          {rows.map((r) => (
            <tr key={r.product_id} className="align-top hover:bg-pr-cream/40">
              <td className="px-4 py-2.5 font-medium text-pr-black">
                {r.product_name}
                <span className="ml-2 text-xs text-pr-black-soft/50">{r.category}</span>
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-pr-black">
                {r.qty_in_depot.toLocaleString('fr-FR')} {r.unit}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-pr-olive-dark">
                {r.total_dispatched > 0 ? r.total_dispatched.toLocaleString('fr-FR') : '—'}
              </td>
              <td className="px-4 py-2.5">
                {r.spaces_detail && r.spaces_detail.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {r.spaces_detail.map((s, i) => (
                      <Badge key={`${r.product_id}-${i}`} tone="neutral">
                        {s.space_name} · {s.qty}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-pr-black-soft/40">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─────────────────────────── Bits ─────────────────────────── */

function MiniKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-pr-stone bg-white p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-pr-olive-dark">{label}</p>
      <p className="mt-0.5 font-display text-2xl font-black text-pr-black">{value}</p>
    </div>
  );
}
