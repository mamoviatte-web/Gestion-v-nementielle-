/**
 * LogeRunnerPage (ROLE_STADE) — Fiche runner des Loges.
 *
 * Méthodo « dotation par loge individuelle + stockage » : chaque loge reçoit une
 * dotation fixe ; la fiche runner de l'espace = Σ des dotations − stock déjà présent
 * (« en office ») = « à monter » (on ne remonte que le complément). Source :
 * get_loge_runner_sheet (loge_dotations + area_stocks). Route : /admin/loges.
 */

import { useEffect, useMemo, useState } from 'react';
import { Printer, Download, Boxes, LayoutGrid, Lock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { downloadAoaWorkbook, type AoaSheetOut } from '@/lib/xlsxAoa';

const LOGE_SPACES = [
  { id: 'a96044d1-9ab0-45d0-85eb-73672df6ab82', name: 'Loge Est' },
  { id: '673b6e4e-0f5a-406f-9029-c35b25a38103', name: 'Loge Ouest Nord' },
  { id: '8be2956e-a379-4e8e-a3eb-65401bac3c56', name: 'Loge Ouest Sud' },
];

interface SynLine { produit: string; product_id: string | null; total: number; en_office: number; a_monter: number }
interface LogeBlock { loge: string; lignes: { produit: string; qte: number }[] }
interface Sheet { space_name: string; nb_loges: number; loges: LogeBlock[]; synthese: SynLine[] }

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Barre empilée : part déjà en stock (vert) + part à monter (ambre) sur la
 * dotation fixe. Donne d'un coup d'œil ce qui reste à remonter.
 */
function CoverBar({ office, monter }: { office: number; monter: number }) {
  const total = office + monter;
  if (total <= 0) return <div className="h-2 w-full rounded-full bg-stone-100" />;
  const p = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-stone-100" title={`Déjà en stock ${office} · À monter ${monter}`}>
      <div className="bg-emerald-400" style={{ width: p(office) }} />
      <div className="bg-amber-400" style={{ width: p(monter) }} />
    </div>
  );
}

export default function LogeRunnerPage() {
  const [spaceId, setSpaceId] = useState(LOGE_SPACES[0].id);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void supabase.rpc('get_loge_runner_sheet', { p_space: spaceId }).then(({ data }) => {
      if (!alive) return;
      const d = data as Sheet | null;
      setSheet(
        d && {
          space_name: String(d.space_name ?? ''),
          nb_loges: num(d.nb_loges),
          loges: (d.loges ?? []).map((l) => ({ loge: String(l.loge), lignes: (l.lignes ?? []).map((x) => ({ produit: String(x.produit), qte: num(x.qte) })) })),
          synthese: (d.synthese ?? []).map((s) => ({ produit: String(s.produit), product_id: s.product_id ?? null, total: num(s.total), en_office: num(s.en_office), a_monter: num(s.a_monter) })),
        },
      );
      setLoading(false);
    });
    return () => { alive = false; };
  }, [spaceId]);

  const totals = useMemo(() => {
    const s = sheet?.synthese ?? [];
    return { total: s.reduce((a, r) => a + r.total, 0), office: s.reduce((a, r) => a + r.en_office, 0), monter: s.reduce((a, r) => a + r.a_monter, 0) };
  }, [sheet]);

  function exportExcel() {
    if (!sheet) return;
    const synth: AoaSheetOut = {
      name: 'À monter',
      aoa: [
        [`Fiche Runner — ${sheet.space_name}`],
        ['Produit', 'Total (dotation)', 'En office', 'À monter'],
        ...sheet.synthese.map((r) => [r.produit, r.total, r.en_office, r.a_monter]),
        [],
        ['TOTAL', totals.total, totals.office, totals.monter],
      ],
      widths: [26, 16, 12, 12],
    };
    const detail: AoaSheetOut = {
      name: 'Dotation par loge',
      aoa: [
        ['Loge', 'Produit', 'Quantité'],
        ...sheet.loges.flatMap((l) => l.lignes.map((x) => [l.loge, x.produit, x.qte])),
      ],
      widths: [24, 26, 10],
    };
    void downloadAoaWorkbook([synth, detail], `fiche_runner_${sheet.space_name.replace(/\s+/g, '_')}.xlsx`);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6 print:p-0">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div className="flex items-center gap-2">
          <div className="h-8 w-1.5 rounded-full bg-amber-500" />
          <div>
            <h1 className="text-2xl font-black text-stone-900">Fiche Runner — Loges</h1>
            <p className="text-sm text-stone-400">Dotation fixe par loge (jamais modifiée). Le runner ne remonte que le manquant.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <select value={spaceId} onChange={(e) => setSpaceId(e.target.value)}
            className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
            {LOGE_SPACES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button onClick={() => window.print()} className="flex items-center gap-2 rounded-xl border border-stone-200 px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50">
            <Printer size={15} />Imprimer
          </button>
          <button onClick={exportExcel} disabled={!sheet} className="flex items-center gap-2 rounded-xl bg-stone-900 px-4 py-2 text-sm font-bold text-white hover:bg-stone-700 disabled:opacity-40">
            <Download size={15} />Excel
          </button>
        </div>
      </div>

      {loading || !sheet ? (
        <div className="h-64 animate-pulse rounded-2xl bg-stone-100" />
      ) : (
        <>
          <div className="hidden print:block">
            <h1 className="text-xl font-black">Fiche Runner — {sheet.space_name}</h1>
          </div>

          {/* Bande formule : rappelle la logique dotation fixe → manquant */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-stone-100 bg-white px-4 py-3 text-sm shadow-sm">
            <span className="inline-flex items-center gap-1.5 font-bold text-stone-700"><Lock size={13} className="text-stone-400" />Dotation fixe</span>
            <span className="text-stone-300">−</span>
            <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />Déjà en stock</span>
            <span className="text-stone-300">=</span>
            <span className="inline-flex items-center gap-1.5 font-black text-amber-700"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" />À monter</span>
            <span className="ml-auto text-xs text-stone-400">La dotation par loge ne bouge jamais — seul le manquant est remonté.</span>
          </div>

          {/* Synthèse : à monter */}
          <div className="overflow-hidden rounded-2xl border border-stone-100 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-stone-100 bg-stone-50 px-4 py-2 text-sm font-bold text-stone-700">
              <Boxes size={15} />À monter — {sheet.space_name} <span className="text-xs font-normal text-stone-400">({sheet.nb_loges} loges)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-100 text-left text-xs uppercase tracking-wide text-stone-400">
                    <th className="px-4 py-2">Produit</th>
                    <th className="px-3 py-2 text-right">Dotation fixe</th>
                    <th className="px-3 py-2 text-right">Déjà en stock</th>
                    <th className="w-40 px-3 py-2">Couverture</th>
                    <th className="px-4 py-2 text-right">À monter</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-50">
                  {sheet.synthese.map((r) => (
                    <tr key={r.produit} className="text-stone-800">
                      <td className="px-4 py-2 font-medium">{r.produit}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-stone-500">{r.total}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{r.en_office}</td>
                      <td className="px-3 py-2"><CoverBar office={r.en_office} monter={r.a_monter} /></td>
                      <td className="px-4 py-2 text-right font-black tabular-nums text-amber-700">{r.a_monter}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-stone-200 bg-stone-50 font-bold text-stone-900">
                    <td className="px-4 py-2">TOTAL</td>
                    <td className="px-3 py-2 text-right tabular-nums">{totals.total}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{totals.office}</td>
                    <td className="px-3 py-2"><CoverBar office={totals.office} monter={totals.monter} /></td>
                    <td className="px-4 py-2 text-right tabular-nums text-amber-700">{totals.monter}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Détail par loge — dotation fixe de référence */}
          <div className="flex items-center gap-2 text-sm font-bold text-stone-700">
            <LayoutGrid size={16} />Dotation par loge individuelle
            <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
              <Lock size={11} />Fixe — ne bouge jamais
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3">
            {sheet.loges.map((l) => {
              const sub = l.lignes.reduce((a, x) => a + x.qte, 0);
              return (
                <div key={l.loge} className="overflow-hidden rounded-2xl border border-stone-100 bg-white break-inside-avoid">
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
        </>
      )}
    </div>
  );
}
