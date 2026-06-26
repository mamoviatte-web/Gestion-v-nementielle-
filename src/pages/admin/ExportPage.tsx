import { useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import { useEventsList } from '@/hooks/useEvents';
import { useEventExportData } from '@/hooks/useEventExportData';
import { exportEventReport, getReportSummary, reportFileName } from '@/lib/export';
import { formatEuro } from '@/lib/calculations';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, Button, EmptyState, Spinner } from '@/components/ui';

export default function ExportPage() {
  const events = useEventsList();
  const [selectedId, setSelectedId] = useState<string>('');
  const { data, loading } = useEventExportData(selectedId || undefined);

  if (events.isLoading) return <Spinner fullPage label="Chargement…" />;
  const list = events.data ?? [];

  const summary = data ? getReportSummary(data) : null;

  return (
    <div>
      <PageHeader
        title="Export Excel"
        description="Bilan complet d'un événement en 3 feuilles (stocks, horaires, prestataires)."
      />

      {list.length === 0 ? (
        <EmptyState icon={FileSpreadsheet} title="Aucun événement à exporter" />
      ) : (
        <div className="space-y-6">
          {/* Sélecteur d'événement (radio) */}
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium text-slate-700">
              Événement à exporter
            </legend>
            {list.map((e) => (
              <label
                key={e.event_id}
                className="flex cursor-pointer items-center gap-3 rounded-lg bg-white p-3 ring-1 ring-slate-200 hover:bg-slate-50"
              >
                <input
                  type="radio"
                  name="event"
                  className="h-4 w-4 text-provence focus:ring-provence"
                  checked={selectedId === e.event_id}
                  onChange={() => setSelectedId(e.event_id)}
                />
                <span className="font-medium text-slate-900">{e.event_name}</span>
                <span className="text-sm text-slate-500">
                  {new Date(e.event_date).toLocaleDateString('fr-FR')}
                </span>
              </label>
            ))}
          </fieldset>

          {/* Aperçu */}
          {selectedId && loading && <Spinner label="Préparation de l'aperçu…" />}
          {selectedId && !loading && data && summary && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <PreviewCard
                  title="Bilan Stocks"
                  lines={`${summary.stockLines} ligne(s)`}
                  extra={`Total : ${formatEuro(summary.totalCost)}${summary.hasMissingPrice ? ' *' : ''}`}
                />
                <PreviewCard
                  title="Horaires Staff"
                  lines={`${summary.scheduleLines} agent(s)`}
                />
                <PreviewCard
                  title="Prestataires"
                  lines={`${summary.providerLines} prestataire(s)`}
                />
              </div>

              {summary.hasMissingPrice && (
                <Alert variant="warning">
                  * Certains produits consommés n'ont pas de prix HT (RG-005) ;
                  ils sont exclus du total.
                </Alert>
              )}

              <Button size="lg" onClick={() => exportEventReport(data)}>
                <Download className="h-5 w-5" /> Télécharger {reportFileName(data)}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PreviewCard({
  title,
  lines,
  extra,
}: {
  title: string;
  lines: string;
  extra?: string;
}) {
  return (
    <div className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
      <div className="flex items-center gap-2">
        <FileSpreadsheet className="h-5 w-5 text-provence" />
        <p className="font-semibold text-slate-900">{title}</p>
      </div>
      <p className="mt-1 text-sm text-slate-500">{lines}</p>
      {extra && <p className="text-sm font-medium text-slate-700">{extra}</p>}
    </div>
  );
}
