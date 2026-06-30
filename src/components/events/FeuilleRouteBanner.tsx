/**
 * FeuilleRouteBanner (provider) — affiche la feuille de route de l'espace
 * (ou globale) si elle existe pour l'événement en cours. Lecture seule.
 */

import { Download, FileText } from 'lucide-react';
import { useAttachments, getSignedUrl } from '@/hooks/useEventCreation';

export function FeuilleRouteBanner({
  eventId,
  spaceId,
}: {
  eventId: string;
  spaceId: string;
}) {
  const { data } = useAttachments(eventId, { type: 'feuille_route_seminaire' });
  const feuilles = (data ?? []).filter(
    (a) => a.space_id === spaceId || a.space_id === null,
  );
  if (feuilles.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
      {feuilles.map((f) => (
        <div
          key={f.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-pr-olive/30 bg-[#EDEFE6] p-3"
        >
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="h-5 w-5 shrink-0 text-pr-olive-dark" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-pr-olive-dark">
                Feuille de route disponible
              </p>
              <p className="truncate text-xs text-pr-olive-dark/80">{f.file_name}</p>
            </div>
          </div>
          <button
            onClick={async () => {
              const url = await getSignedUrl(f.file_url);
              if (url) window.open(url, '_blank', 'noopener');
            }}
            className="inline-flex items-center gap-1 rounded-md bg-pr-olive px-3 py-1.5 text-xs font-semibold text-white hover:bg-pr-olive-dark"
          >
            <Download className="h-3.5 w-3.5" /> Télécharger
          </button>
        </div>
      ))}
    </div>
  );
}
