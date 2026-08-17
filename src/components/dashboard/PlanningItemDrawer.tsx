/**
 * PlanningItemDrawer — panneau latéral de détail/édition d'un item de planning.
 * Tâche (kind='phase') : tous les champs éditables via phase_upsert ; suppression
 * (phase_delete) et validation (phase_set_validated). Événement (kind='event') :
 * récap en lecture seule + lien « Ouvrir l'événement » (jamais supprimable ici).
 * RG-003 : écritures réservées ROLE_STADE (garde base sur les RPC phase_*).
 */

import { useEffect, useMemo, useState } from 'react';
import { X, Trash2, ExternalLink, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';

export interface PlanningItem {
  id: string;
  kind: 'event' | 'phase';
  date: string;
  event_id: string;
  event_name: string;
  event_type: string | null;
  event_status: string;
  phase_type: string;
  label: string | null;
  detail: string | null;
  start_time: string | null;
  end_time: string | null;
  nb_personnes: number | null;
  regisseur: string | null;
  color: string | null;
  is_validated: boolean;
  space_id: string | null;
  space: string | null;
}

export interface EventOpt { event_id: string; event_name: string; event_date: string; event_type: string | null; }
export interface SpaceOpt { space_id: string; space_name: string; }

/** Types de phase éditables (« Événement » exclu). */
const PHASE_TYPES = ['mise_en_place', 'demontage', 'livraison', 'rh', 'nettoyage', 'autre'] as const;
export const PHASE_LABEL: Record<string, string> = {
  evenement: 'Événement', mise_en_place: 'Mise en place', demontage: 'Démontage',
  livraison: 'Livraison', rh: 'RH', nettoyage: 'Nettoyage', autre: 'Autre',
};
const TYPE_COLOR: Record<string, string> = {
  mise_en_place: '#F59E0B', demontage: '#EC4899', livraison: '#10B981',
  rh: '#2F6FED', nettoyage: '#0E7C7B', autre: '#6B7280',
};

const hhmm = (t: string | null): string => (t ? t.slice(0, 5) : '');

export function PlanningItemDrawer({
  item, defaultDate, defaultEventId, events, spaces, onClose, onSaved,
}: {
  /** Item existant (édition) ou null (création). */
  item: PlanningItem | null;
  defaultDate?: string;
  defaultEventId?: string;
  events: EventOpt[];
  spaces: SpaceOpt[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const isEvent = item?.kind === 'event';

  // BLOC 2 — le menu ne liste que les événements à venir (events), mais une tâche
  // déjà rattachée à un événement passé/clôturé doit conserver son rattachement :
  // on réinjecte l'événement de l'item édité s'il n'est plus dans la liste.
  const eventOptions = useMemo(() => {
    if (!item?.event_id || events.some((e) => e.event_id === item.event_id)) return events;
    return [{ event_id: item.event_id, event_name: item.event_name ?? 'Événement', event_date: item.date ?? '', event_type: item.event_type }, ...events];
  }, [events, item]);

  const [eventId, setEventId] = useState(item?.event_id ?? defaultEventId ?? events[0]?.event_id ?? '');
  const [phaseType, setPhaseType] = useState(item?.phase_type && item.phase_type !== 'evenement' ? item.phase_type : 'mise_en_place');
  const [date, setDate] = useState(item?.date ?? defaultDate ?? '');
  const [label, setLabel] = useState(item?.label ?? '');
  const [start, setStart] = useState(hhmm(item?.start_time ?? null));
  const [end, setEnd] = useState(hhmm(item?.end_time ?? null));
  const [nb, setNb] = useState(item?.nb_personnes != null ? String(item.nb_personnes) : '');
  const [regisseur, setRegisseur] = useState(item?.regisseur ?? '');
  const [spaceId, setSpaceId] = useState(item?.space_id ?? '');
  const [detail, setDetail] = useState(item?.detail ?? '');
  const [validated, setValidated] = useState(item?.is_validated ?? false);
  const [color, setColor] = useState(item?.color ?? TYPE_COLOR.mise_en_place);
  const [busy, setBusy] = useState(false);

  // Changer de type ré-applique la couleur par défaut du type (surchargeable).
  useEffect(() => {
    if (!item) setColor(TYPE_COLOR[phaseType] ?? '#6B7280');
  }, [phaseType, item]);

  async function save() {
    if (!eventId || !date) {
      showToast('Événement et date requis.', 'warning');
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc('phase_upsert', {
      p_id: item?.id ?? null,
      p_event: eventId,
      p_date: date,
      p_type: phaseType,
      p_label: label || 'Tâche',
      p_detail: detail || null,
      p_start: start || null,
      p_end: end || null,
      p_nb: nb ? Number(nb) : null,
      p_regisseur: regisseur || null,
      p_color: color || null,
      p_space: spaceId || null,
      p_validated: validated,
    });
    setBusy(false);
    const res = data as { success?: boolean; error?: string } | null;
    if (error || !res?.success) {
      showToast(`Échec : ${res?.error ?? error?.message ?? 'erreur'}`, 'warning');
      return;
    }
    showToast(item ? 'Tâche mise à jour.' : 'Tâche créée.', 'success');
    onSaved();
    onClose();
  }

  async function remove() {
    if (!item) return;
    if (!window.confirm('Supprimer cette tâche ?')) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('phase_delete', { p_id: item.id });
    setBusy(false);
    const res = data as { success?: boolean; error?: string } | null;
    if (error || !res?.success) {
      showToast(`Échec : ${res?.error ?? error?.message ?? 'erreur'}`, 'warning');
      return;
    }
    showToast('Tâche supprimée.', 'success');
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-md animate-slideUp flex-col bg-white shadow-2xl sm:animate-none">
        <header className="flex items-center justify-between border-b border-stone-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ background: item?.color ?? color }} />
            <h2 className="text-base font-bold text-stone-900">
              {isEvent ? item?.event_name : item ? 'Modifier la tâche' : 'Nouvelle tâche'}
            </h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100">
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {isEvent ? (
            <div className="space-y-3">
              <Row label="Type"><span className="text-sm text-stone-700">{item?.event_type === 'match' ? '🏉 Match' : '📋 Séminaire'}</span></Row>
              <Row label="Statut"><span className="text-sm text-stone-700">{item?.event_status}</span></Row>
              <Row label="Date"><span className="text-sm text-stone-700">{item && new Date(item.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</span></Row>
              <Row label="Heure"><span className="text-sm text-stone-700">{hhmm(item?.start_time ?? null) || '—'}</span></Row>
              <button
                onClick={() => item && navigate(`/admin/events/${item.event_id}`)}
                className="mt-2 inline-flex items-center gap-2 rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-stone-700"
              >
                <ExternalLink size={15} /> Ouvrir l'événement
              </button>
              <p className="text-xs text-stone-400">Les activités opérationnelles (mise en place, RH, démontage…) se gèrent comme des tâches sur leurs propres jours.</p>
            </div>
          ) : (
            <>
              <Field label="Titre">
                <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex. Mise en place J-1"
                  className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Type">
                  <select value={phaseType} onChange={(e) => setPhaseType(e.target.value)}
                    className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                    {PHASE_TYPES.map((t) => <option key={t} value={t}>{PHASE_LABEL[t]}</option>)}
                  </select>
                </Field>
                <Field label="Jour">
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                    className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </Field>
              </div>
              <Field label="Événement de rattachement">
                <select value={eventId} onChange={(e) => setEventId(e.target.value)}
                  className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                  {eventOptions.map((e) => (
                    <option key={e.event_id} value={e.event_id}>
                      {e.event_name}{e.event_date ? ` — ${new Date(e.event_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Début"><input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" /></Field>
                <Field label="Fin"><input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="👥 Personnes"><input type="number" min="0" value={nb} onChange={(e) => setNb(e.target.value)} className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" /></Field>
                <Field label="Régisseur"><input value={regisseur} onChange={(e) => setRegisseur(e.target.value)} placeholder="Malo / Val" className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" /></Field>
              </div>
              <Field label="Espace (optionnel)">
                <select value={spaceId} onChange={(e) => setSpaceId(e.target.value)}
                  className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                  <option value="">— aucun —</option>
                  {spaces.map((s) => <option key={s.space_id} value={s.space_id}>{s.space_name}</option>)}
                </select>
              </Field>
              <Field label="Détail (une ligne par point)">
                <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={4}
                  placeholder={'- préparation tireuse\n- inventaire stock'}
                  className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </Field>
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm text-stone-700">
                  <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-stone-200" />
                  Couleur
                </label>
                <label className="flex items-center gap-2 text-sm text-stone-700">
                  <input type="checkbox" checked={validated} onChange={(e) => setValidated(e.target.checked)} className="h-4 w-4 rounded" />
                  Validé
                </label>
              </div>
            </>
          )}
        </div>

        {!isEvent && (
          <footer className="flex items-center justify-between gap-2 border-t border-stone-100 px-5 py-4">
            {item ? (
              <button onClick={() => void remove()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                <Trash2 size={15} /> Supprimer
              </button>
            ) : <span />}
            <button onClick={() => void save()} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-stone-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-stone-700 disabled:opacity-50">
              <Check size={16} /> {item ? 'Enregistrer' : 'Créer la tâche'}
            </button>
          </footer>
        )}
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-stone-500">{label}</label>
      {children}
    </div>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-stone-50 py-1.5">
      <span className="text-xs font-semibold text-stone-400">{label}</span>
      {children}
    </div>
  );
}
