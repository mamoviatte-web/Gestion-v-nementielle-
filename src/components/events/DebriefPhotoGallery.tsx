/**
 * DebriefPhotoGallery (admin) — galerie du rapport photo d'un débrief soumis.
 * Miniatures cliquables (ouverture en grand via URL signée).
 */

import { useEffect, useState } from 'react';
import { Camera } from 'lucide-react';
import { useAttachments, getSignedUrl } from '@/hooks/useEventCreation';
import type { EventAttachment } from '@/lib/types';

function Thumb({ att }: { att: EventAttachment }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void getSignedUrl(att.file_url).then((u) => active && setUrl(u));
    return () => {
      active = false;
    };
  }, [att.file_url]);

  if (!url) {
    return <div className="h-24 w-full animate-pulse rounded-md bg-pr-stone" />;
  }
  return (
    <button onClick={() => window.open(url, '_blank', 'noopener')} className="block">
      <img
        src={url}
        alt={att.file_name}
        className="h-24 w-full rounded-md object-cover ring-1 ring-pr-stone transition-transform hover:scale-[1.02]"
      />
    </button>
  );
}

export function DebriefPhotoGallery({
  eventId,
  spaceId,
}: {
  eventId: string;
  spaceId: string;
}) {
  const { data } = useAttachments(eventId, { spaceId, type: 'rapport_photo_debrief' });
  const photos = data ?? [];
  if (photos.length === 0) return null;

  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-pr-olive-dark">
        <Camera className="h-4 w-4" /> Rapport photo ({photos.length})
      </h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {photos.map((p) => (
          <Thumb key={p.id} att={p} />
        ))}
      </div>
    </section>
  );
}
