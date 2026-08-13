import { useState } from 'react';
import { Zap, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useRunnerPlanning } from '@/hooks/useRunnerPlanning';
import { useToast } from '@/context/ToastContext';
import { supabase } from '@/lib/supabase';
import { WEATHER_LABELS, TREND_LABELS } from '@/lib/runnerCalculations';
import { Alert, Button, Input, Select } from '@/components/ui';
import type { ConsumptionTrend, WeatherType } from '@/lib/types';
import type { EventSpaceWithSpace } from '@/hooks/useEvents';

/** Référence automatique (match précédent via chaînage) + profondeur de chaîne. */
function useAutoReference(eventId: string) {
  return useQuery({
    queryKey: ['runnerAutoRef', eventId],
    queryFn: async (): Promise<{ previousName: string | null; chain: number }> => {
      const { data: cur } = await supabase
        .from('events')
        .select('previous_event_id, event_date')
        .eq('event_id', eventId)
        .single();
      if (!cur?.previous_event_id) return { previousName: null, chain: 0 };
      const { data: prev } = await supabase
        .from('events')
        .select('event_name')
        .eq('event_id', cur.previous_event_id)
        .maybeSingle();
      const { count } = await supabase
        .from('events')
        .select('*', { count: 'exact', head: true })
        .eq('event_type', 'match')
        .lt('event_date', cur.event_date);
      return { previousName: prev?.event_name ?? null, chain: Math.min(count ?? 0, 5) };
    },
  });
}

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
  const { showToast } = useToast();
  const autoRef = useAutoReference(eventId);

  // Split affluence : VIP & Bars (capacité fixe) vs Grand Public (buvettes).
  const splitInfo = useQuery({
    queryKey: ['runnerSplit', eventId],
    queryFn: async (): Promise<{ expected: number | null; gpRef: number | null }> => {
      const [ev, cfg] = await Promise.all([
        supabase.from('events').select('expected_attendees').eq('event_id', eventId).single(),
        supabase.from('attendance_config').select('reference_gp_pax').eq('id', 1).maybeSingle(),
      ]);
      return {
        expected: (ev.data?.expected_attendees as number | null) ?? null,
        gpRef: (cfg.data?.reference_gp_pax as number | null) ?? null,
      };
    },
  });
  // Pax effectif VIP/Bar = expected_pax saisi (event_spaces) sinon capacité
  // (spaces.max_pax). Reflète la population réelle paramétrée par espace.
  const vipPax = spaces
    .filter((s) => s.spaces?.service_type === 'vip' || s.spaces?.service_type === 'bar')
    .reduce((sum, s) => sum + (s.expected_pax ?? s.spaces?.max_pax ?? 0), 0);
  const expectedPax = splitInfo.data?.expected ?? null;
  const gpPax = expectedPax != null ? Math.max(expectedPax - vipPax, 0) : null;
  const gpRef = splitInfo.data?.gpRef ?? null;

  const [weather, setWeather] = useState<WeatherType>('normal');
  const [temperature, setTemperature] = useState('18');
  const [trend, setTrend] = useState<ConsumptionTrend>('stable');
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
      const result = await generateRunnerPlans({
        event_id: eventId,
        space_ids: [...selected],
        weather_type: weather,
        temperature: Number(temperature) || 0,
        consumption_trend: trend,
      });
      const gp = result?.grand_public_pax;
      const ratio = result?.ratio_grand_public;
      const split =
        gp != null && ratio != null
          ? ` · Grand Public ${gp} (×${ratio.toFixed(2)}) / VIP ${result?.vip_pax ?? 0}`
          : '';
      showToast(`${result?.lignes_generees ?? 0} dotations générées${split}`, 'success');
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

          {/* Référence automatique (chaînage) — lecture seule */}
          {autoRef.data?.previousName ? (
            <Alert variant="success" title="📊 Référence automatique">
              Match précédent : <strong>{autoRef.data.previousName}</strong>
              <br />
              Chaîne historique : {autoRef.data.chain} match(s) disponible(s) pour le calcul.
            </Alert>
          ) : (
            <Alert variant="warning" title="Aucun historique disponible">
              Les recommandations seront basées sur les modèles de base
              (runner_templates) uniquement.
            </Alert>
          )}

          {/* Split affluence VIP / Grand Public (calibrage des buvettes). */}
          {expectedPax != null ? (
            <div className="rounded-lg bg-slate-50 p-3 text-sm ring-1 ring-slate-200">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-lg font-bold text-provence">{expectedPax}</p>
                  <p className="text-xs text-slate-500">Affluence</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-provence">{vipPax}</p>
                  <p className="text-xs text-slate-500">VIP &amp; Bars</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-provence">{gpPax}</p>
                  <p className="text-xs text-slate-500">Grand Public</p>
                </div>
              </div>
              {gpRef != null && (
                <p className="mt-2 text-xs text-slate-500">
                  🍺 Buvettes calibrées pour ~{gpPax} spectateurs Grand Public (réf. Vannes {gpRef}).
                </p>
              )}
            </div>
          ) : (
            <Alert variant="warning" title="Affluence non renseignée">
              Saisissez l'affluence attendue de l'événement pour calibrer les buvettes
              (sinon dotations de référence appliquées).
            </Alert>
          )}

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
