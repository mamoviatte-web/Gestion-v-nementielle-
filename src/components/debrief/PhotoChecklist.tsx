/**
 * PhotoChecklist — checklist terrain pour guider les prises de vue du régisseur
 * (séminaire). 12 items (mise en place / F&B / fin), barre de progression,
 * note libre. Auto-save dans debrief_photo_checklist (upsert par event).
 */

import { useEffect, useMemo, useState } from 'react';
import { CheckSquare, Square } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Color = 'blue' | 'amber' | 'green';
const SECTIONS: { key: string; label: string; color: Color; items: { field: string; label: string }[] }[] = [
  {
    key: 'mise_en_place',
    label: '📐 Mise en place',
    color: 'blue',
    items: [
      { field: 'mp_salle', label: 'Vue générale de la salle installée' },
      { field: 'mp_tables', label: 'Dressage des tables' },
      { field: 'mp_buffet', label: 'Zone buffet / bar installé' },
      { field: 'mp_signage', label: 'Signalétique & accueil' },
      { field: 'mp_tech', label: 'Installation technique (écran, sono)' },
    ],
  },
  {
    key: 'fb',
    label: '🍽️ F&B en service',
    color: 'amber',
    items: [
      { field: 'fb_buffet_open', label: 'Buffet ouvert / service lancé' },
      { field: 'fb_bar', label: 'Zone bar en service' },
      { field: 'fb_plats', label: 'Prestations traiteur / plats' },
      { field: 'fb_ambiance', label: "Ambiance salle pendant l'événement" },
    ],
  },
  {
    key: 'fin',
    label: "🔚 Fin d'événement",
    color: 'green',
    items: [
      { field: 'fin_rangement', label: 'Rangement effectué' },
      { field: 'fin_etat_salle', label: "État de la salle après l'événement" },
      { field: 'fin_incident', label: 'Incident / anomalie à signaler (si applicable)' },
    ],
  },
];

const COLORS: Record<Color, { header: string; text: string; check: string }> = {
  blue: { header: 'bg-blue-50 border-blue-200', text: 'text-blue-700', check: 'text-blue-600' },
  amber: { header: 'bg-amber-50 border-amber-200', text: 'text-amber-700', check: 'text-amber-600' },
  green: { header: 'bg-green-50 border-green-200', text: 'text-green-700', check: 'text-green-600' },
};

export function PhotoChecklist({
  eventId,
  regisseurNom,
  onChange,
}: {
  eventId: string;
  regisseurNom: string;
  onChange?: (completed: number, total: number) => void;
}) {
  const [data, setData] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void supabase
      .from('debrief_photo_checklist')
      .select('*')
      .eq('event_id', eventId)
      .maybeSingle()
      .then(({ data: row }) => {
        if (row) {
          setData(row as Record<string, boolean>);
          setNotes((row as { notes_photo?: string }).notes_photo ?? '');
        }
      });
  }, [eventId]);

  const allItems = useMemo(() => SECTIONS.flatMap((s) => s.items), []);
  const completed = allItems.filter((i) => data[i.field]).length;
  const total = allItems.length;
  const pct = Math.round((completed / total) * 100);

  useEffect(() => {
    onChange?.(completed, total);
  }, [completed, total, onChange]);

  async function save(newData: Record<string, boolean>, newNotes = notes) {
    setSaving(true);
    const payload: Record<string, unknown> = { event_id: eventId, regisseur_nom: regisseurNom || 'Régisseur', notes_photo: newNotes, updated_at: new Date().toISOString() };
    for (const it of allItems) payload[it.field] = !!newData[it.field];
    await supabase.from('debrief_photo_checklist').upsert(payload, { onConflict: 'event_id' });
    setSaving(false);
  }

  function toggle(field: string) {
    const next = { ...data, [field]: !data[field] };
    setData(next);
    void save(next);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-stone-200">
          <div
            className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-green-500' : pct >= 60 ? 'bg-amber-400' : 'bg-blue-400'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="shrink-0 text-sm font-semibold text-stone-600">{completed}/{total} photos</span>
        {saving && <span className="text-xs text-stone-400">…</span>}
      </div>

      {SECTIONS.map((section) => {
        const c = COLORS[section.color];
        const done = section.items.filter((i) => data[i.field]).length;
        return (
          <div key={section.key} className={`overflow-hidden rounded-xl border ${c.header}`}>
            <div className={`flex items-center justify-between border-b px-4 py-2.5 ${c.header}`}>
              <span className={`text-sm font-semibold ${c.text}`}>{section.label}</span>
              <span className={`text-xs font-medium ${c.text}`}>{done}/{section.items.length}</span>
            </div>
            <div className="divide-y divide-stone-100 bg-white">
              {section.items.map((item) => (
                <button
                  key={item.field}
                  type="button"
                  onClick={() => toggle(item.field)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-stone-50 active:bg-stone-100"
                >
                  {data[item.field] ? <CheckSquare size={20} className={c.check} /> : <Square size={20} className="text-stone-300" />}
                  <span className={`flex-1 text-sm ${data[item.field] ? 'text-stone-400 line-through' : 'text-stone-700'}`}>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}

      <div>
        <label className="mb-1.5 block text-xs font-medium text-stone-500">Note sur les photos (contexte, problèmes rencontrés…)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => void save(data, notes)}
          placeholder="Ex : éclairage insuffisant lors du service, photos floues remplacées…"
          rows={2}
          className="w-full resize-none rounded-xl border border-stone-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
      </div>
    </div>
  );
}
