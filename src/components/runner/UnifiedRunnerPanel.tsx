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
import { Download, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, RefreshCw, ShoppingCart, Crown, CupSoda } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import { Button, Spinner } from '@/components/ui';
import { formatEuro } from '@/lib/calculations';

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

  const load = useCallback(async () => {
    const [c, b] = await Promise.all([
      supabase.from('event_runner_space_summary').select('*').eq('event_id', eventId).order('family').order('space_name'),
      supabase.from('event_runner_board').select('*').eq('event_id', eventId),
    ]);
    setCards((c.data as Card[] | null) ?? []);
    setBoard((b.data as Line[] | null) ?? []);
    setLoading(false);
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

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
      const html2pdf = (await import('html2pdf.js')).default;
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
          <Button size="sm" loading={pdfBusy} onClick={() => void toPdf(buildHtml(cards.map((c) => c.space_id)), `Fiches_Runner_${slug}.pdf`)}>
            <Download size={14} /> Tout télécharger
          </Button>
        </div>
      </div>

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
                        <SpaceLines lines={linesBySpace.get(c.space_id) ?? []} onShortageClick={() => navigate('/admin/stock')} />
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

function SpaceLines({ lines, onShortageClick }: { lines: Line[]; onShortageClick: () => void }) {
  const totMove = lines.reduce((s, l) => s + num(l.qty_to_move), 0);
  const totCost = lines.reduce((s, l) => s + num(l.cost_ht), 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-100 text-left text-[11px] uppercase tracking-wide text-stone-400">
            <th className="px-2 py-1.5">Produit</th>
            <th className="px-2 py-1.5 text-right">Besoin</th>
            <th className="px-2 py-1.5 text-right">À acheminer</th>
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
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{num(l.qty_to_move)}</td>
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
