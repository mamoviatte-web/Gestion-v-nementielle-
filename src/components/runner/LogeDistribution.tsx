/**
 * LogeDistribution — répartition loge par loge, affichée dans la fiche runner
 * d'un espace « Loge » (Loge Est / Ouest Nord / Ouest Sud). Le runner monte le
 * total à l'office puis distribue à chaque loge selon sa dotation individuelle.
 * Source : get_loge_runner_sheet (loge_dotations). N'affiche rien hors loges.
 */

import { useEffect, useState } from 'react';
import { LayoutGrid, Lock } from 'lucide-react';
import { supabase } from '@/lib/supabase';

const LOGE_IDS = new Set([
  'a96044d1-9ab0-45d0-85eb-73672df6ab82', // Loge Est
  '673b6e4e-0f5a-406f-9029-c35b25a38103', // Loge Ouest Nord
  '8be2956e-a379-4e8e-a3eb-65401bac3c56', // Loge Ouest Sud
]);

interface LogeBlock { loge: string; lignes: { produit: string; qte: number }[] }
interface Sheet { space_name: string; nb_loges: number; loges: LogeBlock[] }

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function LogeDistribution({ spaceId }: { spaceId: string | undefined }) {
  const [sheet, setSheet] = useState<Sheet | null>(null);

  useEffect(() => {
    if (!spaceId || !LOGE_IDS.has(spaceId)) { setSheet(null); return; }
    let alive = true;
    void supabase.rpc('get_loge_runner_sheet', { p_space: spaceId }).then(({ data }) => {
      if (!alive) return;
      const d = data as Sheet | null;
      setSheet(
        d && {
          space_name: String(d.space_name ?? ''),
          nb_loges: num(d.nb_loges),
          loges: (d.loges ?? []).map((l) => ({
            loge: String(l.loge),
            lignes: (l.lignes ?? []).map((x) => ({ produit: String(x.produit), qte: num(x.qte) })),
          })),
        },
      );
    });
    return () => { alive = false; };
  }, [spaceId]);

  if (!spaceId || !LOGE_IDS.has(spaceId) || !sheet || sheet.loges.length === 0) return null;

  return (
    <section className="mb-4 rounded-2xl border border-amber-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <LayoutGrid className="h-4 w-4 text-amber-600" />
        <span className="text-sm font-bold text-stone-800">Répartition par loge</span>
        <span className="text-xs text-stone-400">({sheet.nb_loges} loges)</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
          <Lock size={11} />Dotation fixe par loge
        </span>
        <span className="ml-auto text-xs text-stone-400">Monter le total à l'office, puis distribuer à chaque loge.</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3">
        {sheet.loges.map((l) => {
          const sub = l.lignes.reduce((a, x) => a + x.qte, 0);
          return (
            <div key={l.loge} className="overflow-hidden rounded-xl border border-stone-100 bg-white break-inside-avoid">
              <div className="flex items-center justify-between border-b border-stone-100 bg-amber-50 px-3 py-1.5">
                <span className="text-sm font-bold text-stone-800">{l.loge}</span>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700"><Lock size={10} />{sub}</span>
              </div>
              <table className="w-full text-xs">
                <tbody className="divide-y divide-stone-50">
                  {l.lignes.map((x) => (
                    <tr key={x.produit}>
                      <td className="px-3 py-1 text-stone-700">{x.produit}</td>
                      <td className="px-3 py-1 text-right font-semibold tabular-nums text-stone-900">{x.qte}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </section>
  );
}
