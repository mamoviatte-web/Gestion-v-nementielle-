import { useMemo, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { useProviders, type NewProvider } from '@/hooks/useProviders';
import { PROVIDER_STATUS_META, PROVIDER_TYPE_OPTIONS } from '@/lib/labels';
import { ProviderCard } from './ProviderCard';
import { PresenceTable } from './PresenceTable';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Input,
  Select,
  Spinner,
} from '@/components/ui';
import { Users } from 'lucide-react';
import type { EventSpaceWithSpace } from '@/hooks/useEvents';
import type { ProviderType } from '@/lib/types';

const EMPTY_FORM = {
  provider_company: '',
  provider_type: 'traiteur' as ProviderType,
  space_id: '',
  provider_contact_name: '',
  provider_phone: '',
  planned_arrival_time: '',
  planned_end_time: '',
};

export function ProvidersPanel({
  eventId,
  spaces,
}: {
  eventId: string;
  spaces: EventSpaceWithSpace[];
}) {
  const { providers, stats, addProvider, updateArrival, updateStatus, submitting } =
    useProviders(eventId);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const spaceNameOf = useMemo(() => {
    const map = new Map<string, string>();
    spaces.forEach((s) => map.set(s.space_id, s.spaces?.space_name ?? s.space_id));
    return (spaceId: string | null) =>
      spaceId ? (map.get(spaceId) ?? spaceId) : 'Tout le stade';
  }, [spaces]);

  async function handleAdd() {
    setError(null);
    if (!form.provider_company.trim()) {
      setError('La société est obligatoire.');
      return;
    }
    const payload: NewProvider = {
      provider_company: form.provider_company,
      provider_type: form.provider_type,
      space_id: form.space_id || null,
      provider_contact_name: form.provider_contact_name,
      provider_phone: form.provider_phone,
      planned_arrival_time: form.planned_arrival_time,
      planned_end_time: form.planned_end_time,
    };
    try {
      await addProvider(payload);
      setForm(EMPTY_FORM);
      setShowForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de l\'ajout.');
    }
  }

  if (providers.isLoading) return <Spinner fullPage label="Chargement…" />;
  const list = providers.data ?? [];

  return (
    <div className="space-y-4">
      {/* Barre de résumé */}
      <div className="flex flex-wrap items-center gap-2">
        {(['prévu', 'présent', 'en_retard', 'terminé', 'absent'] as const).map((k) => (
          <Badge key={k} tone={PROVIDER_STATUS_META[k].tone}>
            {stats[k]} {PROVIDER_STATUS_META[k].label.toLowerCase()}
          </Badge>
        ))}
        <div className="ml-auto">
          <Button size="sm" onClick={() => setShowForm((v) => !v)}>
            <UserPlus className="h-4 w-4" /> Ajouter un prestataire
          </Button>
        </div>
      </div>

      {/* Alerte retard (RG-008) */}
      {stats.en_retard > 0 && (
        <Alert variant="error" title={`${stats.en_retard} prestataire(s) en retard (> 15 min) — RG-008`}>
          Vérifiez les arrivées et relancez si nécessaire.
        </Alert>
      )}

      {/* Formulaire d'ajout */}
      {showForm && (
        <div className="space-y-3 rounded-lg bg-white p-4 ring-1 ring-slate-200">
          {error && <Alert variant="error">{error}</Alert>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="Société *"
              value={form.provider_company}
              onChange={(e) => setForm({ ...form, provider_company: e.target.value })}
            />
            <Select
              label="Type *"
              options={PROVIDER_TYPE_OPTIONS}
              value={form.provider_type}
              onChange={(e) =>
                setForm({ ...form, provider_type: e.target.value as ProviderType })
              }
            />
            <Select
              label="Espace (optionnel)"
              placeholder="Tout le stade"
              options={[
                { value: '', label: 'Tout le stade' },
                ...spaces.map((s) => ({
                  value: s.space_id,
                  label: s.spaces?.space_name ?? s.space_id,
                })),
              ]}
              value={form.space_id}
              onChange={(e) => setForm({ ...form, space_id: e.target.value })}
            />
            <Input
              label="Contact"
              value={form.provider_contact_name}
              onChange={(e) =>
                setForm({ ...form, provider_contact_name: e.target.value })
              }
            />
            <Input
              label="Téléphone"
              value={form.provider_phone}
              onChange={(e) => setForm({ ...form, provider_phone: e.target.value })}
            />
            <Input
              type="time"
              label="Arrivée prévue"
              value={form.planned_arrival_time}
              onChange={(e) =>
                setForm({ ...form, planned_arrival_time: e.target.value })
              }
            />
            <Input
              type="time"
              label="Fin prévue"
              value={form.planned_end_time}
              onChange={(e) => setForm({ ...form, planned_end_time: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowForm(false)}>
              Annuler
            </Button>
            <Button loading={submitting} onClick={handleAdd}>
              Ajouter
            </Button>
          </div>
        </div>
      )}

      {list.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Aucun prestataire"
          message="Ajoutez les prestataires attendus pour cet événement."
        />
      ) : (
        <>
          {/* Desktop : tableau complet */}
          <div className="hidden md:block">
            <PresenceTable
              providers={list}
              spaceNameOf={spaceNameOf}
              onSetArrival={(id, t) => void updateArrival(id, t)}
              onSetDeparture={(id, t) =>
                void updateStatus(id, { actual_departure_time: t })
              }
              disabled={submitting}
            />
          </div>
          {/* Mobile : cartes */}
          <div className="grid grid-cols-1 gap-3 md:hidden">
            {list.map((p) => (
              <ProviderCard
                key={p.provider_presence_id}
                provider={p}
                spaceName={spaceNameOf(p.space_id)}
                onSetArrival={(id, t) => void updateArrival(id, t)}
                onSetDeparture={(id, t) =>
                  void updateStatus(id, { actual_departure_time: t })
                }
                disabled={submitting}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
