import { useState } from 'react';
import { ChevronLeft, ChevronRight, History } from 'lucide-react';
import { useMovements, MOVEMENTS_PAGE_SIZE } from '@/hooks/useMovements';
import {
  Badge,
  Button,
  EmptyState,
  Spinner,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui';
import type { Product, StatusTone } from '@/lib/types';

// Type de mouvement → tonalité de pastille (lecture homogène, apaisée).
const TYPE_TONE: Record<string, StatusTone> = {
  entrée_fournisseur: 'success',
  retour: 'success',
  retour_réutilisable: 'success',
  réassort_événement: 'info',
  retour_fournisseur: 'info',
  sortie: 'danger',
  consommation: 'warning',
  correction: 'neutral',
  inventaire: 'neutral',
};
// Sens du flux pour la quantité (signe + couleur).
const INBOUND = new Set(['entrée_fournisseur', 'retour', 'retour_réutilisable', 'réassort_événement']);
const OUTBOUND = new Set(['sortie', 'consommation', 'retour_fournisseur']);
const prettyType = (t: string) => t.replace(/_/g, ' ');

function fmtDate(iso: string): { d: string; t: string } {
  const dt = new Date(iso);
  return {
    d: dt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }),
    t: dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
  };
}

export function MovementHistory({
  eventId,
  spaceId,
  productMap,
}: {
  eventId: string;
  spaceId: string;
  productMap: Map<string, Product>;
}) {
  const [page, setPage] = useState(0);
  const { data, isLoading, isFetching } = useMovements(eventId, spaceId, page);

  if (isLoading) return <Spinner label="Chargement de l'historique…" />;

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const maxPage = Math.max(0, Math.ceil(total / MOVEMENTS_PAGE_SIZE) - 1);

  if (total === 0) {
    return (
      <EmptyState
        icon={History}
        title="Aucun mouvement"
        message="Aucun mouvement de stock enregistré pour cet espace."
      />
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-pr-black-soft/40" />
        <h3 className="font-display text-sm font-bold text-pr-black">Historique des mouvements</h3>
        <span className="rounded-full bg-pr-stone/60 px-2 py-0.5 text-xs font-semibold text-pr-black-soft/60">{total}</span>
      </div>

      <Table>
        <THead>
          <TR>
            <TH className="w-[92px]">Date</TH>
            <TH className="w-[150px]">Type</TH>
            <TH>Produit</TH>
            <TH className="w-[80px] text-right">Qté</TH>
            <TH className="w-[130px]">Responsable</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((m) => {
            const { d, t } = fmtDate(m.created_at);
            const inbound = INBOUND.has(m.movement_type);
            const outbound = OUTBOUND.has(m.movement_type);
            const sign = inbound ? '+' : outbound ? '−' : '';
            const qtyColor = inbound ? 'text-pr-olive' : outbound ? 'text-pr-rust' : 'text-pr-black-soft/60';
            return (
              <TR key={m.movement_id} className="transition-colors hover:bg-pr-cream/60">
                <TD className="whitespace-nowrap">
                  <span className="tabular-nums text-pr-black-soft/80">{d}</span>
                  <span className="ml-1 text-xs tabular-nums text-pr-black-soft/40">{t}</span>
                </TD>
                <TD>
                  <Badge tone={TYPE_TONE[m.movement_type] ?? 'neutral'} className="capitalize">
                    {prettyType(m.movement_type)}
                  </Badge>
                </TD>
                <TD className="font-medium text-pr-black">
                  {productMap.get(m.product_id)?.product_name ?? m.product_id}
                </TD>
                <TD className={`text-right font-semibold tabular-nums ${qtyColor}`}>
                  {sign}{m.qty}
                </TD>
                <TD>
                  <span className="text-xs font-medium uppercase tracking-wide text-pr-black-soft/50">
                    {m.responsable_nom}
                  </span>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>

      {maxPage > 0 && (
        <div className="flex items-center justify-between">
          <Button
            size="sm"
            variant="ghost"
            disabled={page === 0 || isFetching}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" /> Précédent
          </Button>
          <span className="text-xs text-pr-black-soft/50">
            Page {page + 1} / {maxPage + 1}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={page >= maxPage || isFetching}
            onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
          >
            Suivant <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
