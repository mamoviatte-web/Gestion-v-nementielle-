/**
 * LogoUploader — upload du logo client (bucket privé event-assets) avec preview.
 * Remplace le champ URL texte. Renvoie l'URL signée via onChange (le parent la
 * persiste dans seminar_report_draft.client_logo_url).
 */

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

const YEAR = 60 * 60 * 24 * 365;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];

export function LogoUploader({ eventId, value, onChange }: {
  eventId: string;
  value: string | null;
  onChange: (url: string | null) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return alert('Logo trop lourd (max 5 Mo).');
    if (!ACCEPTED.includes(file.type)) return alert('Format accepté : JPG, PNG, WEBP, SVG.');

    setUploading(true);
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(file);

    const ext = file.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '') || 'png';
    const path = `logos/${eventId}/logo_client.${ext}`;
    const { data, error } = await supabase.storage.from('event-assets').upload(path, file, { upsert: true, cacheControl: '3600' });
    if (error || !data) {
      setUploading(false);
      return alert(`Erreur upload : ${error?.message ?? 'inconnue'}`);
    }
    const { data: urlData } = await supabase.storage.from('event-assets').createSignedUrl(data.path, YEAR);
    setUploading(false);
    if (urlData?.signedUrl) onChange(urlData.signedUrl);
  }

  const shown = preview ?? value;

  return (
    <div>
      <div className="flex items-center gap-4">
        {shown ? (
          <div className="relative h-16 w-24 overflow-hidden rounded-xl border border-stone-200 bg-stone-50">
            <img src={shown} alt="Logo client" className="h-full w-full object-contain p-1" />
            <button
              type="button"
              onClick={() => { setPreview(null); onChange(null); }}
              className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white"
              aria-label="Retirer le logo"
            >
              ×
            </button>
          </div>
        ) : (
          <div className="flex h-16 w-24 items-center justify-center rounded-xl border-2 border-dashed border-stone-200 bg-stone-50 text-stone-300">🖼</div>
        )}

        <label className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${uploading ? 'pointer-events-none border-stone-200 text-stone-400 opacity-40' : 'border-stone-300 text-stone-600 hover:border-stone-500 hover:bg-stone-50'}`}>
          {uploading ? '⏳ Upload…' : "📁 Choisir depuis l'ordinateur"}
          <input type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml" onChange={handleFile} className="hidden" />
        </label>
      </div>
      <p className="mt-1.5 text-xs text-stone-400">JPG · PNG · WEBP · SVG · Max 5 Mo</p>
    </div>
  );
}
