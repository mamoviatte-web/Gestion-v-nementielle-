import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MapPin,
  Copy,
  Upload,
  ExternalLink,
  CheckCircle2,
  Clock,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { Button, Badge, EmptyState, Spinner } from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { supabase } from '@/lib/supabase';
import { uploadFeuilleRoute, saveFeuilleRoute, regenerateZoneToken } from '@/lib/zoneApi';
import type { Event } from '@/lib/types';
import type { EventSpaceWithSpace } from '@/hooks/useEvents';

interface SpaceStatusMaps {
  hasInitial: Record<string, boolean>;
  hasFinal: Record<string, boolean>;
  hasDebrief: Record<string, boolean>;
}

const EMPTY_STATUS: SpaceStatusMaps = {
  hasInitial: {},
  hasFinal: {},
  hasDebrief: {},
};

interface StockLineRow {
  space_id: string;
  final_qty: number | null;
}

interface DebriefRow {
  space_id: string;
  submitted_at: string | null;
}

/**
 * Onglet admin « Espaces & codes » d'un séminaire.
 * Affiche pour chaque espace mobilisé son code d'accès, un lien direct,
 * son statut de saisie, le responsable et l'upload de sa feuille de route.
 */
export function SeminaireSpacesTab({
  event,
  spaces,
}: {
  event: Event;
  spaces: EventSpaceWithSpace[];
}) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [regenerating, setRegenerating] = useState<Record<string, boolean>>({});
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const handleRegenerate = async (spaceId: string) => {
    setRegenerating((prev) => ({ ...prev, [spaceId]: true }));
    try {
      const token = await regenerateZoneToken(event.event_id, spaceId, event.event_date);
      showToast(`Nouveau lien généré (${token}).`, 'success');
      await queryClient.invalidateQueries({ queryKey: ['eventSpaces', event.event_id] });
    } catch {
      showToast('Échec de la régénération du lien.', 'warning');
    } finally {
      setRegenerating((prev) => ({ ...prev, [spaceId]: false }));
    }
  };

  const { data: status = EMPTY_STATUS, isLoading } = useQuery<SpaceStatusMaps>({
    queryKey: ['seminaireSpaceStatus', event.event_id],
    queryFn: async () => {
      const hasInitial: Record<string, boolean> = {};
      const hasFinal: Record<string, boolean> = {};
      const hasDebrief: Record<string, boolean> = {};

      const { data: stockLines, error: stockError } = await supabase
        .from('event_stock_lines')
        .select('space_id, final_qty')
        .eq('event_id', event.event_id);

      if (!stockError && stockLines) {
        for (const line of stockLines as StockLineRow[]) {
          hasInitial[line.space_id] = true;
          if (line.final_qty !== null && line.final_qty !== undefined) {
            hasFinal[line.space_id] = true;
          }
        }
      }

      const { data: debriefs, error: debriefError } = await supabase
        .from('debriefs')
        .select('space_id, submitted_at')
        .eq('event_id', event.event_id);

      if (!debriefError && debriefs) {
        for (const debrief of debriefs as DebriefRow[]) {
          if (debrief.submitted_at) {
            hasDebrief[debrief.space_id] = true;
          }
        }
      }

      return { hasInitial, hasFinal, hasDebrief };
    },
  });

  const copyToClipboard = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(message, 'success');
    } catch {
      showToast('Copie impossible.', 'warning');
    }
  };

  const buildLink = (token: string | null | undefined): string =>
    `${window.location.origin}/zone/${token ?? ''}`;

  const handleUpload = async (
    spaceId: string,
    file: File | null | undefined,
  ) => {
    if (!file) return;
    setUploading((prev) => ({ ...prev, [spaceId]: true }));
    try {
      const url = await uploadFeuilleRoute(event.event_id, spaceId, file);
      await saveFeuilleRoute(event.event_id, spaceId, url, file.name);
      showToast('Feuille de route enregistrée.', 'success');
      await queryClient.invalidateQueries({
        queryKey: ['eventSpaces', event.event_id],
      });
    } catch {
      showToast("Échec de l'envoi de la feuille de route.", 'warning');
    } finally {
      setUploading((prev) => ({ ...prev, [spaceId]: false }));
    }
  };

  const copyAllCodes = async () => {
    const lines = spaces.map((es) => {
      const name = es.spaces?.space_name ?? es.space_id;
      const code = es.access_token ?? '—';
      return `${name}: ${code} — ${buildLink(es.access_token)}`;
    });
    await copyToClipboard(lines.join('\n'), 'Tous les codes copiés.');
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-pr-black">
        Espaces mobilisés — {event.event_name}
      </h2>

      {isLoading && <Spinner label="Chargement des statuts…" />}

      {spaces.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="Aucun espace"
          message="Ajoutez des espaces à l'événement."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {spaces.map((es) => {
            const name = es.spaces?.space_name ?? es.space_id;
            const token = es.access_token ?? '';
            const link = buildLink(es.access_token);
            const expired = es.token_expires_at
              ? new Date(es.token_expires_at).getTime() < Date.now()
              : false;
            const isRegen = regenerating[es.space_id] ?? false;
            const initial = status.hasInitial[es.space_id] ?? false;
            const final = status.hasFinal[es.space_id] ?? false;
            const debrief = status.hasDebrief[es.space_id] ?? false;
            const isUploading = uploading[es.space_id] ?? false;

            return (
              <div
                key={es.id}
                className="rounded-lg border border-pr-stone bg-white p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 font-semibold text-pr-black">
                    <MapPin className="h-4 w-4 text-pr-black-soft" aria-hidden />
                    <span>{name}</span>
                  </div>
                  {debrief ? (
                    <Badge tone="success">✅ Terminé</Badge>
                  ) : final ? (
                    <Badge tone="info">Clôture faite</Badge>
                  ) : initial ? (
                    <Badge tone="warning">Ouverture faite</Badge>
                  ) : (
                    <Badge tone="neutral">⏳ En attente</Badge>
                  )}
                </div>

                <div className="mt-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-pr-black-soft">
                    Code d'accès
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="rounded-md bg-pr-cream px-3 py-1.5 text-2xl font-mono tracking-widest text-pr-black">
                      {token || '—'}
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        copyToClipboard(token, 'Code copié.')
                      }
                    >
                      <Copy className="h-4 w-4" aria-hidden />
                      Copier
                    </Button>
                  </div>
                </div>

                <div className="mt-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-pr-black-soft">
                    Lien direct
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-pr-black-soft">
                      {link}
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        copyToClipboard(link, 'Lien copié.')
                      }
                    >
                      <Copy className="h-4 w-4" aria-hidden />
                      Copier le lien
                    </Button>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    {expired ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-pr-rust">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Lien expiré
                      </span>
                    ) : es.token_expires_at ? (
                      <span className="text-xs text-pr-black-soft/70">
                        Valide jusqu'au{' '}
                        {new Date(es.token_expires_at).toLocaleDateString('fr-FR')}
                      </span>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={isRegen}
                      onClick={() => void handleRegenerate(es.space_id)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Régénérer
                    </Button>
                  </div>
                </div>

                <div className="mt-3 text-sm text-pr-black">
                  <span className="text-pr-black-soft">Responsable : </span>
                  <span className="font-medium">
                    {es.space_responsible_name ?? 'non encore saisi'}
                  </span>
                  {(es.space_actual_arrival || es.space_actual_departure) && (
                    <span className="ml-2 text-pr-black-soft">
                      {es.space_actual_arrival?.slice(0, 5) ?? '—'} →{' '}
                      {es.space_actual_departure?.slice(0, 5) ?? '—'}
                    </span>
                  )}
                </div>

                <div className="mt-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-pr-black-soft">
                    Feuille de route
                  </p>
                  {es.feuille_route_url ? (
                    <div className="mt-1 flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">
                        {es.feuille_route_name ?? 'Document'}
                      </span>
                      <a
                        href={es.feuille_route_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-pr-olive-dark hover:underline"
                      >
                        <ExternalLink className="h-4 w-4" aria-hidden />
                        Voir
                      </a>
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-pr-black-soft">
                      Aucune feuille de route.
                    </p>
                  )}
                  <div className="mt-2">
                    <input
                      ref={(node) => {
                        fileInputs.current[es.space_id] = node;
                      }}
                      type="file"
                      accept="application/pdf,image/*"
                      className="hidden"
                      onChange={(e) => {
                        void handleUpload(es.space_id, e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={isUploading}
                      onClick={() =>
                        fileInputs.current[es.space_id]?.click()
                      }
                    >
                      <Upload className="h-4 w-4" aria-hidden />
                      Ajouter / Remplacer
                    </Button>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-1 border-t border-pr-stone pt-3 text-xs text-pr-black-soft">
                  <span className="inline-flex items-center gap-1">
                    Ouverture{' '}
                    {initial ? (
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <Clock className="h-3.5 w-3.5" aria-hidden />
                    )}
                  </span>
                  <span aria-hidden>·</span>
                  <span className="inline-flex items-center gap-1">
                    Clôture{' '}
                    {final ? (
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <Clock className="h-3.5 w-3.5" aria-hidden />
                    )}
                  </span>
                  <span aria-hidden>·</span>
                  <span className="inline-flex items-center gap-1">
                    Débrief{' '}
                    {debrief ? (
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <Clock className="h-3.5 w-3.5" aria-hidden />
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {spaces.length > 0 && (
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => void copyAllCodes()}>
            <Copy className="h-4 w-4" aria-hidden />
            📤 Copier tous les codes
          </Button>
        </div>
      )}
    </div>
  );
}
