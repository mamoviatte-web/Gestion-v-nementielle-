import { PageHeader } from '@/components/layout/PageHeader';
import { Alert } from '@/components/ui';

export default function DashboardPage() {
  return (
    <div>
      <PageHeader
        title="Tableau de bord"
        description="Vue d'ensemble des événements et indicateurs clés."
      />
      <Alert variant="info" title="Phase 1">
        Le contenu du tableau de bord sera implémenté dans une phase
        ultérieure. La structure d'authentification et de navigation est
        opérationnelle.
      </Alert>
    </div>
  );
}
