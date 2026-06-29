/**
 * RunnerTerrainView — vue terrain publique (par jeton), mobile-first.
 * Route publique : /runner/:token
 *
 * Lecture via la vue `runner_terrain_public` (sans coût — RG-003), accessible
 * en anonyme. Les mises à jour terrain (préparé/livré, quantités prises/
 * retournées) passent par le back-office Stade : voir note ci-dessous.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Boxes } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { RUNNER_STATUS_LABELS } from '@/lib/runnerCalculations';
import { Alert, Badge, EmptyState, Spinner } from '@/components/ui';
import type { RunnerTerrainRow } from '@/lib/types';

export default function RunnerTerrainView() {
  const { token } = useParams<{ token: string }>();
  const [rows, setRows] = useState<RunnerTerrainRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error: e } = await supabase
        .from('runner_terrain_public')
        .select('*')
        .eq('terrain_token', token);
      if (!active) return;
      if (e) setError(e.message);
      else setRows((data ?? []) as RunnerTerrainRow[]);
    })();
    return () => {
      active = false;
    };
  }, [token]);

  if (error) {
    return (
      <div className="p-4">
        <Alert variant="error" title="Fiche introuvable">{error}</Alert>
      </div>
    );
  }
  if (rows === null) return <Spinner fullPage label="Chargement…" />;

  return (
    <div className="mx-auto max-w-md p-4">
      <header className="mb-4 rounded-lg bg-provence p-4 text-white">
        <h1 className="text-lg font-bold">Fiche runner</h1>
        <p className="text-xs text-slate-300">Dotations à monter par produit</p>
      </header>

      {rows.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="Aucune ligne"
          message="Cette fiche n'est pas encore transmise ou le lien est invalide."
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-lg bg-white p-4 ring-1 ring-slate-200"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">{r.product_name}</p>
                <p className="text-sm text-slate-500">
                  À monter : <strong>{r.quantity_to_move ?? r.validated_quantity ?? 0}</strong>{' '}
                  {r.unit}
                </p>
                {r.responsible_name && (
                  <p className="text-xs text-slate-400">Resp. : {r.responsible_name}</p>
                )}
              </div>
              <Badge tone="info">{RUNNER_STATUS_LABELS[r.validation_status]}</Badge>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-center text-xs text-slate-400">
        Saisie des quantités prises/retournées : via le poste Stade.
      </p>
    </div>
  );
}
