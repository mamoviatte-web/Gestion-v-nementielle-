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
  FileText,
  PackageCheck,
  Send,
  Truck,
  Warehouse,
  ReceiptText,
  PackagePlus,
  ArrowLeftRight,
  ArrowDownLeft,
  ArrowUpRight,
  Wine,
  type LucideIcon,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { clsx as cx } from 'clsx';
import { Badge, Button, EmptyState, Spinner } from '@/components/ui';
import { formatEuro } from '@/lib/calculations';
import { DeliveryModal } from '@/components/stock/DeliveryModal';
import { MontanerReceptionModal } from '@/components/stock/MontanerReceptionModal';
import { KegReceptionModal } from '@/components/stock/KegReceptionModal';
import { InvoiceRegistryView } from '@/components/stock/InvoiceRegistryView';
import KegStorageTab from './KegStorageTab';
import {
  useDepots,
  useDepotBalances,
  useDepotDeliveries,
  useDepotDispatch,
  useDepotProductScope,
  useDepotsSummary,
  useDepotMovements,
  useLiveBalanceMap,
  type Delivery,
  type DepotMovement,
  type DepotSummary,
} from '@/hooks/useDepots';

type DepotView = 'stock' | 'registre' | 'livraisons' | 'dispatch' | 'factures';

const VIEWS: { key: DepotView; label: string; Icon: LucideIcon }[] = [
  { key: 'stock', label: 'Stock actuel', Icon: Boxes },
  { key: 'registre', label: 'Registre mouvements', Icon: ArrowLeftRight },
  { key: 'livraisons', label: 'Livraisons', Icon: Truck },
  { key: 'dispatch', label: 'Dispatch espaces', Icon: Send },
  { key: 'factures', label: 'Factures', Icon: ReceiptText },
];

function frDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Rôle affiché d'un dépôt, déduit de son nom. */
function depotRole(name: string): string {
  if (/EST/i.test(name)) return 'Cave vins & spiritueux';
  if (/f[uû]ts/i.test(name)) return 'Stockage fûts · pleins / vides';
  return 'Réserve générale · point d’entrée';
}

/* ─────────────────────────── Onglet principal ─────────────────────────── */

export default function DepotsTab() {
  const depots = useDepots();
  const [depotId, setDepotId] = useState<string | null>(null);
  const [view, setView] = useState<DepotView>('stock');
  const [modalOpen, setModalOpen] = useState(false);
  const [montanerOpen, setMontanerOpen] = useState(false);
  const [kegReceptionOpen, setKegReceptionOpen] = useState(false);
  const queryClient = useQueryClient();

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

  const summary = useDepotsSummary();
  const summaryById = useMemo(
    () => new Map((summary.data ?? []).map((s) => [s.id, s])),
    [summary.data],
  );
  const maxValue = useMemo(
    () => Math.max(1, ...(summary.data ?? []).map((s) => s.total_value_ht)),
    [summary.data],
  );

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
      {/* Cockpit — les 3 espaces de stockage, toujours visibles */}
      <div className="grid gap-3 sm:grid-cols-3">
        {depots.data.map((d) => (
          <DepotHealthCard
            key={d.id}
            name={d.name}
            summary={summaryById.get(d.id)}
            maxValue={maxValue}
            active={d.id === depotId}
            onSelect={() => setDepotId(d.id)}
          />
        ))}
      </div>

      {/* Actions dépôt */}
      <div className="flex flex-wrap gap-2">
        {!isKeg && (
          <Button onClick={() => setModalOpen(true)} disabled={!currentDepot}>
            <Truck className="h-4 w-4" /> Enregistrer une livraison
          </Button>
        )}
        <Button onClick={() => setKegReceptionOpen(true)}>
          <PackagePlus className="h-4 w-4" /> Réceptionner des fûts
        </Button>
        <Button variant="secondary" onClick={() => setMontanerOpen(true)}>
          <FileText className="h-4 w-4" /> Facture Montaner
        </Button>
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
          {view === 'registre' && <DepotRegistreView depotId={depotId} />}
          {view === 'livraisons' && <DepotDeliveriesView depotId={depotId} />}
          {view === 'dispatch' && <DepotDispatchView depotId={depotId} />}
          {view === 'factures' && <InvoiceRegistryView />}
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

      {montanerOpen && (
        <MontanerReceptionModal onClose={() => setMontanerOpen(false)} onDone={() => setMontanerOpen(false)} />
      )}

      {kegReceptionOpen && (
        <KegReceptionModal
          onClose={() => setKegReceptionOpen(false)}
          onDone={() => {
            void queryClient.invalidateQueries({ queryKey: ['kegSummary'] });
            void queryClient.invalidateQueries({ queryKey: ['invoiceRegistry'] });
            void queryClient.invalidateQueries({ queryKey: ['depotDeliveries'] });
            void queryClient.invalidateQueries({ queryKey: ['depotBalances'] });
            setKegReceptionOpen(false);
          }}
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

/* ─────────────────────── Cockpit — carte-santé dépôt ─────────────────────── */

function DepotHealthCard({
  name,
  summary,
  maxValue,
  active,
  onSelect,
}: {
  name: string;
  summary?: DepotSummary;
  maxValue: number;
  active: boolean;
  onSelect: () => void;
}) {
  const isKeg = /f[uû]ts/i.test(name);
  const value = summary?.total_value_ht ?? 0;
  const qty = summary?.total_qty ?? 0;
  const refs = summary?.product_lines ?? 0;
  const share = Math.min(100, Math.round((value / maxValue) * 100));
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cx(
        'flex flex-col rounded-2xl border p-4 text-left transition-colors',
        active
          ? 'border-pr-black bg-white shadow-sm ring-1 ring-pr-black'
          : 'border-pr-stone bg-white hover:bg-pr-cream',
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-pr-black-soft/45">
        {isKeg ? <Wine className="h-3.5 w-3.5" /> : <Warehouse className="h-3.5 w-3.5" />}
        {depotRole(name)}
      </div>
      <div className="mt-1 font-display text-base font-black tracking-tight text-pr-black">{name}</div>
      <div className="mt-2.5 font-display text-2xl font-black tabular-nums text-pr-black">
        {isKeg ? (
          <>
            {qty.toLocaleString('fr-FR')} <span className="text-sm font-bold text-pr-black-soft/50">fûts</span>
          </>
        ) : (
          formatEuro(value)
        )}
      </div>
      <div className="mt-0.5 text-xs text-pr-black-soft/55">
        {refs} réf · {qty.toLocaleString('fr-FR')} u{isKeg ? '' : ' · valorisation HT'}
      </div>
      {!isKeg && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-pr-stone">
          <div className="h-full rounded-full bg-pr-olive" style={{ width: `${share}%` }} />
        </div>
      )}
      <div className="mt-2 text-[11px] text-pr-black-soft/40">
        Dernière livraison : {frDate(summary?.last_delivery_date ?? null)}
      </div>
    </button>
  );
}

/* ─────────────────────── Registre des mouvements (dépôt) ─────────────────────── */

const MOVE_META: Record<string, { label: string; tone: 'ok' | 'crit' | 'warn' | 'neutral' }> = {
  entrée_fournisseur: { label: 'Entrée', tone: 'ok' },
  réassort_événement: { label: 'Réassort', tone: 'warn' },
  sortie: { label: 'Sortie', tone: 'crit' },
  transfert_espace: { label: 'Transfert', tone: 'crit' },
  retour: { label: 'Retour', tone: 'neutral' },
  retour_réutilisable: { label: 'Retour', tone: 'neutral' },
  retour_fournisseur: { label: 'Retour fourn.', tone: 'neutral' },
  inventaire: { label: 'Inventaire', tone: 'ok' },
  correction: { label: 'Correction', tone: 'warn' },
  consommation: { label: 'Conso', tone: 'crit' },
  perte_casse: { label: 'Perte / casse', tone: 'crit' },
};

function DepotRegistreView({ depotId }: { depotId: string | null }) {
  const moves = useDepotMovements(depotId ?? undefined);
  if (moves.isLoading) return <Spinner label="Chargement du registre…" />;
  const rows = moves.data ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={ArrowLeftRight}
        title="Aucun mouvement"
        message="Aucune entrée, sortie ou retour enregistré sur ce dépôt."
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-pr-stone bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-pr-stone text-left text-xs uppercase tracking-wide text-pr-black-soft/60">
            <th className="px-4 py-2.5 font-semibold">Type</th>
            <th className="px-4 py-2.5 font-semibold">Produit</th>
            <th className="px-4 py-2.5 font-semibold">Espace / origine</th>
            <th className="px-4 py-2.5 text-right font-semibold">Qté</th>
            <th className="px-4 py-2.5 text-right font-semibold">Date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-pr-stone">
          {rows.map((m) => (
            <RegistreRow key={m.movement_id} m={m} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RegistreRow({ m }: { m: DepotMovement }) {
  const meta = MOVE_META[m.movement_type] ?? { label: m.movement_type, tone: 'neutral' as const };
  const toneCls =
    meta.tone === 'ok'
      ? 'bg-emerald-100 text-emerald-800'
      : meta.tone === 'crit'
        ? 'bg-pr-rust/10 text-pr-rust'
        : meta.tone === 'warn'
          ? 'bg-amber-100 text-amber-800'
          : 'bg-pr-stone text-pr-black-soft/70';
  const inbound = m.direction === 'in';
  const signed = `${inbound ? '+' : '−'}${m.qty.toLocaleString('fr-FR')}`;
  return (
    <tr className="hover:bg-pr-cream/40">
      <td className="px-4 py-2.5">
        <span
          className={cx(
            'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide',
            toneCls,
          )}
        >
          {inbound ? <ArrowDownLeft className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
          {meta.label}
        </span>
      </td>
      <td className="px-4 py-2.5 font-medium text-pr-black">{m.product_name}</td>
      <td className="px-4 py-2.5 text-pr-black-soft/60">{m.space_name ?? '—'}</td>
      <td
        className={cx(
          'px-4 py-2.5 text-right font-display font-bold tabular-nums',
          inbound ? 'text-pr-olive-dark' : 'text-pr-rust',
        )}
      >
        {signed}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums text-pr-black-soft/50">{frDate(m.created_at)}</td>
    </tr>
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
