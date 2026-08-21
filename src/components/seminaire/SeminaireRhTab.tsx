/**
 * SeminaireRhTab — onglet « RH & horaires » d'un séminaire (ROLE_STADE).
 *
 * Donne aux séminaires la même capacité de saisie RH que les matchs :
 *  1. Staff par espace (arrivée / départ / pause / taux) → zone_staff_hours ;
 *  2. Agents de manutention / runner (hors espace, jours de prépa) →
 *     occasional_hours (mission « manutention » / « runner » / …).
 *
 * Les deux tables alimentent directement la synthèse RH mensuelle
 * (rh_monthly_hours) sans changement de vue : la liaison est donc correcte.
 */

import { useEffect, useState } from 'react';
import { MapPin, Info } from 'lucide-react';
import type { Event } from '@/lib/types';
import type { EventSpaceWithSpace } from '@/hooks/useEvents';
import { EmptyState } from '@/components/ui';
import { OccasionalHoursPanel } from '@/components/rh/OccasionalHoursPanel';
import { SeminaireStaffHoursPanel } from './SeminaireStaffHoursPanel';

export function SeminaireRhTab({ event, spaces }: { event: Event; spaces: EventSpaceWithSpace[] }) {
  const active = spaces.filter((s) => s.spaces);
  const [spaceId, setSpaceId] = useState<string>(active[0]?.space_id ?? '');

  useEffect(() => {
    if (active.length && !active.some((s) => s.space_id === spaceId)) setSpaceId(active[0].space_id);
  }, [active, spaceId]);

  const current = active.find((s) => s.space_id === spaceId);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2 rounded-2xl border border-sky-100 bg-sky-50/60 px-4 py-3 text-sm text-sky-900">
        <Info size={16} className="mt-0.5 shrink-0 text-sky-500" />
        <p>Saisissez les horaires du staff par espace, ainsi que les agents de manutention / runner. Les heures et coûts remontent automatiquement dans la <b>synthèse RH mensuelle</b> (onglet RH Analytique).</p>
      </div>

      {active.length === 0 ? (
        <EmptyState icon={MapPin} title="Aucun espace activé" message="Activez au moins un espace (onglet « Espaces & codes ») pour saisir le staff par espace." />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-400"><MapPin size={13} /> Espace</span>
            {active.map((s) => (
              <button
                key={s.space_id}
                onClick={() => setSpaceId(s.space_id)}
                className={
                  s.space_id === spaceId
                    ? 'rounded-full bg-pr-black px-3.5 py-1.5 text-sm font-semibold text-white'
                    : 'rounded-full border border-stone-200 bg-white px-3.5 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-50'
                }
              >
                {s.spaces?.space_name ?? 'Espace'}
              </button>
            ))}
          </div>

          {current && (
            <SeminaireStaffHoursPanel
              eventId={event.event_id}
              spaceId={current.space_id}
              spaceName={current.spaces?.space_name ?? 'Espace'}
            />
          )}
        </>
      )}

      <OccasionalHoursPanel eventId={event.event_id} eventDate={event.event_date} />
    </div>
  );
}
