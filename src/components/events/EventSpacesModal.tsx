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
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Button, Spinner } from '@/components/ui';

interface SpaceRow {
  space_id: string;
  space_name: string;
  service_type: string | null;
  max_pax: number | null;
}

export function EventSpacesModal({
  eventId,
  onClose,
}: {
  eventId: string;
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [allSpaces, setAllSpaces] = useState<SpaceRow[]>([]);
  const [linked, setLinked] = useState<string[]>([]);
  // Pax saisi par espace VIP/Bar (ré)activé — { [space_id]: pax }.
  const [pax, setPax] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    void (async () => {
      const [{ data: all }, { data: cur }] = await Promise.all([
        supabase.from('spaces').select('space_id, space_name, service_type, max_pax').eq('active', true).order('space_name'),
        supabase.from('event_spaces').select('space_id, expected_pax').eq('event_id', eventId),
      ]);
      if (!active) return;
      // Exclure la « Terrasses » standalone (gérée via les zones T2→T5).
      setAllSpaces(((all ?? []) as SpaceRow[]).filter((s) => s.space_name !== 'Terrasses'));
      const curRows = (cur ?? []) as { space_id: string; expected_pax: number | null }[];
      setLinked(curRows.map((c) => c.space_id));
      // Pré-remplir le pax existant des espaces déjà ouverts.
      const p: Record<string, string> = {};
      for (const c of curRows) if (c.expected_pax != null) p[c.space_id] = String(c.expected_pax);
      setPax(p);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [eventId]);

  const toggle = (sp: SpaceRow) =>
    setLinked((prev) => {
      const on = prev.includes(sp.space_id);
      if (on) return prev.filter((x) => x !== sp.space_id);
      // (ré)activation d'un VIP/Bar → pré-remplir le pax avec la capacité.
      if (sp.service_type !== 'buvette') {
        setPax((pp) => (pp[sp.space_id] ? pp : { ...pp, [sp.space_id]: sp.max_pax != null ? String(sp.max_pax) : '' }));
      }
      return [...prev, sp.space_id];
    });

  async function handleSave() {
    setSaving(true);
    // sync_event_spaces : diff + purge de la préparation des espaces retirés
    // (runner, RH, planning, sessions…) en une transaction. On ne fait plus de
    // delete/insert brut — c'est ce qui laissait des espaces fantômes (ex. B5).
    const { data, error } = await supabase.rpc('sync_event_spaces', {
      p_event: eventId,
      p_space_ids: linked,
      p_by: user?.name ?? user?.email ?? null,
    });
    const res = data as {
      success?: boolean; error?: string;
      retires?: number; ajoutes?: number; orphelins_nettoyes?: number; espaces_actifs?: number;
    } | null;
    if (error || !res?.success) {
      setSaving(false);
      return showToast(`Échec : ${res?.error ?? error?.message ?? 'erreur'}`, 'warning');
    }

    // Pax des espaces VIP/Bar ouverts (après sync, l'espace est ouvert donc
    // set_space_pax l'accepte). Une passe par espace VIP/Bar sélectionné.
    const vipBarIds = new Set(allSpaces.filter((s) => s.service_type !== 'buvette').map((s) => s.space_id));
    for (const id of linked) {
      if (!vipBarIds.has(id)) continue;
      const v = Number(pax[id]);
      if (!Number.isFinite(v) || v <= 0) continue;
      await supabase.rpc('set_space_pax', { p_event: eventId, p_space: id, p_pax: v, p_by: user?.name ?? user?.email ?? null });
    }

    // Feuilles de route des nouveaux espaces (idempotent).
    if ((res.ajoutes ?? 0) > 0) await supabase.rpc('init_event_roadmaps', { p_event_id: eventId });

    // Rafraîchir tout le déroulé de l'événement (BLOC 2).
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['eventSpaces', eventId] }),
      queryClient.invalidateQueries({ queryKey: ['event', eventId] }),
      queryClient.invalidateQueries({ queryKey: ['stockLiveBalance'] }),
      queryClient.invalidateQueries({ queryKey: ['stockAlerts'] }),
      queryClient.invalidateQueries({ queryKey: ['criticalStatus'] }),
    ]);
    setSaving(false);
    showToast(
      `Espaces mis à jour — ${res.retires ?? 0} retiré(s), ${res.ajoutes ?? 0} ajouté(s), ${res.espaces_actifs ?? 0} actifs`,
      'success',
    );
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

            {sections.map((section) => {
              if (section.spaces.length === 0) return null;
              const isVip = section.spaces.some((s) => s.service_type !== 'buvette');
              return (
                <div key={section.label}>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-stone-400">{section.label}</p>
                  <div className={isVip ? 'space-y-1.5' : 'grid grid-cols-2 gap-1.5'}>
                    {section.spaces.map((sp) => {
                      const on = linked.includes(sp.space_id);
                      return (
                        <div key={sp.space_id} className={isVip ? 'flex items-center gap-2' : ''}>
                          <button
                            type="button"
                            onClick={() => toggle(sp)}
                            className={`flex flex-1 items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${on ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-200 bg-white text-stone-700 hover:border-stone-400'}`}
                          >
                            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 ${on ? 'border-white/60 bg-white/20' : 'border-stone-300'}`}>
                              {on && <span className="h-2 w-2 rounded-sm bg-white" />}
                            </span>
                            <span className="truncate text-sm font-semibold">{sp.space_name}</span>
                          </button>
                          {isVip && on && (
                            <label className="flex shrink-0 items-center gap-1 text-xs text-stone-500">
                              <input
                                type="number" min="1"
                                value={pax[sp.space_id] ?? ''}
                                onChange={(e) => setPax((pp) => ({ ...pp, [sp.space_id]: e.target.value }))}
                                placeholder={sp.max_pax != null ? String(sp.max_pax) : 'pax'}
                                className="w-16 rounded-lg border border-stone-200 px-2 py-1.5 text-right"
                              />
                              pax
                            </label>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

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
