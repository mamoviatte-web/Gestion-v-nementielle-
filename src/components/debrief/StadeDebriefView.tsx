/**
 * StadeDebriefView — vue LECTURE SEULE du rapport terrain pour l'équipe stade.
 * Aucun upload, aucune checklist interactive : statut checklist + galeries
 * photos consultables + alertes si sections manquantes. Le régisseur reste seul
 * responsable de la saisie (page Rapport).
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, Image as ImageIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface Photo { id: string; url: string; photo_type: string }
interface ChecklistStatus { done: number; total: number; is_complete: boolean }

const PHOTO_TYPES = [
  { key: 'mise_en_place', label: '📐 Mise en place', required: 3 },
  { key: 'fb', label: '🍽️ F&B', required: 2 },
  { key: 'fin_evenement', label: "🔚 Fin d'événement", required: 2 },
];

// 12 items de la checklist terrain (debrief_photo_checklist).
const CHECKLIST_COLS = [
  'mp_salle', 'mp_tables', 'mp_buffet', 'mp_signage', 'mp_tech',
  'fb_buffet_open', 'fb_bar', 'fb_plats', 'fb_ambiance',
  'fin_rangement', 'fin_etat_salle', 'fin_incident',
] as const;

export function StadeDebriefView({ eventId }: { eventId: string }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [checklist, setChecklist] = useState<ChecklistStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      const { data: p } = await supabase
        .from('debrief_photos')
        .select('id, storage_path, photo_type, taken_at')
        .eq('event_id', eventId)
        .order('taken_at');
      const rows = (p ?? []) as { id: string; storage_path: string; photo_type: string }[];
      const withUrls = await Promise.all(rows.map(async (r) => {
        const { data: u } = await supabase.storage.from('debrief-photos').createSignedUrl(r.storage_path, 3600);
        return { id: r.id, url: u?.signedUrl ?? '', photo_type: r.photo_type };
      }));

      const { data: c } = await supabase
        .from('debrief_photo_checklist')
        .select(CHECKLIST_COLS.join(','))
        .eq('event_id', eventId)
        .maybeSingle();

      if (!active) return;
      setPhotos(withUrls);
      if (c) {
        const rec = c as unknown as Record<string, boolean | null>;
        const done = CHECKLIST_COLS.filter((k) => rec[k]).length;
        setChecklist({ done, total: CHECKLIST_COLS.length, is_complete: done === CHECKLIST_COLS.length });
      } else {
        setChecklist(null);
      }
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [eventId]);

  if (loading)
    return (
      <div className="animate-pulse space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-stone-100" />)}</div>
    );

  const alerts = PHOTO_TYPES.filter((t) => photos.filter((p) => p.photo_type === t.key).length < t.required);

  return (
    <div className="space-y-5">
      {/* Statut checklist terrain */}
      <div className={`flex items-center gap-4 rounded-2xl border p-4 ${!checklist ? 'border-stone-200 bg-stone-50' : checklist.is_complete ? 'border-green-200 bg-green-50' : 'border-amber-300 bg-amber-50'}`}>
        {!checklist ? <AlertTriangle size={22} className="shrink-0 text-stone-400" /> : checklist.is_complete ? <CheckCircle size={22} className="shrink-0 text-green-600" /> : <AlertTriangle size={22} className="shrink-0 text-amber-600" />}
        <div>
          <p className={`text-sm font-bold ${!checklist ? 'text-stone-500' : checklist.is_complete ? 'text-green-800' : 'text-amber-800'}`}>
            {!checklist ? 'Checklist terrain non remplie' : checklist.is_complete ? `Checklist terrain complète — ${checklist.done}/${checklist.total} ✅` : `Checklist incomplète — ${checklist.done}/${checklist.total} items cochés`}
          </p>
          <p className={`mt-0.5 text-xs ${!checklist ? 'text-stone-400' : checklist.is_complete ? 'text-green-600' : 'text-amber-600'}`}>
            {!checklist ? "Le régisseur n'a pas encore rempli la checklist" : checklist.is_complete ? 'Toutes les étapes terrain ont été validées par le régisseur' : `${checklist.total - checklist.done} item(s) manquant(s) — contacter le régisseur`}
          </p>
        </div>
      </div>

      {/* Alertes photos manquantes */}
      {alerts.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-600" />
            <p className="text-sm font-bold text-red-800">Photos manquantes — {alerts.length} section(s)</p>
          </div>
          <ul className="space-y-1">
            {alerts.map((a) => {
              const count = photos.filter((p) => p.photo_type === a.key).length;
              return (
                <li key={a.key} className="flex items-center gap-2 text-xs text-red-700">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                  {a.label} — {count} photo{count > 1 ? 's' : ''} / minimum {a.required} attendue{a.required > 1 ? 's' : ''}
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs italic text-red-500">Relancer le régisseur pour compléter le dossier photo.</p>
        </div>
      )}

      {/* Galeries en lecture seule */}
      {PHOTO_TYPES.map((type) => {
        const typePhotos = photos.filter((p) => p.photo_type === type.key);
        const isMissing = typePhotos.length < type.required;
        return (
          <div key={type.key} className={`rounded-2xl border bg-white p-4 ${isMissing ? 'border-red-200' : 'border-stone-100'}`}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-stone-800">{type.label}</p>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${isMissing ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                {typePhotos.length} photo{typePhotos.length > 1 ? 's' : ''}{isMissing ? ` / ${type.required} min ⚠️` : ' ✅'}
              </span>
            </div>
            {typePhotos.length === 0 ? (
              <div className="flex items-center justify-center gap-2 rounded-xl bg-stone-50 py-4 text-xs text-stone-400"><ImageIcon size={16} /> Aucune photo — en attente du régisseur</div>
            ) : (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {typePhotos.map((photo) => (
                  <a key={photo.id} href={photo.url} target="_blank" rel="noopener noreferrer" className="aspect-square overflow-hidden rounded-lg border border-stone-200 transition-colors hover:border-stone-400">
                    <img src={photo.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                  </a>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
