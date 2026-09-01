/**
 * Onglet « Inventaire » du module Stock (CDC V2 §5).
 * Machine à états : 'idle' (historique + démarrage) ↔ 'counting' (comptage en cours).
 * RG-001 : responsable_nom obligatoire (≥ 2 car.).
 * RG-004 : commentaire obligatoire dès qu'un écart est constaté.
 */
import { Fragment, useMemo, useState } from 'react';
import { Plus, ClipboardList, ChevronDown, ChevronRight } from 'lucide-react';
import {
  Button,
  Badge,
  Alert,
  Input,
  Select,
  Textarea,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
  EmptyState,
  Spinner,
} from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';
import {
  useStockLocations,
  useStockBalances,
  useInventorySessions,
  useUnresolvedVarianceCount,
  useSaveInventory,
} from '@/hooks/useStockV2';
import { computeInventoryVariance } from '@/lib/stockCalculations';

/** Ligne de comptage local (état éditable). */
interface CountLine {
  productId: string;
  productName: string;
  category: string;
  unit: string;
  theoretical: number;
  real: number;
  comment: string;
}

/** Ordre & libellé des familles pour le pointage (fûts pointés avec les bières). */
const FAMILY_ORDER: Record<string, number> = {
  Bières: 0,
  Soft: 1,
  Sirops: 2,
  Spiritueux: 3,
  Vins: 4,
  Matériel: 5,
};
const FAMILY_LABEL: Record<string, string> = {
  Bières: '🍺 Bières & Fûts',
  Soft: '🥤 Softs',
  Sirops: '🫙 Sirops',
  Spiritueux: '🥃 Spiritueux',
  Vins: '🍷 Vins',
  Matériel: '📦 Matériel',
};
const familyRank = (category: string): number => FAMILY_ORDER[category] ?? 99;

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

/** Couleur de l'écart : 0 neutre, positif emerald, négatif rust. */
const varianceClass = (variance: number): string => {
  if (variance > 0) return 'text-emerald-600 font-semibold';
  if (variance < 0) return 'text-pr-rust font-semibold';
  return 'text-pr-black-soft';
};

export default function StockInventory() {
  const { showToast } = useToast();
  const { user } = useAuth();
  const { data: locations } = useStockLocations();
  const { data: sessions } = useInventorySessions();
  const { data: unresolved } = useUnresolvedVarianceCount();
  const { saveInventory, saving } = useSaveInventory();

  const [view, setView] = useState<'idle' | 'counting'>('idle');
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);

  // ── Sélection de l'emplacement (phase de démarrage) ──
  const [selecting, setSelecting] = useState(false);
  const [locationId, setLocationId] = useState('');
  const { data: balances, isLoading: balancesLoading } =
    useStockBalances(locationId || undefined);

  // ── État du comptage en cours ──
  const [responsible, setResponsible] = useState(user?.name ?? '');
  const [lines, setLines] = useState<CountLine[]>([]);

  const locationOptions = useMemo(
    () => (locations ?? []).map((l) => ({ value: l.id, label: l.name })),
    [locations],
  );

  // Regroupe les comptages historiques par session.
  const groupedSessions = useMemo(() => {
    const map = new Map<string, NonNullable<typeof sessions>>();
    for (const line of sessions ?? []) {
      const key = line.inventory_session_id ?? line.id;
      const bucket = map.get(key);
      if (bucket) bucket.push(line);
      else map.set(key, [line]);
    }
    return Array.from(map.entries()).sort(
      (a, b) =>
        new Date(b[1][0].counted_at).getTime() -
        new Date(a[1][0].counted_at).getTime(),
    );
  }, [sessions]);

  // ── Actions ──
  const beginSelection = () => {
    setSelecting(true);
    setLocationId('');
    setResponsible(user?.name ?? '');
    setLines([]);
  };

  const seedFromBalances = () => {
    const seeded: CountLine[] = (balances ?? [])
      .filter((b) => b.product)
      .map((b) => ({
        productId: b.product_id,
        productName: b.product?.product_name ?? '—',
        category: b.product?.category ?? 'Autre',
        unit: b.product?.unit ?? '',
        theoretical: b.current_quantity,
        real: b.current_quantity,
        comment: '',
      }))
      // Tri par famille (fûts en tête des bières), puis alphabétique — pointage rapide.
      .sort((a, b) => {
        const fr = familyRank(a.category) - familyRank(b.category);
        if (fr !== 0) return fr;
        const ua = a.unit === 'fût' ? 0 : 1;
        const ub = b.unit === 'fût' ? 0 : 1;
        if (ua !== ub) return ua - ub;
        return a.productName.localeCompare(b.productName, 'fr');
      });
    setLines(seeded);
    setSelecting(false);
    setView('counting');
  };

  const resetToIdle = () => {
    setView('idle');
    setSelecting(false);
    setLocationId('');
    setLines([]);
  };

  const updateLine = (productId: string, patch: Partial<CountLine>) => {
    setLines((prev) =>
      prev.map((l) => (l.productId === productId ? { ...l, ...patch } : l)),
    );
  };

  const missingComment = lines.some(
    (l) =>
      computeInventoryVariance(l.real, l.theoretical) !== 0 &&
      l.comment.trim().length === 0,
  );
  const responsibleValid = responsible.trim().length >= 2;
  const canValidate = responsibleValid && !missingComment && lines.length > 0;

  const handleValidate = async () => {
    if (!canValidate) return;
    await saveInventory({
      locationId,
      responsibleName: responsible.trim(),
      lines: lines.map((l) => ({
        productId: l.productId,
        theoreticalQty: l.theoretical,
        realQty: l.real,
        comment: l.comment.trim() ? l.comment.trim() : null,
      })),
    });
    showToast('Inventaire enregistré avec succès.', 'success');
    resetToIdle();
  };

  // ════════════════════════════════════════════════════════════
  // VUE COMPTAGE
  // ════════════════════════════════════════════════════════════
  if (view === 'counting') {
    const locationName =
      (locations ?? []).find((l) => l.id === locationId)?.name ?? 'Emplacement';

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl text-pr-black">
            Comptage en cours — {locationName}
          </h2>
          <Button variant="ghost" onClick={resetToIdle} disabled={saving}>
            Annuler
          </Button>
        </div>

        <div className="max-w-sm">
          <Input
            label="Responsable du comptage"
            value={responsible}
            onChange={(e) => setResponsible(e.target.value)}
            error={
              responsibleValid ? undefined : 'Nom requis (2 caractères min.).'
            }
            hint="Traçabilité nominative obligatoire (RG-001)."
          />
        </div>

        {missingComment && (
          <Alert variant="warning" title="Écart non justifié">
            Chaque écart constaté doit être commenté avant validation (RG-004).
          </Alert>
        )}

        <Table>
          <THead>
            <TR>
              <TH>Produit</TH>
              <TH className="text-right">Théorique</TH>
              <TH className="text-right">Réel</TH>
              <TH className="text-right">Écart</TH>
              <TH>Commentaire</TH>
            </TR>
          </THead>
          <TBody>
            {lines.map((l, idx) => {
              const variance = computeInventoryVariance(l.real, l.theoretical);
              const needsComment = variance !== 0;
              const showFamily = idx === 0 || lines[idx - 1].category !== l.category;
              return (
                <Fragment key={l.productId}>
                {showFamily && (
                  <tr className="bg-pr-cream/70">
                    <td
                      colSpan={5}
                      className="px-3 py-2 font-display text-xs font-bold uppercase tracking-wide text-pr-black-soft/60"
                    >
                      {FAMILY_LABEL[l.category] ?? l.category}
                    </td>
                  </tr>
                )}
                <TR>
                  <TD className="font-medium text-pr-black">{l.productName}</TD>
                  <TD className="text-right tabular-nums">{l.theoretical}</TD>
                  <TD className="text-right">
                    <Input
                      type="number"
                      value={String(l.real)}
                      onChange={(e) =>
                        updateLine(l.productId, {
                          real: Number(e.target.value) || 0,
                        })
                      }
                      className="w-24 text-right"
                    />
                  </TD>
                  <TD className={`text-right tabular-nums ${varianceClass(variance)}`}>
                    {variance > 0 ? `+${variance}` : variance}
                  </TD>
                  <TD>
                    <Textarea
                      value={l.comment}
                      onChange={(e) =>
                        updateLine(l.productId, { comment: e.target.value })
                      }
                      rows={1}
                      placeholder={
                        needsComment ? 'Justification requise…' : 'Optionnel'
                      }
                      error={
                        needsComment && l.comment.trim().length === 0
                          ? 'Requis'
                          : undefined
                      }
                    />
                  </TD>
                </TR>
                </Fragment>
              );
            })}
          </TBody>
        </Table>

        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={resetToIdle} disabled={saving}>
            Annuler
          </Button>
          <Button
            variant="primary"
            onClick={handleValidate}
            loading={saving}
            disabled={!canValidate}
          >
            Valider l'inventaire
          </Button>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════
  // VUE DÉMARRAGE (sélection d'emplacement)
  // ════════════════════════════════════════════════════════════
  if (selecting) {
    return (
      <div className="space-y-6">
        <h2 className="font-display text-xl text-pr-black">
          Démarrer un inventaire
        </h2>
        <Alert variant="info" title="Comptage physique">
          Sélectionnez l'emplacement à inventorier. Les quantités théoriques
          seront pré-remplies depuis le stock courant.
        </Alert>

        <div className="max-w-sm">
          <Select
            label="Emplacement"
            placeholder="Choisir un emplacement…"
            options={locationOptions}
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          />
        </div>

        {locationId && balancesLoading && (
          <Spinner label="Chargement du stock…" />
        )}

        {locationId && !balancesLoading && (balances?.length ?? 0) === 0 && (
          <Alert variant="warning" title="Aucun stock">
            Cet emplacement ne contient aucune ligne de stock à inventorier.
          </Alert>
        )}

        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={resetToIdle}>
            Annuler
          </Button>
          <Button
            variant="primary"
            onClick={seedFromBalances}
            disabled={
              !locationId || balancesLoading || (balances?.length ?? 0) === 0
            }
          >
            Commencer le comptage
          </Button>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════
  // VUE IDLE (historique)
  // ════════════════════════════════════════════════════════════
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="font-display text-xl text-pr-black">
            Historique des inventaires
          </h2>
          {(unresolved ?? 0) > 0 && (
            <Badge tone="danger">
              {unresolved} écart{(unresolved ?? 0) > 1 ? 's' : ''} non résolu
              {(unresolved ?? 0) > 1 ? 's' : ''}
            </Badge>
          )}
        </div>
        <Button variant="primary" onClick={beginSelection}>
          <Plus className="mr-1.5 h-4 w-4" />
          Démarrer un inventaire
        </Button>
      </div>

      {groupedSessions.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Aucun inventaire"
          message="Lancez votre premier comptage physique pour suivre les écarts de stock."
          action={
            <Button variant="primary" onClick={beginSelection}>
              <Plus className="mr-1.5 h-4 w-4" />
              Démarrer un inventaire
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {groupedSessions.map(([sessionId, sessionLines]) => {
            const first = sessionLines[0];
            const totalVariance = sessionLines.reduce(
              (sum, l) => sum + (l.variance ?? 0),
              0,
            );
            const hasVariance = sessionLines.some((l) => (l.variance ?? 0) !== 0);
            const isOpen = openSessionId === sessionId;
            return (
              <div
                key={sessionId}
                className="rounded-lg border border-pr-stone/40 bg-pr-white"
              >
                <button
                  type="button"
                  onClick={() =>
                    setOpenSessionId(isOpen ? null : sessionId)
                  }
                  className="flex w-full items-center gap-4 px-4 py-3 text-left"
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-pr-olive" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-pr-olive" />
                  )}
                  <span className="w-32 shrink-0 text-sm text-pr-black-soft">
                    {formatDate(first.counted_at)}
                  </span>
                  <span className="flex-1 font-medium text-pr-black">
                    {first.location?.name ?? '—'}
                  </span>
                  <span className="hidden text-sm text-pr-black-soft sm:block">
                    {first.responsible_name}
                  </span>
                  <span className="hidden text-sm text-pr-black-soft md:block">
                    {sessionLines.length} ligne
                    {sessionLines.length > 1 ? 's' : ''}
                  </span>
                  <span
                    className={`w-16 text-right text-sm tabular-nums ${varianceClass(
                      totalVariance,
                    )}`}
                  >
                    {totalVariance > 0 ? `+${totalVariance}` : totalVariance}
                  </span>
                  <Badge tone={hasVariance ? 'danger' : 'success'}>
                    {hasVariance ? 'Écarts' : 'Conforme'}
                  </Badge>
                </button>

                {isOpen && (
                  <div className="border-t border-pr-stone/40 px-4 py-3">
                    <Table>
                      <THead>
                        <TR>
                          <TH>Produit</TH>
                          <TH className="text-right">Théorique</TH>
                          <TH className="text-right">Réel</TH>
                          <TH className="text-right">Écart</TH>
                          <TH>Commentaire</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {sessionLines.map((l) => {
                          const variance = l.variance ?? 0;
                          return (
                            <TR key={l.id}>
                              <TD className="font-medium text-pr-black">
                                {l.product?.product_name ?? '—'}
                              </TD>
                              <TD className="text-right tabular-nums">
                                {l.theoretical_qty ?? '—'}
                              </TD>
                              <TD className="text-right tabular-nums">
                                {l.real_qty ?? '—'}
                              </TD>
                              <TD
                                className={`text-right tabular-nums ${varianceClass(
                                  variance,
                                )}`}
                              >
                                {variance > 0 ? `+${variance}` : variance}
                              </TD>
                              <TD className="text-pr-black-soft">
                                {l.comment ?? '—'}
                              </TD>
                            </TR>
                          );
                        })}
                      </TBody>
                    </Table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
