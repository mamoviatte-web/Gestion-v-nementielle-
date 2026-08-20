/**
 * OccasionalHoursModal — saisie multi-lignes d'heures occasionnelles
 * (mise en place, débarrassage, logistique…). Calcul automatique des heures
 * à partir de début/fin (gestion du passage minuit) et du coût = heures × taux.
 * Insère dans occasional_hours ; réservé ROLE_STADE. Résilient si table absente.
 */

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { Alert, Button, Input, Select } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

const MISSIONS = [
  { value: 'mise_en_place', label: 'Mise en place' },
  { value: 'débarrassage', label: 'Débarrassage' },
  { value: 'logistique', label: 'Logistique' },
  { value: 'nettoyage', label: 'Nettoyage' },
  { value: 'technique', label: 'Technique' },
  { value: 'sécurité', label: 'Sécurité' },
  { value: 'autre', label: 'Autre' },
];

type PaymentType = 'franchise' | 'contrat';

interface Entry {
  staff_name: string;
  mission_type: string;
  payment_type: PaymentType;
  work_date: string;
  start_time: string;
  end_time: string;
  hours_worked: string;
  hourly_rate: string;
}

function emptyEntry(): Entry {
  return {
    staff_name: '',
    mission_type: 'mise_en_place',
    payment_type: 'contrat',
    work_date: new Date().toLocaleDateString('en-CA'),
    start_time: '',
    end_time: '',
    hours_worked: '',
    hourly_rate: '',
  };
}

/** Franchise = à facturer (rouge) · Contrat = à intégrer en paie (vert). */
const PAY_COLOR: Record<PaymentType, string> = { franchise: '#C00000', contrat: '#1E7A34' };

/** Heures entre deux HH:MM, avec passage minuit (+24h si fin < début). */
function computeHours(start: string, end: string): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let diff = eh * 60 + em - (sh * 60 + sm);
  if (diff < 0) diff += 1440;
  return diff / 60;
}

export function OccasionalHoursModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const qc = useQueryClient();
  const [eventId, setEventId] = useState('');
  const [entries, setEntries] = useState<Entry[]>([emptyEntry()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Séminaires (événements non-match) pour rattacher les heures aux charges RH.
  const { data: seminars } = useQuery({
    queryKey: ['seminarEventsForHours'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from('events')
        .select('event_id, event_name, event_date, event_type')
        .neq('event_type', 'match')
        .order('event_date', { ascending: false });
      return (data ?? []) as { event_id: string; event_name: string; event_date: string }[];
    },
  });

  const eventOptions = useMemo(
    () => [
      { value: '', label: 'Aucun (hors événement)' },
      ...(seminars ?? []).map((e) => ({
        value: e.event_id,
        label: `${e.event_name} · ${new Date(e.event_date).toLocaleDateString('fr-FR')}`,
      })),
    ],
    [seminars],
  );

  const validCount = entries.filter((e) => e.staff_name.trim() && Number(e.hours_worked) > 0).length;
  const total = entries.reduce((s, e) => s + (Number(e.hours_worked) || 0) * (Number(e.hourly_rate) || 0), 0);

  function update(i: number, field: keyof Entry, value: string) {
    setEntries((prev) => {
      const next = [...prev];
      const e = { ...next[i], [field]: value };
      // Recalcul auto des heures quand début/fin changent.
      if (field === 'start_time' || field === 'end_time') {
        const h = computeHours(field === 'start_time' ? value : e.start_time, field === 'end_time' ? value : e.end_time);
        if (h > 0) e.hours_worked = h.toFixed(1);
      }
      next[i] = e;
      return next;
    });
  }

  async function handleSave() {
    setError(null);
    const rows = entries.filter((e) => e.staff_name.trim() && Number(e.hours_worked) > 0);
    if (rows.length === 0) {
      setError('Renseignez au moins un agent et ses heures.');
      return;
    }
    setSaving(true);
    const payload = rows.map((e) => ({
      event_id: eventId || null,
      staff_name: e.staff_name.trim().toUpperCase(),
      mission_type: e.mission_type,
      payment_type: e.payment_type,
      work_date: e.work_date,
      start_time: e.start_time || null,
      end_time: e.end_time || null,
      hours_worked: Number(e.hours_worked),
      hourly_rate: e.hourly_rate ? Number(e.hourly_rate) : null,
      created_by: user?.email ?? user?.name ?? 'Stade',
    }));
    const { error: err } = await supabase.from('occasional_hours').insert(payload);
    setSaving(false);
    if (err) {
      setError(
        /does not exist|schema cache/i.test(err.message)
          ? 'Table non provisionnée (applique occasional_hours.sql / _APPLY_ALL.sql).'
          : err.message,
      );
      return;
    }
    showToast(`${rows.length} ligne(s) enregistrée(s).`, 'success');
    void qc.invalidateQueries({ queryKey: ['agentHoursCumulative'] });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-display text-lg font-black text-pr-black">Ajouter des heures</h2>
          <button onClick={onClose} aria-label="Fermer" className="text-pr-black-soft/40 hover:text-pr-black">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-4 text-sm text-pr-black-soft/60">
          Heures de manutention, mise en place, rangement — intégrées aux charges RH de l’événement associé.
        </p>

        {error && (
          <Alert variant="error" className="mb-3">
            {error}
          </Alert>
        )}

        <div className="mb-4">
          <Select
            label="Événement associé (optionnel)"
            options={eventOptions}
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
          />
        </div>

        <div className="space-y-3">
          {entries.map((e, i) => (
            <div key={i} className="rounded-lg bg-pr-cream/50 p-3">
              {/* Circuit de paiement — caractéristique de l'agent (facture vs paie) */}
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-semibold text-pr-black-soft/70">Circuit de paiement *</span>
                {(['contrat', 'franchise'] as PaymentType[]).map((pt) => (
                  <button
                    key={pt}
                    type="button"
                    onClick={() => setEntries((prev) => prev.map((row, idx) => (idx === i ? { ...row, payment_type: pt } : row)))}
                    className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                      e.payment_type === pt ? 'text-white' : 'bg-white text-pr-black-soft/60'
                    }`}
                    style={e.payment_type === pt ? { backgroundColor: PAY_COLOR[pt], borderColor: PAY_COLOR[pt] } : { borderColor: PAY_COLOR[pt], color: PAY_COLOR[pt] }}
                  >
                    {pt === 'franchise' ? 'Franchise · facture' : 'Contrat · paie'}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Input
                  label="Nom Prénom *"
                  value={e.staff_name}
                  placeholder="NOM Prénom"
                  onChange={(ev) => update(i, 'staff_name', ev.target.value)}
                  style={{ color: PAY_COLOR[e.payment_type], fontWeight: 600 }}
                />
                <Select
                  label="Mission"
                  options={MISSIONS}
                  value={e.mission_type}
                  onChange={(ev) => update(i, 'mission_type', ev.target.value)}
                />
                <Input type="date" label="Date" value={e.work_date} onChange={(ev) => update(i, 'work_date', ev.target.value)} />
                <div className="grid grid-cols-2 gap-2">
                  <Input type="time" label="Début" value={e.start_time} onChange={(ev) => update(i, 'start_time', ev.target.value)} />
                  <Input type="time" label="Fin" value={e.end_time} onChange={(ev) => update(i, 'end_time', ev.target.value)} />
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 items-end gap-2 sm:grid-cols-4">
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  label="Heures *"
                  value={e.hours_worked}
                  onChange={(ev) => update(i, 'hours_worked', ev.target.value)}
                />
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  label="€/h"
                  value={e.hourly_rate}
                  placeholder="15"
                  onChange={(ev) => update(i, 'hourly_rate', ev.target.value)}
                />
                <div className="text-sm font-medium text-pr-black">
                  {e.hours_worked && e.hourly_rate
                    ? `${(Number(e.hours_worked) * Number(e.hourly_rate)).toFixed(0)} €`
                    : '—'}
                </div>
                {entries.length > 1 && (
                  <div className="flex justify-end">
                    <button
                      onClick={() => setEntries((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-pr-black-soft/30 hover:text-pr-rust"
                      aria-label="Supprimer la ligne"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-pr-stone/60 pt-4">
          <Button variant="ghost" size="sm" onClick={() => setEntries((prev) => [...prev, emptyEntry()])}>
            <Plus className="h-4 w-4" /> Ajouter une ligne
          </Button>
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-pr-black">Total : {total.toFixed(2)} €</span>
            <Button variant="ghost" onClick={onClose}>
              Annuler
            </Button>
            <Button loading={saving} disabled={validCount === 0} onClick={handleSave}>
              Enregistrer ({validCount} ligne{validCount > 1 ? 's' : ''})
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
