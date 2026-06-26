import { useState } from 'react';
import { ArrowLeft, CheckCircle2, Circle } from 'lucide-react';
import { useDebriefsForEvent } from '@/hooks/useDebriefs';
import { DebriefReadonly } from './DebriefReadonly';
import { Alert, Badge, Spinner } from '@/components/ui';
import type { EventSpaceWithSpace } from '@/hooks/useEvents';
import type { Debrief } from '@/lib/types';

export function DebriefAdminPanel({
  eventId,
  spaces,
}: {
  eventId: string;
  spaces: EventSpaceWithSpace[];
}) {
  const { data: debriefs, isLoading } = useDebriefsForEvent(eventId);
  const [selected, setSelected] = useState<Debrief | null>(null);

  if (isLoading) return <Spinner fullPage label="Chargement…" />;

  const bySpace = new Map<string, Debrief>();
  (debriefs ?? []).forEach((d) => bySpace.set(d.space_id, d));

  if (selected) {
    const space = spaces.find((s) => s.space_id === selected.space_id);
    return (
      <div className="space-y-4">
        <button
          onClick={() => setSelected(null)}
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="h-4 w-4" /> Tous les espaces
        </button>
        <h2 className="text-base font-semibold text-slate-900">
          {space?.spaces?.space_name ?? selected.space_id}
        </h2>
        <DebriefReadonly debrief={selected} />
      </div>
    );
  }

  const submittedCount = (debriefs ?? []).filter((d) => d.submitted_at).length;

  return (
    <div className="space-y-4">
      <Alert variant={submittedCount === spaces.length ? 'success' : 'info'}>
        {submittedCount} / {spaces.length} débriefs reçus.
      </Alert>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {spaces.map((s) => {
          const debrief = bySpace.get(s.space_id);
          const submitted = !!debrief?.submitted_at;
          return (
            <button
              key={s.space_id}
              disabled={!submitted}
              onClick={() => submitted && debrief && setSelected(debrief)}
              className={`flex flex-col gap-2 rounded-lg p-4 text-left ring-1 transition-colors ${
                submitted
                  ? 'bg-white ring-slate-200 hover:bg-slate-50'
                  : 'bg-slate-50 ring-slate-200 opacity-70'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-900">
                  {s.spaces?.space_name ?? s.space_id}
                </span>
                {submitted ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                ) : (
                  <Circle className="h-5 w-5 text-slate-300" />
                )}
              </div>
              {submitted && debrief ? (
                <div className="flex flex-wrap gap-1">
                  {debrief.efficacite && (
                    <Badge tone="info">Efficacité : {debrief.efficacite}</Badge>
                  )}
                  {debrief.stocks_suffisants && (
                    <Badge tone={debrief.stocks_suffisants === 'oui' ? 'success' : 'warning'}>
                      Stocks : {debrief.stocks_suffisants}
                    </Badge>
                  )}
                  {debrief.amenagement && (
                    <Badge tone="neutral">Aménagement : {debrief.amenagement}</Badge>
                  )}
                </div>
              ) : (
                <span className="text-xs text-slate-400">En attente</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
