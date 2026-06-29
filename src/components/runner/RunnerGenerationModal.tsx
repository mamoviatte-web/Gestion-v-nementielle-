import { useState } from 'react';
import { Zap, X } from 'lucide-react';
import { useEventsList } from '@/hooks/useEvents';
import { useRunnerPlanning } from '@/hooks/useRunnerPlanning';
import { WEATHER_LABELS, TREND_LABELS } from '@/lib/runnerCalculations';
import { Alert, Button, Input, Select } from '@/components/ui';
import type { ConsumptionTrend, WeatherType } from '@/lib/types';
import type { EventSpaceWithSpace } from '@/hooks/useEvents';

const WEATHER_OPTIONS = (Object.keys(WEATHER_LABELS) as WeatherType[]).map((w) => ({
  value: w,
  label: WEATHER_LABELS[w],
}));
const TREND_OPTIONS = (Object.keys(TREND_LABELS) as ConsumptionTrend[]).map((t) => ({
  value: t,
  label: TREND_LABELS[t],
}));

export function RunnerGenerationModal({
  eventId,
  spaces,
  onClose,
  onGenerated,
}: {
  eventId: string;
  spaces: EventSpaceWithSpace[];
  onClose: () => void;
  onGenerated: () => void;
}) {
  const { generateRunnerPlans, submitting } = useRunnerPlanning(eventId);
  const events = useEventsList();
  const archived = (events.data ?? []).filter(
    (e) => e.event_id !== eventId && (e.status === 'archivé' || e.status === 'clôturé'),
  );

  const [weather, setWeather] = useState<WeatherType>('normal');
  const [temperature, setTemperature] = useState('18');
  const [trend, setTrend] = useState<ConsumptionTrend>('stable');
  const [referenceId, setReferenceId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(spaces.map((s) => s.space_id)),
  );
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleGenerate() {
    setError(null);
    if (selected.size === 0) {
      setError('Sélectionnez au moins un espace.');
      return;
    }
    try {
      await generateRunnerPlans({
        event_id: eventId,
        space_ids: [...selected],
        weather_type: weather,
        temperature: Number(temperature) || 0,
        consumption_trend: trend,
        reference_event_id: referenceId || undefined,
      });
      onGenerated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la génération.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold text-provence">
            <Zap className="h-5 w-5" /> Générer les dotations runner
          </h2>
          <button onClick={onClose} aria-label="Fermer" className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && <Alert variant="error" className="mb-3">{error}</Alert>}

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Météo"
              options={WEATHER_OPTIONS}
              value={weather}
              onChange={(e) => setWeather(e.target.value as WeatherType)}
            />
            <Input
              type="number"
              label="Température (°C)"
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
            />
          </div>
          <Select
            label="Tendance de consommation"
            options={TREND_OPTIONS}
            value={trend}
            onChange={(e) => setTrend(e.target.value as ConsumptionTrend)}
          />
          <Select
            label="Événement de référence (optionnel)"
            placeholder="Aucun"
            options={[
              { value: '', label: 'Aucun' },
              ...archived.map((e) => ({
                value: e.event_id,
                label: `${e.event_name} — ${new Date(e.event_date).toLocaleDateString('fr-FR')}`,
              })),
            ]}
            value={referenceId}
            onChange={(e) => setReferenceId(e.target.value)}
          />

          <div>
            <p className="mb-1 text-sm font-medium text-slate-700">Espaces à inclure</p>
            <div className="grid max-h-40 grid-cols-1 gap-1 overflow-y-auto rounded-lg ring-1 ring-slate-200 p-2 sm:grid-cols-2">
              {spaces.map((s) => (
                <label key={s.space_id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-provence focus:ring-provence"
                    checked={selected.has(s.space_id)}
                    onChange={() => toggle(s.space_id)}
                  />
                  {s.spaces?.space_name ?? s.space_id}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button loading={submitting} onClick={handleGenerate}>
            <Zap className="h-4 w-4" /> Générer les fiches runner
          </Button>
        </div>
      </div>
    </div>
  );
}
