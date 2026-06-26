/**
 * DebriefPage (Responsable) — formulaire de débrief en 7 sections (stepper).
 * Soumission irréversible. Si déjà soumis : vue récapitulative lecture seule.
 */

import { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, MessageSquare, Send } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useOpenEventsForSpace } from '@/hooks/useEvents';
import { useDebrief } from '@/hooks/useDebriefs';
import {
  DEBRIEF_SECTIONS,
  emptyDebriefValues,
  type DebriefField,
  type DebriefFormValues,
} from '@/lib/debriefForm';
import { DebriefReadonly } from '@/components/debrief/DebriefReadonly';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  Alert,
  Button,
  EmptyState,
  Input,
  Select,
  Spinner,
  Textarea,
} from '@/components/ui';

export default function DebriefPage() {
  const { user, responsableName } = useAuth();
  const spaceId = user?.spaceId;

  if (!responsableName) return <Navigate to="/provider/home" replace />;
  if (!spaceId) {
    return (
      <Alert variant="warning" title="Espace non rattaché">
        Votre compte n'est rattaché à aucun espace.
      </Alert>
    );
  }
  return <DebriefContent spaceId={spaceId} responsable={responsableName} />;
}

function DebriefContent({
  spaceId,
  responsable,
}: {
  spaceId: string;
  responsable: string;
}) {
  const eventsQuery = useOpenEventsForSpace(spaceId);
  const event = (eventsQuery.data ?? [])[0] ?? null;
  const { debrief, submitDebrief, submitting } = useDebrief(event?.event_id, spaceId);

  const [step, setStep] = useState(0);
  const [values, setValues] = useState<DebriefFormValues>(emptyDebriefValues);
  const [error, setError] = useState<string | null>(null);

  const section = DEBRIEF_SECTIONS[step];
  const isLast = step === DEBRIEF_SECTIONS.length - 1;
  const progress = useMemo(
    () => Math.round(((step + 1) / DEBRIEF_SECTIONS.length) * 100),
    [step],
  );

  if (eventsQuery.isLoading || debrief.isLoading)
    return <Spinner fullPage label="Chargement…" />;
  if (!event) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="Aucun événement ouvert"
        message="Aucun événement n'est actuellement ouvert pour votre espace."
      />
    );
  }

  // Déjà soumis → lecture seule (irréversible).
  if (debrief.data?.submitted_at) {
    return (
      <div className="space-y-4">
        <PageHeader title="Débrief" description={event.event_name} />
        <Alert variant="success" title="Débrief soumis">
          Soumis le{' '}
          {new Date(debrief.data.submitted_at).toLocaleString('fr-FR')} par{' '}
          {debrief.data.responsable}.
        </Alert>
        <DebriefReadonly debrief={debrief.data} />
      </div>
    );
  }

  function setValue(key: string, value: string | boolean) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit() {
    setError(null);
    try {
      await submitDebrief(values, responsable);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la soumission.');
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Débrief" description={event.event_name} />

      {/* Barre de progression */}
      <div>
        <div className="mb-1 flex justify-between text-xs text-slate-500">
          <span>
            Section {step + 1} / {DEBRIEF_SECTIONS.length}
          </span>
          <span>{progress}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full bg-provence transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <h2 className="text-base font-semibold text-provence">{section.title}</h2>
      {error && <Alert variant="error">{error}</Alert>}

      <div className="space-y-3">
        {section.fields.map((field) => (
          <FieldInput
            key={field.key}
            field={field}
            value={values[field.key]}
            onChange={(v) => setValue(field.key, v)}
          />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="ghost"
          size="lg"
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
        >
          <ChevronLeft className="h-5 w-5" /> Précédent
        </Button>
        {isLast ? (
          <Button size="lg" loading={submitting} onClick={handleSubmit}>
            <Send className="h-5 w-5" /> Soumettre le débrief
          </Button>
        ) : (
          <Button size="lg" onClick={() => setStep((s) => s + 1)}>
            Suivant <ChevronRight className="h-5 w-5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: DebriefField;
  value: string | boolean;
  onChange: (value: string | boolean) => void;
}) {
  if (field.type === 'checkbox') {
    return (
      <label className="flex items-center gap-2 rounded-lg bg-white p-3 ring-1 ring-slate-200">
        <input
          type="checkbox"
          className="h-5 w-5 rounded border-slate-300 text-provence focus:ring-provence"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="text-sm font-medium text-slate-700">{field.label}</span>
      </label>
    );
  }
  if (field.type === 'textarea') {
    return (
      <Textarea
        label={field.label}
        rows={2}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (field.type === 'select') {
    return (
      <Select
        label={field.label}
        placeholder="Sélectionner…"
        options={field.options ?? []}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <Input
      type="number"
      label={field.label}
      value={String(value)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
