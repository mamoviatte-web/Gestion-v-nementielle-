import { PageHeader } from '@/components/layout/PageHeader';
import { Alert } from '@/components/ui';

export default function ExportPage() {
  return (
    <div>
      <PageHeader
        title="Export"
        description="Export Excel des consommations et coûts."
      />
      <Alert variant="info">
        L'export Excel (xlsx) sera implémenté dans une phase ultérieure.
      </Alert>
    </div>
  );
}
