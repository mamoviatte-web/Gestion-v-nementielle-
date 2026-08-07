/**
 * AreaRunnersPanel — fiches runner des espaces VIP / Terrasses / Bodega,
 * pilotées par le référentiel CDC (area_product_reference) via la RPC unifiée
 * get_runner_sheet (event-aware, cascade de dotation réel→profil→plancher).
 *
 * Remplace l'ancien estimateur piloté par les coefficients : la liste des
 * produits vient exclusivement du référentiel (les bons produits par espace),
 * et chaque ligne socle porte une dotation non nulle (« À monter »). Aucun coût
 * n'est affiché (règle CDC). Les buvettes B1→B9 gardent leur onglet dédié.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Spinner } from '@/components/ui';
import type { EventSpaceWithSpace } from '@/hooks/useEvents';

type Level = 'S' | 'SR' | 'SRP' | 'ALL';

const LEVELS: { key: Level; label: string }[] = [
  { key: 'S', label: 'Socle (S)' },
  { key: 'SR', label: '+ Récurrents (SR)' },
  { key: 'SRP', label: '+ Ponctuels (SRP)' },
  { key: 'ALL', label: 'Tout (ALL)' },
];

const FAMILY_ORDER = [
  'Bière / Fûts',
  'Vins',
  'Champagne',
  'Softs / Eau / Sirops',
  'Spiritueux / Apéritifs',
  'Gaz / Technique',
  'Autres',
];

type DotationSource = 'reel' | 'profil' | 'plancher' | 'option';

const SOURCE_PILL: Record<DotationSource, { label: string; cls: string }> = {
  reel: { label: 'réel', cls: 'bg-green-100 text-green-700' },
  profil: { label: 'profil', cls: 'bg-blue-100 text-blue-700' },
  plancher: { label: 'plancher', cls: 'bg-stone-100 text-stone-500' },
  option: { label: 'option', cls: 'border border-stone-300 text-stone-400' },
};

interface RunnerLine {
  product_family: string;
  product_name: string;
  association_level: 'S' | 'R' | 'P' | 'C';
  is_default: boolean;
  product_id: string | null;
  depot_label: string | null;
  depot_type: string | null;
  stock_espace: number;
  moy_hist: number;
  coeff: number;
  a_monter: number;
  dotation_source: DotationSource;
}

interface RunnerSheet {
  area: string;
  libelle: string;
  show_level: string;
  lines: RunnerLine[];
}

interface AreaRef {
  name: string;
  spaceId: string;
}

function LevelBadge({ level }: { level: RunnerLine['association_level'] }) {
  const map = {
    S: 'bg-stone-900 text-white',
    R: 'border border-stone-400 text-stone-600',
    P: 'bg-stone-100 text-stone-400',
    C: 'bg-stone-100 text-stone-400 italic',
  } as const;
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${map[level]}`}>
      {level === 'C' ? 'à confirmer' : level}
    </span>
  );
}

export function AreaRunnersPanel({
  eventId,
  spaces,
}: {
  eventId: string;
  spaces: EventSpaceWithSpace[];
}) {
  const [level, setLevel] = useState<Level>('S');
  const [selected, setSelected] = useState<string | null>(null);
  const [sheets, setSheets] = useState<Record<string, RunnerSheet>>({});
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Espaces hors buvettes (les buvettes ont leur onglet « Runner Buvettes »).
  const areas = useMemo<AreaRef[]>(
    () =>
      spaces
        .filter((s) => s.spaces?.service_type !== 'buvette' && s.spaces?.space_name)
        .map((s) => ({ name: s.spaces!.space_name, spaceId: s.space_id })),
    [spaces],
  );

  const spaceIdByArea = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of areas) m.set(a.name.trim().toUpperCase(), a.spaceId);
    return m;
  }, [areas]);

  const loadSheets = useCallback(async () => {
    setLoading(true);
    const results = await Promise.all(
      areas.map(async (a) => {
        const { data } = await supabase.rpc('get_runner_sheet', {
          p_area_name: a.name,
          p_event_id: eventId,
          p_show_level: level,
        });
        return [a.name, (data as RunnerSheet | null) ?? null] as const;
      }),
    );
    const map: Record<string, RunnerSheet> = {};
    for (const [name, sheet] of results) if (sheet) map[name] = sheet;
    setSheets(map);
    setLoading(false);
  }, [areas, eventId, level]);

  useEffect(() => {
    void loadSheets();
  }, [loadSheets]);

  const LevelSelector = (
    <div className="flex flex-wrap gap-1 rounded-xl border border-stone-200 bg-white p-1 text-sm">
      {LEVELS.map((l) => (
        <button
          key={l.key}
          onClick={() => setLevel(l.key)}
          className={`rounded-lg px-3 py-1.5 font-medium transition-colors ${level === l.key ? 'bg-stone-900 text-white' : 'text-stone-500 hover:bg-stone-50'}`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );

  /** Quantité éditée (défaut = À monter pré-rempli). */
  const qtyValue = (l: RunnerLine): string =>
    edits[l.product_name] ?? String(l.a_monter || 0);

  /** Enregistre les dotations validées dans runner_auto_planning (clé event/space/produit). */
  async function persistValidation(sheet: RunnerSheet, transmit: boolean) {
    const spaceId = spaceIdByArea.get(sheet.area.trim().toUpperCase());
    if (!spaceId) return;
    setSaving(true);
    try {
      const token = crypto.randomUUID();
      const rows = sheet.lines
        .filter((l) => l.product_id)
        .map((l) => ({
          event_id: eventId,
          space_id: spaceId,
          product_id: l.product_id as string,
          recommended_quantity: l.a_monter,
          validated_quantity: Number(qtyValue(l)) || 0,
          validation_status: transmit ? 'transmis_runners' : 'validé',
          terrain_token: token,
        }));
      if (rows.length > 0) {
        await supabase
          .from('runner_auto_planning')
          .upsert(rows, { onConflict: 'event_id,space_id,product_id' });
      }
    } finally {
      setSaving(false);
    }
  }

  // ── Fiche détail d'un espace ─────────────────────────────────────────────
  if (selected) {
    const sheet = sheets[selected] ?? null;
    const families = FAMILY_ORDER.filter((f) =>
      (sheet?.lines ?? []).some((l) => l.product_family === f),
    );
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={() => setSelected(null)}
            className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800"
          >
            <ArrowLeft className="h-4 w-4" /> Tous les espaces
          </button>
          {LevelSelector}
        </div>

        {loading || !sheet ? (
          <Spinner label="Chargement…" />
        ) : (
          <>
            {(() => {
              const reco = sheet.lines.filter((l) => l.a_monter > 0);
              const units = sheet.lines.reduce((s, l) => s + (l.a_monter || 0), 0);
              return (
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-black text-stone-900">
                      Runner — {sheet.libelle}{' '}
                      <span className="text-stone-400">({sheet.area})</span>
                    </h3>
                    <p className="text-sm text-stone-500">
                      <span className="font-bold text-stone-800">{reco.length}</span> produit
                      {reco.length > 1 ? 's' : ''} recommandé{reco.length > 1 ? 's' : ''} ·{' '}
                      <span className="font-bold text-stone-800">{units}</span> unité
                      {units > 1 ? 's' : ''} à monter · niveau {sheet.show_level}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-400">
                      Base : référentiel CDC + consommations réelles · marge +20 %
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" loading={saving} onClick={() => void persistValidation(sheet, false)}>
                      <Check className="h-4 w-4" /> Tout valider cet espace
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={saving}
                      onClick={() => void persistValidation(sheet, true)}
                    >
                      <Send className="h-4 w-4" /> Transmettre aux runners
                    </Button>
                  </div>
                </div>
              );
            })()}

            {families.map((fam) => (
              <div key={fam} className="overflow-hidden rounded-2xl border border-stone-200">
                <div className="border-b border-stone-100 bg-stone-50 px-4 py-2 text-sm font-bold text-stone-700">
                  {fam}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-stone-100 text-left text-xs uppercase tracking-wide text-stone-400">
                        <th className="px-4 py-2">Produit</th>
                        <th className="px-3 py-2">Niveau</th>
                        <th className="px-3 py-2 text-right">Coeff.</th>
                        <th className="px-3 py-2 text-right">Moy. hist.</th>
                        <th className="px-3 py-2 text-right">Stock espace</th>
                        <th className="px-3 py-2 text-right">À monter</th>
                        <th className="px-3 py-2">Source</th>
                        <th className="px-3 py-2">Validée</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-50">
                      {sheet.lines
                        .filter((l) => l.product_family === fam)
                        .map((l) => {
                          const src = SOURCE_PILL[l.dotation_source] ?? SOURCE_PILL.option;
                          return (
                            <tr
                              key={l.product_name}
                              className={
                                l.association_level === 'C' || l.association_level === 'P'
                                  ? 'text-stone-400'
                                  : 'text-stone-800'
                              }
                            >
                              <td className="px-4 py-2.5 font-medium">{l.product_name}</td>
                              <td className="px-3 py-2.5">
                                <LevelBadge level={l.association_level} />
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums">
                                ×{Number(l.coeff).toFixed(2)}
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                {l.moy_hist ? Number(l.moy_hist).toFixed(1) : '—'}
                              </td>
                              <td className="px-3 py-2.5 text-right">{l.stock_espace || '—'}</td>
                              <td className="px-3 py-2.5 text-right text-base font-bold text-stone-900">
                                {l.a_monter || '—'}
                              </td>
                              <td className="px-3 py-2.5">
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${src.cls}`}
                                >
                                  {src.label}
                                </span>
                              </td>
                              <td className="px-3 py-2.5">
                                <input
                                  type="number"
                                  min={0}
                                  className="w-20 rounded-md border border-stone-300 px-2 py-1 text-sm"
                                  value={qtyValue(l)}
                                  onChange={(e) =>
                                    setEdits((prev) => ({ ...prev, [l.product_name]: e.target.value }))
                                  }
                                />
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    );
  }

  // ── Liste des espaces (hors buvettes) ────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-stone-600">
          Runner Espaces — VIP · Terrasses · Bodega (référentiel CDC)
        </p>
        {LevelSelector}
      </div>
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-amber-200">
        🍺 Les buvettes (B1→B9) sont gérées dans l'onglet <strong>« Runner Buvettes »</strong>.
      </p>
      {loading ? (
        <Spinner label="Chargement…" />
      ) : areas.length === 0 ? (
        <p className="rounded-xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-500">
          Aucun espace VIP / Terrasse / Bodega activé sur cet événement.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {areas.map((a) => {
            const sheet = sheets[a.name];
            const lines = sheet?.lines ?? [];
            const nbAMonter = lines.filter((l) => l.a_monter > 0).length;
            const nbSocle = lines.filter((l) => l.association_level === 'S').length;
            return (
              <button
                key={a.spaceId}
                onClick={() => setSelected(a.name)}
                className="rounded-2xl border border-stone-200 bg-white p-4 text-left transition-colors hover:border-stone-400"
              >
                <div className="flex items-center justify-between">
                  <p className="text-lg font-black text-stone-900">{a.name}</p>
                  <span className="rounded-lg bg-stone-900 px-2.5 py-1 text-sm font-bold text-white">
                    {nbAMonter}
                  </span>
                </div>
                <p className="mt-1 text-xs text-stone-400">
                  {nbAMonter} à monter · {nbSocle} socle · {lines.length} au total
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
