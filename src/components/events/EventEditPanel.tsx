/**
 * EventEditPanel — édition inline des caractéristiques d'un événement
 * (ROLE_STADE). Intitulé, date, heure, jauge, météo, température, notes.
 *
 * Réconciliation schéma réel : la jauge est `expected_attendees` (pas
 * `pax_count`), la météo `weather_type` (enum contraint), plus `temperature`
 * et `notes` (pas `meteo`/`notes_admin`). Aucune colonne à créer.
 */

import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import { Button, Input, Select, Textarea } from '@/components/ui';
import type { Event, WeatherType } from '@/lib/types';

const WEATHER_OPTIONS: { value: '' | WeatherType; label: string }[] = [
  { value: '', label: '— Non renseignée' },
  { value: 'tres_favorable', label: '☀️ Très favorable' },
  { value: 'normal', label: '🌤️ Normal' },
  { value: 'chaleur', label: '🌡️ Chaleur' },
  { value: 'forte_chaleur', label: '🔥 Forte chaleur' },
  { value: 'pluie', label: '🌧️ Pluie' },
  { value: 'froid', label: '🥶 Froid' },
];

export function EventEditPanel({ event, onClose }: { event: Event; onClose: () => void }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    event_name: event.event_name ?? '',
    event_date: event.event_date?.slice(0, 10) ?? '',
    start_time: event.start_time?.slice(0, 5) ?? '',
    expected_attendees: event.expected_attendees != null ? String(event.expected_attendees) : '',
    weather_type: (event.weather_type ?? '') as '' | WeatherType,
    temperature: event.temperature != null ? String(event.temperature) : '',
    notes: event.notes ?? '',
  });

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((p) => ({ ...p, [k]: e.target.value }));

  async function handleSave() {
    if (!form.event_name.trim()) return showToast("Renseignez l'intitulé de l'événement.", 'warning');
    if (!form.event_date) return showToast("Renseignez la date de l'événement.", 'warning');
    setSaving(true);
    const { error } = await supabase
      .from('events')
      .update({
        event_name: form.event_name.trim(),
        event_date: form.event_date,
        start_time: form.start_time || null,
        expected_attendees: form.expected_attendees ? parseInt(form.expected_attendees, 10) : null,
        weather_type: form.weather_type || null,
        temperature: form.temperature !== '' ? Number(form.temperature) : null,
        notes: form.notes.trim() || null,
      })
      .eq('event_id', event.event_id);
    setSaving(false);
    if (error) return showToast(`Échec : ${error.message}`, 'warning');
    await queryClient.invalidateQueries({ queryKey: ['event', event.event_id] });
    await queryClient.invalidateQueries({ queryKey: ['events'] });
    showToast('Événement mis à jour.', 'success');
    onClose();
  }

  return (
    <div className="mt-4 space-y-4 rounded-2xl border border-amber-200 bg-amber-50 p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-amber-800">✏️ Modifier les caractéristiques de l'événement</p>
        <button
          onClick={onClose}
          className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs text-stone-500 hover:text-stone-800"
        >
          <X className="h-3.5 w-3.5" /> Annuler
        </button>
      </div>

      <Input label="Intitulé *" value={form.event_name} onChange={set('event_name')} placeholder="ex. Provence Rugby vs Nice" />

      <div className="grid gap-3 sm:grid-cols-3">
        <Input label="Date *" type="date" value={form.event_date} onChange={set('event_date')} />
        <Input label="Heure de début" type="time" value={form.start_time} onChange={set('start_time')} />
        <Input label="Jauge (spectateurs)" type="number" min={0} step={100} value={form.expected_attendees} onChange={set('expected_attendees')} placeholder="ex. 8000" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Select label="Météo prévue" value={form.weather_type} onChange={set('weather_type')} options={WEATHER_OPTIONS} />
        <Input label="Température (°C)" type="number" step={1} value={form.temperature} onChange={set('temperature')} placeholder="ex. 18" />
      </div>

      <Textarea label="Notes admin" rows={2} value={form.notes} onChange={set('notes')} placeholder="Notes internes (équipe stade)" />

      <div className="flex gap-3">
        <Button variant="secondary" onClick={onClose}>Annuler</Button>
        <Button onClick={() => void handleSave()} disabled={saving || !form.event_name.trim() || !form.event_date}>
          <Check className="mr-1.5 h-4 w-4" /> {saving ? 'Sauvegarde…' : 'Enregistrer les modifications'}
        </Button>
      </div>
    </div>
  );
}
