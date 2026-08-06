/**
 * EventPlanningPage — gestion des phases opérationnelles d'un événement.
 * L'admin ajoute mise en place / démontage / îlots / autres phases avec
 * régisseur assigné ; elles apparaissent automatiquement dans le WeeklyPlanner.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Trash2, Plus, ArrowLeft, Pencil, X, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useEvent } from '@/hooks/useEvents';
import { useToast } from '@/context/ToastContext';
import { Alert, Button, Input, Select, Spinner, Textarea } from '@/components/ui';

type PhaseType = 'mise_en_place' | 'evenement' | 'demontage' | 'ilot' | 'autre';

interface Phase {
  id: string;
  phase_type: PhaseType;
  phase_date: string;
  start_time: string | null;
  end_time: string | null;
  label: string | null;
  detail: string | null;
  nb_personnes: number | null;
  regisseur: string | null;
}

const PHASE_META: Record<PhaseType, { label: string; color: string }> = {
  mise_en_place: { label: '⚙️ Mise en place', color: '#F59E0B' },
  evenement: { label: '🎯 Événement', color: '#1A1A2E' },
  demontage: { label: '📦 Démontage', color: '#EC4899' },
  ilot: { label: '🏗️ Îlot à monter', color: '#0EA5E9' },
  autre: { label: '📋 Autre', color: '#6B7280' },
};
const ADDABLE: PhaseType[] = ['mise_en_place', 'ilot', 'demontage', 'autre'];

interface Draft {
  phase_type: PhaseType;
  phase_date: string;
  start_time: string;
  end_time: string;
  label: string;
  detail: string;
  nb_personnes: string;
  regisseur: string;
}

export default function EventPlanningPage() {
  const { id } = useParams<{ id: string }>();
  const eventQuery = useEvent(id);
  const { showToast } = useToast();
  const [phases, setPhases] = useState<Phase[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const event = eventQuery.data;
  const emptyDraft = useMemo<Draft>(() => ({
    phase_type: 'mise_en_place',
    phase_date: event?.event_date ?? '',
    start_time: '', end_time: '', label: '', detail: '', nb_personnes: '', regisseur: event?.regisseur_name ?? '',
  }), [event?.event_date, event?.regisseur_name]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  // Ne réinitialise le brouillon que hors édition (évite d'écraser un formulaire ouvert).
  useEffect(() => { if (!editingId) setDraft(emptyDraft); }, [emptyDraft, editingId]);

  async function reload() {
    if (!id) return;
    const { data } = await supabase
      .from('event_planning_phases')
      .select('*')
      .eq('event_id', id)
      .order('phase_date')
      .order('start_time', { nullsFirst: true });
    setPhases((data as Phase[] | null) ?? []);
    setLoading(false);
  }
  useEffect(() => { void reload(); }, [id]);

  async function savePhase() {
    if (!id) return;
    if (!draft.phase_date) return showToast('Renseignez la date de la phase.', 'warning');
    if (!draft.label.trim()) return showToast("Renseignez l'intitulé de la phase.", 'warning');
    setSaving(true);
    const payload = {
      event_id: id,
      phase_type: draft.phase_type,
      phase_date: draft.phase_date,
      start_time: draft.start_time || null,
      end_time: draft.end_time || null,
      label: draft.label.trim() || PHASE_META[draft.phase_type].label,
      detail: draft.detail.trim() || null,
      nb_personnes: draft.nb_personnes ? Number(draft.nb_personnes) : 0,
      regisseur: draft.regisseur.trim() || null,
      color: PHASE_META[draft.phase_type].color,
    };
    const { error } = editingId
      ? await supabase.from('event_planning_phases').update(payload).eq('id', editingId)
      : await supabase.from('event_planning_phases').insert(payload);
    setSaving(false);
    if (error) return showToast(`Échec : ${error.message}`, 'warning');
    showToast(editingId ? 'Phase mise à jour.' : 'Phase ajoutée.', 'success');
    setEditingId(null);
    setDraft(emptyDraft);
    void reload();
  }

  function startEdit(p: Phase) {
    setEditingId(p.id);
    setDraft({
      phase_type: p.phase_type,
      phase_date: p.phase_date ?? '',
      start_time: p.start_time?.slice(0, 5) ?? '',
      end_time: p.end_time?.slice(0, 5) ?? '',
      label: p.label ?? '',
      detail: p.detail ?? '',
      nb_personnes: p.nb_personnes != null ? String(p.nb_personnes) : '',
      regisseur: p.regisseur ?? '',
    });
    document.getElementById('phase-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(emptyDraft);
  }

  async function removePhase(phaseId: string) {
    if (!window.confirm('Supprimer cette phase ?')) return;
    const { error } = await supabase.from('event_planning_phases').delete().eq('id', phaseId);
    if (error) return showToast(`Échec : ${error.message}`, 'warning');
    if (editingId === phaseId) cancelEdit();
    setPhases((prev) => prev.filter((p) => p.id !== phaseId));
  }

  if (eventQuery.isLoading) return <Spinner fullPage label="Chargement…" />;
  if (!event) return <Alert variant="error" title="Événement introuvable"><Link to="/admin/events" className="underline">Retour</Link></Alert>;

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }));

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <Link to={`/admin/events/${id}`} className="mb-2 inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800">
          <ArrowLeft className="h-4 w-4" /> Retour à l'événement
        </Link>
        <h1 className="font-display text-2xl font-black text-pr-black">Planning opérationnel</h1>
        <p className="text-sm text-stone-500">{event.event_name} · {new Date(event.event_date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
      </div>

      {/* Ajout / édition d'une phase */}
      <div
        id="phase-form"
        className={`space-y-4 rounded-2xl border p-5 transition-colors ${editingId ? 'border-amber-300 bg-amber-50' : 'border-pr-stone bg-white'}`}
      >
        <div className="flex items-center justify-between">
          <p className="font-semibold text-pr-black">
            {editingId ? `✏️ Modifier « ${draft.label || 'phase'} »` : 'Ajouter une phase'}
          </p>
          {editingId && (
            <button
              onClick={cancelEdit}
              className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs text-stone-500 hover:text-stone-800"
            >
              <X className="h-3.5 w-3.5" /> Annuler
            </button>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Type de phase" value={draft.phase_type} onChange={set('phase_type')}
            disabled={editingId != null && draft.phase_type === 'evenement'}
            options={(editingId != null && draft.phase_type === 'evenement'
              ? [{ value: 'evenement', label: PHASE_META.evenement.label }]
              : ADDABLE.map((t) => ({ value: t, label: PHASE_META[t].label })))} />
          <Input label="Date *" type="date" value={draft.phase_date} onChange={set('phase_date')} />
          <Input label="Heure début" type="time" value={draft.start_time} onChange={set('start_time')} />
          <Input label="Heure fin" type="time" value={draft.end_time} onChange={set('end_time')} />
          <Input label="Intitulé *" value={draft.label} onChange={set('label')} placeholder="ex. Mise en place AIRBUS" />
          <Input label="Régisseur assigné" value={draft.regisseur} onChange={set('regisseur')} placeholder="Nom du régisseur" />
          <Input label="Personnes mobilisées" type="number" min={0} value={draft.nb_personnes} onChange={set('nb_personnes')} />
        </div>
        <Textarea label="Détail" rows={2} value={draft.detail} onChange={set('detail')} placeholder="Notes / consignes de la phase" />
        <Button onClick={() => void savePhase()} disabled={saving || !draft.label.trim() || !draft.phase_date}>
          {editingId ? <><Check className="mr-1.5 h-4 w-4" /> Enregistrer les modifications</> : <><Plus className="mr-1.5 h-4 w-4" /> Ajouter la phase</>}
        </Button>
      </div>

      {/* Liste des phases */}
      <div>
        <p className="mb-3 font-semibold text-pr-black">Phases planifiées ({phases.length})</p>
        {loading ? (
          <Spinner label="Chargement…" />
        ) : phases.length === 0 ? (
          <Alert variant="info">Aucune phase pour l'instant. La phase « Événement » est créée automatiquement.</Alert>
        ) : (
          <div className="space-y-2">
            {phases.map((p) => {
              const meta = PHASE_META[p.phase_type];
              const isEditing = editingId === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => startEdit(p)}
                  className={`group flex cursor-pointer items-center gap-3 rounded-xl border bg-white p-3 transition-colors ${isEditing ? 'border-amber-300 ring-1 ring-amber-200' : 'border-pr-stone hover:border-stone-400'}`}
                >
                  <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: meta.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-pr-black">{p.label ?? meta.label}</p>
                    <p className="text-xs text-stone-500">
                      {meta.label} · {new Date(p.phase_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                      {p.start_time && ` · ${p.start_time.slice(0, 5)}`}{p.end_time && `–${p.end_time.slice(0, 5)}`}
                      {p.regisseur && ` · 👤 ${p.regisseur}`}
                      {!!p.nb_personnes && ` · 👥 ${p.nb_personnes}`}
                    </p>
                    {p.detail && <p className="mt-0.5 truncate text-xs text-stone-400">{p.detail}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => startEdit(p)}
                      className="rounded-lg p-1.5 text-stone-400 opacity-0 transition hover:bg-stone-100 hover:text-stone-700 group-hover:opacity-100"
                      aria-label="Modifier"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    {p.phase_type !== 'evenement' && (
                      <button onClick={() => void removePhase(p.id)} className="rounded-lg p-1.5 text-pr-rust transition hover:bg-red-50 hover:opacity-80" aria-label="Supprimer">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
