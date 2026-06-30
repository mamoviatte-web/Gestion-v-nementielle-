/**
 * RouteSheetPanel (admin) — feuilles de route par espace pour un événement.
 * Upload / remplacement / téléchargement / suppression.
 */

import { useMemo } from 'react';
import { Download, Upload, Trash2, FileText, CheckCircle2 } from 'lucide-react';
import {
  useAttachments,
  useEventCreation,
  getSignedUrl,
} from '@/hooks/useEventCreation';
import { Alert, Badge, Spinner } from '@/components/ui';
import type { EventSpaceWithSpace } from '@/hooks/useEvents';
import type { EventAttachment } from '@/lib/types';

async function openSigned(path: string) {
  const url = await getSignedUrl(path);
  if (url) window.open(url, '_blank', 'noopener');
}

export function RouteSheetPanel({
  eventId,
  spaces,
}: {
  eventId: string;
  spaces: EventSpaceWithSpace[];
}) {
  const attachments = useAttachments(eventId, { type: 'feuille_route_seminaire' });
  const { uploadFeuilleRoute, deleteAttachment, uploading, deleting } = useEventCreation();

  const bySpace = useMemo(() => {
    const map = new Map<string, EventAttachment>();
    (attachments.data ?? []).forEach((a) => {
      if (a.space_id) map.set(a.space_id, a);
    });
    return map;
  }, [attachments.data]);

  if (attachments.isLoading) return <Spinner fullPage label="Chargement…" />;

  return (
    <div className="space-y-3">
      <Alert variant="info">
        Joignez une feuille de route par espace. Elle est consultable par le
        responsable de l'espace concerné.
      </Alert>

      {spaces.map((s) => {
        const att = bySpace.get(s.space_id);
        return (
          <div
            key={s.space_id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-pr-stone bg-white p-3"
          >
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-pr-olive" />
              <span className="font-medium text-pr-black">{s.spaces?.space_name ?? s.space_id}</span>
              {att ? (
                <Badge tone="success">
                  <CheckCircle2 className="mr-1 inline h-3 w-3" /> {att.file_name}
                </Badge>
              ) : (
                <Badge tone="neutral">Aucune feuille</Badge>
              )}
            </div>

            <div className="flex items-center gap-2">
              {att && (
                <>
                  <button
                    onClick={() => void openSigned(att.file_url)}
                    className="inline-flex items-center gap-1 text-sm font-medium text-pr-olive hover:underline"
                  >
                    <Download className="h-4 w-4" /> Télécharger
                  </button>
                  <button
                    onClick={() => void deleteAttachment(att.id, att.file_url, eventId)}
                    disabled={deleting}
                    className="text-pr-rust hover:opacity-80"
                    aria-label="Supprimer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              )}
              <label className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-pr-black px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-pr-black-soft">
                <Upload className="h-3.5 w-3.5" />
                {att ? 'Remplacer' : 'Ajouter'}
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadFeuilleRoute(eventId, s.space_id, f);
                  }}
                />
              </label>
            </div>
          </div>
        );
      })}
    </div>
  );
}
