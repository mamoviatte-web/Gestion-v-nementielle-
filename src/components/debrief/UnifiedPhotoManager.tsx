/**
 * UnifiedPhotoManager — AXE 2 : « une seule visu sur les photos ».
 * ---------------------------------------------------------------------------
 * Remplace les 3 galeries séparées (mise en place / F&B / fin d'événement) par
 * UNE seule grille où toutes les photos du débrief séminaire sont visibles d'un
 * coup, filtrables par catégorie, avec pour chacune :
 *   • le choix « dans le PDF » (include_in_pdf) + légende PDF,
 *   • le changement de catégorie,
 *   • la suppression + agrandissement.
 * Bucket privé « debrief-photos » (URL signées), table `debrief_photos`.
 *
 * Passerelle régisseur → rapport : les photos remontées par le régisseur depuis
 * la zone (débrief public, bucket `zone-files`) sont affichées en bandeau et
 * importables en un clic dans le rapport (copie inter-bucket → debrief_photos),
 * pour que « le débrief régisseur » alimente réellement l'export PDF.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Camera, Check, FileText, Import, Loader2, Upload, X, ZoomIn } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';

type PhotoType = 'mise_en_place' | 'fb' | 'fin_evenement';

const CATEGORIES: { type: PhotoType; label: string; emoji: string }[] = [
  { type: 'mise_en_place', label: 'Mise en place', emoji: '📐' },
  { type: 'fb', label: 'F&B — service', emoji: '🍽️' },
  { type: 'fin_evenement', label: "Fin d'événement", emoji: '🔚' },
];

const SIGNED_TTL = 60 * 60 * 24 * 7; // 7 jours

interface Photo {
  id: string;
  storage_path: string;
  photo_type: PhotoType;
  caption: string | null;
  pdf_caption: string | null;
  taken_by: string | null;
  taken_at: string;
  include_in_pdf: boolean;
  signed_url: string;
}

async function sign(path: string): Promise<string> {
  const { data } = await supabase.storage.from('debrief-photos').createSignedUrl(path, SIGNED_TTL);
  return data?.signedUrl ?? '';
}

export function UnifiedPhotoManager({
  eventId,
  responsableNom,
}: {
  eventId: string;
  responsableNom: string;
}) {
  const { showToast } = useToast();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<PhotoType | 'toutes'>('toutes');
  const [uploadType, setUploadType] = useState<PhotoType>('mise_en_place');
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState<Photo | null>(null);
  const [regisseurPhotos, setRegisseurPhotos] = useState<string[]>([]);
  const [importing, setImporting] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('debrief_photos')
      .select('id, storage_path, photo_type, caption, pdf_caption, taken_by, taken_at, include_in_pdf')
      .eq('event_id', eventId)
      .in('photo_type', ['mise_en_place', 'fb', 'fin_evenement'])
      .is('space_id', null)
      .order('taken_at', { ascending: true });
    const rows = (data ?? []) as Omit<Photo, 'signed_url'>[];
    const withUrls = await Promise.all(rows.map(async (r) => ({ ...r, signed_url: await sign(r.storage_path) })));
    setPhotos(withUrls);
    setLoading(false);
  }, [eventId]);

  // Photos remontées par le régisseur depuis la zone (débrief public).
  const loadRegisseur = useCallback(async () => {
    const { data } = await supabase.from('debriefs').select('photo_urls').eq('event_id', eventId);
    const urls = ((data ?? []) as { photo_urls: string[] | null }[]).flatMap((d) => d.photo_urls ?? []);
    setRegisseurPhotos(urls.filter(Boolean));
  }, [eventId]);

  useEffect(() => {
    void load();
    void loadRegisseur();
  }, [load, loadRegisseur]);

  const uploadOne = useCallback(
    async (file: File, type: PhotoType) => {
      if (file.size > 20 * 1024 * 1024) {
        showToast('Photo trop lourde (max 20 Mo).', 'warning');
        return;
      }
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${eventId}/event/${type}/${Date.now()}_${safeName}`;
      const { data: up, error: upErr } = await supabase.storage.from('debrief-photos').upload(path, file, { upsert: false });
      if (upErr || !up) {
        showToast(`Erreur upload : ${upErr?.message ?? 'inconnue'}`, 'warning');
        return;
      }
      const url = await sign(up.path);
      const { data: row } = await supabase
        .from('debrief_photos')
        .insert({
          event_id: eventId,
          space_id: null,
          photo_type: type,
          storage_path: up.path,
          public_url: url,
          taken_by: responsableNom,
          file_size_kb: Math.round(file.size / 1024),
        })
        .select('id, storage_path, photo_type, caption, pdf_caption, taken_by, taken_at, include_in_pdf')
        .single();
      if (row) setPhotos((prev) => [...prev, { ...(row as Omit<Photo, 'signed_url'>), signed_url: url }]);
    },
    [eventId, responsableNom, showToast],
  );

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploading(true);
    for (const f of files) await uploadOne(f, uploadType);
    setUploading(false);
    e.target.value = '';
  }

  async function togglePdf(photo: Photo) {
    const next = !photo.include_in_pdf;
    setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, include_in_pdf: next } : p)));
    await supabase.from('debrief_photos').update({ include_in_pdf: next }).eq('id', photo.id);
    window.dispatchEvent(new CustomEvent('pdf-photos-changed'));
  }

  async function saveCaption(photo: Photo, caption: string) {
    setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, pdf_caption: caption } : p)));
    await supabase.from('debrief_photos').update({ pdf_caption: caption }).eq('id', photo.id);
    window.dispatchEvent(new CustomEvent('pdf-photos-changed'));
  }

  async function changeCategory(photo: Photo, type: PhotoType) {
    setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, photo_type: type } : p)));
    await supabase.from('debrief_photos').update({ photo_type: type }).eq('id', photo.id);
    window.dispatchEvent(new CustomEvent('pdf-photos-changed'));
  }

  async function deletePhoto(photo: Photo) {
    if (!confirm('Supprimer cette photo ?')) return;
    await supabase.storage.from('debrief-photos').remove([photo.storage_path]);
    await supabase.from('debrief_photos').delete().eq('id', photo.id);
    setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    window.dispatchEvent(new CustomEvent('pdf-photos-changed'));
  }

  // Importe une photo régisseur (zone-files public) dans le rapport (debrief-photos).
  async function importRegisseurPhoto(url: string) {
    setImporting(url);
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('téléchargement impossible');
      const blob = await resp.blob();
      const ext = (url.split('.').pop() ?? 'jpg').split('?')[0];
      const path = `${eventId}/event/fin_evenement/${Date.now()}_regisseur.${ext}`;
      const { data: up, error: upErr } = await supabase.storage.from('debrief-photos').upload(path, blob, { upsert: false });
      if (upErr || !up) throw new Error(upErr?.message ?? 'upload');
      const signed = await sign(up.path);
      const { data: row } = await supabase
        .from('debrief_photos')
        .insert({
          event_id: eventId,
          space_id: null,
          photo_type: 'fin_evenement',
          storage_path: up.path,
          public_url: signed,
          taken_by: `${responsableNom} (régisseur)`,
          include_in_pdf: true,
        })
        .select('id, storage_path, photo_type, caption, pdf_caption, taken_by, taken_at, include_in_pdf')
        .single();
      if (row) {
        setPhotos((prev) => [...prev, { ...(row as Omit<Photo, 'signed_url'>), signed_url: signed }]);
        window.dispatchEvent(new CustomEvent('pdf-photos-changed'));
        showToast('Photo régisseur importée dans le rapport.', 'success');
      }
    } catch (err) {
      showToast(`Import impossible : ${err instanceof Error ? err.message : 'erreur'}`, 'warning');
    } finally {
      setImporting(null);
    }
  }

  const visible = useMemo(() => (filter === 'toutes' ? photos : photos.filter((p) => p.photo_type === filter)), [photos, filter]);
  const inPdfCount = photos.filter((p) => p.include_in_pdf).length;
  const catCount = (t: PhotoType) => photos.filter((p) => p.photo_type === t).length;

  if (loading) return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-stone-400" /></div>;

  return (
    <div className="space-y-4">
      {/* En-tête : total + compteur PDF */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-bold text-stone-800">
          <Camera className="h-4 w-4 text-stone-500" /> {photos.length} photo{photos.length > 1 ? 's' : ''} au total
        </span>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${inPdfCount ? 'bg-amber-400 text-slate-900' : 'bg-slate-200 text-slate-500'}`}>
          {inPdfCount} dans le PDF
        </span>
      </div>

      {/* Filtres catégories */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter('toutes')}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${filter === 'toutes' ? 'bg-pr-olive text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
        >
          Toutes ({photos.length})
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.type}
            onClick={() => { setFilter(c.type); setUploadType(c.type); }}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${filter === c.type ? 'bg-pr-olive text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
          >
            {c.emoji} {c.label} ({catCount(c.type)})
          </button>
        ))}
      </div>

      {/* Barre d'ajout : catégorie cible + upload */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-stone-300 bg-stone-50 p-2.5">
        <span className="text-xs font-medium text-stone-500">Ajouter dans :</span>
        <select
          value={uploadType}
          onChange={(e) => setUploadType(e.target.value as PhotoType)}
          className="rounded border border-stone-300 bg-white px-2 py-1 text-xs"
        >
          {CATEGORIES.map((c) => <option key={c.type} value={c.type}>{c.emoji} {c.label}</option>)}
        </select>
        <label className={`ml-auto flex cursor-pointer items-center gap-1.5 rounded-lg bg-pr-olive px-3 py-1.5 text-xs font-semibold text-white hover:bg-pr-olive-dark ${uploading ? 'pointer-events-none opacity-50' : ''}`}>
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {uploading ? 'Envoi…' : 'Ajouter des photos'}
          <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple className="hidden" onChange={handleFiles} />
        </label>
      </div>

      {/* Grille unique */}
      {visible.length === 0 ? (
        <p className="py-6 text-center text-xs text-stone-400">Aucune photo dans cette catégorie.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
          {visible.map((photo) => {
            const cat = CATEGORIES.find((c) => c.type === photo.photo_type);
            return (
              <div key={photo.id} className="group overflow-hidden rounded-lg border border-stone-200 bg-white">
                <div className="relative aspect-square">
                  <img
                    src={photo.signed_url}
                    alt={photo.pdf_caption ?? photo.caption ?? ''}
                    loading="lazy"
                    className={`h-full w-full object-cover ${photo.include_in_pdf ? 'ring-2 ring-amber-400' : ''}`}
                  />
                  <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[9px] font-bold text-white">{cat?.emoji}</span>
                  {photo.include_in_pdf && (
                    <span className="absolute right-1 top-1 rounded bg-amber-400 px-1 text-[9px] font-black text-slate-900">PDF</span>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                    <button onClick={() => setLightbox(photo)} className="rounded-full bg-white/90 p-1.5" title="Agrandir">
                      <ZoomIn className="h-3.5 w-3.5 text-slate-700" />
                    </button>
                    <button onClick={() => void deletePhoto(photo)} className="rounded-full bg-red-500/90 p-1.5" title="Supprimer">
                      <X className="h-3.5 w-3.5 text-white" />
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5 p-1.5">
                  <button
                    onClick={() => void togglePdf(photo)}
                    className={`flex w-full items-center justify-center gap-1 rounded py-1 text-[10px] font-bold transition-colors ${
                      photo.include_in_pdf ? 'bg-amber-400 text-slate-900' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                    }`}
                  >
                    {photo.include_in_pdf ? <Check className="h-2.5 w-2.5" /> : <FileText className="h-2.5 w-2.5" />}
                    {photo.include_in_pdf ? 'Dans le PDF' : 'Ajouter au PDF'}
                  </button>
                  {photo.include_in_pdf && (
                    <input
                      defaultValue={photo.pdf_caption ?? ''}
                      onBlur={(e) => void saveCaption(photo, e.target.value)}
                      placeholder="Légende PDF…"
                      className="w-full rounded border border-stone-200 px-1 py-0.5 text-[10px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-amber-300"
                    />
                  )}
                  <select
                    value={photo.photo_type}
                    onChange={(e) => void changeCategory(photo, e.target.value as PhotoType)}
                    className="w-full rounded border border-stone-200 bg-white px-1 py-0.5 text-[10px] text-stone-500"
                    title="Changer de catégorie"
                  >
                    {CATEGORIES.map((c) => <option key={c.type} value={c.type}>{c.emoji} {c.label}</option>)}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bandeau photos régisseur (zone) importables */}
      {regisseurPhotos.length > 0 && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
          <p className="mb-2 flex items-center gap-2 text-xs font-bold text-sky-800">
            📲 Photos remontées par le régisseur (débrief zone)
            <span className="font-normal text-sky-500">— cliquez « Importer » pour les intégrer au rapport</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {regisseurPhotos.map((url) => (
              <div key={url} className="relative">
                <img src={url} alt="Photo régisseur" className="h-16 w-16 rounded-lg border border-sky-200 object-cover" />
                <button
                  onClick={() => void importRegisseurPhoto(url)}
                  disabled={importing === url}
                  className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-0.5 rounded-b-lg bg-sky-600/90 py-0.5 text-[9px] font-bold text-white hover:bg-sky-700 disabled:opacity-60"
                >
                  {importing === url ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Import className="h-2.5 w-2.5" />}
                  Importer
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" onClick={() => setLightbox(null)}>
          <button className="absolute right-4 top-4 text-white" onClick={() => setLightbox(null)}>
            <X className="h-7 w-7" />
          </button>
          <img src={lightbox.signed_url} alt={lightbox.caption ?? ''} onClick={(e) => e.stopPropagation()} className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      )}
    </div>
  );
}
