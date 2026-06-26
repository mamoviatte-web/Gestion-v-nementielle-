import { useState } from 'react';
import {
  Badge,
  Button,
  Input,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui';
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

interface PresenceTableProps {
  providers: ProviderPresence[];
  spaceNameOf: (spaceId: string | null) => string;
  onSetArrival: (id: string, time: string) => void;
  onSetDeparture: (id: string, time: string) => void;
  disabled?: boolean;
}

/** Tableau complet des prestataires (admin desktop), avec édition inline. */
export function PresenceTable({
  providers,
  spaceNameOf,
  onSetArrival,
  onSetDeparture,
  disabled,
}: PresenceTableProps) {
  const [editId, setEditId] = useState<string | null>(null);
  const [time, setTime] = useState('');

  return (
    <Table>
      <THead>
        <TR>
          <TH>Société</TH>
          <TH>Type</TH>
          <TH>Espace</TH>
          <TH>Contact</TH>
          <TH>Arr. prévue</TH>
          <TH>Arr. réelle</TH>
          <TH className="text-right">Retard</TH>
          <TH className="text-right">Durée</TH>
          <TH>Départ</TH>
          <TH>Statut</TH>
          <TH>Observation</TH>
          <TH />
        </TR>
      </THead>
      <TBody>
        {providers.map((p) => {
          const status = computeProviderStatus(p);
          const meta = PROVIDER_STATUS_META[status];
          const delay =
            p.planned_arrival_time && p.actual_arrival_time
              ? computeProviderDelay(p.planned_arrival_time, p.actual_arrival_time)
              : null;
          const duration =
            p.actual_arrival_time && p.actual_departure_time
              ? computePresenceDuration(p.actual_arrival_time, p.actual_departure_time)
              : null;
          const editing = editId === p.provider_presence_id;
          const needsArrival = !p.actual_arrival_time;

          return (
            <TR key={p.provider_presence_id}>
              <TD className="font-medium text-slate-900">{p.provider_company}</TD>
              <TD>{PROVIDER_TYPE_LABELS[p.provider_type]}</TD>
              <TD>{spaceNameOf(p.space_id)}</TD>
              <TD>
                {p.provider_contact_name ?? '—'}
                {p.provider_phone ? ` · ${p.provider_phone}` : ''}
              </TD>
              <TD>{p.planned_arrival_time?.slice(0, 5) ?? '—'}</TD>
              <TD>{p.actual_arrival_time?.slice(0, 5) ?? '—'}</TD>
              <TD className="text-right">
                {delay === null ? (
                  '—'
                ) : (
                  <span className={`font-medium ${delayTextClass(delay)}`}>
                    {delay > 0 ? '+' : ''}
                    {delay}
                  </span>
                )}
              </TD>
              <TD className="text-right">
                {duration === null ? '—' : formatHours(duration)}
              </TD>
              <TD>{p.actual_departure_time?.slice(0, 5) ?? '—'}</TD>
              <TD>
                <Badge tone={meta.tone}>{meta.label}</Badge>
              </TD>
              <TD className="max-w-[16rem] truncate" >{p.comment ?? '—'}</TD>
              <TD>
                {editing ? (
                  <div className="flex items-center gap-1">
                    <Input
                      type="time"
                      aria-label="Heure"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                    />
                    <Button
                      size="sm"
                      disabled={disabled || !time}
                      onClick={() => {
                        if (needsArrival) onSetArrival(p.provider_presence_id, time);
                        else onSetDeparture(p.provider_presence_id, time);
                        setEditId(null);
                        setTime('');
                      }}
                    >
                      OK
                    </Button>
                  </div>
                ) : (
                  status !== 'terminé' &&
                  status !== 'annulé' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditId(p.provider_presence_id);
                        setTime('');
                      }}
                    >
                      {needsArrival ? 'Arrivée' : 'Départ'}
                    </Button>
                  )
                )}
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}
