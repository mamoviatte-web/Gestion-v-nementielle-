import { useState } from 'react';
import { Clock, LogOut } from 'lucide-react';
import { Badge, Button, Input } from '@/components/ui';
import {
  computeProviderDelay,
  computeProviderStatus,
  computePresenceDuration,
  formatHours,
} from '@/lib/calculations';
import {
  PROVIDER_STATUS_META,
  PROVIDER_TYPE_LABELS,
  delayTextClass,
} from '@/lib/labels';
import type { ProviderPresence } from '@/lib/types';

interface ProviderCardProps {
  provider: ProviderPresence;
  spaceName: string;
  onSetArrival: (id: string, time: string) => void;
  onSetDeparture: (id: string, time: string) => void;
  disabled?: boolean;
}

/** Carte prestataire (mobile) — infos, retard, durée, saisie horaires réels. */
export function ProviderCard({
  provider,
  spaceName,
  onSetArrival,
  onSetDeparture,
  disabled,
}: ProviderCardProps) {
  const [arrival, setArrival] = useState('');
  const [departure, setDeparture] = useState('');

  const status = computeProviderStatus(provider);
  const meta = PROVIDER_STATUS_META[status];
  const delay =
    provider.planned_arrival_time && provider.actual_arrival_time
      ? computeProviderDelay(provider.planned_arrival_time, provider.actual_arrival_time)
      : null;
  const duration =
    provider.actual_arrival_time && provider.actual_departure_time
      ? computePresenceDuration(provider.actual_arrival_time, provider.actual_departure_time)
      : null;

  return (
    <div className="space-y-2 rounded-lg bg-white p-4 ring-1 ring-slate-200">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900">
            {provider.provider_company}
          </p>
          <p className="text-xs text-slate-500">
            {PROVIDER_TYPE_LABELS[provider.provider_type]} · {spaceName}
          </p>
        </div>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-slate-500">Arr. prévue</dt>
          <dd>{provider.planned_arrival_time?.slice(0, 5) ?? '—'}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-500">Arr. réelle</dt>
          <dd>{provider.actual_arrival_time?.slice(0, 5) ?? '—'}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-500">Retard</dt>
          <dd>
            {delay === null ? (
              '—'
            ) : (
              <span className={`font-medium ${delayTextClass(delay)}`}>
                {delay > 0 ? '+' : ''}
                {delay} min
              </span>
            )}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-500">Durée</dt>
          <dd>{duration === null ? '—' : formatHours(duration)}</dd>
        </div>
      </dl>

      {/* Saisie de l'arrivée réelle */}
      {!provider.actual_arrival_time && status !== 'annulé' && (
        <div className="flex items-end gap-2 pt-1">
          <Input
            type="time"
            label="Arrivée réelle"
            value={arrival}
            onChange={(e) => setArrival(e.target.value)}
          />
          <Button
            size="sm"
            disabled={disabled || !arrival}
            onClick={() => onSetArrival(provider.provider_presence_id, arrival)}
          >
            <Clock className="h-4 w-4" /> Enregistrer
          </Button>
        </div>
      )}

      {/* Saisie du départ réel */}
      {provider.actual_arrival_time && !provider.actual_departure_time && (
        <div className="flex items-end gap-2 pt-1">
          <Input
            type="time"
            label="Départ réel"
            value={departure}
            onChange={(e) => setDeparture(e.target.value)}
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled || !departure}
            onClick={() => onSetDeparture(provider.provider_presence_id, departure)}
          >
            <LogOut className="h-4 w-4" /> Départ
          </Button>
        </div>
      )}
    </div>
  );
}
