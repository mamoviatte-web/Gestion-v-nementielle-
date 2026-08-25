/**
 * RhAnalytiquePage (ROLE_STADE) — « RH Analytique » : reporting inter-matchs.
 *
 * Vue agrégée des heures mensuelles par personne (source : vue `rh_monthly_hours`,
 * union de zone_staff_hours + occasional_hours). Filtre par plage de mois,
 * tableau par personne × mois, ventilation du coût par mission, et export Excel
 * recalculable. Reporting pur — aucune écriture (les heures sont saisies dans RH Match).
 * Route : /admin/rh/analytique.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, TrendingUp, Users, Clock, Wallet, AlertTriangle, FileSpreadsheet } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { downloadAoaWorkbook, type AoaSheetOut } from '@/lib/xlsxAoa';
import { downloadPayrollWorkbook, type PayrollRow } from '@/lib/payrollExport';

interface MonthlyRow {
  staff_name: string;
  mois: string;
  heures: number;
  cout_ht: number;
  nb_evenements: number;
  missions: string;
}

interface DetailRow {
  mois: string;
  espace: string;
  statut: string;
  heures: number;
  cout_ht: number;
}

const STATUT_LABEL: Record<string, string> = {
  salarie: 'Salarié', autoentrepreneur: 'Auto-entrepreneur', benevole: 'Bénévole',
  franchise: 'Franchise', non_precise: 'Non précisé',
};

/** Circuit de paiement : franchise = facture (rouge) · contrat = paie (vert). */
const payColor = (t: string): string =>
  t === 'franchise' ? '#C00000' : t === 'contrat' ? '#1E7A34' : '#6B7280';

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const eur = (v: number): string =>
  v.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €';
const hrs = (v: number): string => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });

/** Mois courant au format YYYY-MM. */
function ymNow(offset = 0): string {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const moisLabel = (ym: string): string => {
  const [y, m] = ym.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
};

function Tile({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-stone-100 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-stone-400">{icon}<span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span></div>
      <p className={`mt-1 text-2xl font-black tabular-nums ${accent ?? 'text-stone-900'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-stone-400">{sub}</p>}
    </div>
  );
}

interface BreakItem { key: string; label: string; heures: number; cout: number }
function Breakdown({ title, items }: { title: string; items: BreakItem[] }) {
  const max = Math.max(1, ...items.map((i) => i.cout));
  return (
    <div className="overflow-hidden rounded-2xl border border-stone-100 bg-white">
      <div className="border-b border-stone-100 bg-stone-50 px-4 py-2 text-sm font-bold text-stone-700">{title}</div>
      <div className="divide-y divide-stone-50">
        {items.map((r) => (
          <div key={r.key} className="px-4 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-stone-800">{r.label}</span>
              <span className="shrink-0 text-sm font-bold tabular-nums text-indigo-600">{eur(r.cout)}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-100">
                <div className="h-full rounded-full bg-indigo-500" style={{ width: `${(r.cout / max) * 100}%` }} />
              </div>
              <span className="shrink-0 text-[11px] text-stone-400">{hrs(r.heures)} h</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function RhAnalytiquePage() {
  const [debut, setDebut] = useState(ymNow(-11));
  const [fin, setFin] = useState(ymNow(0));
  const [rows, setRows] = useState<MonthlyRow[]>([]);
  const [details, setDetails] = useState<DetailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [payMonth, setPayMonth] = useState(ymNow(0));
  const [payRows, setPayRows] = useState<PayrollRow[]>([]);
  const [exporting, setExporting] = useState(false);

  const loadPay = useCallback(async () => {
    const { data } = await supabase
      .from('rh_monthly_hours')
      .select('staff_name, type_paiement, mois, missions, heures, cout_ht, nb_evenements')
      .eq('mois', payMonth)
      .order('staff_name');
    setPayRows((data ?? []).map((r) => ({
      staff_name: String((r as PayrollRow).staff_name ?? ''),
      type_paiement: String((r as PayrollRow).type_paiement ?? 'non défini'),
      mois: String((r as PayrollRow).mois ?? payMonth),
      missions: String((r as PayrollRow).missions ?? ''),
      heures: num((r as PayrollRow).heures),
      cout_ht: num((r as PayrollRow).cout_ht),
      nb_evenements: num((r as PayrollRow).nb_evenements),
    })));
  }, [payMonth]);

  useEffect(() => { void loadPay(); }, [loadPay]);

  const [savingCircuit, setSavingCircuit] = useState<string | null>(null);
  /** Bascule le circuit d'une personne (Franchise/Contrat) ; Contrat = 18 €/h. */
  async function setCircuit(staff: string, type: 'franchise' | 'contrat') {
    setSavingCircuit(staff);
    try {
      const { error } = await supabase.rpc('set_staff_payment_circuit', {
        p_staff: staff, p_mois: payMonth, p_type: type,
      });
      if (error) throw error;
      await loadPay();
    } catch (e) {
      alert('Échec du changement de circuit : ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSavingCircuit(null);
    }
  }

  async function exportPaie() {
    setExporting(true);
    try { await downloadPayrollWorkbook(payMonth, payRows); }
    finally { setExporting(false); }
  }

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void Promise.all([
      supabase.from('rh_monthly_hours').select('*')
        .gte('mois', debut).lte('mois', fin)
        .order('mois', { ascending: false }).order('staff_name'),
      supabase.from('rh_monthly_hours_detail').select('mois, espace, statut, heures, cout_ht')
        .gte('mois', debut).lte('mois', fin),
    ]).then(([{ data: sum }, { data: det }]) => {
      if (!alive) return;
      setRows((sum ?? []).map((r) => ({
        staff_name: String((r as MonthlyRow).staff_name ?? ''),
        mois: String((r as MonthlyRow).mois ?? ''),
        heures: num((r as MonthlyRow).heures),
        cout_ht: num((r as MonthlyRow).cout_ht),
        nb_evenements: num((r as MonthlyRow).nb_evenements),
        missions: String((r as MonthlyRow).missions ?? ''),
      })));
      setDetails((det ?? []).map((r) => ({
        mois: String((r as DetailRow).mois ?? ''),
        espace: String((r as DetailRow).espace ?? '—'),
        statut: String((r as DetailRow).statut ?? 'non_precise'),
        heures: num((r as DetailRow).heures),
        cout_ht: num((r as DetailRow).cout_ht),
      })));
      setLoading(false);
    });
    return () => { alive = false; };
  }, [debut, fin]);

  const totals = useMemo(() => {
    const heures = rows.reduce((s, r) => s + r.heures, 0);
    const cout = rows.reduce((s, r) => s + r.cout_ht, 0);
    const personnes = new Set(rows.map((r) => r.staff_name)).size;
    const mois = new Set(rows.map((r) => r.mois)).size;
    return { heures, cout, personnes, mois };
  }, [rows]);

  const parMission = useMemo(() => {
    const m = new Map<string, { heures: number; cout: number; n: number }>();
    for (const r of rows) {
      // `missions` peut lister plusieurs missions séparées par des virgules.
      const list = r.missions.split(',').map((x) => x.trim()).filter(Boolean);
      const keys = list.length ? list : ['—'];
      for (const k of keys) {
        const cur = m.get(k) ?? { heures: 0, cout: 0, n: 0 };
        cur.heures += r.heures / keys.length;
        cur.cout += r.cout_ht / keys.length;
        cur.n += 1;
        m.set(k, cur);
      }
    }
    return [...m.entries()].map(([mission, v]) => ({ mission, ...v })).sort((a, b) => b.cout - a.cout);
  }, [rows]);

  const parEspace = useMemo(() => {
    const m = new Map<string, { heures: number; cout: number }>();
    for (const r of details) {
      const cur = m.get(r.espace) ?? { heures: 0, cout: 0 };
      cur.heures += r.heures; cur.cout += r.cout_ht;
      m.set(r.espace, cur);
    }
    return [...m.entries()].map(([espace, v]) => ({ espace, ...v })).sort((a, b) => b.cout - a.cout);
  }, [details]);

  const parStatut = useMemo(() => {
    const m = new Map<string, { heures: number; cout: number }>();
    for (const r of details) {
      const cur = m.get(r.statut) ?? { heures: 0, cout: 0 };
      cur.heures += r.heures; cur.cout += r.cout_ht;
      m.set(r.statut, cur);
    }
    return [...m.entries()].map(([statut, v]) => ({ statut, ...v })).sort((a, b) => b.cout - a.cout);
  }, [details]);

  function exportExcel() {
    const detail: AoaSheetOut = {
      name: 'Heures mensuelles',
      aoa: [
        ['Personne', 'Mois', 'Missions', 'Heures', 'Coût HT (€)', 'Nb événements'],
        ...rows.map((r) => [r.staff_name, r.mois, r.missions, r.heures, r.cout_ht, r.nb_evenements]),
        [],
        ['TOTAL', '', '', totals.heures, totals.cout, ''],
      ],
      widths: [26, 10, 24, 10, 12, 14],
    };
    const missions: AoaSheetOut = {
      name: 'Coût par mission',
      aoa: [
        ['Mission', 'Heures', 'Coût HT (€)', 'Lignes'],
        ...parMission.map((r) => [r.mission, Math.round(r.heures * 10) / 10, Math.round(r.cout * 100) / 100, r.n]),
      ],
      widths: [24, 10, 12, 8],
    };
    const espaces: AoaSheetOut = {
      name: 'Coût par espace',
      aoa: [
        ['Espace', 'Heures', 'Coût HT (€)'],
        ...parEspace.map((r) => [r.espace, Math.round(r.heures * 10) / 10, Math.round(r.cout * 100) / 100]),
      ],
      widths: [26, 10, 12],
    };
    const statuts: AoaSheetOut = {
      name: 'Coût par statut',
      aoa: [
        ['Statut d’emploi', 'Heures', 'Coût HT (€)'],
        ...parStatut.map((r) => [STATUT_LABEL[r.statut] ?? r.statut, Math.round(r.heures * 10) / 10, Math.round(r.cout * 100) / 100]),
      ],
      widths: [22, 10, 12],
    };
    void downloadAoaWorkbook([detail, missions, espaces, statuts], `rh-heures_${debut}_${fin}.xlsx`);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-1.5 rounded-full bg-indigo-500" />
          <div>
            <h1 className="text-2xl font-black text-stone-900">RH Analytique</h1>
            <p className="text-sm text-stone-400">Heures mensuelles par personne, coûts par mission — inter-matchs.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold text-stone-500">Du
            <input type="month" value={debut} max={fin} onChange={(e) => setDebut(e.target.value)}
              className="ml-1 rounded-xl border border-stone-200 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-semibold text-stone-500">au
            <input type="month" value={fin} min={debut} onChange={(e) => setFin(e.target.value)}
              className="ml-1 rounded-xl border border-stone-200 px-3 py-2 text-sm" />
          </label>
          <button onClick={exportExcel} disabled={rows.length === 0}
            className="flex items-center gap-2 rounded-xl bg-stone-900 px-4 py-2 text-sm font-bold text-white hover:bg-stone-700 disabled:opacity-40">
            <Download size={15} />Exporter Excel
          </button>
        </div>
      </div>

      {/* ── Récapitulatif de paie mensuel (DAF) ── */}
      <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-black text-stone-900">
              <FileSpreadsheet size={16} className="text-emerald-600" />Récapitulatif de paie mensuel — DAF
            </p>
            <p className="mt-0.5 text-xs text-stone-400">
              Une ligne par personne (tous matchs du mois). <span style={{ color: payColor('franchise') }} className="font-semibold">Franchise = à facturer</span> · <span style={{ color: payColor('contrat') }} className="font-semibold">Contrat = paie</span>. Montant « À verser » prêt pour virement.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <label className="text-xs font-semibold text-stone-500">Mois de paie
              <input type="month" value={payMonth} onChange={(e) => setPayMonth(e.target.value)}
                className="ml-1 rounded-xl border border-stone-200 px-3 py-2 text-sm" />
            </label>
            <button onClick={() => void exportPaie()} disabled={exporting || payRows.length === 0}
              className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40">
              <Download size={15} />{exporting ? 'Génération…' : 'Exporter Excel (paie DAF)'}
            </button>
          </div>
        </div>

        {payRows.length === 0 ? (
          <p className="mt-3 rounded-xl bg-stone-50 px-4 py-4 text-center text-xs text-stone-400">
            Aucune heure enregistrée pour {payMonth}.
          </p>
        ) : (
          <>
            <div className="mt-3 overflow-x-auto rounded-xl border border-stone-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-100 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-400">
                    <th className="px-4 py-2">Personne</th>
                    <th className="px-3 py-2">Circuit</th>
                    <th className="px-3 py-2 text-right">Heures</th>
                    <th className="px-3 py-2 text-right">Coût HT</th>
                    <th className="px-4 py-2 text-right">À verser</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-50">
                  {payRows.map((r, i) => (
                    <tr key={`${r.staff_name}-${i}`}>
                      <td className="px-4 py-2 font-bold" style={{ color: payColor(r.type_paiement) }}>{r.staff_name}</td>
                      <td className="px-3 py-2">
                        <div className="inline-flex overflow-hidden rounded-lg border border-stone-200 text-xs font-semibold">
                          <button
                            type="button"
                            disabled={savingCircuit === r.staff_name}
                            onClick={() => void setCircuit(r.staff_name, 'franchise')}
                            title="Franchise = à facturer (taux de base)"
                            className={`px-2.5 py-1 transition-colors ${r.type_paiement === 'franchise' ? 'text-white' : 'bg-white text-stone-500 hover:bg-stone-50'}`}
                            style={r.type_paiement === 'franchise' ? { background: payColor('franchise') } : {}}
                          >
                            Franchise
                          </button>
                          <button
                            type="button"
                            disabled={savingCircuit === r.staff_name}
                            onClick={() => void setCircuit(r.staff_name, 'contrat')}
                            title="Contrat = paie · taux porté à 18 €/h"
                            className={`border-l border-stone-200 px-2.5 py-1 transition-colors ${r.type_paiement === 'contrat' ? 'text-white' : 'bg-white text-stone-500 hover:bg-stone-50'}`}
                            style={r.type_paiement === 'contrat' ? { background: payColor('contrat') } : {}}
                          >
                            Contrat 18€
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{hrs(r.heures)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{eur(r.cout_ht)}</td>
                      <td className="px-4 py-2 text-right font-bold tabular-nums">{eur(r.cout_ht)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex flex-wrap justify-end gap-4 text-sm">
              <span style={{ color: payColor('franchise') }} className="font-bold">
                Franchise (à facturer) : {eur(payRows.filter((r) => r.type_paiement === 'franchise').reduce((s, r) => s + r.cout_ht, 0))}
              </span>
              <span style={{ color: payColor('contrat') }} className="font-bold">
                Contrat (paie) : {eur(payRows.filter((r) => r.type_paiement === 'contrat').reduce((s, r) => s + r.cout_ht, 0))}
              </span>
              <span className="font-black text-stone-900">
                TOTAL : {eur(payRows.reduce((s, r) => s + r.cout_ht, 0))}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={<Users size={14} />} label="Personnes" value={String(totals.personnes)} sub={`${totals.mois} mois`} />
        <Tile icon={<Clock size={14} />} label="Heures" value={hrs(totals.heures)} sub="cumulées" />
        <Tile icon={<Wallet size={14} />} label="Coût HT" value={eur(totals.cout)} accent="text-indigo-600" />
        <Tile icon={<TrendingUp size={14} />} label="Coût moyen / h" value={totals.heures > 0 ? eur(totals.cout / totals.heures) : '—'} />
      </div>

      {/* Ventilations : mission / espace / statut */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {parMission.length > 0 && (
          <Breakdown title="Coût par mission" items={parMission.map((r) => ({ key: r.mission, label: r.mission, heures: r.heures, cout: r.cout }))} />
        )}
        {parEspace.length > 0 && (
          <Breakdown title="Coût par espace" items={parEspace.map((r) => ({ key: r.espace, label: r.espace, heures: r.heures, cout: r.cout }))} />
        )}
        {parStatut.length > 0 && (
          <Breakdown title="Coût par statut d’emploi" items={parStatut.map((r) => ({ key: r.statut, label: STATUT_LABEL[r.statut] ?? r.statut, heures: r.heures, cout: r.cout }))} />
        )}
      </div>

      {/* Détail par personne × mois */}
      <div className="overflow-hidden rounded-2xl border border-stone-100 bg-white">
        <div className="border-b border-stone-100 bg-stone-50 px-4 py-2 text-sm font-bold text-stone-700">Détail par personne × mois</div>
        {loading ? (
          <div className="h-40 animate-pulse bg-stone-50" />
        ) : rows.length === 0 ? (
          <p className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-stone-400">
            <AlertTriangle size={16} className="text-stone-300" />Aucune heure enregistrée sur cette plage de mois.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-100 text-left text-xs uppercase tracking-wide text-stone-400">
                  <th className="px-4 py-2">Personne</th>
                  <th className="px-3 py-2">Mois</th>
                  <th className="px-3 py-2">Missions</th>
                  <th className="px-3 py-2 text-right">Heures</th>
                  <th className="px-3 py-2 text-right">Coût HT</th>
                  <th className="px-3 py-2 text-right">Événements</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50">
                {rows.map((r, i) => (
                  <tr key={`${r.staff_name}-${r.mois}-${i}`} className="text-stone-800">
                    <td className="px-4 py-2 font-medium">{r.staff_name}</td>
                    <td className="px-3 py-2 text-stone-500">{moisLabel(r.mois)}</td>
                    <td className="px-3 py-2 text-stone-500">{r.missions || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{hrs(r.heures)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{eur(r.cout_ht)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-stone-500">{r.nb_evenements}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
