/**
 * DataPilotCapacitesPage (ROLE_STADE) — référentiel « Capacités & pax ».
 *
 * Donnée de référence du stade (master data) : capacité et pax de référence par
 * espace. Ces valeurs pilotent la normalisation conso /100 pax et le
 * dimensionnement des dotations. Lecture seule ici — l'édition d'un espace se
 * fait dans Configuration → Espaces (table `spaces`, écritures inchangées).
 * Route : /admin/datapilot/capacites.
 *
 * Ajouts : bande de synthèse (StatTile) + export Excel habillé (charte
 * excelTheme) reprenant toutes les colonnes, sous-totaux par type et TOTAL.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Database, ExternalLink, Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { StatTile } from '@/components/ui';
import { downloadAoaWorkbook, type AoaCell, type AoaSheetOut } from '@/lib/xlsxAoa';
import { INT, type ColumnStyle } from '@/lib/excelTheme';

interface SpaceRow {
  space_id: string;
  space_name: string;
  display_name: string | null;
  space_type: string;
  service_type: string | null;
  capacity: number | null;
  max_pax: number | null;
}

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/* Styles de colonnes Excel (charte excelTheme) réutilisés par l'export. */
const colLeft: ColumnStyle = { align: 'left' };
const colInt: ColumnStyle = { numFmt: INT, align: 'right' };

const spaceLabel = (r: SpaceRow): string => r.display_name || r.space_name;

export default function DataPilotCapacitesPage() {
  const [rows, setRows] = useState<SpaceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [xls, setXls] = useState(false);

  useEffect(() => {
    void supabase.from('spaces')
      .select('space_id, space_name, display_name, space_type, service_type, capacity, max_pax')
      .eq('active', true).order('space_type').order('space_name')
      .then(({ data }) => {
        setRows((data ?? []) as SpaceRow[]);
        setLoading(false);
      });
  }, []);

  const groups = useMemo(() => {
    const m = new Map<string, SpaceRow[]>();
    for (const r of rows) (m.get(r.space_type) ?? m.set(r.space_type, []).get(r.space_type)!).push(r);
    return [...m.entries()];
  }, [rows]);

  /** Synthèse globale : compteurs et totaux du référentiel capacités/pax. */
  const summary = useMemo(() => {
    let capSum = 0;
    let paxSum = 0;
    let missingCap = 0;
    let missingPax = 0;
    for (const r of rows) {
      const c = num(r.capacity);
      const p = num(r.max_pax);
      if (c == null) missingCap++; else capSum += c;
      if (p == null) missingPax++; else paxSum += p;
    }
    return {
      total: rows.length,
      types: groups.length,
      capSum,
      paxSum,
      missingCap,
      missingPax,
    };
  }, [rows, groups]);

  /** Export Excel complet et habillé du référentiel (sous-totaux par type + TOTAL). */
  async function exportExcel() {
    setXls(true);
    try {
      const header: AoaCell[] = ['Espace', 'Type', 'Service', 'Capacité', 'Pax de référence'];

      // Corps : espaces regroupés par type avec un sous-total par groupe.
      const body: AoaCell[][] = [];
      for (const [type, list] of groups) {
        let capG = 0;
        let paxG = 0;
        for (const r of list) {
          const c = num(r.capacity);
          const p = num(r.max_pax);
          if (c != null) capG += c;
          if (p != null) paxG += p;
          body.push([
            spaceLabel(r),
            r.space_type,
            r.service_type || '—',
            c ?? '—',
            p ?? '—',
          ]);
        }
        body.push([`Sous-total ${type}`, '', `${list.length} espace(s)`, capG, paxG]);
      }
      const totalRow: AoaCell[] = [
        'Total', '', `${summary.total} espace(s)`, summary.capSum, summary.paxSum,
      ];

      // Feuille SYNTHÈSE : indicateurs clés + répartition par type.
      const synthAoa: AoaCell[][] = [
        ['Capacités & pax de référence — Provence Rugby · Stade Maurice-David'],
        [],
        ['Indicateur', 'Valeur'],
        ['Espaces actifs', summary.total],
        ['Types d\'espace', summary.types],
        ['Capacité totale', summary.capSum],
        ['Pax de référence total', summary.paxSum],
        ['Capacité non renseignée', summary.missingCap],
        ['Pax non renseigné', summary.missingPax],
        [],
        ['Répartition par type', 'Espaces', 'Capacité', 'Pax de référence'],
        ...groups.map(([type, list]): AoaCell[] => {
          const capG = list.reduce((s, r) => s + (num(r.capacity) ?? 0), 0);
          const paxG = list.reduce((s, r) => s + (num(r.max_pax) ?? 0), 0);
          return [type, list.length, capG, paxG];
        }),
        ['Total', summary.total, summary.capSum, summary.paxSum],
      ];

      const sheets: AoaSheetOut[] = [
        {
          name: 'Synthèse',
          aoa: synthAoa,
          widths: [30, 14, 14, 16],
          columns: [colLeft, colInt, colInt, colInt],
        },
        {
          name: 'Capacités',
          aoa: [['Capacités & pax de référence — par espace'], [], header, ...body, totalRow],
          widths: [30, 12, 20, 12, 16],
          columns: [colLeft, colLeft, colLeft, colInt, colInt],
        },
      ];

      const dateStr = new Date().toISOString().slice(0, 10);
      await downloadAoaWorkbook(sheets, `Capacites-pax_Provence-Rugby_${dateStr}.xlsx`);
    } finally {
      setXls(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="h-8 w-1.5 rounded-full bg-cyan-500" />
          <div>
            <h1 className="text-2xl font-black text-stone-900">Capacités & pax de référence</h1>
            <p className="text-sm text-stone-400">Master data espace — pilote la normalisation /100 pax et le dimensionnement des dotations.</p>
          </div>
        </div>
        <button
          onClick={() => void exportExcel()}
          disabled={xls || rows.length === 0}
          className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 px-3 py-2 text-sm font-semibold text-white hover:bg-cyan-700 disabled:opacity-40"
        >
          <Download size={15} /> {xls ? 'Export…' : 'Exporter Excel'}
        </button>
      </div>

      {/* Bande de synthèse (KPIs du référentiel) */}
      {!loading && rows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatTile label="Espaces actifs" value={summary.total} sub={`${summary.types} type(s)`} />
          <StatTile label="Capacité totale" value={summary.capSum.toLocaleString('fr-FR')} sub="places cumulées" />
          <StatTile label="Pax de référence" value={summary.paxSum.toLocaleString('fr-FR')} sub="base conso /100 pax" />
          <StatTile
            label="Capacité manquante"
            value={summary.missingCap}
            tone={summary.missingCap > 0 ? 'warn' : 'good'}
            sub={summary.missingCap > 0 ? 'à renseigner' : 'complet'}
          />
          <StatTile
            label="Pax manquant"
            value={summary.missingPax}
            tone={summary.missingPax > 0 ? 'warn' : 'good'}
            sub={summary.missingPax > 0 ? 'à renseigner' : 'complet'}
          />
        </div>
      )}

      <div className="flex items-start gap-3 rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-xs leading-relaxed text-cyan-900">
        <Database size={16} className="mt-0.5 shrink-0" />
        <p><b>D'où ça vient :</b> table <code>spaces</code> (Configuration → Espaces). <b>Ce que ça pilote :</b> le pax de référence sert de base à la conso normalisée /100 pax et au calcul des quantités recommandées. Lecture seule ici.</p>
      </div>

      {loading ? (
        <div className="h-64 animate-pulse rounded-2xl bg-stone-100" />
      ) : (
        groups.map(([type, list]) => (
          <div key={type} className="overflow-hidden rounded-2xl border border-stone-100 bg-white">
            <div className="flex items-center gap-2 border-b border-stone-100 bg-stone-50 px-4 py-2 text-sm font-bold text-stone-700">
              <Building2 size={15} />{type}<span className="ml-1 text-xs font-normal text-stone-400">({list.length})</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-100 text-left text-xs uppercase tracking-wide text-stone-400">
                  <th className="px-4 py-2">Espace</th>
                  <th className="px-3 py-2">Service</th>
                  <th className="px-3 py-2 text-right">Capacité</th>
                  <th className="px-4 py-2 text-right">Pax de référence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50">
                {list.map((r) => (
                  <tr key={r.space_id} className="text-stone-800">
                    <td className="px-4 py-2 font-medium">{spaceLabel(r)}</td>
                    <td className="px-3 py-2 text-stone-500">{r.service_type || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(r.capacity) ?? '—'}</td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums">{num(r.max_pax) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}

      <Link to="/admin/spaces" className="inline-flex items-center gap-1.5 text-sm font-semibold text-cyan-700 hover:text-cyan-900">
        <ExternalLink size={14} />Modifier les espaces (Configuration → Espaces)
      </Link>
    </div>
  );
}
