/**
 * LogeRunnerPage (ROLE_STADE) — Fiche runner des Loges.
 *
 * Méthodo « dotation par loge individuelle + stockage » : chaque loge reçoit une
 * dotation fixe ; la fiche runner de l'espace = Σ des dotations − stock déjà présent
 * (« en office ») = « à monter » (on ne remonte que le complément). Source :
 * get_loge_runner_sheet (loge_dotations + area_stocks). Route : /admin/loges.
 */

import { useEffect, useMemo, useState } from 'react';
import { Printer, Download, Boxes, LayoutGrid, Lock, BarChart3, ChevronDown, ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { downloadAoaWorkbook, sumFormula, type AoaCell, type AoaSheetOut } from '@/lib/xlsxAoa';
import { INT, type ColumnStyle } from '@/lib/excelTheme';

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

/** Entier lisible « 1 234 » (séparateur français). */
const nf = (v: number): string => v.toLocaleString('fr-FR');

/* Styles de colonnes Excel (charte commune excelTheme). */
const colLeft: ColumnStyle = { align: 'left' };
const colInt: ColumnStyle = { numFmt: INT, align: 'right' };

interface BreakItem { key: string; label: string; value: number; sub?: string }

/**
 * Barres de synthèse (part relative au max) — permet de lire l'essentiel sans
 * dérouler les tables. Barre ambre = « à monter », comme la charte de la page.
 */
function Breakdown({ title, items, barClass = 'bg-amber-400' }: { title: string; items: BreakItem[]; barClass?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="overflow-hidden rounded-2xl border border-stone-100 bg-white shadow-sm">
      <div className="border-b border-stone-100 bg-stone-50 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-stone-400">{title}</div>
      <div className="divide-y divide-stone-50">
        {items.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-stone-400">Aucune donnée.</div>
        ) : items.map((r) => (
          <div key={r.key} className="px-4 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-stone-700">{r.label}</span>
              <span className="shrink-0 text-sm font-bold tabular-nums text-amber-700">{nf(r.value)}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-100">
                <div className={`h-full rounded-full ${barClass}`} style={{ width: `${(r.value / max) * 100}%` }} />
              </div>
              {r.sub != null && <span className="shrink-0 text-[11px] text-stone-400">{r.sub}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

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
  const [showLoges, setShowLoges] = useState(false);

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

  /** Taux de couverture = part déjà en stock sur la dotation fixe. */
  const coverage = totals.total > 0 ? totals.office / totals.total : 0;
  const nbLignes = useMemo(() => (sheet?.loges ?? []).reduce((a, l) => a + l.lignes.length, 0), [sheet]);

  /** À monter par produit (décroissant) — priorité de chargement du runner. */
  const parProduit = useMemo<BreakItem[]>(() =>
    (sheet?.synthese ?? [])
      .filter((r) => r.a_monter > 0)
      .sort((a, b) => b.a_monter - a.a_monter)
      .map((r) => ({ key: r.produit, label: r.produit, value: r.a_monter, sub: `${nf(r.en_office)} en stock` })),
  [sheet]);

  /** Dotation fixe totale par loge (décroissant) — poids relatif des loges. */
  const parLoge = useMemo<BreakItem[]>(() =>
    (sheet?.loges ?? [])
      .map((l) => ({ key: l.loge, label: l.loge, value: l.lignes.reduce((a, x) => a + x.qte, 0), sub: `${l.lignes.length} réf.` }))
      .sort((a, b) => b.value - a.value),
  [sheet]);

  function exportExcel() {
    if (!sheet) return;
    const synth: AoaSheetOut = {
      name: 'À monter',
      aoa: [
        [`Fiche Runner — ${sheet.space_name}`],
        ['Dotation fixe (ne bouge jamais) − Déjà en stock = À monter'],
        ['Produit', 'Dotation fixe', 'Déjà en stock', 'À monter'],
        ...sheet.synthese.map((r): AoaCell[] => [r.produit, r.total, r.en_office, r.a_monter]),
        [],
        // 3 colonnes additives (Dotation fixe / Déjà en stock / À monter) → totaux
        // auto-vérifiants (=SUM). Données : lignes Excel 4..(3+n), n = nb produits.
        [
          'TOTAL',
          sumFormula(1, 4, 3 + sheet.synthese.length),
          sumFormula(2, 4, 3 + sheet.synthese.length),
          sumFormula(3, 4, 3 + sheet.synthese.length),
        ],
      ],
      widths: [26, 14, 14, 12],
      columns: [colLeft, colInt, colInt, colInt],
    };
    // Feuille « Détail complet » : une ligne par loge × produit (toutes colonnes),
    // le détail exhaustif reste dans l'export tandis que l'écran est synthétique.
    const detail: AoaSheetOut = {
      name: 'Détail complet',
      aoa: [
        [`Détail dotation par loge — ${sheet.space_name}`],
        ['Loge', 'Produit', 'Quantité'],
        ...sheet.loges.flatMap((l) => l.lignes.map((x): AoaCell[] => [l.loge, x.produit, x.qte])),
        [],
        // Ici l'entête est en ligne 2 (titre en 1, pas de ligne vide) → les données
        // commencent en ligne 3. « Quantité » additive → =SUM sur 3..(2+m).
        ['TOTAL', '', sumFormula(2, 3, 2 + sheet.loges.reduce((a, l) => a + l.lignes.length, 0))],
      ],
      widths: [22, 30, 12],
      columns: [colLeft, colLeft, colInt],
    };
    // Une feuille « prête à l'emploi » par loge (nom d'onglet Excel assaini/unique).
    const used = new Set<string>();
    const tabName = (label: string): string => {
      const base = (label.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim() || 'Loge').slice(0, 28);
      let name = base;
      for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 25)} ${i}`;
      used.add(name.toLowerCase());
      return name;
    };
    const perLoge: AoaSheetOut[] = sheet.loges.map((l) => ({
      name: tabName(l.loge),
      aoa: [
        [`${sheet.space_name} — ${l.loge}`],
        ['Dotation fixe (ne bouge jamais)'],
        ['Produit', 'Quantité'],
        ...l.lignes.map((x): AoaCell[] => [x.produit, x.qte]),
        [],
        // Données en lignes 4..(3+k) (titre/1, sous-titre/2, entête/3) → « Quantité »
        // additive → total auto-vérifiant (=SUM).
        ['TOTAL', sumFormula(1, 4, 3 + l.lignes.length)],
      ],
      widths: [30, 10],
      columns: [colLeft, colInt],
    }));
    void downloadAoaWorkbook([synth, detail, ...perLoge], `fiche_runner_${sheet.space_name.replace(/\s+/g, '_')}.xlsx`);
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

          {/* KPIs de synthèse — l'essentiel sans dérouler les tables */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5 print:grid-cols-5">
            <div className="rounded-xl border border-stone-100 bg-white px-3.5 py-2.5 shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Dotation fixe</p>
              <p className="text-lg font-black tabular-nums text-stone-900">{nf(totals.total)}</p>
              <p className="mt-0.5 text-xs text-stone-400">unités</p>
            </div>
            <div className="rounded-xl border border-stone-100 bg-white px-3.5 py-2.5 shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Déjà en stock</p>
              <p className="text-lg font-black tabular-nums text-emerald-600">{nf(totals.office)}</p>
              <p className="mt-0.5 text-xs text-stone-400">en office</p>
            </div>
            <div className="rounded-xl border border-stone-100 bg-white px-3.5 py-2.5 shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">À monter</p>
              <p className="text-lg font-black tabular-nums text-amber-700">{nf(totals.monter)}</p>
              <p className="mt-0.5 text-xs text-stone-400">complément runner</p>
            </div>
            <div className="rounded-xl border border-stone-100 bg-white px-3.5 py-2.5 shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Couverture</p>
              <p className="text-lg font-black tabular-nums text-stone-900">{(coverage * 100).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} %</p>
              <p className="mt-0.5 text-xs text-stone-400">déjà présent</p>
            </div>
            <div className="rounded-xl border border-stone-100 bg-white px-3.5 py-2.5 shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Loges</p>
              <p className="text-lg font-black tabular-nums text-stone-900">{nf(sheet.nb_loges)}</p>
              <p className="mt-0.5 text-xs text-stone-400">{nf(nbLignes)} lignes</p>
            </div>
          </div>

          {/* Graphiques de synthèse — à monter par produit & poids des loges */}
          <div className="print:hidden">
            <div className="mb-2 flex items-center gap-2 text-sm font-bold text-stone-700">
              <BarChart3 size={16} />Synthèse graphique
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <Breakdown title="À monter par produit (décroissant)" items={parProduit} />
              <Breakdown title="Dotation fixe par loge (décroissant)" items={parLoge} barClass="bg-stone-400" />
            </div>
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

          {/* Détail par loge — dotation fixe de référence (repliable) */}
          <button
            type="button"
            onClick={() => setShowLoges((v) => !v)}
            className="flex w-full items-center gap-2 rounded-2xl border border-stone-100 bg-white px-4 py-2.5 text-left text-sm font-bold text-stone-700 shadow-sm transition-colors hover:bg-stone-50 print:hidden"
          >
            {showLoges ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <LayoutGrid size={16} />Dotation par loge individuelle
            <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
              <Lock size={11} />Fixe — ne bouge jamais
            </span>
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
              {sheet.nb_loges} loge{sheet.nb_loges > 1 ? 's' : ''} · {nbLignes} ligne{nbLignes > 1 ? 's' : ''}
            </span>
            <span className="ml-auto hidden text-[11px] font-medium normal-case text-stone-400 sm:inline">
              {showLoges ? 'Masquer' : 'Afficher'} · détail complet dans l’export Excel ↑
            </span>
          </button>
          <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 print:grid print:grid-cols-3 ${showLoges ? '' : 'hidden'}`}>
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
