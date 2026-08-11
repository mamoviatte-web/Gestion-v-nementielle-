/**
 * KegStorageTab — dépôt « Stockage Fûts » : fûts pleins (dispatch vers espaces)
 * et fûts vides (retour fournisseur). Réservé ROLE_STADE.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  Droplets,
  FlaskConical,
  PackageCheck,
  Send,
  Trash2,
  Truck,
  X,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Alert, Badge, Button, EmptyState, Input, Select, Spinner } from '@/components/ui';
import { formatEuro } from '@/lib/calculations';
import {
  useKegSummary,
  useEmptyKegs,
  useKegReturnHistory,
  useOpenEventsForDispatch,
  useKegMutations,
  type KegSummaryRow,
} from '@/hooks/useKegManagement';

type KegView = 'pleins' | 'vides';

function frDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

/* ─────────────────────────── Onglet ─────────────────────────── */

export default function KegStorageTab() {
  const [view, setView] = useState<KegView>('pleins');
  const summary = useKegSummary();
  const empty = useEmptyKegs();

  const views: { key: KegView; label: string; count: number }[] = [
    { key: 'pleins', label: '🟢 Fûts pleins', count: summary.data?.totalPleins ?? 0 },
    { key: 'vides', label: '🔴 Fûts vides', count: empty.data?.total ?? 0 },
  ];

  return (
    <div className="space-y-5">
      <div className="flex gap-1 overflow-x-auto border-b border-pr-stone">
        {views.map((v) => {
          const active = view === v.key;
          return (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={clsx(
                'flex shrink-0 items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                active ? 'border-pr-black text-pr-black' : 'border-transparent text-pr-black-soft/50 hover:text-pr-black',
              )}
            >
              {v.label}
              <span className="rounded-full bg-pr-stone/60 px-1.5 text-xs font-semibold">{v.count}</span>
            </button>
          );
        })}
      </div>

      {view === 'pleins' && <KegPleinsView />}
      {view === 'vides' && <KegVidesView />}
    </div>
  );
}

/* ─────────────────────────── Fûts pleins ─────────────────────────── */

function KegPleinsView() {
  const summary = useKegSummary();
  const [dispatchKeg, setDispatchKeg] = useState<KegSummaryRow | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [consume, setConsume] = useState<{ keg: KegSummaryRow | null } | null>(null);

  if (summary.isLoading) return <Spinner label="Chargement des fûts…" />;
  const data = summary.data;
  if (!data || data.kegs.length === 0) {
    return <EmptyState icon={PackageCheck} title="Aucun fût référencé" />;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Fûts pleins" value={String(data.totalPleins)} sub="disponibles" icon={CheckCircle2} tone="success" />
        <KpiCard label="En espace" value={String(data.totalEnEspace)} sub="en cours d'utilisation" icon={Building2} />
        <KpiCard label="Litres disponibles" value={`${data.totalLitres.toLocaleString('fr-FR')} L`} sub="stock plein" icon={Droplets} />
        <KpiCard label="Valeur stock" value={formatEuro(data.totalValue)} sub="fûts pleins" icon={CircleDollarSign} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setReceiveOpen(true)}>
          <Truck className="h-4 w-4" /> Réceptionner des fûts
        </Button>
        <Button variant="secondary" onClick={() => setConsume({ keg: null })}>
          <FlaskConical className="h-4 w-4" /> Purge tireuses
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-pr-stone bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-pr-stone text-left text-xs uppercase tracking-wide text-pr-black-soft/60">
              <th className="px-4 py-2.5 font-semibold">Fût</th>
              <th className="px-4 py-2.5 text-right font-semibold">Pleins</th>
              <th className="px-4 py-2.5 text-right font-semibold">En espace</th>
              <th className="px-4 py-2.5 text-right font-semibold">Vides</th>
              <th className="px-4 py-2.5 text-right font-semibold">Volume</th>
              <th className="px-4 py-2.5 text-right font-semibold">PU HT</th>
              <th className="px-4 py-2.5 text-right font-semibold">Valeur HT</th>
              <th className="px-4 py-2.5 text-right font-semibold">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-pr-stone">
            {data.kegs.map((k) => (
              <tr key={k.product_id} className="hover:bg-pr-cream/40">
                <td className="px-4 py-3 font-medium text-pr-black">{k.product_name}</td>
                <td className="px-4 py-3 text-right">
                  <span
                    className={clsx(
                      'font-medium',
                      k.pleins === 0 ? 'text-pr-rust' : k.pleins <= 2 ? 'text-amber-600' : 'text-pr-olive-dark',
                    )}
                  >
                    {k.pleins} {k.pleins > 1 ? 'fûts' : 'fût'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-pr-black-soft/60">{k.en_espace > 0 ? k.en_espace : '—'}</td>
                <td className="px-4 py-3 text-right">
                  {k.vides > 0 ? <span className="font-medium text-pr-rust">{k.vides}</span> : '—'}
                </td>
                <td className="px-4 py-3 text-right text-pr-black-soft/60">
                  {k.litres_disponibles > 0 ? `${k.litres_disponibles.toLocaleString('fr-FR')} L` : '—'}
                </td>
                <td className="px-4 py-3 text-right text-pr-black-soft/70">
                  {k.unit_price_ht != null ? formatEuro(k.unit_price_ht) : '—'}
                </td>
                <td className="px-4 py-3 text-right font-medium text-pr-black">
                  {k.unit_price_ht != null ? formatEuro(k.pleins * k.unit_price_ht) : '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex gap-1.5">
                    <button
                      onClick={() => setDispatchKeg(k)}
                      disabled={k.pleins <= 0}
                      className="rounded-lg border border-pr-olive/40 px-2.5 py-1 text-xs font-medium text-pr-olive-dark hover:bg-pr-olive/10 disabled:opacity-30"
                    >
                      Dispatcher
                    </button>
                    <button
                      onClick={() => setConsume({ keg: k })}
                      disabled={k.pleins <= 0}
                      className="rounded-lg border border-amber-400/50 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-30"
                    >
                      Consommer
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dispatchKeg && <DispatchKegModal keg={dispatchKeg} onClose={() => setDispatchKeg(null)} />}
      {receiveOpen && <KegReceiveModal onClose={() => setReceiveOpen(false)} />}
      {consume && (
        <ConsumePurgeModal
          keg={consume.keg}
          kegs={data.kegs}
          onClose={() => setConsume(null)}
          onDone={() => void summary.refetch()}
        />
      )}
    </div>
  );
}

/* ─────────────────────────── Fûts vides ─────────────────────────── */

function KegVidesView() {
  const empty = useEmptyKegs();
  const history = useKegReturnHistory();
  const { markReturnedToSupplier, marking } = useKegMutations();
  const [selected, setSelected] = useState<string[]>([]);

  const lines = empty.data?.lines ?? [];
  const allSelected = lines.length > 0 && selected.length === lines.length;

  async function handleReturn() {
    if (selected.length === 0) return;
    await markReturnedToSupplier(selected);
    setSelected([]);
  }

  if (empty.isLoading) return <Spinner label="Chargement des fûts vides…" />;

  return (
    <div className="space-y-4 pb-20">
      {(empty.data?.total ?? 0) > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-amber-800">
              {empty.data?.total} fût(s) vide(s) en attente de retour fournisseur
            </p>
            <p className="text-xs text-amber-600">
              Volume récupérable : {(empty.data?.totalVolume ?? 0).toLocaleString('fr-FR')} L
            </p>
          </div>
        </div>
      )}

      {lines.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="Aucun fût vide" message="Tous les fûts vides ont été retournés au fournisseur." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-pr-stone bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-pr-stone text-left text-xs uppercase tracking-wide text-pr-black-soft/60">
                <th className="w-10 px-3 py-2.5">
                  <input
                    type="checkbox"
                    aria-label="Tout sélectionner"
                    checked={allSelected}
                    onChange={(e) => setSelected(e.target.checked ? lines.map((l) => l.id) : [])}
                  />
                </th>
                <th className="px-3 py-2.5 font-semibold">Fût</th>
                <th className="px-3 py-2.5 text-right font-semibold">Qté vides</th>
                <th className="px-3 py-2.5 font-semibold">Événement source</th>
                <th className="px-3 py-2.5 font-semibold">Espace</th>
                <th className="px-3 py-2.5 text-right font-semibold">Retourné le</th>
                <th className="px-3 py-2.5 text-right font-semibold">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pr-stone">
              {lines.map((l) => (
                <tr key={l.id} className="hover:bg-pr-cream/40">
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      aria-label={`Sélectionner ${l.product_name}`}
                      checked={selected.includes(l.id)}
                      onChange={(e) =>
                        setSelected((prev) => (e.target.checked ? [...prev, l.id] : prev.filter((id) => id !== l.id)))
                      }
                    />
                  </td>
                  <td className="px-3 py-2.5 font-medium text-pr-black">{l.product_name}</td>
                  <td className="px-3 py-2.5 text-right font-medium text-pr-rust">{l.qty}</td>
                  <td className="px-3 py-2.5 text-pr-black-soft/60">{l.event_name ?? '—'}</td>
                  <td className="px-3 py-2.5 text-pr-black-soft/60">{l.space_name ?? '—'}</td>
                  <td className="px-3 py-2.5 text-right text-pr-black-soft/50">{frDate(l.returned_empty_at)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <Badge tone="danger">À retourner</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Historique retours */}
      {(history.data ?? []).length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-pr-black-soft/60">
            Historique retours fournisseur
          </h3>
          <ul className="divide-y divide-pr-stone rounded-xl border border-pr-stone bg-white text-sm">
            {(history.data ?? []).map((h) => (
              <li key={h.id} className="flex items-center justify-between px-4 py-2">
                <span className="text-pr-black">{h.product_name}</span>
                <span className="text-pr-black-soft/60">
                  {h.qty} fût(s) · {frDate(h.returned_to_supplier_at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Barre d'action groupée */}
      {selected.length > 0 && (
        <div className="fixed bottom-24 left-1/2 z-30 flex -translate-x-1/2 items-center gap-4 rounded-xl bg-pr-black px-6 py-3 text-pr-white shadow-xl md:bottom-6">
          <span className="text-sm">{selected.length} fût(s) sélectionné(s)</span>
          <Button loading={marking} onClick={handleReturn} variant="secondary" size="sm">
            <CheckCircle2 className="h-4 w-4" /> Marquer retournés au fournisseur
          </Button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Modale dispatch ─────────────────────────── */

function DispatchKegModal({ keg, onClose }: { keg: KegSummaryRow; onClose: () => void }) {
  const events = useOpenEventsForDispatch();
  const { dispatchKegs, dispatching } = useKegMutations();
  const [eventId, setEventId] = useState('');
  const [spaceId, setSpaceId] = useState('');
  const [qty, setQty] = useState('1');
  const [responsable, setResponsable] = useState('');
  const [error, setError] = useState<string | null>(null);

  const eventOptions = useMemo(
    () => (events.data ?? []).map((e) => ({ value: e.event_id, label: e.event_name })),
    [events.data],
  );
  const spaceOptions = useMemo(() => {
    const ev = (events.data ?? []).find((e) => e.event_id === eventId);
    return (ev?.spaces ?? []).map((s) => ({ value: s.space_id, label: s.space_name }));
  }, [events.data, eventId]);

  const qtyNum = Number(qty) || 0;
  const value = keg.unit_price_ht != null ? qtyNum * keg.unit_price_ht : null;

  async function handleDispatch() {
    setError(null);
    if (!eventId) return setError('Sélectionnez un événement.');
    if (!spaceId) return setError('Sélectionnez un espace.');
    if (qtyNum < 1 || qtyNum > keg.pleins) return setError(`Quantité entre 1 et ${keg.pleins}.`);
    if (responsable.trim().length < 2) return setError('Responsable requis (RG-001).');
    try {
      await dispatchKegs({
        productId: keg.product_id,
        qty: qtyNum,
        eventId,
        spaceId,
        responsable,
        unitPriceHt: keg.unit_price_ht,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors du dispatch.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <h2 className="flex items-center gap-2 font-display text-lg font-black text-pr-black">
            <Send className="h-5 w-5 text-pr-olive-dark" /> Dispatcher — {keg.product_name}
          </h2>
          <button onClick={onClose} aria-label="Fermer" className="text-pr-black-soft/40 hover:text-pr-black">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && <Alert variant="error" className="mb-3">{error}</Alert>}

        <div className="mb-3 rounded-lg border border-pr-olive/30 bg-pr-olive/5 p-3 text-sm text-pr-olive-dark">
          {keg.pleins} fût(s) plein(s) disponible(s)
        </div>

        <div className="space-y-3">
          <Select
            label="Événement *"
            placeholder="Sélectionner un événement"
            options={eventOptions}
            value={eventId}
            onChange={(e) => {
              setEventId(e.target.value);
              setSpaceId('');
            }}
          />
          <Select
            label="Espace destination *"
            placeholder="Sélectionner l'espace"
            options={spaceOptions}
            value={spaceId}
            onChange={(e) => setSpaceId(e.target.value)}
          />
          <Input
            type="number"
            min="1"
            max={String(keg.pleins)}
            label="Quantité à dispatcher *"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <Input
            label="Responsable livraison *"
            placeholder="Prénom NOM"
            value={responsable}
            onChange={(e) => setResponsable(e.target.value)}
          />

          <div className="rounded-lg bg-pr-cream/60 p-3 text-sm text-pr-black-soft/80">
            Valeur dispatché :{' '}
            {value != null ? (
              <span className="font-medium text-pr-black">
                {qtyNum} × {keg.unit_price_ht?.toFixed(2)} € = {formatEuro(value)}
              </span>
            ) : (
              '—'
            )}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button loading={dispatching} onClick={handleDispatch}>
            <Send className="h-4 w-4" /> Dispatcher {qtyNum} fût(s)
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Modale purge tireuses ─────────────────────────── */

interface PurgeLine { product_id: string; produit: string; qty: number; pu_ht: number | null; cout_ht: number }

function ConsumePurgeModal({
  keg, kegs, onClose, onDone,
}: {
  keg: KegSummaryRow | null;
  kegs: KegSummaryRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const events = useOpenEventsForDispatch();
  const [eventId, setEventId] = useState('');
  const [productId, setProductId] = useState(keg?.product_id ?? '');
  const [qty, setQty] = useState('1');
  const [responsable, setResponsable] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [purges, setPurges] = useState<PurgeLine[]>([]);

  const eventOptions = useMemo(
    () => (events.data ?? []).map((e) => ({ value: e.event_id, label: e.event_name })),
    [events.data],
  );
  const kegOptions = useMemo(
    () => kegs.filter((k) => k.pleins > 0).map((k) => ({ value: k.product_id, label: k.product_name })),
    [kegs],
  );
  const selectedKeg = kegs.find((k) => k.product_id === productId) ?? keg;
  const dispo = selectedKeg?.pleins ?? 0;
  const pu = selectedKeg?.unit_price_ht ?? null;
  const qtyNum = Number(qty) || 0;
  const value = pu != null ? qtyNum * pu : null;

  const loadPurges = useCallback(async () => {
    if (!eventId) { setPurges([]); return; }
    const { data } = await supabase.rpc('get_event_purges', { p_event: eventId });
    setPurges((data as PurgeLine[] | null) ?? []);
  }, [eventId]);
  useEffect(() => { void loadPurges(); }, [loadPurges]);

  async function consume() {
    setError(null);
    if (!eventId) return setError('Sélectionnez un événement.');
    if (!productId) return setError('Sélectionnez un fût.');
    if (qtyNum < 1 || qtyNum > dispo) return setError(`Quantité entre 1 et ${dispo}.`);
    if (responsable.trim().length < 2) return setError('Responsable requis (RG-001).');
    setBusy(true);
    const { data, error: err } = await supabase.rpc('consume_fut_purge', {
      p_event: eventId, p_product: productId, p_qty: qtyNum, p_by: responsable.trim(), p_note: 'Purge tireuse',
    });
    setBusy(false);
    const res = data as { success?: boolean; error?: string; cout_ht?: number } | null;
    if (err || !res?.success) return setError(res?.error ?? err?.message ?? 'Erreur lors de la purge.');
    onDone();
    await loadPurges();
    setQty('1');
  }

  async function cancel(pid: string, q: number) {
    if (!window.confirm('Annuler cette purge ? Les fûts seront restaurés et la charge retirée.')) return;
    setError(null);
    setBusy(true);
    const { data, error: err } = await supabase.rpc('cancel_fut_purge', {
      p_event: eventId, p_product: pid, p_qty: q, p_by: responsable.trim() || 'Stade',
    });
    setBusy(false);
    const res = data as { success?: boolean; error?: string } | null;
    if (err || !res?.success) return setError(res?.error ?? err?.message ?? 'Erreur lors de l\'annulation.');
    onDone();
    await loadPurges();
  }

  const totalPurges = purges.reduce((s, p) => s + (Number(p.cout_ht) || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <h2 className="flex items-center gap-2 font-display text-lg font-black text-pr-black">
            <FlaskConical className="h-5 w-5 text-amber-600" /> Purge tireuses
          </h2>
          <button onClick={onClose} aria-label="Fermer" className="text-pr-black-soft/40 hover:text-pr-black">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && <Alert variant="error" className="mb-3">{error}</Alert>}

        <div className="space-y-3">
          <Select
            label="Événement *"
            placeholder="Sélectionner un événement"
            options={eventOptions}
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
          />
          <Select
            label="Fût à consommer *"
            placeholder="Sélectionner un fût"
            options={kegOptions}
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
          />
          {selectedKeg && (
            <div className="rounded-lg border border-amber-300/50 bg-amber-50 p-3 text-sm text-amber-800">
              {dispo} fût(s) plein(s) disponible(s)
            </div>
          )}
          <Input
            type="number" min="1" max={String(dispo)}
            label="Quantité à consommer *"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <Input
            label="Responsable *"
            placeholder="Prénom NOM"
            value={responsable}
            onChange={(e) => setResponsable(e.target.value)}
          />
          <div className="rounded-lg bg-pr-cream/60 p-3 text-sm text-pr-black-soft/80">
            Valeur consommée (imputée F&B / Bières) :{' '}
            {value != null ? (
              <span className="font-medium text-pr-black">{qtyNum} × {pu?.toFixed(2)} € = {formatEuro(value)}</span>
            ) : '—'}
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Fermer</Button>
          <Button loading={busy} onClick={() => void consume()}>
            <FlaskConical className="h-4 w-4" /> Consommer {qtyNum} fût(s)
          </Button>
        </div>

        {/* Récap des purges de l'événement */}
        {eventId && (
          <div className="mt-5 border-t border-pr-stone pt-4">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-pr-black-soft/60">
              Purges de cet événement
            </h3>
            {purges.length === 0 ? (
              <p className="text-sm text-pr-black-soft/50">Aucune purge enregistrée.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-pr-black-soft/50">
                    <th className="py-1">Fût</th>
                    <th className="py-1 text-right">Qté</th>
                    <th className="py-1 text-right">Coût HT</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-pr-stone">
                  {purges.map((p) => (
                    <tr key={p.product_id}>
                      <td className="py-1.5 font-medium text-pr-black">{p.produit}</td>
                      <td className="py-1.5 text-right">{p.qty}</td>
                      <td className="py-1.5 text-right font-semibold">{formatEuro(Number(p.cout_ht) || 0)}</td>
                      <td className="py-1.5 text-right">
                        <button
                          onClick={() => void cancel(p.product_id, p.qty)}
                          disabled={busy}
                          title="Annuler la purge"
                          className="rounded-lg p-1 text-pr-black-soft/40 hover:bg-pr-rust/10 hover:text-pr-rust disabled:opacity-40"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  <tr className="font-bold text-pr-black">
                    <td className="py-1.5" colSpan={2}>Total imputé F&B</td>
                    <td className="py-1.5 text-right">{formatEuro(totalPurges)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── Modale réception ─────────────────────────── */

interface ReceiveLine {
  key: string;
  productId: string;
  qty: string;
}

function KegReceiveModal({ onClose }: { onClose: () => void }) {
  const summary = useKegSummary();
  const { receiveFutDelivery, receiving } = useKegMutations();
  const [lines, setLines] = useState<ReceiveLine[]>(() => [{ key: crypto.randomUUID(), productId: '', qty: '' }]);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(
    () => (summary.data?.kegs ?? []).map((k) => ({ value: k.product_id, label: k.product_name })),
    [summary.data],
  );
  const priceById = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const k of summary.data?.kegs ?? []) m.set(k.product_id, k.unit_price_ht);
    return m;
  }, [summary.data]);

  function update(key: string, patch: Partial<ReceiveLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function handleReceive() {
    setError(null);
    const payload = lines
      .filter((l) => l.productId && Number(l.qty) > 0)
      .map((l) => ({ productId: l.productId, qty: Number(l.qty), unitPriceHt: priceById.get(l.productId) ?? null }));
    if (payload.length === 0) return setError('Ajoutez au moins un fût (quantité > 0).');
    try {
      await receiveFutDelivery(payload);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la réception.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <h2 className="flex items-center gap-2 font-display text-lg font-black text-pr-black">
            <Truck className="h-5 w-5 text-pr-olive-dark" /> Réceptionner des fûts
          </h2>
          <button onClick={onClose} aria-label="Fermer" className="text-pr-black-soft/40 hover:text-pr-black">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && <Alert variant="error" className="mb-3">{error}</Alert>}

        <div className="space-y-2">
          {lines.map((l) => (
            <div key={l.key} className="grid grid-cols-[1fr_6rem_auto] items-end gap-2">
              <Select
                label="Fût"
                placeholder="Sélectionner…"
                options={options}
                value={l.productId}
                onChange={(e) => update(l.key, { productId: e.target.value })}
              />
              <Input
                type="number"
                min="0"
                label="Qté reçue"
                value={l.qty}
                onChange={(e) => update(l.key, { qty: e.target.value })}
              />
              <button
                type="button"
                onClick={() => setLines((prev) => (prev.length > 1 ? prev.filter((x) => x.key !== l.key) : prev))}
                aria-label="Retirer"
                className="mb-1 inline-flex h-9 w-9 items-center justify-center rounded-lg text-pr-black-soft/40 hover:bg-pr-rust/10 hover:text-pr-rust disabled:opacity-30"
                disabled={lines.length <= 1}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        <Button
          variant="secondary"
          size="sm"
          className="mt-2"
          onClick={() => setLines((prev) => [...prev, { key: crypto.randomUUID(), productId: '', qty: '' }])}
        >
          + Ajouter un fût
        </Button>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button loading={receiving} onClick={handleReceive}>
            <PackageCheck className="h-4 w-4" /> Enregistrer la réception
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── KPI ─────────────────────────── */

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'default',
}: {
  label: string;
  value: string;
  sub: string;
  icon: LucideIcon;
  tone?: 'default' | 'success';
}) {
  return (
    <div
      className={clsx(
        'rounded-xl border border-t-[3px] border-pr-stone bg-white p-4',
        tone === 'success' ? 'border-t-emerald-500' : 'border-t-pr-olive',
      )}
    >
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-pr-olive-dark">{label}</p>
        <Icon className={clsx('h-4 w-4 shrink-0', tone === 'success' ? 'text-emerald-500' : 'text-pr-olive-dark')} />
      </div>
      <p className="mt-1 font-display text-2xl font-black text-pr-black">{value}</p>
      <p className="mt-0.5 truncate text-xs text-pr-black-soft/50">{sub}</p>
    </div>
  );
}
