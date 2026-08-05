/**
 * EventSpaceSelector — sélection des espaces (étape 2 création événement),
 * réorganisée en sections visuelles dissociées :
 *   🏆 VIP & Stade  (tout sauf buvettes et la « Terrasses » standalone)
 *   🍺 Buvettes     (toggle · superviseurs Buvette 1 / Buvette 2 + leurs zones)
 *   🌿 Terrasses    (toggle · sous-zones T2→T5)
 *
 * Réconciliation schéma réel :
 *   • service_type ∈ {vip,bar,buvette,bodega} — « Terrasses » est service_type
 *     'bar' et gérée via les zones T2→T5, donc exclue de la grille VIP.
 *   • Les buvettes réelles = B1..B9 + superviseurs « Buvette 1 »/« Buvette 2 »
 *     (buvette_groups/buvette_group_members). Activer un superviseur coche le
 *     parent + ses buvettes membres. Les buvettes restent dans `selected` (le
 *     submit du modal n'est pas modifié).
 */

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { EventType, Space } from '@/lib/types';

const TERRASSE_ZONES = [
  { code: 'T2', label: 'Tribune gauche' },
  { code: 'T3', label: 'Tribune centre' },
  { code: 'T4', label: 'Tribune droite' },
  { code: 'T5', label: 'Côté virage' },
] as const;

interface BuvetteGroup {
  id: string;
  name: string;
  parentId: string | null;
  memberIds: string[];
  allIds: string[]; // parent + membres actifs
}

interface Props {
  eventType: EventType;
  spaces: Space[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleMany: (ids: string[], check: boolean) => void;
  buvettesEnabled: boolean;
  setBuvettesEnabled: (v: boolean) => void;
  terrassesEnabled: boolean;
  setTerrassesEnabled: (v: boolean) => void;
  activeTerrasseZones: string[];
  setActiveTerrasseZones: React.Dispatch<React.SetStateAction<string[]>>;
}

export function EventSpaceSelector({
  eventType, spaces, selected, onToggle, onToggleMany,
  buvettesEnabled, setBuvettesEnabled,
  terrassesEnabled, setTerrassesEnabled,
  activeTerrasseZones, setActiveTerrasseZones,
}: Props) {
  const isMatch = eventType === 'match';
  const [groups, setGroups] = useState<BuvetteGroup[]>([]);

  // Grille VIP & Stade : tout sauf buvettes et la « Terrasses » standalone.
  const vipSpaces = useMemo(
    () => spaces.filter((s) => s.service_type !== 'buvette' && s.space_name !== 'Terrasses'),
    [spaces],
  );
  const buvetteSpaces = useMemo(() => spaces.filter((s) => s.service_type === 'buvette'), [spaces]);
  const allBuvetteIds = useMemo(() => buvetteSpaces.map((s) => s.space_id), [buvetteSpaces]);

  // Groupes de buvettes (superviseurs + membres) — best-effort.
  useEffect(() => {
    if (!isMatch) return;
    let active = true;
    void (async () => {
      const [{ data: gRows }, { data: mRows }] = await Promise.all([
        supabase.from('buvette_groups').select('id, group_name, is_active'),
        supabase.from('buvette_group_members').select('group_id, space_id, is_active'),
      ]);
      if (!active) return;
      const byName = new Map(spaces.map((s) => [s.space_name, s.space_id] as const));
      const built: BuvetteGroup[] = (gRows ?? [])
        .filter((g) => (g as { is_active?: boolean }).is_active !== false)
        .map((g) => {
          const name = String((g as { group_name: string }).group_name);
          const parentId = byName.get(name) ?? null;
          const memberIds = (mRows ?? [])
            .filter((m) => m.group_id === (g as { id: string }).id && (m as { is_active?: boolean }).is_active !== false)
            .map((m) => String(m.space_id));
          return { id: String((g as { id: string }).id), name, parentId, memberIds, allIds: [parentId, ...memberIds].filter(Boolean) as string[] };
        });
      setGroups(built);
    })();
    return () => { active = false; };
  }, [isMatch, spaces]);

  return (
    <div className="space-y-3">
      {isMatch && (
        <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs text-blue-700">
          <CheckCircle2 size={14} className="shrink-0 text-blue-500" />
          <span>Match = tous les espaces s'activent automatiquement (ajustez ci-dessous).</span>
        </div>
      )}

      {/* ══ VIP & STADE ══ */}
      <SpaceGroupSection
        icon="🏆"
        label="Espaces VIP & Stade"
        desc={`${vipSpaces.length} espaces · Salons · Loges · Wine bars · Club 70 · Bistrot · Bodega · Comptoir · Le Pub`}
        accentClass="border-amber-200"
        headerClass="bg-gradient-to-r from-amber-50 to-white"
        spaces={vipSpaces}
        selected={selected}
        onToggle={onToggle}
        onToggleAll={(check) => onToggleMany(vipSpaces.map((s) => s.space_id), check)}
      />

      {/* ══ BUVETTES (match uniquement) ══ */}
      {isMatch && (
        <div className="overflow-hidden rounded-2xl border border-stone-200">
          <div className="border-b border-stone-100 bg-stone-50 px-4 py-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-lg">🍺</span>
              <div className="flex-1">
                <p className="text-sm font-bold text-stone-800">Buvettes grand public</p>
                <p className="text-xs text-stone-400">B1→B9 · supervisées par Buvette 1 et Buvette 2</p>
              </div>
            </div>
            <label className="mt-3 flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={buvettesEnabled}
                onChange={(e) => {
                  setBuvettesEnabled(e.target.checked);
                  onToggleMany(allBuvetteIds, e.target.checked);
                }}
                className="h-4 w-4 rounded accent-stone-900"
              />
              <span className="text-sm font-semibold text-stone-700">Activer les buvettes pour ce match</span>
            </label>
          </div>

          {buvettesEnabled && (
            <div className="grid grid-cols-2 gap-2 p-3">
              {groups.length > 0
                ? groups.map((g) => {
                    const on = g.parentId ? selected.has(g.parentId) : g.allIds.some((id) => selected.has(id));
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => onToggleMany(g.allIds, !on)}
                        className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition-all ${on ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-200 bg-white text-stone-700 hover:border-stone-400'}`}
                      >
                        <CheckMark on={on} />
                        <div>
                          <p className={`text-sm font-bold ${on ? 'text-white' : 'text-stone-800'}`}>{g.name}</p>
                          <p className={`text-[10px] ${on ? 'text-white/60' : 'text-stone-400'}`}>{g.memberIds.length} zone{g.memberIds.length > 1 ? 's' : ''} supervisée{g.memberIds.length > 1 ? 's' : ''}</p>
                        </div>
                      </button>
                    );
                  })
                : buvetteSpaces.map((b) => {
                    const on = selected.has(b.space_id);
                    return (
                      <button key={b.space_id} type="button" onClick={() => onToggle(b.space_id)}
                        className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition-all ${on ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-200 bg-white text-stone-700 hover:border-stone-400'}`}>
                        <CheckMark on={on} />
                        <span className={`text-sm font-bold ${on ? 'text-white' : 'text-stone-800'}`}>{b.space_name}</span>
                      </button>
                    );
                  })}
            </div>
          )}
        </div>
      )}

      {/* ══ TERRASSES (match uniquement) ══ */}
      {isMatch && (
        <div className="overflow-hidden rounded-2xl border border-stone-200">
          <div className="border-b border-stone-100 bg-stone-50 px-4 py-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-lg">🌿</span>
              <div className="flex-1">
                <p className="text-sm font-bold text-stone-800">Terrasses VIP</p>
                <p className="text-xs text-stone-400">Prestations supplémentaires — activez les zones selon le match</p>
              </div>
            </div>
            <label className="mt-3 flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={terrassesEnabled}
                onChange={(e) => {
                  setTerrassesEnabled(e.target.checked);
                  if (!e.target.checked) setActiveTerrasseZones([]);
                }}
                className="h-4 w-4 rounded accent-stone-900"
              />
              <span className="text-sm font-semibold text-stone-700">Activer les terrasses pour ce match</span>
            </label>
          </div>

          {terrassesEnabled && (
            <div className="grid grid-cols-2 gap-2 p-3">
              {TERRASSE_ZONES.map(({ code, label }) => {
                const on = activeTerrasseZones.includes(code);
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setActiveTerrasseZones((prev) => (on ? prev.filter((z) => z !== code) : [...prev, code]))}
                    className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition-all ${on ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-200 bg-white text-stone-700 hover:border-stone-400'}`}
                  >
                    <CheckMark on={on} />
                    <div>
                      <p className={`text-sm font-bold ${on ? 'text-white' : 'text-stone-800'}`}>Terrasse {code}</p>
                      <p className={`text-[10px] ${on ? 'text-white/60' : 'text-stone-400'}`}>{label}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CheckMark({ on }: { on: boolean }) {
  return (
    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 ${on ? 'border-white/60 bg-white/20' : 'border-stone-300'}`}>
      {on && <span className="h-2 w-2 rounded-sm bg-white" />}
    </span>
  );
}

function SpaceGroupSection({
  icon, label, desc, accentClass, headerClass, spaces, selected, onToggle, onToggleAll,
}: {
  icon: string; label: string; desc: string; accentClass: string; headerClass: string;
  spaces: Space[]; selected: Set<string>; onToggle: (id: string) => void; onToggleAll: (check: boolean) => void;
}) {
  const nbSelected = spaces.filter((s) => selected.has(s.space_id)).length;
  const allSelected = spaces.length > 0 && nbSelected === spaces.length;
  return (
    <div className={`overflow-hidden rounded-2xl border ${accentClass}`}>
      <div className={`flex items-center justify-between border-b border-stone-100 px-4 py-3 ${headerClass}`}>
        <div className="flex items-center gap-2.5">
          <span className="text-lg">{icon}</span>
          <div>
            <p className="text-sm font-bold text-stone-800">{label}</p>
            <p className="text-xs text-stone-400">{desc}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onToggleAll(!allSelected)}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${allSelected ? 'bg-stone-900 text-white' : 'border border-stone-200 bg-white text-stone-500 hover:text-stone-800'}`}
        >
          {allSelected ? '✓ Tous' : `${nbSelected}/${spaces.length}`}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1.5 p-3">
        {spaces.map((sp) => {
          const on = selected.has(sp.space_id);
          return (
            <button
              key={sp.space_id}
              type="button"
              onClick={() => onToggle(sp.space_id)}
              className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all ${on ? 'border-stone-800 bg-stone-900 text-white' : 'border-stone-100 bg-white text-stone-700 hover:border-stone-300'}`}
            >
              <CheckMark on={on} />
              <span className={`truncate text-sm font-semibold ${on ? 'text-white' : 'text-stone-800'}`}>{sp.space_name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
