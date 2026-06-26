import { useMemo } from 'react';
import { useSpaces } from '@/hooks/useSpaces';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, Badge, Spinner } from '@/components/ui';
import type { Space, SpaceType } from '@/lib/types';

const TYPES: SpaceType[] = ['VIP', 'Bar', 'Buvette'];

export default function SpacesPage() {
  const { data: spaces, isLoading } = useSpaces();

  const grouped = useMemo(() => {
    const map = new Map<SpaceType, Space[]>();
    TYPES.forEach((t) => map.set(t, []));
    (spaces ?? []).forEach((s) => map.get(s.space_type)?.push(s));
    return map;
  }, [spaces]);

  if (isLoading) return <Spinner fullPage label="Chargement…" />;

  return (
    <div>
      <PageHeader
        title="Espaces"
        description="Les 16 espaces du stade et leurs codes d'accès."
      />

      <Alert variant="warning" title="Confidentialité" className="mb-5">
        Les codes d'accès servent d'identifiant aux responsables d'espace. Ne
        les diffusez qu'aux personnes concernées.
      </Alert>

      <div className="space-y-6">
        {TYPES.map((type) => {
          const items = grouped.get(type) ?? [];
          if (items.length === 0) return null;
          return (
            <section key={type}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                {type} ({items.length})
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((s) => (
                  <div
                    key={s.space_id}
                    className="flex items-center justify-between gap-3 rounded-lg bg-white p-4 ring-1 ring-slate-200"
                  >
                    <div>
                      <p className="font-medium text-slate-900">{s.space_name}</p>
                      <Badge tone="neutral">{s.space_type}</Badge>
                    </div>
                    <code className="rounded bg-black px-2.5 py-1 font-mono text-sm font-semibold text-green-400">
                      {s.access_code}
                    </code>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
