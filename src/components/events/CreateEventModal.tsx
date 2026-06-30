/**
 * CreateEventModal — parcours guidé de création d'événement (3 étapes).
 *   1. Type + infos générales
 *   2. Espaces mobilisés (match = tous auto / autres = sélection manuelle)
 *   3. Feuilles de route par espace (non-match uniquement, optionnel)
 */

import { useMemo, useState } from 'react';
import { X, ArrowLeft, ArrowRight, Plus, Zap, FileText } from 'lucide-react';
import { clsx } from 'clsx';
import { useSpaces } from '@/hooks/useSpaces';
import { useEventCreation } from '@/hooks/useEventCreation';
import { EVENT_TYPE_META, EVENT_TYPES } from '@/lib/eventTypes';
import { Alert, Button, Input, Select } from '@/components/ui';
import type { EventType, Space, SpaceType } from '@/lib/types';

const SPACE_TYPES: SpaceType[] = ['VIP', 'Bar', 'Buvette'];
const MAX_FILE_MB = 10;
const ACCEPT = '.pdf,.doc,.docx,.jpg,.jpeg,.png';

interface FeuilleEntry {
  file?: File;
  comment: string;
}

export function CreateEventModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (eventId: string) => void;
}) {
  const { data: spaces = [] } = useSpaces();
  const { createEvent, uploadFeuilleRoute, creating, uploading } = useEventCreation();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState('');
  const [type, setType] = useState<EventType>('match');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [attendees, setAttendees] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [feuilles, setFeuilles] = useState<Record<string, FeuilleEntry>>({});
  const [error, setError] = useState<string | null>(null);

  const isMatch = type === 'match';
  const featured = EVENT_TYPES.filter((t) => EVENT_TYPE_META[t].featured);
  const others = EVENT_TYPES.filter((t) => !EVENT_TYPE_META[t].featured);

  const grouped = useMemo(() => {
    const map = new Map<SpaceType, Space[]>();
    SPACE_TYPES.forEach((t) => map.set(t, []));
    spaces.forEach((s) => map.get(s.space_type)?.push(s));
    return map;
  }, [spaces]);

  function goStep2() {
    if (!name.trim()) return setError('Le nom de l\'événement est obligatoire.');
    if (!date) return setError('La date est obligatoire.');
    setError(null);
    // Match → pré-cocher tous les espaces ; sinon aucune présélection.
    setSelected(isMatch ? new Set(spaces.map((s) => s.space_id)) : new Set());
    setStep(2);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function handleCreate() {
    setError(null);
    if (selected.size === 0) return setError('Sélectionnez au moins un espace.');
    try {
      const { event_id } = await createEvent({
        event_name: name,
        event_type: type,
        event_date: date,
        start_time: time,
        expected_attendees: Number(attendees) || 0,
        selected_space_ids: [...selected],
      });
      // Upload des feuilles de route jointes (non-match).
      if (!isMatch) {
        for (const [spaceId, entry] of Object.entries(feuilles)) {
          if (entry.file && selected.has(spaceId)) {
            await uploadFeuilleRoute(event_id, spaceId, entry.file, entry.comment || undefined);
          }
        }
      }
      onCreated(event_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la création.');
    }
  }

  function setFile(spaceId: string, file: File | undefined) {
    if (file && file.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`${file.name} dépasse ${MAX_FILE_MB} Mo.`);
      return;
    }
    setError(null);
    setFeuilles((prev) => ({
      ...prev,
      [spaceId]: { file, comment: prev[spaceId]?.comment ?? '' },
    }));
  }

  const totalSteps = isMatch ? 2 : 3;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-pr-black/40 p-4">
      <div className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        {/* En-tête */}
        <div className="flex items-center justify-between border-b border-pr-stone px-5 py-4">
          <h2 className="font-display text-lg font-bold text-pr-black">Créer un événement</h2>
          <div className="flex items-center gap-3">
            <span className="text-sm text-pr-olive-dark">
              {step}/{totalSteps}
            </span>
            <div className="flex gap-1">
              {[1, 2, 3].slice(0, totalSteps).map((s) => (
                <span
                  key={s}
                  className={clsx('h-2 w-2 rounded-full', step >= s ? 'bg-pr-black' : 'bg-pr-stone')}
                />
              ))}
            </div>
            <button onClick={onClose} aria-label="Fermer" className="text-pr-black-soft/50 hover:text-pr-black">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && <Alert variant="error" className="mb-4">{error}</Alert>}

          {/* ÉTAPE 1 */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-sm font-medium text-pr-black-soft">Type d'événement</p>
                <div className="grid grid-cols-2 gap-2">
                  {featured.map((t) => {
                    const { label, Icon } = EVENT_TYPE_META[t];
                    const active = type === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setType(t)}
                        className={clsx(
                          'flex flex-col items-center gap-2 rounded-xl border p-4 transition-colors',
                          active
                            ? 'border-pr-black bg-pr-black text-white'
                            : 'border-pr-stone bg-white text-pr-black hover:bg-pr-cream',
                        )}
                      >
                        <Icon className="h-6 w-6" />
                        <span className="font-medium">{label}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2">
                  <Select
                    label="Autre type d'événement"
                    placeholder="— autre type —"
                    options={others.map((t) => ({ value: t, label: EVENT_TYPE_META[t].label }))}
                    value={others.includes(type) ? type : ''}
                    onChange={(e) => e.target.value && setType(e.target.value as EventType)}
                  />
                </div>
              </div>

              {isMatch ? (
                <>
                  <Input
                    label="Nom de l'événement *"
                    placeholder="Provence Rugby vs [Adversaire]"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <Input type="date" label="Date du match *" value={date} onChange={(e) => setDate(e.target.value)} />
                  <details className="mt-1">
                    <summary className="cursor-pointer text-sm text-pr-olive-dark">
                      + Plus d'options (optionnel)
                    </summary>
                    <div className="mt-3 space-y-3">
                      <Input
                        type="time"
                        label="Heure de début (défaut 19:00)"
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                      />
                      <Input
                        type="number"
                        label="Spectateurs attendus"
                        placeholder="Estimation automatique si vide"
                        value={attendees}
                        onChange={(e) => setAttendees(e.target.value)}
                      />
                    </div>
                  </details>
                </>
              ) : (
                <>
                  <Input label="Nom de l'événement *" value={name} onChange={(e) => setName(e.target.value)} />
                  <div className="grid grid-cols-2 gap-3">
                    <Input type="date" label="Date *" value={date} onChange={(e) => setDate(e.target.value)} />
                    <Input type="time" label="Heure de début" value={time} onChange={(e) => setTime(e.target.value)} />
                  </div>
                  <Input
                    type="number"
                    label="Participants attendus"
                    value={attendees}
                    onChange={(e) => setAttendees(e.target.value)}
                  />
                </>
              )}
            </div>
          )}

          {/* ÉTAPE 2 */}
          {step === 2 && (
            <div className="space-y-4">
              {isMatch ? (
                <>
                  <Alert variant="success">
                    <Zap className="mr-1 inline h-4 w-4" />
                    Match = tous les espaces du stade s'activent automatiquement.
                  </Alert>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-pr-olive-dark">
                      {selected.size}/{spaces.length} espaces ouverts
                    </p>
                    <button
                      className="text-sm font-medium text-pr-olive hover:underline"
                      onClick={() =>
                        setSelected(
                          selected.size === spaces.length
                            ? new Set()
                            : new Set(spaces.map((s) => s.space_id)),
                        )
                      }
                    >
                      {selected.size === spaces.length ? 'Tout désélectionner' : 'Tout activer'}
                    </button>
                  </div>
                  <SpaceGrid spaces={spaces} selected={selected} onToggle={toggle} />
                </>
              ) : (
                <>
                  <p className="text-sm text-pr-black-soft">
                    Sélectionnez les espaces nécessaires pour cet événement.
                  </p>
                  {SPACE_TYPES.map((st) => {
                    const items = grouped.get(st) ?? [];
                    if (items.length === 0) return null;
                    return (
                      <div key={st}>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-pr-olive-dark">
                          {st}
                        </p>
                        <SpaceGrid spaces={items} selected={selected} onToggle={toggle} />
                      </div>
                    );
                  })}
                  <p className="text-sm font-medium text-pr-black">
                    {selected.size} espace{selected.size > 1 ? 's' : ''} sélectionné
                    {selected.size > 1 ? 's' : ''}
                  </p>
                </>
              )}
            </div>
          )}

          {/* ÉTAPE 3 (non-match) */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-pr-black-soft">
                Joignez une feuille de route par espace (optionnel, modifiable plus tard).
                Formats : PDF, DOCX, JPG, PNG — max {MAX_FILE_MB} Mo.
              </p>
              {[...selected].map((sid) => {
                const space = spaces.find((s) => s.space_id === sid);
                const entry = feuilles[sid];
                return (
                  <div key={sid} className="rounded-lg border border-pr-stone p-3">
                    <p className="mb-2 flex items-center gap-2 font-medium text-pr-black">
                      <FileText className="h-4 w-4 text-pr-olive" />
                      {space?.space_name ?? sid}
                    </p>
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-pr-stone px-3 py-2 text-sm text-pr-black-soft hover:bg-pr-cream">
                      <input
                        type="file"
                        accept={ACCEPT}
                        className="hidden"
                        onChange={(e) => setFile(sid, e.target.files?.[0])}
                      />
                      {entry?.file ? entry.file.name : 'Glisser un fichier ou parcourir'}
                    </label>
                    <Input
                      className="mt-2"
                      placeholder="Commentaire (optionnel)"
                      value={entry?.comment ?? ''}
                      onChange={(e) =>
                        setFeuilles((prev) => ({
                          ...prev,
                          [sid]: { file: prev[sid]?.file, comment: e.target.value },
                        }))
                      }
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pied — navigation */}
        <div className="flex items-center justify-between border-t border-pr-stone px-5 py-4">
          {step === 1 ? (
            <Button variant="ghost" onClick={onClose}>Annuler</Button>
          ) : (
            <Button variant="ghost" onClick={() => setStep((s) => (s - 1) as 1 | 2)}>
              <ArrowLeft className="h-4 w-4" /> Retour
            </Button>
          )}

          {step === 1 && (
            <Button onClick={goStep2}>
              Suivant <ArrowRight className="h-4 w-4" />
            </Button>
          )}
          {step === 2 &&
            (isMatch ? (
              <Button loading={creating || uploading} onClick={handleCreate}>
                <Plus className="h-4 w-4" /> Créer l'événement
              </Button>
            ) : (
              <Button disabled={selected.size === 0} onClick={() => setStep(3)}>
                Suivant <ArrowRight className="h-4 w-4" />
              </Button>
            ))}
          {step === 3 && (
            <Button loading={creating || uploading} onClick={handleCreate}>
              <Plus className="h-4 w-4" /> Créer l'événement
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function SpaceGrid({
  spaces,
  selected,
  onToggle,
}: {
  spaces: Space[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1">
      {spaces.map((s) => (
        <label
          key={s.space_id}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-pr-cream"
        >
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-pr-stone text-pr-olive focus:ring-pr-olive"
            checked={selected.has(s.space_id)}
            onChange={() => onToggle(s.space_id)}
          />
          {s.space_name}
        </label>
      ))}
    </div>
  );
}
