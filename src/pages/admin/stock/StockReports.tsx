/**
 * Onglet « Rapports » du module Stock (ROLE_STADE).
 *
 * Six générateurs de rapports Excel. Chaque carte propose les sélecteurs
 * de paramètres nécessaires puis un bouton « Télécharger Excel » qui appelle
 * la fonction d'export correspondante de `@/lib/stockReports`.
 */

import { useState, type ComponentType } from 'react';
import {
  Trophy,
  Building2,
  Package,
  Warehouse,
  Users,
  ClipboardList,
} from 'lucide-react';

import { Button, Select } from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { useEventsList } from '@/hooks/useEvents';
import { useSpaces } from '@/hooks/useSpaces';
import { useCatalog } from '@/hooks/useCatalog';
import { useStockLocations } from '@/hooks/useStockV2';
import {
  exportRapportEvenement,
  exportRapportEspace,
  exportRapportProduit,
  exportRapportStockGeneral,
  exportRapportPrestataires,
  exportRapportInventaire,
} from '@/lib/stockReports';

type ParamKind = 'event' | 'space' | 'product' | 'location' | 'none';

interface ReportDef {
  id: string;
  label: string;
  description: string;
  Icon: ComponentType<{ className?: string }>;
  params: ParamKind[];
  run: (ids: string[]) => Promise<void>;
}

const REPORTS: ReportDef[] = [
  {
    id: 'evenement',
    label: 'Rapport événement',
    description: 'Stocks consommés par espace et produit pour un événement.',
    Icon: Trophy,
    params: ['event'],
    run: ([eventId]) => exportRapportEvenement(eventId),
  },
  {
    id: 'espace',
    label: 'Rapport espace',
    description: 'Consommation cumulée par produit pour un espace.',
    Icon: Building2,
    params: ['space'],
    run: ([spaceId]) => exportRapportEspace(spaceId),
  },
  {
    id: 'produit',
    label: 'Rapport produit',
    description: 'Historique de consommation d’un produit par événement.',
    Icon: Package,
    params: ['product'],
    run: ([productId]) => exportRapportProduit(productId),
  },
  {
    id: 'stock_general',
    label: 'Rapport stock général',
    description: 'Vue globale, détail par emplacement et alertes stock.',
    Icon: Warehouse,
    params: [],
    run: () => exportRapportStockGeneral(),
  },
  {
    id: 'prestataires',
    label: 'Rapport prestataires',
    description: 'Présence des prestataires pour un événement.',
    Icon: Users,
    params: ['event'],
    run: ([eventId]) => exportRapportPrestataires(eventId),
  },
  {
    id: 'inventaire',
    label: 'Rapport inventaire',
    description: 'Comptages et écarts d’inventaire d’un emplacement.',
    Icon: ClipboardList,
    params: ['location'],
    run: ([locationId]) => exportRapportInventaire(locationId),
  },
];

const PLACEHOLDERS: Record<Exclude<ParamKind, 'none'>, string> = {
  event: 'Choisir un événement…',
  space: 'Choisir un espace…',
  product: 'Choisir un produit…',
  location: 'Choisir un emplacement…',
};

export default function StockReports() {
  const { showToast } = useToast();
  const events = useEventsList();
  const spaces = useSpaces();
  const { products } = useCatalog();
  const locations = useStockLocations();

  /** Paramètres sélectionnés par carte : reportId → (paramKind → id). */
  const [selection, setSelection] = useState<Record<string, Partial<Record<ParamKind, string>>>>(
    {},
  );
  /** Id du rapport en cours de génération (spinner du bouton). */
  const [downloading, setDownloading] = useState<string | null>(null);

  const optionsFor = (kind: ParamKind) => {
    switch (kind) {
      case 'event':
        return (events.data ?? []).map((e) => ({
          value: e.event_id,
          label: `${e.event_name} — ${e.event_date}`,
        }));
      case 'space':
        return (spaces.data ?? []).map((s) => ({
          value: s.space_id,
          label: s.space_name,
        }));
      case 'product':
        return (products.data ?? []).map((p) => ({
          value: p.product_id,
          label: p.product_name,
        }));
      case 'location':
        return (locations.data ?? []).map((l) => ({
          value: l.id,
          label: l.name,
        }));
      default:
        return [];
    }
  };

  const setParam = (reportId: string, kind: ParamKind, value: string) => {
    setSelection((prev) => ({
      ...prev,
      [reportId]: { ...prev[reportId], [kind]: value },
    }));
  };

  const handleDownload = async (report: ReportDef) => {
    const chosen = selection[report.id] ?? {};
    const ids = report.params.map((k) => chosen[k] ?? '');
    if (ids.some((id) => !id)) return;

    setDownloading(report.id);
    try {
      await report.run(ids);
      showToast('Rapport généré.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur lors de la génération.', 'warning');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-4">
      <header>
        <h2 className="font-display text-xl font-black text-pr-black">Rapports Excel</h2>
        <p className="text-sm text-pr-olive-dark">
          Générez et téléchargez les bilans de stock au format Excel.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {REPORTS.map((report) => {
          const chosen = selection[report.id] ?? {};
          const ready = report.params.every((k) => Boolean(chosen[k]));
          const Icon = report.Icon;
          return (
            <div
              key={report.id}
              className="flex flex-col gap-3 rounded-xl border border-pr-stone border-t-[3px] border-t-pr-black bg-white p-4"
            >
              <div className="flex items-start gap-3">
                <span className="rounded-lg bg-pr-cream p-2 text-pr-black">
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-display font-black text-pr-black">{report.label}</p>
                  <p className="text-sm text-pr-olive-dark">{report.description}</p>
                </div>
              </div>

              {report.params.map((kind) => (
                <Select
                  key={kind}
                  placeholder={kind === 'none' ? undefined : PLACEHOLDERS[kind]}
                  options={optionsFor(kind)}
                  value={chosen[kind] ?? ''}
                  onChange={(e) => setParam(report.id, kind, e.target.value)}
                />
              ))}

              <div className="mt-auto">
                <Button
                  fullWidth
                  disabled={!ready}
                  loading={downloading === report.id}
                  onClick={() => void handleDownload(report)}
                >
                  Télécharger Excel
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
