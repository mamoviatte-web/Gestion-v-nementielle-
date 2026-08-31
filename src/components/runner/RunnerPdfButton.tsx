/**
 * RunnerPdfButton — « Télécharger les fiches runner (PDF) ».
 * StockPilot MD · Stade Maurice-David · Provence Rugby.
 *
 * Flux : 1) récupère les fiches formatées via get_runner_pdf_data (état actuel,
 * quantités modifiées manuellement comprises — AUCUNE régénération ici, pour ne
 * pas écraser les ajustements), 2) produit un PDF « 1 page par espace activé ».
 * Aucun coût affiché (règle CDC). La (re)génération est une action explicite
 * séparée (« Générer les dotations »).
 *
 * get_runner_pdf_data lit event_spaces : un événement sans espace lié produit un
 * PDF vide → message clair invitant à lier des espaces d'abord.
 */

import { useState } from 'react';
import { Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import { Button } from '@/components/ui';
import { loadModule } from '@/lib/lazyModule';

// Types renvoyés par get_runner_pdf_data.
interface Ligne {
  family: string;
  product: string;
  cat: string;
  moy_hist: number | null;
  coeff: number;
  reco: number | null;
  a_monter: number | null;
  depot: string;
}
interface Espace {
  space_name: string;
  libelle: string;
  service_type: string;
  nb_produits: number;
  total_a_monter: number;
  lignes: Ligne[];
}

interface Props {
  eventId: string;
  matchNom?: string;
  matchDate?: string;
  pax?: number | null;
  label?: string;
}

const FAMILY_RANK: Record<string, number> = {
  'Bière / Fûts': 1,
  Vins: 2,
  Champagne: 3,
  'Softs / Eau / Sirops': 4,
  'Spiritueux / Apéritifs': 5,
  'Gaz / Technique': 6,
  Autres: 7,
};

function depotClass(depot: string): string {
  if (/Sur place|Buvette locale/i.test(depot)) return 'dep-local';
  if (/Stock EST/i.test(depot)) return 'dep-est';
  if (/Fûts/i.test(depot)) return 'dep-fut';
  if (/AUC/i.test(depot)) return 'dep-auc';
  return 'dep-auc';
}

const esc = (s: unknown): string =>
  String(s ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );

function buildHtml(
  spaces: Espace[],
  matchNom: string,
  matchDate: string,
  pax?: number | null,
): string {
  const pages = spaces
    .map((sp) => {
      const lignes = [...sp.lignes].sort(
        (a, b) =>
          (FAMILY_RANK[a.family] ?? 9) - (FAMILY_RANK[b.family] ?? 9) ||
          a.product.localeCompare(b.product),
      );
      const rows = lignes
        .map(
          (l) => `
      <tr>
        <td class="prod">${esc(l.product)}</td>
        <td class="cat">${esc(l.cat)}</td>
        <td class="num">${esc(Math.round(Number(l.moy_hist ?? 0)))}</td>
        <td class="num coeff">×${Number(l.coeff ?? 1).toFixed(2)}</td>
        <td class="num amonter">${esc(l.a_monter ?? 0)}</td>
        <td class="dep"><span class="${depotClass(l.depot)}">${esc(l.depot)}</span></td>
        <td class="chk"></td>
      </tr>`,
        )
        .join('');
      return `
    <section class="page-espace">
      <header>
        <div><div class="code">${esc(sp.space_name)}</div><div class="lib">${esc(sp.libelle)}</div></div>
        <div class="hr"><div class="match">Match ${esc(matchNom)}</div>
          <div class="meta">${esc(matchDate)}${pax != null ? ` · ${esc(pax)} PAX attendus` : ''}</div></div>
      </header>
      <div class="kpis">
        <div><b>${esc(sp.nb_produits)}</b><span>produits à monter</span></div>
        <div><b>${esc(sp.total_a_monter)}</b><span>unités à monter</span></div>
        <div class="wide"><span>Base : consommations réelles · marge +20 %</span></div>
      </div>
      <table>
        <thead><tr>
          <th>Produit</th><th>Cat.</th><th>Moy. hist.</th><th>Coeff.</th>
          <th>À MONTER</th><th>Dépôt de prélèvement</th><th>✓ Monté</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <footer>StockPilot MD · Stade Maurice-David · Provence Rugby — Fiche runner générée automatiquement · Aucun coût sur cette fiche</footer>
    </section>`;
    })
    .join('');

  return `<div id="runner-print-root"><style>
    #runner-print-root { font-family:'Helvetica Neue',Arial,sans-serif; color:#1a1a2e; }
    #runner-print-root .page-espace { page-break-after: always; padding: 4px; }
    #runner-print-root .page-espace:last-child { page-break-after: auto; }
    #runner-print-root header { display:flex; justify-content:space-between; align-items:flex-end;
      border-bottom:3px solid #0b1f3a; padding-bottom:8px; }
    #runner-print-root .code { font-size:32px; font-weight:800; color:#0b1f3a; line-height:1; }
    #runner-print-root .lib { font-size:14px; color:#5a6472; margin-top:2px; }
    #runner-print-root .hr { text-align:right; }
    #runner-print-root .match { font-size:19px; font-weight:700; }
    #runner-print-root .meta { font-size:12px; color:#5a6472; }
    #runner-print-root .kpis { display:flex; gap:10px; margin:12px 0; }
    #runner-print-root .kpis > div { background:#f2f5f9; border-radius:8px; padding:8px 14px; text-align:center; }
    #runner-print-root .kpis b { font-size:22px; display:block; color:#0b1f3a; }
    #runner-print-root .kpis span { font-size:10px; color:#5a6472; text-transform:uppercase; letter-spacing:.5px; }
    #runner-print-root .kpis .wide { flex:1; display:flex; align-items:center; justify-content:center;
      background:#fff7e6; color:#8a6d1a; font-size:11px; }
    #runner-print-root table { width:100%; border-collapse:collapse; font-size:12px; }
    #runner-print-root thead { display: table-header-group; }
    #runner-print-root thead th { background:#0b1f3a; color:#fff; padding:7px 6px; text-align:left;
      font-size:10px; text-transform:uppercase; letter-spacing:.4px; }
    #runner-print-root thead th:nth-child(3), #runner-print-root thead th:nth-child(4),
    #runner-print-root thead th:nth-child(5) { text-align:center; }
    #runner-print-root tbody td { padding:6px; border-bottom:1px solid #e4e8ee; }
    #runner-print-root tbody tr:nth-child(even) { background:#f7f9fc; }
    #runner-print-root .prod { font-weight:600; }
    #runner-print-root .cat { color:#5a6472; font-size:11px; }
    #runner-print-root .num { text-align:center; }
    #runner-print-root .coeff { color:#5a6472; }
    #runner-print-root .amonter { font-weight:800; font-size:15px; color:#0b1f3a; text-align:center; }
    #runner-print-root .dep span { font-size:10px; padding:2px 7px; border-radius:10px; white-space:nowrap; }
    #runner-print-root .dep-fut { background:#e8eefb; color:#274690; }
    #runner-print-root .dep-auc { background:#e9f6ee; color:#1d7a46; }
    #runner-print-root .dep-local { background:#fdeede; color:#a2620f; }
    #runner-print-root .dep-est { background:#f3e8fb; color:#6b2a9a; }
    #runner-print-root td.chk { width:56px; border:1px solid #cfd6df; }
    #runner-print-root footer { margin-top:10px; font-size:9px; color:#8a94a2; text-align:center;
      border-top:1px solid #e4e8ee; padding-top:6px; }
  </style>${pages}</div>`;
}

export function RunnerPdfButton({
  eventId,
  matchNom = 'Match',
  matchDate = '',
  pax = null,
  label = 'Télécharger PDF',
}: Props) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  async function handleDownload() {
    if (busy) return;
    setBusy(true);
    let holder: HTMLDivElement | null = null;
    try {
      // On N' APPELLE PLUS generate_runner_dotations ici : l'impression reflète
      // l'état actuel des fiches (y compris les quantités modifiées manuellement),
      // sans écraser le travail. La (re)génération reste une action explicite via
      // le bouton dédié « Générer les dotations ».
      // Récupérer les fiches formatées telles quelles.
      const { data, error } = await supabase.rpc('get_runner_pdf_data', { p_event_id: eventId });
      if (error) throw error;

      const spaces = ((data as { spaces?: Espace[] } | null)?.spaces ?? []) as Espace[];
      if (spaces.length === 0) {
        showToast(
          "Aucun espace activé pour ce match. Liez des espaces à l'événement puis réessayez.",
          'warning',
        );
        return;
      }

      // 3) Construire le HTML hors écran et générer le PDF.
      const html = buildHtml(spaces, matchNom, matchDate, pax);
      holder = document.createElement('div');
      holder.style.position = 'fixed';
      holder.style.left = '-10000px';
      holder.style.top = '0';
      holder.style.width = '210mm';
      holder.innerHTML = html;
      document.body.appendChild(holder);

      const html2pdf = (await loadModule(() => import('html2pdf.js'), (m) => showToast(m, 'success'))).default;
      await html2pdf()
        .set({
          margin: [10, 8, 10, 8],
          filename: `Fiches_Runner_${matchNom.replace(/\s+/g, '_')}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        })
        .from(holder.firstElementChild as HTMLElement)
        .save();

      showToast(`Fiches runner (${spaces.length} espace${spaces.length > 1 ? 's' : ''}) téléchargées`, 'success');
    } catch (e) {
      console.error('[RunnerPdfButton]', e);
      showToast('Échec de la génération du PDF : ' + (e instanceof Error ? e.message : String(e)), 'warning');
    } finally {
      if (holder && holder.parentNode) holder.parentNode.removeChild(holder);
      setBusy(false);
    }
  }

  return (
    <Button variant="secondary" loading={busy} onClick={() => void handleDownload()}>
      <Download className="h-4 w-4" /> {label}
    </Button>
  );
}

export default RunnerPdfButton;
