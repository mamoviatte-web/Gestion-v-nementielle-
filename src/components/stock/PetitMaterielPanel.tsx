/**
 * PetitMaterielPanel — demande chiffrée de petit matériel par espace (ADMIN,
 * VIP & Bars). Chaque item du référentiel reçoit une quantité « besoin pour le
 * prochain match ». Les besoins alimentent les dotations runner et se
 * transmettent d'un match à l'autre (bouton « Reprendre du match précédent »).
 *
 * DORMANT : monté uniquement derrière `PETIT_MATERIEL_ENABLED`. Aucune donnée de
 * stock/dotation existante n'est touchée (table dédiée petit_materiel_requests).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import { Button, Card, Spinner } from '@/components/ui';

interface Item {
  item_id: string;
  code: string;
  label: string;
  qty: number;
}

export function PetitMaterielPanel({ eventId, spaceId }: { eventId: string; spaceId: string }) {
  const { showToast } = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [carrying, setCarrying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc('get_petit_materiel', { p_event_id: eventId, p_space_id: spaceId });
    const rows = (data as Item[] | null) ?? [];
    setItems(rows);
    setQty(Object.fromEntries(rows.map((r) => [r.item_id, r.qty])));
    setLoading(false);
  }, [eventId, spaceId]);

  useEffect(() => { void load(); }, [load]);

  const dirty = useMemo(() => items.some((it) => (qty[it.item_id] ?? 0) !== it.qty), [items, qty]);
  const total = useMemo(() => Object.values(qty).reduce((s, v) => s + (v || 0), 0), [qty]);

  async function save() {
    setSaving(true);
    const lines = items.map((it) => ({ item_id: it.item_id, qty: qty[it.item_id] ?? 0 }));
    const { data, error } = await supabase.rpc('save_petit_materiel', { p_event_id: eventId, p_space_id: spaceId, p_lines: lines });
    setSaving(false);
    const res = data as { success?: boolean; error?: string } | null;
    if (error || res?.success === false) { showToast(`Échec : ${res?.error ?? error?.message ?? 'erreur'}`, 'warning'); return; }
    showToast('Besoins petit matériel enregistrés.', 'success');
    await load();
  }

  async function carryForward() {
    if (!window.confirm('Reprendre les besoins petit matériel du match précédent pour tous les espaces ?')) return;
    setCarrying(true);
    const { data, error } = await supabase.rpc('carry_forward_petit_materiel', { p_to_event: eventId });
    setCarrying(false);
    const res = data as { success?: boolean; error?: string; lignes?: number } | null;
    if (error || res?.success === false) { showToast(`Reprise impossible : ${res?.error ?? error?.message ?? 'erreur'}`, 'warning'); return; }
    showToast(`Besoins repris du match précédent (${res?.lignes ?? 0} ligne(s)).`, 'success');
    await load();
  }

  if (loading) return <Spinner label="Chargement du petit matériel…" />;

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-bold uppercase tracking-wide text-pr-black-soft/60">
            Demande petit matériel
          </h3>
          <p className="mt-0.5 text-xs text-pr-black-soft/50">
            Besoin chiffré pour le prochain match — {total} pièce(s) au total sur cet espace.
          </p>
        </div>
        <Button size="sm" variant="secondary" loading={carrying} onClick={() => void carryForward()}>
          Reprendre du match précédent
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {items.map((it) => (
          <label key={it.item_id} className="flex items-center justify-between gap-3 border-b border-pr-stone/60 py-1.5">
            <span className="min-w-0 flex-1 truncate text-sm text-pr-black-soft/80" title={`${it.label} · ${it.code}`}>
              {it.label}
            </span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={qty[it.item_id] || ''}
              placeholder="0"
              onChange={(e) => {
                const v = e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value) || 0);
                setQty((prev) => ({ ...prev, [it.item_id]: v }));
              }}
              className="h-9 w-20 shrink-0 rounded-lg border border-pr-stone bg-white text-center text-sm font-semibold tabular-nums focus:border-pr-olive focus:outline-none focus:ring-2 focus:ring-pr-olive/20"
            />
          </label>
        ))}
      </div>

      <div className="flex items-center justify-end gap-3">
        {dirty && <span className="text-xs text-pr-gold">Modifications non enregistrées</span>}
        <Button size="sm" loading={saving} disabled={!dirty} onClick={() => void save()}>
          Enregistrer les besoins
        </Button>
      </div>
    </Card>
  );
}
