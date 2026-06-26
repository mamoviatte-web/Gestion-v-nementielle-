import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui';
import { Clock } from 'lucide-react';

export default function SchedulePage() {
  return (
    <div>
      <PageHeader
        title="Horaires"
        description="Présence du personnel et des prestataires."
      />
      <EmptyState
        icon={Clock}
        title="Horaires"
        message="La saisie des horaires sera disponible dans une phase ultérieure."
      />
    </div>
  );
}
