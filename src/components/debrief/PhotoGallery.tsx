/**
 * PhotoGallery — galerie photos illimitée d'un débrief (upload + lightbox).
 * Bucket privé « debrief-photos » (URL signées). Table debrief_photos.
 * readonly=true : mode consultation (rapport / admin).
 */

import { useCallback, useEffect, useState } from 'react';
import { Camera, Upload, X, ZoomIn } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export type DebriefPhotoType = 'mise_en_place' | 'fb' | 'fin_evenement' | 'incident' | 'autre';

interface Photo {
  id: string;
  storage_path: string;
  public_url: string;
  caption?: string | null;
  taken_by?: string | null;
  taken_at: string;
}

const SIGNED_TTL = 60 * 60 * 24 * 7; // 7 jours

async function signed(path: string): Promise<string> {
  const { data } = await supabase.storage.from('debrief-photos').createSignedUrl(path, SIGNED_TTL);
  return data?.signedUrl ?? '';
}

export function PhotoGallery({
  eventId,
  spaceId,
  photoType,
  label,
  responsableNom,
  readonly = false,
}: {
  eventId: string;
  spaceId: string;
  photoType: DebriefPhotoType;
  label: string;
  responsableNom: string;
  readonly?: boolean;
}) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [lightbox, setLightbox] = useState<Photo | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      const { data } = await supabase
        .from('debrief_photos')
        .select('id, storage_path, public_url, caption, taken_by, taken_at')
        .eq('event_id', eventId)
        .eq('photo_type', photoType)
        .eq('space_id', spaceId)
        .order('taken_at', { ascending: true });
      if (!active) return;
      // Régénère une URL signée fraîche pour chaque photo.
      const withUrls = await Promise.all(
        (data ?? []).map(async (p) => ({ ...p, public_url: await signed(p.storage_path) })),
      );
      setPhotos(withUrls as Photo[]);
    }
    void load();
    return () => {
      active = false;
    };
  }, [eventId, spaceId, photoType]);

  const uploadPhoto = useCallback(
    async (file: File) => {
      if (file.size > 20 * 1024 * 1024) {
        alert('Photo trop lourde (max 20 Mo). Compresse-la et réessaie.');
        return;
      }
      setUploading(true);
      setProgress(20);
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${eventId}/${spaceId}/${photoType}/${Date.now()}_${safeName}`;
      const { data: up, error: upErr } = await supabase.storage
        .from('debrief-photos')
        .upload(path, file, { upsert: false });
      if (upErr || !up) {
        alert(`Erreur upload : ${upErr?.message ?? 'inconnue'}`);
        setUploading(false);
        return;
      }
      setProgress(70);
      const url = await signed(up.path);
      const { data: row, error: dbErr } = await supabase
        .from('debrief_photos')
        .insert({
          event_id: eventId,
          space_id: spaceId,
          photo_type: photoType,
          storage_path: up.path,
          public_url: url,
          taken_by: responsableNom,
          file_size_kb: Math.round(file.size / 1024),
        })
        .select('id, storage_path, public_url, caption, taken_by, taken_at')
        .single();
      setProgress(100);
      setUploading(false);
      if (!dbErr && row) setPhotos((prev) => [...prev, { ...(row as Photo), public_url: url }]);
      else if (dbErr) alert(`Erreur enregistrement : ${dbErr.message}`);
    },
    [eventId, spaceId, photoType, responsableNom],
  );

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    void files.reduce((p, f) => p.then(() => uploadPhoto(f)), Promise.resolve());
    e.target.value = '';
  }

  async function deletePhoto(photo: Photo) {
    if (!confirm('Supprimer cette photo ?')) return;
    await supabase.storage.from('debrief-photos').remove([photo.storage_path]);
    await supabase.from('debrief_photos').delete().eq('id', photo.id);
    setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-medium text-slate-700">
          <Camera className="h-4 w-4 text-slate-500" /> {label}
        </span>
        <span className="text-sm text-slate-400">{photos.length} photo(s)</span>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
        {photos.map((photo) => (
          <div key={photo.id} className="group relative aspect-square">
            <img
              src={photo.public_url}
              alt={photo.caption ?? label}
              loading="lazy"
              className="h-full w-full rounded-lg border border-slate-200 object-cover"
            />
            <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-lg bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
              <button onClick={() => setLightbox(photo)} className="rounded-full bg-white/90 p-1.5" title="Agrandir">
                <ZoomIn className="h-3.5 w-3.5 text-slate-700" />
              </button>
              {!readonly && (
                <button onClick={() => void deletePhoto(photo)} className="rounded-full bg-red-500/90 p-1.5" title="Supprimer">
                  <X className="h-3.5 w-3.5 text-white" />
                </button>
              )}
            </div>
          </div>
        ))}

        {!readonly && (
          <label
            className={`flex aspect-square cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 transition-colors hover:border-amber-400 hover:bg-amber-50 ${
              uploading ? 'pointer-events-none opacity-50' : ''
            }`}
          >
            <Upload className="mb-1 h-5 w-5 text-slate-400" />
            <span className="text-xs text-slate-400">{uploading ? `${progress}%` : 'Ajouter'}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple className="hidden" onChange={handleFiles} />
          </label>
        )}
      </div>

      {uploading && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
          <div className="h-1.5 rounded-full bg-amber-500 transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}

      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" onClick={() => setLightbox(null)}>
          <button className="absolute right-4 top-4 text-white" onClick={() => setLightbox(null)}>
            <X className="h-7 w-7" />
          </button>
          <img src={lightbox.public_url} alt={lightbox.caption ?? ''} onClick={(e) => e.stopPropagation()} className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      )}
    </div>
  );
}
