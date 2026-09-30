/**
 * DataHealthPage — « Santé des données » (ROLE_STADE). Vérifie l'intégrité des
 * dérivés par rapport aux registres (sources de vérité immuables) :
 *   1. Audit fûts : keg_true_balance (reçus − consommés − purges − en espace)
 *      vs keg_summary (affiché) → l'écart doit être NUL par construction.
 *   2. Complétude clôture : event_consumption_completeness → finals manquants
 *      (les chiffres bougent parce qu'il MANQUE des finals, pas parce qu'on
 *      « recalcule » — à compléter, pas à recalculer).
 * Principe : registres append-only, chiffres dérivés, aucune suppression auto.
 *
 * Priorité écran : SYNTHÈSE chiffrée (KPIs santé) + GRAPHE « anomalies par
 * domaine » d'un coup d'œil ; les longues tables détail sont repliées et
 * intégralement récupérables via l'EXPORT EXCEL habillé (charte excelTheme).
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, Beer, Boxes, CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, Download, HeartPulse, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Spinner, StatTile } from '@/components/ui';
import { formatEuro } from '@/lib/calculations';
import { downloadAoaWorkbook, sumFormula, type AoaCell, type AoaSheetOut } from '@/lib/xlsxAoa';
import { EUR, INT, type ColumnStyle } from '@/lib/excelTheme';

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

interface TrueBalance { product_id: string; product_name: string; recus: number; consommes: number; purges: number; pleins_theoriques: number; vides_theoriques: number; valeur_pleins_ht: number | null }
interface KegSummary { product_id: string; product_name: string; pleins: number; en_espace: number; vides: number }
interface CompletenessRow { event_id: string; event_name: string; status: string; space_id: string; space_name: string; finals_manquants: number; unites_en_attente: number }
interface StockRow { product_id: string; product_name: string; category: string; qty_auc: number; qty_est: number; qty_futs: number; qty_total_depot: number; qty_in_event: number; valeur_depot_ht: number | null; alert_status: string | null; min_stock: number | null }
interface LedgerSynth { location_name: string; location_type: string; refs: number; refs_en_ecart: number; refs_negatives: number; ecart_abs_total: number | null; refs_sans_ancre: number; derniere_ancre: string | null }
interface LedgerEcart { product_id: string; location_name: string; location_type: string; anchor_qty: number; derived_qty: number; counter_qty: number; ecart: number; product_name?: string }
interface PhantomRow { movement_id: string; depot: string; movement_type: string; qty: number; product_id: string; product_name?: string }

/* Styles de colonnes Excel réutilisés (charte excelTheme). */
const colInt: ColumnStyle = { numFmt: INT, align: 'right' };
const colEur: ColumnStyle = { numFmt: EUR, align: 'right' };
const colLeft: ColumnStyle = { align: 'left' };
const colCenter: ColumnStyle = { align: 'center' };
const r2 = (n: unknown): number => Math.round(num(n) * 100) / 100;

/** En-tête repliable pour les longues tables de détail (le détail ligne-à-ligne
 *  complet part dans l'export Excel — cf. downloadAoaWorkbook). */
function DetailToggle({ open, onToggle, label, count, tone = 'neutral' }: { open: boolean; onToggle: () => void; label: string; count: number; tone?: 'neutral' | 'alert' }) {
  return (
    <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-2 text-left">
      <span className="flex items-center gap-2 text-sm font-bold text-stone-800">
        {open ? <ChevronDown size={16} className="text-stone-400" /> : <ChevronRight size={16} className="text-stone-400" />}
        {label}
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone === 'alert' && count > 0 ? 'bg-rose-100 text-rose-700' : 'bg-stone-100 text-stone-500'}`}>
          {count} ligne{count > 1 ? 's' : ''}
        </span>
      </span>
      <span className="hidden text-xs font-medium text-stone-400 sm:inline">{open ? 'Masquer' : 'Afficher'} · détail complet dans l’export Excel</span>
    </button>
  );
}

/** Barre d'anomalies « façon Breakdown » : une ligne par domaine, tri décroissant,
 *  barre rouge proportionnelle → l'état de santé se lit d'un coup d'œil. */
interface HealthItem { key: string; label: string; count: number; hint: string }
function HealthBreakdown({ items }: { items: HealthItem[] }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="divide-y divide-stone-100">
      {items.map((r) => {
        const ok = r.count === 0;
        return (
          <div key={r.key} className="px-1 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-stone-700">{r.label}</span>
              <span className={`shrink-0 text-sm font-bold tabular-nums ${ok ? 'text-emerald-600' : 'text-rose-600'}`}>{ok ? '0' : r.count}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-100">
                <div className={`h-full rounded-full ${ok ? 'bg-emerald-400/70' : 'bg-rose-500'}`} style={{ width: ok ? '100%' : `${Math.max(6, (r.count / max) * 100)}%` }} />
              </div>
              <span className="w-40 shrink-0 truncate text-right text-[11px] text-stone-400">{r.hint}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function DataHealthPage() {
  const kegQ = useQuery({
    queryKey: ['dataHealthKegs'],
    queryFn: async () => {
      const [t, s] = await Promise.all([
        supabase.from('keg_true_balance').select('*').order('product_name'),
        supabase.from('keg_summary').select('product_id, product_name, pleins, en_espace, vides'),
      ]);
      return { truth: (t.data as TrueBalance[] | null) ?? [], summary: (s.data as KegSummary[] | null) ?? [] };
    },
  });

  const compQ = useQuery({
    queryKey: ['dataHealthCompleteness'],
    queryFn: async (): Promise<CompletenessRow[]> => {
      const { data } = await supabase.from('event_consumption_completeness').select('*').gt('finals_manquants', 0).order('finals_manquants', { ascending: false });
      return (data as CompletenessRow[] | null) ?? [];
    },
  });

  // CDC V5 #1/#5 — cohérence du stock général : stade = Σ localisations (dérivé).
  const stockQ = useQuery({
    queryKey: ['dataHealthStock'],
    queryFn: async (): Promise<StockRow[]> => {
      const { data } = await supabase.from('stock_live_balance').select('*');
      return (data as StockRow[] | null) ?? [];
    },
  });
  // Socle de précision : compteur (stock_balances) vs dérivé (ancre + Σ flux).
  const ledgerQ = useQuery({
    queryKey: ['dataHealthLedger'],
    queryFn: async () => {
      const [syn, ec, ph, pr] = await Promise.all([
        supabase.from('v_stock_audit_synthese').select('*'),
        supabase.from('v_stock_audit_ecarts').select('product_id, location_name, location_type, anchor_qty, derived_qty, counter_qty, ecart').order('ecart'),
        supabase.from('v_stock_audit_sorties_fantomes').select('movement_id, depot, movement_type, qty, product_id'),
        supabase.from('products').select('product_id, product_name'),
      ]);
      const nameById = new Map(((pr.data as { product_id: string; product_name: string }[] | null) ?? []).map((p) => [p.product_id, p.product_name]));
      return {
        synth: (syn.data as LedgerSynth[] | null) ?? [],
        ecarts: ((ec.data as LedgerEcart[] | null) ?? []).map((r) => ({ ...r, product_name: nameById.get(r.product_id) ?? r.product_id })),
        phantoms: ((ph.data as PhantomRow[] | null) ?? []).map((r) => ({ ...r, product_name: nameById.get(r.product_id) ?? r.product_id })),
      };
    },
  });
  const ledger = ledgerQ.data ?? { synth: [], ecarts: [], phantoms: [] };
  const ledgerEcartsTot = ledger.synth.reduce((s, r) => s + num(r.refs_en_ecart), 0);
  const ledgerNegTot = ledger.synth.reduce((s, r) => s + num(r.refs_negatives), 0);
  const ledgerSansAncreTot = ledger.synth.reduce((s, r) => s + num(r.refs_sans_ancre), 0);

  // Bascule post-clôture (A) + manques constatés (B).
  const bascQ = useQuery({
    queryKey: ['dataHealthBascule'],
    queryFn: async () => {
      const [b, m] = await Promise.all([
        supabase.from('v_event_bascule_audit').select('event_id, event_name, event_date, status, space_name, finals_saisis, soumises').eq('anomalie_non_bascule', true).order('event_date', { ascending: false }),
        supabase.from('v_stock_audit_manques').select('movement_id, event_name, product_name, space_name, manque, created_at').limit(20),
      ]);
      return {
        bascule: (b.data as { event_id: string; event_name: string; event_date: string; status: string; space_name: string; finals_saisis: number; soumises: number }[] | null) ?? [],
        manques: (m.data as { movement_id: string; event_name: string; product_name: string; space_name: string; manque: number; created_at: string }[] | null) ?? [],
      };
    },
  });
  const basc = bascQ.data ?? { bascule: [], manques: [] };

  const stock = stockQ.data ?? [];
  const stockIncoherences = useMemo(
    () => stock.filter((r) => Math.round(num(r.qty_total_depot)) !== Math.round(num(r.qty_auc) + num(r.qty_est) + num(r.qty_futs))),
    [stock],
  );
  const stockAlerts = useMemo(
    () => stock.filter((r) => {
      const a = String(r.alert_status ?? '').toLowerCase();
      return a.includes('rupture') || a.includes('critique') || a.includes('alerte');
    }),
    [stock],
  );
  const stockValue = stock.reduce((s, r) => s + num(r.valeur_depot_ht), 0);

  const kegRows = useMemo(() => {
    const summaryById = new Map((kegQ.data?.summary ?? []).map((s) => [s.product_id, s]));
    return (kegQ.data?.truth ?? []).map((t) => {
      const affiche = summaryById.get(t.product_id);
      const pleinsAffiche = num(affiche?.pleins);
      return { ...t, pleins_affiche: pleinsAffiche, en_espace: num(affiche?.en_espace), ecart: pleinsAffiche - num(t.pleins_theoriques) };
    });
  }, [kegQ.data]);

  const ecarts = kegRows.filter((r) => r.ecart !== 0);
  const totalPleins = kegRows.reduce((s, r) => s + num(r.pleins_affiche), 0);
  const totalValeur = kegRows.reduce((s, r) => s + num(r.valeur_pleins_ht), 0);

  const compByEvent = useMemo(() => {
    const m = new Map<string, { event_id: string; event_name: string; status: string; spaces: CompletenessRow[]; miss: number; pending: number }>();
    for (const r of compQ.data ?? []) {
      const g = m.get(r.event_id) ?? { event_id: r.event_id, event_name: r.event_name, status: r.status, spaces: [], miss: 0, pending: 0 };
      g.spaces.push(r); g.miss += num(r.finals_manquants); g.pending += num(r.unites_en_attente);
      m.set(r.event_id, g);
    }
    return [...m.values()].sort((a, b) => b.miss - a.miss);
  }, [compQ.data]);

  const finalsManquantsTot = compByEvent.reduce((s, g) => s + g.miss, 0);

  // ── SYNTHÈSE : anomalies par domaine (tri décroissant) ──
  const anomalies = useMemo<HealthItem[]>(() => {
    const items: HealthItem[] = [
      { key: 'kegEcarts', label: 'Écarts fûts (registre → dépôt)', count: ecarts.length, hint: 'à investiguer' },
      { key: 'ledgerEcarts', label: 'Écarts compteur / dérivé', count: ledgerEcartsTot, hint: 'ré-ancrage physique' },
      { key: 'ledgerNeg', label: 'Soldes négatifs', count: ledgerNegTot, hint: 'comptage à refaire' },
      { key: 'phantoms', label: 'Mouvements fantômes', count: ledger.phantoms.length, hint: 'sans ligne source' },
      { key: 'sansAncre', label: 'Réfs sans ancre physique', count: ledgerSansAncreTot, hint: 'à ancrer' },
      { key: 'bascule', label: 'Clôtures sans bascule', count: basc.bascule.length, hint: 'triggers à valider' },
      { key: 'manques', label: 'Manques dépôt constatés', count: basc.manques.length, hint: 'sortie > stock' },
      { key: 'stockIncoh', label: 'Stock hors dépôts nommés', count: stockIncoherences.length, hint: 'à rattacher' },
      { key: 'stockAlert', label: 'Produits en alerte stock', count: stockAlerts.length, hint: 'rupture / critique' },
      { key: 'compEvents', label: 'Événements à finaliser', count: compByEvent.length, hint: `${finalsManquantsTot} final(s) manquant(s)` },
    ];
    return items.sort((a, b) => b.count - a.count);
  }, [ecarts.length, ledgerEcartsTot, ledgerNegTot, ledger.phantoms.length, ledgerSansAncreTot, basc.bascule.length, basc.manques.length, stockIncoherences.length, stockAlerts.length, compByEvent.length, finalsManquantsTot]);

  const anyLoading = kegQ.isLoading || compQ.isLoading || stockQ.isLoading || ledgerQ.isLoading || bascQ.isLoading;
  const totalAnomalies = anomalies.reduce((s, a) => s + a.count, 0);
  const domainesEnAlerte = anomalies.filter((a) => a.count > 0).length;
  const hasData = kegRows.length > 0 || stock.length > 0 || ledger.synth.length > 0 || compByEvent.length > 0;

  // ── Replis (défaut masqué → priorité synthèse/graphe) ──
  const [showLedgerSynth, setShowLedgerSynth] = useState(false);
  const [showLedgerEcarts, setShowLedgerEcarts] = useState(false);
  const [showBascule, setShowBascule] = useState(false);
  const [showStock, setShowStock] = useState(false);
  const [showKeg, setShowKeg] = useState(false);
  const [showComp, setShowComp] = useState(false);
  const [exporting, setExporting] = useState(false);

  /**
   * Export Excel complet et habillé (charte excelTheme via downloadAoaWorkbook) :
   *  - feuille « Synthèse » : score santé + anomalies par domaine ;
   *  - feuilles détail : audit fûts, écarts compteur/dérivé, ledger par
   *    emplacement, complétude de clôture, cohérence stock — toutes colonnes
   *    + ligne TOTAL. Le détail masqué à l'écran est intégralement récupérable.
   */
  async function exportExcel() {
    setExporting(true);
    try {
      const sheets: AoaSheetOut[] = [];

      // ── Feuille SYNTHÈSE ──
      const synthAoa: AoaCell[][] = [
        ['Santé des données — Provence Rugby · Stade Maurice-David'],
        [],
        ['Indicateur', 'Valeur', 'Commentaire'],
        ['Anomalies totales', totalAnomalies, `${domainesEnAlerte} domaine(s) en alerte`],
        ['Écarts fûts', ecarts.length, `${totalPleins} pleins · ${formatEuro(totalValeur)}`],
        ['Écarts compteur / dérivé', ledgerEcartsTot, 'à résoudre par comptage physique'],
        ['Soldes négatifs', ledgerNegTot, 'ré-ancrage nécessaire'],
        ['Mouvements fantômes', ledger.phantoms.length, 'sans ligne de solde source'],
        ['Réfs sans ancre', ledgerSansAncreTot, 'jamais comptées physiquement'],
        ['Clôtures sans bascule', basc.bascule.length, 'triggers non déclenchés'],
        ['Manques dépôt constatés', basc.manques.length, 'sortie > stock disponible'],
        ['Stock hors dépôts nommés', stockIncoherences.length, 'à rattacher à une localisation'],
        ['Produits en alerte stock', stockAlerts.length, `sur ${stock.length} produit(s) · ${formatEuro(stockValue)}`],
        ['Événements à finaliser', compByEvent.length, `${finalsManquantsTot} final(s) manquant(s)`],
        [],
        ['Anomalies par domaine', 'Nombre', 'Action'],
        ...anomalies.map((a): AoaCell[] => [a.label, a.count, a.hint]),
        // Bloc « Anomalies par domaine » : en-tête Excel ligne 16, données
        // lignes 17..16+n → total auto-vérifiant sur la colonne « Nombre » (B).
        ['Total', sumFormula(1, 17, 16 + anomalies.length), ''],
      ];
      sheets.push({ name: 'Synthèse', aoa: synthAoa, widths: [34, 12, 34], columns: [colLeft, colInt, colLeft] });

      // ── Feuille Audit fûts ──
      if (kegRows.length) {
        const rows: AoaCell[][] = kegRows.map((r) => [
          r.product_name, num(r.recus), num(r.consommes), num(r.purges), num(r.en_espace),
          num(r.pleins_theoriques), num(r.pleins_affiche), num(r.ecart), num(r.vides_theoriques),
          r.valeur_pleins_ht == null ? '' : r2(r.valeur_pleins_ht),
        ]);
        // Total auto-vérifiant : données lignes Excel 4..3+n, colonnes B..J
        // toutes additives (quantités + valeur HT). Le tableur recalcule le SUM.
        const last = 3 + kegRows.length;
        const total: AoaCell[] = [
          'Total',
          sumFormula(1, 4, last),
          sumFormula(2, 4, last),
          sumFormula(3, 4, last),
          sumFormula(4, 4, last),
          sumFormula(5, 4, last),
          sumFormula(6, 4, last),
          sumFormula(7, 4, last),
          sumFormula(8, 4, last),
          sumFormula(9, 4, last),
        ];
        sheets.push({
          name: 'Audit fûts',
          aoa: [['Audit des fûts — registre → dépôt'], [], ['Fût', 'Reçus', 'Consommés', 'Purges', 'En espace', 'Pleins théoriques', 'Pleins affichés', 'Écart', 'Vides', 'Valeur pleins HT'], ...rows, total],
          widths: [24, 9, 11, 9, 10, 15, 14, 9, 9, 15],
          columns: [colLeft, colInt, colInt, colInt, colInt, colInt, colInt, colInt, colInt, colEur],
        });
      }

      // ── Feuille Écarts compteur / dérivé ──
      if (ledger.ecarts.length) {
        const rows: AoaCell[][] = ledger.ecarts.map((r) => [
          r.product_name ?? r.product_id, r.location_name, r.location_type === 'reserve_centrale' ? 'Dépôt' : 'Espace',
          num(r.anchor_qty), num(r.derived_qty), num(r.counter_qty), num(r.ecart),
        ]);
        sheets.push({
          name: 'Écarts compteur-dérivé',
          aoa: [['Écarts compteur vs dérivé (ancre + Σ flux)'], [], ['Produit', 'Emplacement', 'Nature', 'Ancre', 'Dérivé', 'Compteur', 'Écart'], ...rows],
          widths: [24, 22, 10, 10, 10, 10, 10],
          columns: [colLeft, colLeft, colCenter, colInt, colInt, colInt, colInt],
        });
      }

      // ── Feuille Ledger par emplacement ──
      if (ledger.synth.length) {
        const rows: AoaCell[][] = ledger.synth.map((r) => [
          r.location_name, r.location_type === 'reserve_centrale' ? 'Dépôt' : 'Espace',
          num(r.refs), num(r.refs_en_ecart), num(r.refs_negatives), num(r.refs_sans_ancre),
          r.ecart_abs_total == null ? '' : num(r.ecart_abs_total),
          r.derniere_ancre ? new Date(r.derniere_ancre).toLocaleDateString('fr-FR') : '—',
        ]);
        // Total auto-vérifiant : données lignes 4..3+n. Colonnes C..G additives
        // (réfs, écarts, négatifs, sans ancre, écart abs.) ; Nature/ancre = texte.
        const last = 3 + ledger.synth.length;
        const total: AoaCell[] = [
          'Total', '',
          sumFormula(2, 4, last),
          sumFormula(3, 4, last),
          sumFormula(4, 4, last),
          sumFormula(5, 4, last),
          sumFormula(6, 4, last), '',
        ];
        sheets.push({
          name: 'Ledger par emplacement',
          aoa: [['Précision du ledger par emplacement'], [], ['Emplacement', 'Nature', 'Réfs', 'Écarts', 'Négatifs', 'Sans ancre', 'Écart abs. total', 'Dernière ancre'], ...rows, total],
          widths: [24, 10, 9, 9, 10, 12, 16, 15],
          columns: [colLeft, colCenter, colInt, colInt, colInt, colInt, colInt, colCenter],
        });
      }

      // ── Feuille Complétude de clôture ──
      if ((compQ.data ?? []).length) {
        const rows: AoaCell[][] = (compQ.data ?? []).map((r) => [
          r.event_name, r.status, r.space_name, num(r.finals_manquants), num(r.unites_en_attente),
        ]);
        // Total auto-vérifiant : données lignes 4..3+n. Colonnes D (finals
        // manquants) et E (unités en attente) additives ; le reste = texte.
        const last = 3 + (compQ.data ?? []).length;
        const total: AoaCell[] = [
          'Total', '', '',
          sumFormula(3, 4, last),
          sumFormula(4, 4, last),
        ];
        sheets.push({
          name: 'Complétude clôture',
          aoa: [['Complétude de clôture — finals manquants'], [], ['Événement', 'Statut', 'Espace', 'Finals manquants', 'Unités en attente'], ...rows, total],
          widths: [28, 16, 20, 16, 16],
          columns: [colLeft, colLeft, colLeft, colInt, colInt],
        });
      }

      // ── Feuille Cohérence stock ──
      if (stock.length) {
        const rows: AoaCell[][] = [...stock]
          .sort((a, b) => num(b.valeur_depot_ht) - num(a.valeur_depot_ht))
          .map((r) => [
            r.product_name, r.category, num(r.qty_auc), num(r.qty_est), num(r.qty_futs),
            num(r.qty_total_depot), num(r.qty_in_event), num(r.min_stock),
            r.valeur_depot_ht == null ? '' : r2(r.valeur_depot_ht),
            r.alert_status ?? '',
          ]);
        // Total auto-vérifiant : données lignes 4..3+n. Colonnes C..G (AUC, EST,
        // Fûts, Total dépôt, En événement) + I (Valeur dépôt HT) additives.
        // « Mini » (seuil) et « Alerte » (état) ne se somment pas → statiques ''.
        const last = 3 + stock.length;
        const total: AoaCell[] = [
          'Total', '',
          sumFormula(2, 4, last),
          sumFormula(3, 4, last),
          sumFormula(4, 4, last),
          sumFormula(5, 4, last),
          sumFormula(6, 4, last),
          '', sumFormula(8, 4, last), '',
        ];
        sheets.push({
          name: 'Cohérence stock',
          aoa: [['Cohérence du stock général (Σ localisations)'], [], ['Produit', 'Catégorie', 'AUC', 'EST', 'Fûts', 'Total dépôt', 'En événement', 'Mini', 'Valeur dépôt HT', 'Alerte'], ...rows, total],
          widths: [26, 14, 8, 8, 8, 12, 13, 8, 15, 14],
          columns: [colLeft, colLeft, colInt, colInt, colInt, colInt, colInt, colInt, colEur, colLeft],
        });
      }

      const dateStr = new Date().toISOString().slice(0, 10);
      await downloadAoaWorkbook(sheets, `Sante-donnees_Provence-Rugby_${dateStr}.xlsx`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-black text-stone-900"><Activity className="text-pr-olive" /> Santé des données</h1>
          <p className="mt-1 text-sm text-stone-500">Contrôle d'intégrité : les chiffres affichés sont dérivés des registres (sources de vérité immuables). Rien n'est supprimé automatiquement.</p>
        </div>
        <button
          onClick={() => void exportExcel()}
          disabled={!hasData || exporting}
          className="flex items-center gap-2 rounded-xl bg-stone-900 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-stone-700 disabled:opacity-40"
        >
          <Download size={15} />{exporting ? 'Génération…' : 'Exporter Excel'}
        </button>
      </div>

      {/* Principe */}
      <div className="mb-6 flex items-start gap-2 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-stone-600">
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-pr-olive" />
        <span>Registres append-only : <b>event_stock_lines</b> (conso), réceptions <b>keg_inventory</b>, <b>event_revenue</b>, <b>occasional_hours</b>. Les vues (keg_summary, consommation, marge…) en dérivent. Chaque process est idempotent : relancé, il converge sans dupliquer.</span>
      </div>

      {/* ═══ SYNTHÈSE : score santé + anomalies par domaine ═══ */}
      <section className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-stone-800"><HeartPulse size={16} className="text-pr-olive" /> Synthèse santé</h2>
        {anyLoading ? <Spinner /> : (
          <>
            <div className={`mb-4 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${totalAnomalies === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
              {totalAnomalies === 0
                ? <><CheckCircle2 size={16} /> Tout est aligné — aucune anomalie détectée sur les {anomalies.length} contrôles. Les chiffres dérivés sont fiables.</>
                : <><AlertTriangle size={16} /> {totalAnomalies} anomalie(s) sur {domainesEnAlerte} domaine(s) — voir le détail par section ci-dessous et l'export Excel.</>}
            </div>

            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Anomalies totales" value={totalAnomalies} sub={`${domainesEnAlerte} domaine(s) en alerte`} tone={totalAnomalies === 0 ? 'good' : 'crit'} />
              <StatTile label="Soldes négatifs" value={ledgerNegTot} sub="ré-ancrage physique" tone={ledgerNegTot === 0 ? 'good' : 'crit'} />
              <StatTile label="Finals manquants" value={finalsManquantsTot} sub={`${compByEvent.length} événement(s)`} tone={finalsManquantsTot === 0 ? 'good' : 'warn'} />
              <StatTile label="Écarts fûts" value={ecarts.length} sub={`${totalPleins} pleins suivis`} tone={ecarts.length === 0 ? 'good' : 'crit'} />
            </div>

            {/* Graphe : anomalies par domaine (tri décroissant) */}
            <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
              <div className="border-b border-stone-100 bg-stone-50 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-stone-400">Anomalies par domaine · état de santé d'un coup d'œil</div>
              <div className="px-4 py-2">
                <HealthBreakdown items={anomalies} />
              </div>
            </div>
          </>
        )}
      </section>

      {/* 0.bis Précision du ledger : compteur vs dérivé (ancre + Σ flux) */}
      <section className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-stone-800"><ShieldCheck size={16} className="text-pr-olive" /> Précision du ledger (compteur vs dérivé)</h2>
        {ledgerQ.isLoading ? <Spinner /> : (
          <>
            <div className={`mb-3 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${ledgerEcartsTot === 0 && ledger.phantoms.length === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
              {ledgerEcartsTot === 0 && ledger.phantoms.length === 0
                ? <><CheckCircle2 size={16} /> Aligné — chaque solde = dernière ancre physique + Σ flux. Aucun écart, aucun mouvement fantôme.</>
                : <><AlertTriangle size={16} /> {ledgerEcartsTot} écart(s) compteur/dérivé · {ledger.phantoms.length} mouvement(s) fantôme(s) · {ledgerNegTot} solde(s) négatif(s) — à ancrer par comptage physique.</>}
            </div>

            {/* Synthèse par emplacement — repliable */}
            <div className="mb-3 rounded-xl border border-stone-200 bg-white p-4">
              <DetailToggle open={showLedgerSynth} onToggle={() => setShowLedgerSynth((v) => !v)} label="Synthèse par emplacement" count={ledger.synth.length} />
              {showLedgerSynth && (
                <div className="mt-3 overflow-x-auto rounded-xl border border-stone-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-stone-100 bg-stone-50 text-left text-[11px] uppercase tracking-wide text-stone-400">
                        <th className="px-3 py-2">Emplacement</th><th className="px-2 py-2 text-right">Réfs</th>
                        <th className="px-2 py-2 text-right">Écarts</th><th className="px-2 py-2 text-right">Négatifs</th>
                        <th className="px-2 py-2 text-right">Sans ancre</th><th className="px-3 py-2">Dernière ancre</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-50">
                      {ledger.synth.map((r) => (
                        <tr key={r.location_name} className={num(r.refs_en_ecart) > 0 ? 'bg-amber-50/50' : 'text-stone-800'}>
                          <td className="px-3 py-2 font-medium">{r.location_name} <span className="text-[10px] text-stone-400">{r.location_type === 'reserve_centrale' ? '· dépôt' : '· espace'}</span></td>
                          <td className="px-2 py-2 text-right tabular-nums text-stone-500">{num(r.refs)}</td>
                          <td className={`px-2 py-2 text-right font-bold tabular-nums ${num(r.refs_en_ecart) ? 'text-amber-600' : 'text-emerald-600'}`}>{num(r.refs_en_ecart)}</td>
                          <td className={`px-2 py-2 text-right tabular-nums ${num(r.refs_negatives) ? 'text-rose-600 font-bold' : 'text-stone-400'}`}>{num(r.refs_negatives) || '—'}</td>
                          <td className={`px-2 py-2 text-right tabular-nums ${num(r.refs_sans_ancre) ? 'text-amber-500' : 'text-stone-400'}`}>{num(r.refs_sans_ancre) || '—'}</td>
                          <td className="px-3 py-2 text-xs text-stone-500">{r.derniere_ancre ? new Date(r.derniere_ancre).toLocaleDateString('fr-FR') : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Détail des écarts — repliable */}
            {ledger.ecarts.length > 0 && (
              <div className="mb-3 rounded-xl border border-amber-200 bg-white p-4">
                <DetailToggle open={showLedgerEcarts} onToggle={() => setShowLedgerEcarts((v) => !v)} label="Détail des écarts compteur/dérivé" count={ledger.ecarts.length} tone="alert" />
                {showLedgerEcarts && (
                  <div className="mt-3 overflow-x-auto rounded-xl border border-amber-100">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-amber-100 bg-amber-50 text-left text-[11px] uppercase tracking-wide text-amber-700">
                          <th className="px-3 py-2">Produit</th><th className="px-3 py-2">Emplacement</th>
                          <th className="px-2 py-2 text-right">Ancre</th><th className="px-2 py-2 text-right">Dérivé</th>
                          <th className="px-2 py-2 text-right">Compteur</th><th className="px-2 py-2 text-right">Écart</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-amber-50">
                        {ledger.ecarts.map((r) => (
                          <tr key={`${r.product_id}_${r.location_name}`} className="text-stone-800">
                            <td className="px-3 py-2 font-medium">{r.product_name}</td>
                            <td className="px-3 py-2 text-stone-500">{r.location_name}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-stone-400">{num(r.anchor_qty)}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{num(r.derived_qty)}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{num(r.counter_qty)}</td>
                            <td className={`px-2 py-2 text-right font-bold tabular-nums ${num(r.ecart) === 0 ? 'text-emerald-600' : 'text-amber-600'}`}>{num(r.ecart) > 0 ? `+${num(r.ecart)}` : num(r.ecart)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Mouvements fantômes */}
            {ledger.phantoms.length > 0 && (
              <div className="rounded-xl border border-rose-200 bg-rose-50/40 px-4 py-3">
                <p className="text-xs font-semibold text-rose-700">{ledger.phantoms.length} mouvement(s) sans ligne de solde source (« fantômes ») :</p>
                <p className="mt-1 text-xs text-stone-600">{ledger.phantoms.map((p) => `${p.product_name} (${p.movement_type} ${num(p.qty)} · ${p.depot})`).join(' · ')}</p>
              </div>
            )}
            <p className="mt-2 text-xs text-stone-400">Principe : <b>solde = dernière ancre physique + Σ flux depuis</b>. Un écart ≠ 0 se résout par un <b>comptage physique</b> (ré-ancrage), jamais par un recalcul aveugle.</p>
          </>
        )}
      </section>

      {/* 0.ter Bascule post-clôture + manques constatés */}
      <section className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-stone-800"><ClipboardCheck size={16} className="text-pr-olive" /> Bascule post-clôture & manques</h2>
        {bascQ.isLoading ? <Spinner /> : (
          <>
            <div className={`mb-3 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${basc.bascule.length === 0 && basc.manques.length === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
              {basc.bascule.length === 0 && basc.manques.length === 0
                ? <><CheckCircle2 size={16} /> Toutes les clôtures ont basculé (mouvements tracés) · aucun manque dépôt constaté.</>
                : <><AlertTriangle size={16} /> {basc.bascule.length} espace(s) clôturé(s) sans bascule · {basc.manques.length} manque(s) dépôt constaté(s).</>}
            </div>
            {basc.bascule.length > 0 && (
              <div className="mb-3 rounded-xl border border-amber-200 bg-white p-4">
                <DetailToggle open={showBascule} onToggle={() => setShowBascule((v) => !v)} label="Clôtures sans bascule" count={basc.bascule.length} tone="alert" />
                {showBascule && (
                  <div className="mt-3 overflow-x-auto rounded-xl border border-amber-100">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-amber-100 bg-amber-50 text-left text-[11px] uppercase tracking-wide text-amber-700">
                          <th className="px-3 py-2">Événement</th><th className="px-3 py-2">Espace</th>
                          <th className="px-2 py-2 text-right">Finals saisis</th><th className="px-2 py-2 text-right">Soumis</th><th className="px-3 py-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-amber-50">
                        {basc.bascule.map((r) => (
                          <tr key={`${r.event_id}_${r.space_name}`} className="text-stone-800">
                            <td className="px-3 py-2 font-medium"><Link to={`/admin/events/${r.event_id}`} className="hover:underline">{r.event_name}</Link> <span className="text-xs text-stone-400">· {r.status}</span></td>
                            <td className="px-3 py-2 text-stone-500">{r.space_name}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{num(r.finals_saisis)}</td>
                            <td className="px-2 py-2 text-right font-bold tabular-nums text-rose-600">{num(r.soumises)}</td>
                            <td className="px-3 py-2 text-xs text-amber-700">clôture à valider dans l'appli</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            {basc.manques.length > 0 && (
              <div className="rounded-xl border border-rose-200 bg-rose-50/40 px-4 py-3">
                <p className="text-xs font-semibold text-rose-700">{basc.manques.length} manque(s) dépôt constaté(s) (acheminé &gt; stock disponible) :</p>
                <p className="mt-1 text-xs text-stone-600">{basc.manques.map((m) => `${m.product_name} −${num(m.manque)} (${m.space_name}, ${m.event_name})`).join(' · ')}</p>
              </div>
            )}
            <p className="mt-2 text-xs text-stone-400">Non-bascule = des finals saisis mais aucun soumis → les triggers n'ont pas tourné (à valider). Manque = une sortie a dépassé le stock dépôt (à recompter).</p>
          </>
        )}
      </section>

      {/* 0. Cohérence du stock général */}
      <section className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-stone-800"><Boxes size={16} className="text-pr-olive" /> Cohérence du stock général (Σ localisations)</h2>
        {stockQ.isLoading ? <Spinner /> : (
          <>
            <div className={`mb-3 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${stockIncoherences.length === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
              {stockIncoherences.length === 0
                ? <><CheckCircle2 size={16} /> Cohérent — stock stade = Σ localisations (AUC + Stock EST + Fûts) sur {stock.length} produit(s). Aucune valeur libre.</>
                : <><AlertTriangle size={16} /> {stockIncoherences.length} produit(s) avec du stock dépôt hors AUC / Stock EST / Fûts — à rattacher à une localisation.</>}
            </div>
            <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-stone-100 bg-white p-3"><p className="text-[11px] uppercase tracking-wide text-stone-400">Produits suivis</p><p className="mt-1 text-lg font-black text-stone-800">{stock.length}</p></div>
              <div className="rounded-xl border border-stone-100 bg-white p-3"><p className="text-[11px] uppercase tracking-wide text-stone-400">Valeur dépôt HT</p><p className="mt-1 text-lg font-black text-stone-800">{formatEuro(stockValue)}</p></div>
              <div className="rounded-xl border border-stone-100 bg-white p-3"><p className="text-[11px] uppercase tracking-wide text-stone-400">En alerte</p><p className={`mt-1 text-lg font-black ${stockAlerts.length ? 'text-rose-600' : 'text-stone-300'}`}>{stockAlerts.length}</p></div>
              <div className="rounded-xl border border-stone-100 bg-white p-3"><p className="text-[11px] uppercase tracking-wide text-stone-400">Hors dépôts nommés</p><p className={`mt-1 text-lg font-black ${stockIncoherences.length ? 'text-amber-600' : 'text-emerald-600'}`}>{stockIncoherences.length}</p></div>
            </div>
            {stockAlerts.length > 0 && (
              <div className="rounded-xl border border-stone-200 bg-white p-4">
                <DetailToggle open={showStock} onToggle={() => setShowStock((v) => !v)} label="Produits en alerte stock" count={stockAlerts.length} tone="alert" />
                {showStock && (
                  <div className="mt-3 overflow-x-auto rounded-xl border border-stone-100">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-stone-100 bg-stone-50 text-left text-[11px] uppercase tracking-wide text-stone-400">
                          <th className="px-3 py-2">Produit</th><th className="px-2 py-2 text-right">AUC</th><th className="px-2 py-2 text-right">EST</th>
                          <th className="px-2 py-2 text-right">Fûts</th><th className="px-2 py-2 text-right">Total dépôt</th><th className="px-2 py-2 text-right">Mini</th><th className="px-3 py-2">Alerte</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-50">
                        {stockAlerts.map((r) => (
                          <tr key={r.product_id} className="text-stone-800">
                            <td className="px-3 py-2 font-medium">{r.product_name}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-stone-500">{num(r.qty_auc)}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-stone-500">{num(r.qty_est)}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-stone-500">{num(r.qty_futs)}</td>
                            <td className="px-2 py-2 text-right font-semibold tabular-nums">{num(r.qty_total_depot)}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-stone-400">{num(r.min_stock) || '—'}</td>
                            <td className="px-3 py-2"><span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">{r.alert_status}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* 1. Audit fûts */}
      <section className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-stone-800"><Beer size={16} className="text-amber-600" /> Audit des fûts (registre → dépôt)</h2>
        {kegQ.isLoading ? <Spinner /> : (
          <>
            <div className={`mb-3 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${ecarts.length === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
              {ecarts.length === 0
                ? <><CheckCircle2 size={16} /> Cohérent — écart nul entre le registre et le dépôt ({totalPleins} pleins · {formatEuro(totalValeur)}).</>
                : <><AlertTriangle size={16} /> {ecarts.length} écart(s) détecté(s) entre pleins théoriques et affichés — à investiguer.</>}
            </div>
            <div className="rounded-xl border border-stone-200 bg-white p-4">
              <DetailToggle open={showKeg} onToggle={() => setShowKeg((v) => !v)} label="Balances fûts détaillées" count={kegRows.length} tone={ecarts.length > 0 ? 'alert' : 'neutral'} />
              {showKeg && (
                <div className="mt-3 overflow-x-auto rounded-xl border border-stone-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-stone-100 bg-stone-50 text-left text-[11px] uppercase tracking-wide text-stone-400">
                        <th className="px-3 py-2">Fût</th>
                        <th className="px-2 py-2 text-right">Reçus</th>
                        <th className="px-2 py-2 text-right">Consommés</th>
                        <th className="px-2 py-2 text-right">Purges</th>
                        <th className="px-2 py-2 text-right">En espace</th>
                        <th className="px-2 py-2 text-right">Pleins théoriques</th>
                        <th className="px-2 py-2 text-right">Pleins affichés</th>
                        <th className="px-2 py-2 text-right">Écart</th>
                        <th className="px-3 py-2 text-right">Vides</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-50">
                      {kegRows.map((r) => (
                        <tr key={r.product_id} className={r.ecart !== 0 ? 'bg-rose-50/60' : 'text-stone-800'}>
                          <td className="px-3 py-2 font-medium">{r.product_name}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-stone-500">{num(r.recus)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-stone-500">{num(r.consommes)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-stone-500">{num(r.purges)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-stone-500">{num(r.en_espace) || '—'}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{num(r.pleins_theoriques)}</td>
                          <td className="px-2 py-2 text-right font-semibold tabular-nums">{num(r.pleins_affiche)}</td>
                          <td className={`px-2 py-2 text-right font-bold tabular-nums ${r.ecart === 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{r.ecart === 0 ? '0' : (r.ecart > 0 ? `+${r.ecart}` : r.ecart)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-stone-500">{num(r.vides_theoriques) || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {/* 2. Complétude clôture */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-stone-800"><ClipboardCheck size={16} className="text-amber-600" /> Complétude de clôture (stocks finaux manquants)</h2>
        {compQ.isLoading ? <Spinner /> : compByEvent.length === 0 ? (
          <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700"><CheckCircle2 size={16} /> Aucun final manquant — tous les chiffres de conso/marge sont fiables.</div>
        ) : (
          <>
            <p className="mb-3 text-xs text-stone-500">Ces événements ont des chiffres <b>provisoires</b> tant que les finals ne sont pas saisis. À <b>compléter</b> (Analyse conso → Finaliser par espace), pas à « recalculer ».</p>
            <div className="rounded-xl border border-amber-200 bg-white p-4">
              <DetailToggle open={showComp} onToggle={() => setShowComp((v) => !v)} label="Complétude par événement" count={compByEvent.length} tone="alert" />
              {showComp && (
                <div className="mt-3 space-y-2">
                  {compByEvent.map((g) => (
                    <div key={g.event_id} className="rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link to={`/admin/events/${g.event_id}`} className="text-sm font-bold text-stone-800 hover:underline">{g.event_name} <span className="text-xs font-normal text-stone-400">· {g.status}</span></Link>
                        <span className="text-xs font-semibold text-amber-700">{g.miss} final(s) manquant(s) · {g.pending} u. en attente · {g.spaces.length} espace(s)</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-stone-500">{g.spaces.map((s) => s.space_name).join(', ')}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
