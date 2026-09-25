/**
 * UnifiedRunnerPanel — fiches runner unifiées (VIP + Buvettes) avec contrôle de
 * stock LIVE. Source : vues event_runner_space_summary (cartes) + event_runner_board
 * (lignes). `stock_sufficient_live` compare la réserve centrale au besoin total du
 * produit sur l'événement → badge « Stock insuffisant » et « Manque N ». Les vues
 * sont live : après inventaire/réception/dispatch/purge, un rechargement recalcule.
 * Téléchargement PDF par espace, « Tout télécharger » et « Liste de courses ».
 * RG-003 : vues réservées ROLE_STADE (garde base). Écran admin.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, FileSpreadsheet, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, RefreshCw, ShoppingCart, Crown, CupSoda, Zap } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import { Button, Spinner, Select } from '@/components/ui';
import { formatEuro } from '@/lib/calculations';
import { loadModule } from '@/lib/lazyModule';
import { downloadRunnerWorkbook } from '@/lib/runnerExcel';
import { PETIT_MATERIEL_ENABLED } from '@/lib/featureFlags';

interface PmLine { code: string; label: string; qty: number }

interface Card {
  space_id: string; space_name: string; family: string; service_type: string | null;
  nb_lignes: number; total_to_move: number; cost_ht: number;
  lignes_insuffisantes: number; has_stock_alert: boolean;
}
interface Line {
  space_id: string; space_name: string; family: string;
  product_id: string; product_name: string; category: string;
  needed_qty: number; qty_to_move: number; area_stock: number; reserve_qty: number;
  cost_ht: number; stock_sufficient_live: boolean; shortfall_qty: number;
  consumption_reference: number;
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Espaces Loges : dotation par loge (get_loge_runner_sheet) → détail dans le PDF.
const LOGE_IDS = new Set([
  'a96044d1-9ab0-45d0-85eb-73672df6ab82', // Loge Est
  '673b6e4e-0f5a-406f-9029-c35b25a38103', // Loge Ouest Nord
  '8be2956e-a379-4e8e-a3eb-65401bac3c56', // Loge Ouest Sud
]);
interface LogeBlock { loge: string; lignes: { produit: string; qte: number }[] }

/** Grille « répartition par loge » (détail dotation fixe par loge) pour le PDF. */
function buildLogeDetailHtml(blocks: LogeBlock[]): string {
  if (!blocks.length) return '';
  const cards = blocks.map((b) => {
    const sub = b.lignes.reduce((a, x) => a + x.qte, 0);
    const rows = b.lignes.map((x) =>
      `<tr><td style="padding:2px 6px;border-bottom:1px solid #eee">${x.produit}</td><td style="padding:2px 6px;border-bottom:1px solid #eee;text-align:right;font-weight:600">${x.qte}</td></tr>`).join('');
    return `<div style="display:inline-block;vertical-align:top;width:32%;margin:0 1% 8px 0;border:1px solid #E7E2D8;border-radius:8px;overflow:hidden;font-size:10px">
      <div style="background:#FBF3DD;padding:3px 6px;font-weight:700;color:#0B1F3A"><span>${b.loge}</span><span style="float:right;color:#B8860B">${sub}</span></div>
      <table style="width:100%;border-collapse:collapse">${rows}</table>
    </div>`;
  }).join('');
  return `<div style="margin-top:12px">
    <p style="margin:0 0 5px;font-size:11px;font-weight:700;color:#0B1F3A">Répartition par loge — dotation fixe par loge (${blocks.length} loges)</p>
    <div>${cards}</div>
  </div>`;
}

/** Bloc « Petit matériel » (lignes supplémentaires) pour le PDF de la fiche runner. */
function buildPmHtml(lines: PmLine[]): string {
  if (!lines.length) return '';
  const tot = lines.reduce((a, x) => a + x.qty, 0);
  const rows = lines.map((x) =>
    `<tr><td style="padding:3px 6px;border:1px solid #ddd">${x.label}</td><td style="padding:3px 6px;border:1px solid #ddd;text-align:right;font-weight:700">${x.qty}</td></tr>`).join('');
  return `<div style="margin-top:12px">
    <p style="margin:0 0 5px;font-size:11px;font-weight:700;color:#0B1F3A">Petit matériel — besoins de l'espace (${lines.length} article(s) · ${tot} pièce(s))</p>
    <table style="width:60%;border-collapse:collapse;font-size:11px">
      <thead><tr style="background:#0B1F3A;color:#fff"><th style="padding:4px 6px;text-align:left">Article</th><th style="padding:4px 6px;text-align:right">Quantité</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// Ordre d'affichage des catégories sur la fiche runner (le vin en premier, bien visible).
const CATEGORY_ORDER = ['Vins', 'Champagne', 'Bières', 'Soft', 'Softs', 'Spiritueux', 'Sirops', 'Gaz', 'Matériel'];
const catRank = (c: string): number => {
  const i = CATEGORY_ORDER.indexOf(c);
  return i === -1 ? CATEGORY_ORDER.length : i;
};
const FAM = {
  VIP: { label: 'VIP & Salons', accent: '#B8860B', soft: '#FBF3DD', Icon: Crown },
  Buvettes: { label: 'Buvettes & Bars', accent: '#2F6FED', soft: '#E4ECFD', Icon: CupSoda },
} as const;
const famStyle = (f: string) => (f === 'VIP' ? FAM.VIP : FAM.Buvettes);

export function UnifiedRunnerPanel({
  eventId, matchNom, matchDate,
}: {
  eventId: string;
  matchNom: string;
  matchDate: string;
}) {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [cards, setCards] = useState<Card[]>([]);
  const [board, setBoard] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [xlsBusy, setXlsBusy] = useState(false);
  const [logeSheets, setLogeSheets] = useState<Record<string, LogeBlock[]>>({});
  // Petit matériel déclaré par espace (lignes supplémentaires runner) — drapeau.
  const [pmBySpace, setPmBySpace] = useState<Record<string, PmLine[]>>({});
  // Activation d'une zone de dernière minute (ex. Club 70 Sud/Nord).
  const [allSpaces, setAllSpaces] = useState<{ space_id: string; space_name: string; service_type: string | null }[]>([]);
  const [zoneToActivate, setZoneToActivate] = useState('');
  const [asBuvette, setAsBuvette] = useState(false);
  const [activating, setActivating] = useState(false);

  const load = useCallback(async () => {
    const [c, b, sp] = await Promise.all([
      supabase.from('event_runner_space_summary').select('*').eq('event_id', eventId).order('family').order('space_name'),
      supabase.from('event_runner_board').select('*').eq('event_id', eventId),
      supabase.from('spaces').select('space_id, space_name, service_type, is_operational, is_supervisor_slot')
        .eq('active', true).order('space_name'),
    ]);
    const cardList = (c.data as Card[] | null) ?? [];
    setCards(cardList);
    setBoard((b.data as Line[] | null) ?? []);
    // Zones activables « dernière minute » : espaces de service pas encore sur la fiche.
    const spRows = (sp.data as { space_id: string; space_name: string; service_type: string | null; is_operational: boolean | null; is_supervisor_slot: boolean | null }[] | null) ?? [];
    setAllSpaces(spRows
      .filter((s) => !s.is_operational && !s.is_supervisor_slot && !LOGE_IDS.has(s.space_id) && !['Buvette 1', 'Buvette 2'].includes(s.space_name))
      .map((s) => ({ space_id: s.space_id, space_name: s.space_name, service_type: s.service_type })));
    // Détail loge par loge (pour le PDF) des espaces Loges présents.
    const logeIds = cardList.filter((x) => LOGE_IDS.has(x.space_id)).map((x) => x.space_id);
    const sheets: Record<string, LogeBlock[]> = {};
    await Promise.all(logeIds.map(async (sid) => {
      const { data } = await supabase.rpc('get_loge_runner_sheet', { p_space: sid });
      const d = data as { loges?: { loge: string; lignes?: { produit: string; qte: number }[] }[] } | null;
      sheets[sid] = (d?.loges ?? []).map((l) => ({
        loge: String(l.loge),
        lignes: (l.lignes ?? []).map((x) => ({ produit: String(x.produit), qte: num(x.qte) })),
      }));
    }));
    setLogeSheets(sheets);

    // Petit matériel : besoins déclarés par espace (lignes supplémentaires runner).
    if (PETIT_MATERIEL_ENABLED) {
      const { data: pm } = await supabase
        .from('petit_materiel_requests')
        .select('space_id, qty, petit_materiel_items(code, label, sort_order)')
        .eq('event_id', eventId)
        .gt('qty', 0);
      const rows = (pm as { space_id: string; qty: number; petit_materiel_items: { code: string; label: string; sort_order: number } | null }[] | null) ?? [];
      const byS: Record<string, PmLine[]> = {};
      for (const r of rows) {
        if (!r.petit_materiel_items) continue;
        (byS[r.space_id] ??= []).push({ code: r.petit_materiel_items.code, label: r.petit_materiel_items.label, qty: num(r.qty) });
      }
      for (const k in byS) byS[k].sort((a, b) => a.label.localeCompare(b.label, 'fr'));
      setPmBySpace(byS);
    }

    setLoading(false);
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  // Édition de la quantité « À acheminer » (persistée dans runner_auto_planning).
  const saveQty = useCallback(
    async (spaceId: string, productId: string, oldQty: number, newQty: number) => {
      if (newQty === oldQty) return;
      // Mise à jour optimiste : ligne + total de la carte.
      setBoard((prev) =>
        prev.map((l) =>
          l.space_id === spaceId && l.product_id === productId ? { ...l, qty_to_move: newQty } : l,
        ),
      );
      setCards((prev) =>
        prev.map((c) =>
          c.space_id === spaceId ? { ...c, total_to_move: num(c.total_to_move) + (newQty - oldQty) } : c,
        ),
      );
      const { data, error } = await supabase.rpc('set_runner_qty_to_move', {
        p_event_id: eventId, p_space_id: spaceId, p_product_id: productId, p_qty: newQty,
      });
      const res = data as { success: boolean; error?: string } | null;
      if (error || !res?.success) {
        showToast('Échec de l’enregistrement de la quantité à acheminer.', 'warning');
        void load(); // resynchronise depuis la base
      } else {
        showToast('Quantité à acheminer enregistrée.', 'success');
      }
    },
    [eventId, load, showToast],
  );

  // Zones pas encore présentes sur la fiche runner de ce match.
  const activatable = useMemo(() => {
    const onBoard = new Set(cards.map((c) => c.space_id));
    return allSpaces.filter((s) => !onBoard.has(s.space_id));
  }, [allSpaces, cards]);

  const activateZone = useCallback(async () => {
    const sp = activatable.find((s) => s.space_id === zoneToActivate);
    if (!sp) return;
    setActivating(true);
    const { data, error } = await supabase.rpc('activate_zone_runner', { p_event_id: eventId, p_space_id: sp.space_id, p_as_buvette: asBuvette });
    const r = data as { success?: boolean; error?: string; lines?: number; qty_to_move?: number } | null;
    setActivating(false);
    if (error || !r?.success) { showToast(`Échec : ${r?.error ?? error?.message ?? 'activation impossible'}`, 'warning'); return; }
    setZoneToActivate(''); setAsBuvette(false);
    await load();
    setExpanded(sp.space_id);
    showToast(`${sp.space_name} activé${asBuvette ? ' en format buvette' : ''} : fiche runner générée (${r.lines ?? 0} produit(s), ${r.qty_to_move ?? 0} à acheminer). Les autres zones sont inchangées.`, 'success');
  }, [activatable, zoneToActivate, asBuvette, eventId, load, showToast]);

  const linesBySpace = useMemo(() => {
    const m = new Map<string, Line[]>();
    for (const l of board) {
      const arr = m.get(l.space_id) ?? [];
      arr.push(l);
      m.set(l.space_id, arr);
    }
    // Groupé par catégorie (Vins en tête), puis manque en haut, puis nom.
    for (const [, arr] of m)
      arr.sort(
        (a, b) =>
          catRank(a.category) - catRank(b.category) ||
          a.category.localeCompare(b.category) ||
          Number(a.stock_sufficient_live) - Number(b.stock_sufficient_live) ||
          a.product_name.localeCompare(b.product_name),
      );
    return m;
  }, [board]);

  const espacesAlerte = cards.filter((c) => c.has_stock_alert).length;
  const produitsManque = new Set(board.filter((l) => !l.stock_sufficient_live).map((l) => l.product_id)).size;

  /** Construit le HTML d'une ou plusieurs fiches (une page par espace). */
  function buildHtml(spaceIds: string[]): string {
    const pages = spaceIds.map((sid, idx) => {
      const card = cards.find((c) => c.space_id === sid);
      const lines = linesBySpace.get(sid) ?? [];
      const rows = lines.map((l) => {
        const short = !l.stock_sufficient_live;
        return `<tr style="background:${short ? '#FDECEC' : '#fff'}">
          <td style="padding:4px 6px;border:1px solid #ddd">${l.product_name}</td>
          <td style="padding:4px 6px;border:1px solid #ddd">${l.category}</td>
          <td style="padding:4px 6px;border:1px solid #ddd;text-align:right">${num(l.needed_qty)}</td>
          <td style="padding:4px 6px;border:1px solid #ddd;text-align:right;font-weight:700">${num(l.qty_to_move)}</td>
          <td style="padding:4px 6px;border:1px solid #ddd;text-align:right">${num(l.area_stock)}</td>
          <td style="padding:4px 6px;border:1px solid #ddd;text-align:right">${num(l.reserve_qty)}</td>
          <td style="padding:4px 6px;border:1px solid #ddd;text-align:center">${short ? `<b style="color:#B03A2E">⚠ Manque ${num(l.shortfall_qty)}</b>` : '✅'}</td>
        </tr>`;
      }).join('');
      const totMove = lines.reduce((s, l) => s + num(l.qty_to_move), 0);
      const logeDetail = LOGE_IDS.has(sid) ? buildLogeDetailHtml(logeSheets[sid] ?? []) : '';
      const pmDetail = PETIT_MATERIEL_ENABLED ? buildPmHtml(pmBySpace[sid] ?? []) : '';
      return `<div style="${idx > 0 ? 'page-break-before:always;' : ''}font-family:Arial,sans-serif;padding:4px">
        <h2 style="margin:0 0 2px;color:#0B1F3A">${card?.space_name ?? ''} <span style="font-size:12px;color:#8A94A2">· ${card?.family ?? ''}</span></h2>
        <p style="margin:0 0 8px;font-size:11px;color:#8A94A2">${matchNom} · ${matchDate} · ${lines.length} produit(s) · ${totMove} à acheminer</p>
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead><tr style="background:#0B1F3A;color:#fff">
            <th style="padding:5px 6px;text-align:left">Produit</th><th style="padding:5px 6px;text-align:left">Catégorie</th>
            <th style="padding:5px 6px;text-align:right">Besoin</th><th style="padding:5px 6px;text-align:right">À acheminer</th>
            <th style="padding:5px 6px;text-align:right">Stock espace</th><th style="padding:5px 6px;text-align:right">Stock réserve</th>
            <th style="padding:5px 6px;text-align:center">Statut</th>
          </tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr style="background:#F2F5F9;font-weight:700"><td colspan="3" style="padding:5px 6px;border:1px solid #ddd">TOTAL</td>
            <td style="padding:5px 6px;border:1px solid #ddd;text-align:right">${totMove}</td><td colspan="3" style="border:1px solid #ddd"></td></tr></tfoot>
        </table>
        ${logeDetail}
        ${pmDetail}
      </div>`;
    }).join('');
    return `<div>${pages}</div>`;
  }

  function buildShoppingHtml(): string {
    const byProduct = new Map<string, { name: string; category: string; besoin: number; reserve: number; manque: number }>();
    for (const l of board) {
      const e = byProduct.get(l.product_id) ?? { name: l.product_name, category: l.category, besoin: 0, reserve: num(l.reserve_qty), manque: 0 };
      e.besoin += num(l.qty_to_move);
      e.reserve = num(l.reserve_qty);
      e.manque = Math.max(e.manque, num(l.shortfall_qty));
      byProduct.set(l.product_id, e);
    }
    const rows = [...byProduct.values()].sort((a, b) => b.manque - a.manque || a.name.localeCompare(b.name)).map((p) => `
      <tr style="background:${p.manque > 0 ? '#FDECEC' : '#fff'}">
        <td style="padding:4px 6px;border:1px solid #ddd">${p.name}</td>
        <td style="padding:4px 6px;border:1px solid #ddd">${p.category}</td>
        <td style="padding:4px 6px;border:1px solid #ddd;text-align:right;font-weight:700">${p.besoin}</td>
        <td style="padding:4px 6px;border:1px solid #ddd;text-align:right">${p.reserve}</td>
        <td style="padding:4px 6px;border:1px solid #ddd;text-align:center">${p.manque > 0 ? `<b style="color:#B03A2E">${p.manque}</b>` : '—'}</td>
      </tr>`).join('');
    return `<div style="font-family:Arial,sans-serif;padding:4px">
      <h2 style="margin:0 0 2px;color:#0B1F3A">Liste de courses — ${matchNom}</h2>
      <p style="margin:0 0 8px;font-size:11px;color:#8A94A2">${matchDate} · besoin total par produit vs réserve centrale</p>
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead><tr style="background:#0B1F3A;color:#fff">
          <th style="padding:5px 6px;text-align:left">Produit</th><th style="padding:5px 6px;text-align:left">Catégorie</th>
          <th style="padding:5px 6px;text-align:right">Besoin total</th><th style="padding:5px 6px;text-align:right">Réserve</th>
          <th style="padding:5px 6px;text-align:center">Manque</th>
        </tr></thead><tbody>${rows}</tbody>
      </table></div>`;
  }

  async function toPdf(html: string, filename: string) {
    if (pdfBusy) return;
    setPdfBusy(true);
    let holder: HTMLDivElement | null = null;
    try {
      holder = document.createElement('div');
      holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm';
      holder.innerHTML = html;
      document.body.appendChild(holder);
      const html2pdf = (await loadModule(() => import('html2pdf.js'), (m) => showToast(m, 'success'))).default;
      await html2pdf().set({
        margin: [10, 8, 10, 8], filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      }).from(holder.firstElementChild as HTMLElement).save();
      showToast('PDF téléchargé.', 'success');
    } catch (e) {
      showToast('Échec du PDF : ' + (e instanceof Error ? e.message : String(e)), 'warning');
    } finally {
      if (holder?.parentNode) holder.parentNode.removeChild(holder);
      setPdfBusy(false);
    }
  }

  async function toExcel() {
    if (xlsBusy) return;
    setXlsBusy(true);
    try {
      await downloadRunnerWorkbook({
        matchNom, matchDate,
        cards: cards.map((c) => ({ space_id: c.space_id, space_name: c.space_name, family: c.family })),
        linesBySpace,
        allLines: board,
        filename: `Fiches_Runner_${slug}.xlsx`,
      });
      showToast('Export Excel téléchargé.', 'success');
    } catch (e) {
      showToast('Échec de l’export Excel : ' + (e instanceof Error ? e.message : String(e)), 'warning');
    } finally {
      setXlsBusy(false);
    }
  }

  if (loading) return <Spinner />;
  if (cards.length === 0) {
    return <p className="rounded-xl bg-stone-50 px-4 py-6 text-center text-sm text-stone-400">Aucune fiche runner — générez les dotations depuis l'en-tête du match.</p>;
  }

  const slug = matchNom.replace(/\s+/g, '_');
  const families = ['VIP', 'Buvettes'].filter((f) => cards.some((c) => c.family === f));

  return (
    <div className="space-y-5">
      {/* Bandeau stock global */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white px-5 py-3">
        <div className="flex items-center gap-4 text-sm">
          {espacesAlerte === 0 ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-600"><CheckCircle2 size={16} /> Stock suffisant sur tous les espaces</span>
          ) : (
            <span className="inline-flex items-center gap-1.5 font-semibold text-rose-600">
              <AlertTriangle size={16} /> {espacesAlerte} espace(s) en alerte · {produitsManque} produit(s) en manque
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => void load()}><RefreshCw size={14} /> Rafraîchir</Button>
          <Button size="sm" variant="secondary" loading={pdfBusy} onClick={() => void toPdf(buildShoppingHtml(), `Liste_courses_${slug}.pdf`)}>
            <ShoppingCart size={14} /> Liste de courses
          </Button>
          <Button size="sm" variant="secondary" loading={xlsBusy} onClick={() => void toExcel()}>
            <FileSpreadsheet size={14} /> Excel
          </Button>
          <Button size="sm" loading={pdfBusy} onClick={() => void toPdf(buildHtml(cards.map((c) => c.space_id)), `Fiches_Runner_${slug}.pdf`)}>
            <Download size={14} /> Tout télécharger (PDF)
          </Button>
        </div>
      </div>

      {/* Activer une zone de dernière minute (ex. Club 70 Sud/Nord) */}
      {activatable.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
            <Zap size={16} className="text-amber-600" /> Activer une zone de dernière minute
          </div>
          <div className="min-w-[220px] flex-1 sm:flex-none">
            <Select
              value={zoneToActivate}
              onChange={(e) => setZoneToActivate(e.target.value)}
              options={[{ value: '', label: '— Choisir une zone à activer —' }, ...activatable.map((s) => ({ value: s.space_id, label: s.space_name }))]}
            />
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 text-sm font-medium text-amber-800" title="Doter comme une buvette (volume grand public) plutôt que sur la base pax du bar">
            <input type="checkbox" checked={asBuvette} onChange={(e) => setAsBuvette(e.target.checked)} className="h-4 w-4 rounded" />
            Format buvette (volume public)
          </label>
          <Button size="sm" disabled={!zoneToActivate || activating} loading={activating} onClick={() => void activateZone()}>
            <Zap size={14} /> Activer + générer la fiche
          </Button>
          <span className="text-xs text-amber-700/80">Génère uniquement la fiche de cette zone — les quantités des autres restent intactes.</span>
        </div>
      )}

      {/* Sections par famille */}
      {families.map((fam) => {
        const st = famStyle(fam);
        const famCards = cards.filter((c) => c.family === fam);
        return (
          <section key={fam}>
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg text-white" style={{ background: st.accent }}><st.Icon size={15} /></span>
              <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: st.accent }}>{st.label}</h2>
              <span className="text-xs text-stone-400">({famCards.length})</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {famCards.map((c) => {
                const open = expanded === c.space_id;
                return (
                  <div key={c.space_id} className="overflow-hidden rounded-2xl border" style={{ borderColor: c.has_stock_alert ? '#FCA5A5' : '#E5E7EB' }}>
                    <button onClick={() => setExpanded(open ? null : c.space_id)} className="w-full p-4 text-left transition-colors hover:bg-stone-50" style={{ background: st.soft }}>
                      <div className="flex items-center justify-between">
                        <p className="font-bold text-stone-800">{c.space_name}</p>
                        {open ? <ChevronDown size={16} className="text-stone-400" /> : <ChevronRight size={16} className="text-stone-400" />}
                      </div>
                      <p className="mt-1 text-xs text-stone-500">{num(c.nb_lignes)} produits · {num(c.total_to_move)} à acheminer · {formatEuro(num(c.cost_ht))}</p>
                      <div className="mt-2">
                        {c.has_stock_alert ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">
                            <AlertTriangle size={12} /> Stock insuffisant — {num(c.lignes_insuffisantes)} ligne(s)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                            <CheckCircle2 size={12} /> Stock OK
                          </span>
                        )}
                      </div>
                    </button>
                    {open && (
                      <div className="bg-white p-3">
                        <SpaceLines
                          lines={linesBySpace.get(c.space_id) ?? []}
                          onShortageClick={() => navigate('/admin/stock')}
                          onEditQty={(line, v) => void saveQty(line.space_id, line.product_id, num(line.qty_to_move), v)}
                        />
                        {PETIT_MATERIEL_ENABLED && (pmBySpace[c.space_id]?.length ?? 0) > 0 && (
                          <PetitMaterielRunnerBlock lines={pmBySpace[c.space_id]} />
                        )}
                        <div className="mt-2 flex justify-end">
                          <Button size="sm" variant="secondary" loading={pdfBusy} onClick={() => void toPdf(buildHtml([c.space_id]), `Fiche_${c.space_name.replace(/\s+/g, '_')}_${slug}.pdf`)}>
                            <Download size={13} /> Télécharger cette fiche
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Bloc « Petit matériel » (lignes supplémentaires) affiché sous les lignes F&B. */
function PetitMaterielRunnerBlock({ lines }: { lines: PmLine[] }) {
  const tot = lines.reduce((s, l) => s + l.qty, 0);
  return (
    <div className="mt-3 rounded-lg border border-pr-stone bg-pr-cream/40 p-2.5">
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-pr-black-soft/55">
        🧰 Petit matériel <span className="font-normal text-pr-black-soft/40">· {lines.length} article(s) · {tot} pièce(s)</span>
      </p>
      <div className="grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2">
        {lines.map((l) => (
          <div key={l.code} className="flex items-center justify-between border-b border-pr-stone/50 py-1 text-sm">
            <span className="min-w-0 truncate text-pr-black-soft/75">{l.label}</span>
            <span className="shrink-0 font-semibold tabular-nums text-pr-black">{l.qty}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Cellule éditable « À acheminer » : commit au blur / Entrée, entier ≥ 0. */
function EditableQty({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => { setV(String(value)); }, [value]);
  const commit = () => {
    const n = Math.max(0, Math.round(Number(v)));
    if (!Number.isFinite(n)) { setV(String(value)); return; }
    setV(String(n));
    if (n !== value) onSave(n);
  };
  return (
    <input
      type="number"
      min={0}
      inputMode="numeric"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className="w-16 rounded-md border border-stone-200 bg-white px-1.5 py-1 text-right text-sm font-semibold tabular-nums text-stone-800 focus:border-pr-olive focus:outline-none focus:ring-1 focus:ring-pr-olive"
      title="Modifier la quantité à acheminer (enregistrée automatiquement)"
    />
  );
}

function SpaceLines({
  lines,
  onShortageClick,
  onEditQty,
}: {
  lines: Line[];
  onShortageClick: () => void;
  onEditQty: (line: Line, value: number) => void;
}) {
  const totMove = lines.reduce((s, l) => s + num(l.qty_to_move), 0);
  const totCost = lines.reduce((s, l) => s + num(l.cost_ht), 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-100 text-left text-[11px] uppercase tracking-wide text-stone-400">
            <th className="px-2 py-1.5">Produit</th>
            <th className="px-2 py-1.5 text-right">Besoin</th>
            <th className="px-2 py-1.5 text-right">À acheminer <span className="normal-case text-stone-300" title="Modifiable">✎</span></th>
            <th className="px-2 py-1.5 text-right">Espace</th>
            <th className="px-2 py-1.5 text-right">Réserve</th>
            <th className="px-2 py-1.5 text-center">Statut</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-50">
          {lines.map((l, i) => {
            const showHeader = i === 0 || lines[i - 1].category !== l.category;
            return (
              <Fragment key={l.product_id}>
                {showHeader && (
                  <tr className="bg-stone-50/80">
                    <td colSpan={6} className="px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-stone-500">
                      {l.category}
                    </td>
                  </tr>
                )}
                <tr className={l.stock_sufficient_live ? '' : 'bg-rose-50/60'}>
                  <td className="px-2 py-1.5 font-medium text-stone-800">
                    {l.product_name}
                    {num(l.consumption_reference) > 0 && (
                      <span className="ml-1.5 rounded bg-sky-100 px-1 py-0.5 text-[9px] font-semibold text-sky-700" title="Issu de l'historique de consommation de l'espace">hist.</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{num(l.needed_qty)}</td>
                  <td className="px-2 py-1.5 text-right">
                    <EditableQty value={num(l.qty_to_move)} onSave={(v) => onEditQty(l, v)} />
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-stone-500">{num(l.area_stock)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-stone-500">{num(l.reserve_qty)}</td>
                  <td className="px-2 py-1.5 text-center">
                    {l.stock_sufficient_live ? (
                      <CheckCircle2 size={15} className="mx-auto text-emerald-500" />
                    ) : (
                      <button onClick={onShortageClick} title="Ouvrir le stock réserve pour réapprovisionner" className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-1.5 py-0.5 text-[11px] font-bold text-rose-700 hover:bg-rose-200">
                        <AlertTriangle size={11} /> Manque {num(l.shortfall_qty)}
                      </button>
                    )}
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-stone-200 font-bold text-stone-800">
            <td className="px-2 py-1.5">TOTAL</td>
            <td />
            <td className="px-2 py-1.5 text-right tabular-nums">{totMove}</td>
            <td colSpan={2} />
            <td className="px-2 py-1.5 text-right tabular-nums">{formatEuro(totCost)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
