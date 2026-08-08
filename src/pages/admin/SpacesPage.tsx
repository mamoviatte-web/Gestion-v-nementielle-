/**
 * SpacesPage (ROLE_STADE) — maintenance des espaces : détection et résolution
 * des doublons (« Buvette 1 » alias de « B1 », deux « Salon Nord », …).
 *
 * Robustesse espaces : un responsable connecté sur un espace doublon doit voir
 * les données de l'espace CANONIQUE. Le motif « Buvette N → BN » est résolu
 * automatiquement côté serveur (zone_canonical_space) ; pour tout doublon à nom
 * libre, l'admin déclare ici la correspondance en un clic. Toute correspondance
 * ajoutée est prise en compte immédiatement par get_match_session / _zone_resolve
 * et les fonctions RH.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link2, Trash2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, Button, Select, Spinner } from '@/components/ui';

interface Space {
  space_id: string;
  space_name: string;
  active: boolean;
  service_type: string | null;
}
interface DuplicateRow {
  ghost_space_id: string;
  ghost_name: string;
  canonical_space_id: string;
  canonical_name: string;
  mapping_explicite: boolean;
}
interface MappingRow {
  ghost_space_id: string;
  canonical_space_id: string;
  created_at: string;
}

export default function SpacesPage() {
  const { showToast } = useToast();
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [dups, setDups] = useState<DuplicateRow[]>([]);
  const [maps, setMaps] = useState<MappingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [ghostId, setGhostId] = useState('');
  const [canonId, setCanonId] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [sp, du, mp] = await Promise.all([
      supabase.from('spaces').select('space_id, space_name, active, service_type').order('space_name'),
      supabase.from('space_duplicates_check').select('*'),
      supabase.from('space_canonical_map').select('ghost_space_id, canonical_space_id, created_at'),
    ]);
    setSpaces((sp.data as Space[] | null) ?? []);
    setDups((du.data as DuplicateRow[] | null) ?? []);
    setMaps((mp.data as MappingRow[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const nameOf = useMemo(() => {
    const m = new Map(spaces.map((s) => [s.space_id, s.space_name]));
    return (id: string) => m.get(id) ?? id;
  }, [spaces]);

  const spaceOptions = useMemo(
    () =>
      spaces.map((s) => ({
        value: s.space_id,
        label: `${s.space_name}${s.active ? '' : ' (inactif)'}`,
      })),
    [spaces],
  );

  async function declareMapping() {
    if (!ghostId || !canonId) return;
    if (ghostId === canonId) {
      showToast('Le doublon et le canonique doivent être différents.', 'warning');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('space_canonical_map')
      .upsert({ ghost_space_id: ghostId, canonical_space_id: canonId }, { onConflict: 'ghost_space_id' });
    setSaving(false);
    if (error) {
      showToast(`Échec : ${error.message}`, 'warning');
      return;
    }
    showToast(`« ${nameOf(ghostId)} » rattaché à « ${nameOf(canonId)} ».`, 'success');
    setGhostId('');
    setCanonId('');
    void load();
  }

  async function removeMapping(ghost: string) {
    const { error } = await supabase.from('space_canonical_map').delete().eq('ghost_space_id', ghost);
    if (error) {
      showToast(`Échec : ${error.message}`, 'warning');
      return;
    }
    showToast('Correspondance supprimée.', 'success');
    void load();
  }

  if (loading) return <Spinner />;

  const unmapped = dups.filter((d) => !d.mapping_explicite);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Espaces en double"
        description="Détection et résolution des doublons. Un responsable connecté sur un doublon voit toujours les données de l'espace canonique."
      />

      {/* Doublons détectés par motif (Buvette N ↔ BN) */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
          Doublons détectés (motif automatique)
        </h2>
        {dups.length === 0 ? (
          <Alert variant="success">Aucun doublon de motif « Buvette N » détecté.</Alert>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2">Doublon</th>
                  <th className="px-4 py-2">→ Canonique</th>
                  <th className="px-4 py-2 text-right">État</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dups.map((d) => (
                  <tr key={d.ghost_space_id} className="text-slate-800">
                    <td className="px-4 py-2 font-medium">{d.ghost_name}</td>
                    <td className="px-4 py-2">{d.canonical_name}</td>
                    <td className="px-4 py-2 text-right">
                      {d.mapping_explicite ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600">
                          <CheckCircle2 size={14} /> Lié
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-600">
                          <AlertTriangle size={14} /> Auto (motif)
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {unmapped.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            Les doublons « Auto (motif) » sont déjà résolus côté serveur ; les déclarer explicitement ci-dessous
            les fige durablement (utile si le nom devait changer).
          </p>
        )}
      </section>

      {/* Déclaration manuelle (noms libres) */}
      <section className="mb-8 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-1 text-sm font-bold text-slate-800">Déclarer une correspondance</h2>
        <p className="mb-4 text-xs text-slate-500">
          Pour tout doublon à nom libre (deux « Salon Nord », un « Wine bar Nord » dupliqué…), choisissez l'espace
          doublon puis son espace canonique. Prise en compte immédiate partout.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-600">Espace doublon</label>
            <Select
              value={ghostId}
              onChange={(e) => setGhostId(e.target.value)}
              options={[{ value: '', label: '— choisir —' }, ...spaceOptions]}
            />
          </div>
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-600">Espace canonique</label>
            <Select
              value={canonId}
              onChange={(e) => setCanonId(e.target.value)}
              options={[{ value: '', label: '— choisir —' }, ...spaceOptions]}
            />
          </div>
          <Button onClick={() => void declareMapping()} disabled={saving || !ghostId || !canonId}>
            <Link2 size={16} /> Rattacher
          </Button>
        </div>
      </section>

      {/* Correspondances explicites existantes */}
      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
          Correspondances explicites ({maps.length})
        </h2>
        {maps.length === 0 ? (
          <p className="text-sm text-slate-400">Aucune correspondance déclarée manuellement.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2">Doublon</th>
                  <th className="px-4 py-2">→ Canonique</th>
                  <th className="px-4 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {maps.map((m) => (
                  <tr key={m.ghost_space_id} className="text-slate-800">
                    <td className="px-4 py-2 font-medium">{nameOf(m.ghost_space_id)}</td>
                    <td className="px-4 py-2">{nameOf(m.canonical_space_id)}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => void removeMapping(m.ghost_space_id)}
                        className="inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-800"
                      >
                        <Trash2 size={14} /> Supprimer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
