/**
 * BuvetteRunnersPanel — fiches runner des 9 buvettes (B1→B9), pilotées par le
 * référentiel CDC V3 (area_product_reference) via les RPC get_buvette_runners_index
 * et get_buvette_runner. Écran liste + fiche détail groupée par famille, avec le
 * dépôt de prélèvement par ligne. Aucun coût affiché (règle CDC).
 */

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Spinner } from '@/components/ui';

type Level = 'S' | 'SR' | 'SRP' | 'ALL';

const LEVELS: { key: Level; label: string }[] = [
  { key: 'S', label: 'Socle (S)' },
  { key: 'SR', label: '+ Récurrents (SR)' },
  { key: 'SRP', label: '+ Ponctuels (SRP)' },
  { key: 'ALL', label: 'Tout (ALL)' },
];

const DEPOT_BADGE: Record<string, { label: string; cls: string }> = {
  stockage_futs: { label: 'Stockage Fûts', cls: 'bg-amber-100 text-amber-700' },
  auc_reserve: { label: 'AUC Réserve', cls: 'bg-blue-100 text-blue-700' },
  buvette_locale: { label: 'Sur place', cls: 'bg-emerald-100 text-emerald-700' },
  stock_est: { label: 'Stock EST', cls: 'bg-purple-100 text-purple-700' },
};

const FAMILY_ORDER = ['Bière / Fûts', 'Vins', 'Champagne', 'Softs / Eau / Sirops', 'Spiritueux / Apéritifs', 'Gaz / Technique', 'Autres'];

interface IndexRow {
  area_name: string;
  libelle: string;
  nb_a_monter: number;
  nb_socle: number;
  nb_total: number;
  depots: string[] | null;
}
interface RunnerLine {
  product_family: string;
  product_name: string;
  association_level: 'S' | 'R' | 'P' | 'C';
  is_default: boolean;
  depot_label: string | null;
  depot_type: string | null;
  stock_espace: number;
  moy_hist: number;
  reco: number;
}
interface RunnerSheet {
  buvette_code: string;
  libelle: string;
  show_level: string;
  lines: RunnerLine[];
}

function LevelBadge({ level }: { level: RunnerLine['association_level'] }) {
  const map = {
    S: 'bg-stone-900 text-white',
    R: 'border border-stone-400 text-stone-600',
    P: 'bg-stone-100 text-stone-400',
    C: 'bg-stone-100 text-stone-400 italic',
  } as const;
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${map[level]}`}>{level === 'C' ? 'à confirmer' : level}</span>;
}

function DepotBadge({ type, label }: { type: string | null; label: string | null }) {
  if (!type) return <span className="text-xs text-stone-300">—</span>;
  const b = DEPOT_BADGE[type] ?? { label: label ?? type, cls: 'bg-stone-100 text-stone-600' };
  return (
    <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold ${b.cls}`} title={label ?? undefined}>
      {b.label}
    </span>
  );
}

export function BuvetteRunnersPanel({ eventId }: { eventId: string }) {
  const [level, setLevel] = useState<Level>('S');
  const [selected, setSelected] = useState<string | null>(null);
  const [index, setIndex] = useState<IndexRow[]>([]);
  const [sheet, setSheet] = useState<RunnerSheet | null>(null);
  const [loading, setLoading] = useState(true);

  const loadIndex = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc('get_buvette_runners_index', { p_event_id: eventId, p_show_level: level });
    setIndex((data as IndexRow[] | null) ?? []);
    setLoading(false);
  }, [eventId, level]);

  const loadSheet = useCallback(async (code: string) => {
    setLoading(true);
    const { data } = await supabase.rpc('get_buvette_runner', { p_buvette_code: code, p_event_id: eventId, p_show_level: level });
    setSheet((data as RunnerSheet | null) ?? null);
    setLoading(false);
  }, [eventId, level]);

  useEffect(() => {
    if (selected) void loadSheet(selected);
    else void loadIndex();
  }, [selected, level, loadIndex, loadSheet]);

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

  // ── Fiche détail ─────────────────────────────────────────────────────────
  if (selected) {
    const families = FAMILY_ORDER.filter((f) => (sheet?.lines ?? []).some((l) => l.product_family === f));
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button onClick={() => { setSelected(null); setSheet(null); }} className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800">
            <ArrowLeft className="h-4 w-4" /> Toutes les buvettes
          </button>
          {LevelSelector}
        </div>

        {loading || !sheet ? (
          <Spinner label="Chargement…" />
        ) : (
          <>
            <div>
              <h3 className="text-lg font-black text-stone-900">Runner — {sheet.libelle} <span className="text-stone-400">({sheet.buvette_code})</span></h3>
              <p className="text-sm text-stone-500">{sheet.lines.length} produit{sheet.lines.length > 1 ? 's' : ''} à monter · niveau {sheet.show_level}</p>
            </div>

            {families.map((fam) => (
              <div key={fam} className="overflow-hidden rounded-2xl border border-stone-200">
                <div className="border-b border-stone-100 bg-stone-50 px-4 py-2 text-sm font-bold text-stone-700">{fam}</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-stone-100 text-left text-xs uppercase tracking-wide text-stone-400">
                        <th className="px-4 py-2">Produit</th>
                        <th className="px-3 py-2">Niveau</th>
                        <th className="px-3 py-2 text-right">Stock espace</th>
                        <th className="px-3 py-2 text-right">Moy. hist.</th>
                        <th className="px-3 py-2 text-right">Reco</th>
                        <th className="px-4 py-2">Dépôt</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-50">
                      {sheet.lines.filter((l) => l.product_family === fam).map((l) => (
                        <tr key={l.product_name} className={l.association_level === 'C' || l.association_level === 'P' ? 'text-stone-400' : 'text-stone-800'}>
                          <td className="px-4 py-2.5 font-medium">{l.product_name}</td>
                          <td className="px-3 py-2.5"><LevelBadge level={l.association_level} /></td>
                          <td className="px-3 py-2.5 text-right">{l.stock_espace || '—'}</td>
                          <td className="px-3 py-2.5 text-right">{l.moy_hist ? Number(l.moy_hist).toFixed(1) : '—'}</td>
                          <td className="px-3 py-2.5 text-right font-semibold">{l.reco || '—'}</td>
                          <td className="px-4 py-2.5"><DepotBadge type={l.depot_type} label={l.depot_label} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            <p className="text-xs text-stone-400">
              La transmission déduira les quantités des dépôts centraux (AUC / Stock EST / Stockage Fûts). Les lignes « Sur place » (softs B2/B3/B4) sont montées sur place, sans déduction centrale.
            </p>
          </>
        )}
      </div>
    );
  }

  // ── Liste des 9 buvettes ─────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-stone-600">Runner Buvettes — 9 points de vente (B1 → B9)</p>
        {LevelSelector}
      </div>
      {loading ? (
        <Spinner label="Chargement…" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {index.map((b) => (
            <button
              key={b.area_name}
              onClick={() => setSelected(b.area_name)}
              className="rounded-2xl border border-stone-200 bg-white p-4 text-left transition-colors hover:border-stone-400"
            >
              <div className="flex items-center justify-between">
                <p className="text-lg font-black text-stone-900">{b.area_name}</p>
                <span className="rounded-lg bg-stone-900 px-2.5 py-1 text-sm font-bold text-white">{b.nb_a_monter}</span>
              </div>
              <p className="mt-0.5 truncate text-sm text-stone-500">{b.libelle}</p>
              <p className="mt-1 text-xs text-stone-400">{b.nb_a_monter} à monter · {b.nb_socle} socle · {b.nb_total} au total</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {(b.depots ?? []).map((d) => <DepotBadge key={d} type={d} label={null} />)}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
