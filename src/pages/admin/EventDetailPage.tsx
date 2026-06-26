import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { clsx } from 'clsx';
import { useEvent, useEventSpaces } from '@/hooks/useEvents';
import { EVENT_STATUS_META } from '@/lib/labels';
import { StockDotationsTable } from '@/components/stock/StockDotationsTable';
import { ProvidersPanel } from '@/components/providers/ProvidersPanel';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, Badge, Select, Spinner } from '@/components/ui';

type Tab = 'stocks' | 'prestataires' | 'horaires' | 'debriefs';

const TABS: { key: Tab; label: string }[] = [
  { key: 'stocks', label: 'Stocks & Dotations' },
  { key: 'prestataires', label: 'Prestataires' },
  { key: 'horaires', label: 'Horaires Staff' },
  { key: 'debriefs', label: 'Débriefs' },
];

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const eventQuery = useEvent(id);
  const spacesQuery = useEventSpaces(id);
  const [tab, setTab] = useState<Tab>('stocks');
  const [spaceId, setSpaceId] = useState<string>('');

  if (eventQuery.isLoading) return <Spinner fullPage label="Chargement…" />;
  const event = eventQuery.data;
  if (!event) {
    return (
      <Alert variant="error" title="Événement introuvable">
        <Link to="/admin/events" className="underline">
          Retour à la liste des événements
        </Link>
      </Alert>
    );
  }

  const spaces = spacesQuery.data ?? [];
  const selectedSpace = spaceId || spaces[0]?.space_id || '';
  const status = EVENT_STATUS_META[event.status];

  return (
    <div>
      <Link
        to="/admin/events"
        className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" /> Événements
      </Link>

      <PageHeader
        title={event.event_name}
        description={`${new Date(event.event_date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${event.start_time ? ` · ${event.start_time.slice(0, 5)}` : ''}${event.expected_attendees ? ` · ${event.expected_attendees} spectateurs` : ''}`}
        action={<Badge tone={status.tone}>{status.label}</Badge>}
      />

      {/* Onglets */}
      <div className="mb-5 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === t.key
                ? 'border-provence text-provence'
                : 'border-transparent text-slate-500 hover:text-slate-700',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Sélecteur d'espace (commun aux onglets par espace) */}
      {spaces.length > 0 && (
        <div className="mb-4 max-w-xs">
          <Select
            label="Espace"
            value={selectedSpace}
            onChange={(e) => setSpaceId(e.target.value)}
            options={spaces.map((s) => ({
              value: s.space_id,
              label: s.spaces?.space_name ?? s.space_id,
            }))}
          />
        </div>
      )}

      {/* Contenu */}
      {tab === 'stocks' &&
        (selectedSpace ? (
          <StockDotationsTable eventId={event.event_id} spaceId={selectedSpace} />
        ) : (
          <Alert variant="info">Aucun espace activé pour cet événement.</Alert>
        ))}

      {tab === 'prestataires' && (
        <ProvidersPanel eventId={event.event_id} spaces={spaces} />
      )}
      {tab === 'horaires' && (
        <Alert variant="info">Horaires staff — à venir (Phase 5).</Alert>
      )}
      {tab === 'debriefs' && (
        <Alert variant="info">Débriefs — à venir (Phase 5).</Alert>
      )}
    </div>
  );
}
