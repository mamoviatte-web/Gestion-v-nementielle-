import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMovements, MOVEMENTS_PAGE_SIZE } from '@/hooks/useMovements';
import {
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
import { History } from 'lucide-react';
import type { Product } from '@/lib/types';

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
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-600">
        Historique des mouvements ({total})
      </h3>
      <Table>
        <THead>
          <TR>
            <TH>Date</TH>
            <TH>Type</TH>
            <TH>Produit</TH>
            <TH className="text-right">Qté</TH>
            <TH>Responsable</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((m) => (
            <TR key={m.movement_id}>
              <TD>{new Date(m.created_at).toLocaleString('fr-FR')}</TD>
              <TD>{m.movement_type}</TD>
              <TD>{productMap.get(m.product_id)?.product_name ?? m.product_id}</TD>
              <TD className="text-right">{m.qty}</TD>
              <TD>{m.responsable_nom}</TD>
            </TR>
          ))}
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
          <span className="text-xs text-slate-500">
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
