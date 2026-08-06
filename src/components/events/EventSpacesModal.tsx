/**
 * EventSpacesModal — édition des espaces activés sur un événement après
 * création (ROLE_STADE). Diffe l'état sélectionné avec event_spaces (ajout /
 * retrait) et initialise les feuilles de route des nouveaux espaces via la
 * RPC existante init_event_roadmaps.
 *
 * Réconciliation : service_type réel ∈ {vip,bar,buvette,bodega} (pas de
 * 'terrasse'). La « Terrasses » standalone est gérée via les zones T2→T5 et
 * exclue ici, comme à la création.
 */

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import { Button, Spinner } from '@/components/ui';

interface SpaceRow {
  space_id: string;
  space_name: string;
  service_type: string | null;
}

export function EventSpacesModal({
  eventId,
  onClose,
}: {
  eventId: string;
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [allSpaces, setAllSpaces] = useState<SpaceRow[]>([]);
  const [linked, setLinked] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [{ data: all }, { data: cur }] = await Promise.all([
        supabase.from('spaces').select('space_id, space_name, service_type').eq('active', true).order('space_name'),
        supabase.from('event_spaces').select('space_id').eq('event_id', eventId),
      ]);
      if (!active) return;
      // Exclure la « Terrasses » standalone (gérée via les zones T2→T5).
      setAllSpaces(((all ?? []) as SpaceRow[]).filter((s) => s.space_name !== 'Terrasses'));
      setLinked(((cur ?? []) as { space_id: string }[]).map((c) => c.space_id));
      setLoading(false);
    })();
    return () => { active = false; };
  }, [eventId]);

  const toggle = (id: string) =>
    setLinked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  async function handleSave() {
    setSaving(true);
    const { data: cur } = await supabase.from('event_spaces').select('space_id').eq('event_id', eventId);
    const currentIds = ((cur ?? []) as { space_id: string }[]).map((c) => c.space_id);
    const toAdd = linked.filter((id) => !currentIds.includes(id));
    const toRemove = currentIds.filter((id) => !linked.includes(id));

    if (toAdd.length) {
      const { error } = await supabase.from('event_spaces').insert(toAdd.map((space_id) => ({ event_id: eventId, space_id })));
      if (error) { setSaving(false); return showToast(`Échec ajout : ${error.message}`, 'warning'); }
    }
    if (toRemove.length) {
      const { error } = await supabase.from('event_spaces').delete().eq('event_id', eventId).in('space_id', toRemove);
      if (error) { setSaving(false); return showToast(`Échec retrait : ${error.message}`, 'warning'); }
    }
    // Initialiser les feuilles de route des nouveaux espaces (idempotent).
    if (toAdd.length) await supabase.rpc('init_event_roadmaps', { p_event_id: eventId });

    await queryClient.invalidateQueries({ queryKey: ['eventSpaces', eventId] });
    await queryClient.invalidateQueries({ queryKey: ['event', eventId] });
    setSaving(false);
    showToast(`Espaces mis à jour (+${toAdd.length} / −${toRemove.length}).`, 'success');
    onClose();
  }

  const sections = [
    { label: '🏆 Espaces VIP & Bars', spaces: allSpaces.filter((s) => s.service_type !== 'buvette') },
    { label: '🍺 Buvettes (B1→B9)', spaces: allSpaces.filter((s) => s.service_type === 'buvette') },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-black text-stone-900">Espaces ouverts pour cet événement</h3>
          <button onClick={onClose} className="text-lg text-stone-400 hover:text-stone-700" aria-label="Fermer">
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading ? (
          <Spinner label="Chargement…" />
        ) : (
          <>
            <p className="text-xs text-stone-500">
              {linked.length} espace{linked.length > 1 ? 's' : ''} sélectionné{linked.length > 1 ? 's' : ''}
              <button
                onClick={() => setLinked(allSpaces.filter((s) => s.service_type !== 'buvette').map((s) => s.space_id))}
                className="ml-3 text-amber-600 underline"
              >
                Tout VIP & Bars
              </button>
              <button onClick={() => setLinked([])} className="ml-2 text-stone-400 underline">
                Tout désélectionner
              </button>
            </p>

            {sections.map((section) =>
              section.spaces.length === 0 ? null : (
                <div key={section.label}>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-stone-400">{section.label}</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {section.spaces.map((sp) => {
                      const on = linked.includes(sp.space_id);
                      return (
                        <button
                          key={sp.space_id}
                          type="button"
                          onClick={() => toggle(sp.space_id)}
                          className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${on ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-200 bg-white text-stone-700 hover:border-stone-400'}`}
                        >
                          <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 ${on ? 'border-white/60 bg-white/20' : 'border-stone-300'}`}>
                            {on && <span className="h-2 w-2 rounded-sm bg-white" />}
                          </span>
                          <span className="truncate text-sm font-semibold">{sp.space_name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ),
            )}

            <div className="flex gap-3 border-t border-stone-100 pt-3">
              <Button variant="secondary" className="flex-1" onClick={onClose}>Annuler</Button>
              <Button className="flex-1" onClick={() => void handleSave()} disabled={saving}>
                {saving ? '…' : 'Mettre à jour les espaces'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
