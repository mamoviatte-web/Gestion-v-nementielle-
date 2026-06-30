/**
 * Modales de suppression d'événement (ROLE_STADE).
 *  - ConfirmDeleteModal : suppression unitaire, « tapez le nom » pour confirmer.
 *  - BulkDeleteModal : suppression en masse, taper « SUPPRIMER ».
 */

import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useEventDeletion, useDeletionSummary } from '@/hooks/useEventDeletion';
import { useToast } from '@/context/ToastContext';
import { Alert, Button, Input } from '@/components/ui';
import type { Event } from '@/lib/types';

function SummaryLines({ eventId }: { eventId: string }) {
  const { data: s } = useDeletionSummary(eventId);
  if (!s) return null;
  const rows = (
    [
      ['lignes de stock', s.stockLines],
      ['mouvements de stock', s.movements],
      ['prestataires', s.providers],
      ['horaires staff', s.schedules],
      ['débriefs', s.debriefs],
      ['fiches runner', s.runnerPlans],
      ['pièces jointes', s.attachments],
    ] as [string, number][]
  ).filter(([, n]) => n > 0);
  if (rows.length === 0) return <p className="text-sm text-pr-black-soft/60">Aucune donnée liée.</p>;
  return (
    <ul className="list-inside list-disc text-sm text-pr-black-soft">
      {rows.map(([label, n]) => (
        <li key={label}>
          {n} {label}
        </li>
      ))}
    </ul>
  );
}

export function ConfirmDeleteModal({
  event,
  onClose,
  onDeleted,
}: {
  event: Event;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { deleteEvent, deleting } = useEventDeletion();
  const { showToast } = useToast();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canDelete = text.trim() === event.event_name;

  async function handleDelete() {
    if (!canDelete) return;
    setError(null);
    try {
      await deleteEvent(event.event_id);
      showToast(`« ${event.event_name} » supprimé.`, 'success');
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la suppression.');
    }
  }

  return (
    <Shell title="Supprimer l'événement" onClose={onClose}>
      <Alert variant="error" title={`Supprimer « ${event.event_name} » ?`}>
        Action irréversible. Cela supprimera également :
      </Alert>
      <div className="my-3">
        <SummaryLines eventId={event.event_id} />
      </div>
      <p className="mb-3 text-xs text-pr-black-soft/70">
        Si un match suivant existe, son chaînage (previous_event_id) sera réinitialisé.
      </p>
      {error && <Alert variant="error" className="mb-3">{error}</Alert>}
      <Input
        label="Pour confirmer, tapez le nom de l'événement"
        placeholder={event.event_name}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Annuler</Button>
        <Button variant="danger" disabled={!canDelete} loading={deleting} onClick={handleDelete}>
          Supprimer définitivement
        </Button>
      </div>
    </Shell>
  );
}

export function BulkDeleteModal({
  events,
  onClose,
  onDeleted,
}: {
  events: Event[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { bulkDelete, deleting } = useEventDeletion();
  const { showToast } = useToast();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canDelete = text.trim().toUpperCase() === 'SUPPRIMER';

  async function handleDelete() {
    if (!canDelete) return;
    setError(null);
    try {
      await bulkDelete(events.map((e) => e.event_id));
      showToast(`${events.length} événement(s) supprimé(s).`, 'success');
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la suppression.');
    }
  }

  return (
    <Shell title="Supprimer la sélection" onClose={onClose}>
      <Alert variant="error" title={`Supprimer ${events.length} événement(s) ?`}>
        Action irréversible. Toutes les données liées seront supprimées.
      </Alert>
      <ul className="my-3 max-h-40 list-inside list-disc overflow-y-auto text-sm text-pr-black-soft">
        {events.map((e) => (
          <li key={e.event_id}>{e.event_name}</li>
        ))}
      </ul>
      {error && <Alert variant="error" className="mb-3">{error}</Alert>}
      <Input
        label="Tapez SUPPRIMER pour confirmer"
        placeholder="SUPPRIMER"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Annuler</Button>
        <Button variant="danger" disabled={!canDelete} loading={deleting} onClick={handleDelete}>
          Supprimer définitivement
        </Button>
      </div>
    </Shell>
  );
}

function Shell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-pr-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-pr-rust">
            <AlertTriangle className="h-5 w-5" /> {title}
          </h2>
          <button onClick={onClose} aria-label="Fermer" className="text-pr-black-soft/50 hover:text-pr-black">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
