/**
 * PdfPhotoSummary — récapitulatif des photos sélectionnées pour le rapport PDF
 * (régisseur / ROLE_STADE). Se rafraîchit sur l'événement « pdf-photos-changed »
 * émis par PhotoGallery lorsqu'une photo est (dé)sélectionnée.
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface SelPhoto {
  id: string;
  storage_path: string;
  photo_type: string;
  pdf_caption: string | null;
  signed_url: string;
}

const TYPE_LABEL: Record<string, string> = {
  mise_en_place: '📐 Mise en place',
  fb: '🍽️ F&B',
  fin_evenement: "🔚 Fin d'événement",
};

export function PdfPhotoSummary({ eventId }: { eventId: string }) {
  const [selected, setSelected] = useState<SelPhoto[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSelected = useCallback(async () => {
    const { data } = await supabase
      .from('debrief_photos')
      .select('id, storage_path, photo_type, pdf_caption, pdf_order, taken_at')
      .eq('event_id', eventId)
      .eq('include_in_pdf', true)
      .order('photo_type')
      .order('pdf_order');
    const rows = (data ?? []) as { id: string; storage_path: string; photo_type: string; pdf_caption: string | null }[];
    const withUrls = await Promise.all(
      rows.map(async (r) => {
        const { data: u } = await supabase.storage.from('debrief-photos').createSignedUrl(r.storage_path, 3600);
        return { ...r, signed_url: u?.signedUrl ?? '' };
      }),
    );
    setSelected(withUrls);
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    void fetchSelected();
    const handler = () => void fetchSelected();
    window.addEventListener('pdf-photos-changed', handler);
    return () => window.removeEventListener('pdf-photos-changed', handler);
  }, [fetchSelected]);

  if (loading) return null;

  const empty = selected.length === 0;

  return (
    <div className={`rounded-xl border-2 p-4 ${empty ? 'border-slate-200 bg-slate-50' : 'border-amber-300 bg-amber-50'}`}>
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-bold text-slate-800">📄 Sélection pour le rapport PDF</span>
        <span className={`rounded-full px-2 py-1 text-xs font-bold ${empty ? 'bg-slate-200 text-slate-500' : 'bg-amber-400 text-slate-900'}`}>
          {selected.length} photo{selected.length > 1 ? 's' : ''}
        </span>
      </div>

      {empty ? (
        <p className="py-3 text-center text-xs text-slate-400">
          Aucune photo sélectionnée.
          <br />
          Appuyez sur « Ajouter au PDF » sous chaque photo souhaitée.
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            {selected.map((photo) => (
              <div key={photo.id} className="relative">
                <img
                  src={photo.signed_url}
                  alt={photo.pdf_caption ?? ''}
                  className="h-14 w-14 rounded-lg border-2 border-amber-400 object-cover"
                />
                <span className="absolute -left-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[9px] font-black text-slate-900">
                  {TYPE_LABEL[photo.photo_type]?.match(/\p{Emoji}/u)?.[0] ?? '?'}
                </span>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            {['mise_en_place', 'fb', 'fin_evenement'].map((type) => {
              const count = selected.filter((p) => p.photo_type === type).length;
              if (count === 0) return null;
              return (
                <div key={type} className="flex items-center justify-between text-xs text-slate-600">
                  <span>{TYPE_LABEL[type] ?? type}</span>
                  <span className="font-bold">
                    {count} photo{count > 1 ? 's' : ''}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-center text-[10px] text-slate-400">Ces photos seront disposées en grille dans le rapport PDF séminaire.</p>
        </>
      )}
    </div>
  );
}
